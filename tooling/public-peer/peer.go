package main

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/openimsdk/openim-sdk-core/v3/open_im_sdk"
	"github.com/openimsdk/openim-sdk-core/v3/pkg/ccontext"
	"github.com/openimsdk/openim-sdk-core/v3/sdk_struct"
)

type peerEvent struct {
	Seq     int64           `json:"seq"`
	Name    string          `json:"name"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

type peerService struct {
	mu          sync.Mutex
	client      *open_im_sdk.LoginMgr
	events      []peerEvent
	eventSignal chan struct{}
	nextSeq     int64
	loggedIn    bool
	loginConfig loginPayload
	syncReady   chan struct{}
}

func newPeerService() *peerService {
	return &peerService{eventSignal: make(chan struct{}), syncReady: make(chan struct{}, 1)}
}

func (s *peerService) operationContext(operationID string) context.Context {
	ctx := s.client.Context()
	if operationID != "" {
		ctx = ccontext.WithOperationID(ctx, operationID)
	}
	return ctx
}

func ensureDirectory(path string) error {
	if path == "" || !filepath.IsAbs(path) {
		return errors.New("public peer directory must be absolute")
	}
	return os.MkdirAll(path, 0o700)
}

func (s *peerService) login(payload loginPayload) error {
	if payload.APIAddr == "" || payload.WSAddr == "" || payload.UserID == "" || payload.Token == "" || payload.Platform <= 0 {
		return errors.New("public peer login payload is incomplete")
	}
	if err := ensureDirectory(payload.DataDir); err != nil {
		return err
	}
	if payload.LogFilePath == "" {
		payload.LogFilePath = payload.DataDir
	}
	if err := ensureDirectory(payload.LogFilePath); err != nil {
		return err
	}
	s.client = new(open_im_sdk.LoginMgr)
	s.syncReady = make(chan struct{}, 1)
	listener := &peerListener{service: s}
	config := sdk_struct.IMConfig{
		SystemType:          "unix-public-peer",
		PlatformID:          payload.Platform,
		ApiAddr:             payload.APIAddr,
		WsAddr:              payload.WSAddr,
		DataDir:             payload.DataDir,
		LogLevel:            4,
		IsLogStandardOutput: false,
		LogFilePath:         payload.LogFilePath,
	}
	if !s.client.InitSDK(config, listener) {
		return errors.New("public peer init failed")
	}
	s.client.SetConversationListener(listener)
	s.client.SetAdvancedMsgListener(listener)
	s.client.SetFriendshipListener(listener)
	s.client.SetGroupListener(listener)
	s.client.SetUserListener(listener)
	s.loginConfig = payload
	if err := s.client.Login(s.operationContext(payload.OperationID), payload.UserID, payload.Token); err != nil {
		return err
	}
	timeout := time.Duration(payload.SyncTimeoutMs) * time.Millisecond
	if timeout <= 0 {
		timeout = 60 * time.Second
	}
	select {
	case <-s.syncReady:
	case <-time.After(timeout):
		return errors.New("public peer initial sync timed out")
	}
	s.mu.Lock()
	s.loggedIn = true
	s.mu.Unlock()
	return nil
}

func (s *peerService) logoutSession() error {
	s.mu.Lock()
	loggedIn := s.loggedIn
	s.mu.Unlock()
	if !loggedIn || s.client == nil {
		return errors.New("public peer is not logged in")
	}
	if err := s.client.Logout(s.operationContext("public_peer_logout")); err != nil {
		return err
	}
	s.mu.Lock()
	s.loggedIn = false
	s.mu.Unlock()
	return nil
}

func (s *peerService) loginSession() error {
	s.mu.Lock()
	loggedIn := s.loggedIn
	s.mu.Unlock()
	if loggedIn || s.client == nil {
		return errors.New("public peer session state is invalid")
	}
	s.syncReady = make(chan struct{}, 1)
	if err := s.client.Login(s.operationContext("public_peer_relogin"), s.loginConfig.UserID, s.loginConfig.Token); err != nil {
		return err
	}
	timeout := time.Duration(s.loginConfig.SyncTimeoutMs) * time.Millisecond
	if timeout <= 0 {
		timeout = 60 * time.Second
	}
	select {
	case <-s.syncReady:
	case <-time.After(timeout):
		return errors.New("public peer relogin sync timed out")
	}
	s.mu.Lock()
	s.loggedIn = true
	s.mu.Unlock()
	return nil
}

func (s *peerService) emitEvent(name string, payload string) {
	raw := json.RawMessage(payload)
	if !json.Valid(raw) {
		encoded, _ := json.Marshal(payload)
		raw = encoded
	}
	s.mu.Lock()
	s.nextSeq++
	s.events = append(s.events, peerEvent{Seq: s.nextSeq, Name: name, Payload: raw})
	if len(s.events) > 512 {
		s.events = append([]peerEvent(nil), s.events[len(s.events)-512:]...)
	}
	close(s.eventSignal)
	s.eventSignal = make(chan struct{})
	s.mu.Unlock()
}

func (s *peerService) eventCursor() int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.nextSeq
}

func (s *peerService) waitEvent(payload waitEventPayload) (peerEvent, error) {
	timeout := time.Duration(payload.TimeoutMs) * time.Millisecond
	if timeout <= 0 || timeout > 2*time.Minute {
		timeout = 60 * time.Second
	}
	deadline := time.NewTimer(timeout)
	defer deadline.Stop()
	for {
		s.mu.Lock()
		for _, event := range s.events {
			if event.Seq > payload.AfterSeq && event.Name == payload.Name {
				s.mu.Unlock()
				return event, nil
			}
		}
		signal := s.eventSignal
		s.mu.Unlock()
		select {
		case <-signal:
		case <-deadline.C:
			return peerEvent{}, errors.New("public peer event wait timed out")
		}
	}
}

func (s *peerService) sendText(payload sendTextPayload) (map[string]any, error) {
	if s.client == nil || payload.RecvID == "" || payload.Text == "" {
		return nil, errors.New("public peer send payload is invalid")
	}
	ctx := s.operationContext(payload.OperationID)
	message, err := s.client.Conversation().CreateTextMessage(ctx, payload.Text)
	if err != nil {
		return nil, err
	}
	sent, err := s.client.Conversation().SendMessage(ctx, message, payload.RecvID, "", nil, false)
	if err != nil {
		return nil, err
	}
	return map[string]any{"message": sent}, nil
}

func (s *peerService) changeInputStates(payload changeInputStatesPayload) (map[string]any, error) {
	if s.client == nil || payload.ConversationID == "" {
		return nil, errors.New("public peer input-state payload is invalid")
	}
	err := s.client.Conversation().ChangeInputStates(s.operationContext(payload.OperationID), payload.ConversationID, payload.Focus)
	return map[string]any{"focus": payload.Focus}, err
}

func (s *peerService) getInputStates(payload getInputStatesPayload) (map[string]any, error) {
	if s.client == nil || payload.ConversationID == "" || payload.UserID == "" {
		return nil, errors.New("public peer input-state query is invalid")
	}
	states, err := s.client.Conversation().GetInputStates(s.operationContext(payload.OperationID), payload.ConversationID, payload.UserID)
	return map[string]any{"states": states}, err
}

func (s *peerService) shutdown() error {
	s.mu.Lock()
	loggedIn := s.loggedIn
	s.mu.Unlock()
	if s.client == nil {
		return nil
	}
	if loggedIn {
		_ = s.client.Logout(s.operationContext("public_peer_shutdown"))
	}
	s.client.UnInitSDK()
	s.mu.Lock()
	s.loggedIn = false
	s.mu.Unlock()
	return nil
}

type peerListener struct{ service *peerService }

func (l *peerListener) OnConnecting()                          {}
func (l *peerListener) OnConnectSuccess()                      {}
func (l *peerListener) OnConnectFailed(int32, string)          {}
func (l *peerListener) OnKickedOffline()                       {}
func (l *peerListener) OnUserTokenExpired()                    {}
func (l *peerListener) OnUserTokenInvalid(string)              {}
func (l *peerListener) OnSyncServerStart(bool)                 {}
func (l *peerListener) OnSyncServerProgress(int)               {}
func (l *peerListener) OnSyncServerFailed(bool)                {}
func (l *peerListener) OnNewConversation(string)               {}
func (l *peerListener) OnConversationChanged(string)           {}
func (l *peerListener) OnTotalUnreadMessageCountChanged(int32) {}
func (l *peerListener) OnConversationUserInputStatusChanged(v string) {
	l.service.emitEvent("OnConversationUserInputStatusChanged", v)
}
func (l *peerListener) OnSyncServerFinish(bool) {
	select {
	case l.service.syncReady <- struct{}{}:
	default:
	}
}
func (l *peerListener) OnRecvNewMessage(v string)     { l.service.emitEvent("OnRecvNewMessage", v) }
func (l *peerListener) OnRecvC2CReadReceipt(v string) { l.service.emitEvent("OnRecvC2CReadReceipt", v) }
func (l *peerListener) OnNewRecvMessageRevoked(v string) {
	l.service.emitEvent("OnNewRecvMessageRevoked", v)
}
func (l *peerListener) OnRecvOfflineNewMessage(v string) {
	l.service.emitEvent("OnRecvOfflineNewMessage", v)
}
func (l *peerListener) OnMsgDeleted(v string) { l.service.emitEvent("OnMsgDeleted", v) }
func (l *peerListener) OnRecvOnlineOnlyMessage(v string) {
	l.service.emitEvent("OnRecvOnlineOnlyMessage", v)
}
func (l *peerListener) OnFriendApplicationAdded(v string) {
	l.service.emitEvent("OnFriendApplicationAdded", v)
}
func (l *peerListener) OnFriendApplicationDeleted(v string) {
	l.service.emitEvent("OnFriendApplicationDeleted", v)
}
func (l *peerListener) OnFriendApplicationAccepted(v string) {
	l.service.emitEvent("OnFriendApplicationAccepted", v)
}
func (l *peerListener) OnFriendApplicationRejected(v string) {
	l.service.emitEvent("OnFriendApplicationRejected", v)
}
func (l *peerListener) OnFriendAdded(v string)        { l.service.emitEvent("OnFriendAdded", v) }
func (l *peerListener) OnFriendDeleted(v string)      { l.service.emitEvent("OnFriendDeleted", v) }
func (l *peerListener) OnFriendInfoChanged(v string)  { l.service.emitEvent("OnFriendInfoChanged", v) }
func (l *peerListener) OnBlackAdded(v string)         { l.service.emitEvent("OnBlackAdded", v) }
func (l *peerListener) OnBlackDeleted(v string)       { l.service.emitEvent("OnBlackDeleted", v) }
func (l *peerListener) OnJoinedGroupAdded(v string)   { l.service.emitEvent("OnJoinedGroupAdded", v) }
func (l *peerListener) OnJoinedGroupDeleted(v string) { l.service.emitEvent("OnJoinedGroupDeleted", v) }
func (l *peerListener) OnGroupMemberAdded(v string)   { l.service.emitEvent("OnGroupMemberAdded", v) }
func (l *peerListener) OnGroupMemberDeleted(v string) { l.service.emitEvent("OnGroupMemberDeleted", v) }
func (l *peerListener) OnGroupApplicationAdded(v string) {
	l.service.emitEvent("OnGroupApplicationAdded", v)
}
func (l *peerListener) OnGroupApplicationDeleted(v string) {
	l.service.emitEvent("OnGroupApplicationDeleted", v)
}
func (l *peerListener) OnGroupInfoChanged(v string) { l.service.emitEvent("OnGroupInfoChanged", v) }
func (l *peerListener) OnGroupDismissed(v string)   { l.service.emitEvent("OnGroupDismissed", v) }
func (l *peerListener) OnGroupMemberInfoChanged(v string) {
	l.service.emitEvent("OnGroupMemberInfoChanged", v)
}
func (l *peerListener) OnGroupApplicationAccepted(v string) {
	l.service.emitEvent("OnGroupApplicationAccepted", v)
}
func (l *peerListener) OnGroupApplicationRejected(v string) {
	l.service.emitEvent("OnGroupApplicationRejected", v)
}
func (l *peerListener) OnSelfInfoUpdated(v string)   { l.service.emitEvent("OnSelfInfoUpdated", v) }
func (l *peerListener) OnUserStatusChanged(v string) { l.service.emitEvent("OnUserStatusChanged", v) }
func (l *peerListener) OnUserCommandAdd(string)      {}
func (l *peerListener) OnUserCommandDelete(string)   {}
func (l *peerListener) OnUserCommandUpdate(string)   {}
