package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"os"
)

func publicPeerErrorCode(err error) string {
	switch {
	case errors.Is(err, errPeerConnectFailed):
		return "connection_failed"
	case errors.Is(err, errPeerSyncFailed):
		return "initial_sync_failed"
	case errors.Is(err, errPeerSyncTimedOut):
		return "initial_sync_timed_out"
	case errors.Is(err, errPeerTokenExpired):
		return "token_expired"
	case errors.Is(err, errPeerTokenInvalid):
		return "token_invalid"
	case errors.Is(err, errPeerKickedOffline):
		return "kicked_offline"
	default:
		return "command_failed"
	}
}

func writeResponse(encoder *json.Encoder, response responseEnvelope) error {
	return encoder.Encode(response)
}

func handleRequest(service *peerService, request requestEnvelope) (any, error) {
	switch request.Command {
	case "login":
		payload, err := decodePayload[loginPayload](request)
		if err != nil {
			return nil, err
		}
		return map[string]any{"loggedIn": true}, service.login(payload)
	case "logout_session":
		return map[string]any{"loggedIn": false}, service.logoutSession()
	case "login_session":
		return map[string]any{"loggedIn": true}, service.loginSession()
	case "event_cursor":
		return map[string]any{"seq": service.eventCursor()}, nil
	case "wait_event":
		payload, err := decodePayload[waitEventPayload](request)
		if err != nil {
			return nil, err
		}
		return service.waitEvent(payload)
	case "send_text":
		payload, err := decodePayload[sendTextPayload](request)
		if err != nil {
			return nil, err
		}
		return service.sendText(payload)
	case "change_input_states":
		payload, err := decodePayload[changeInputStatesPayload](request)
		if err != nil {
			return nil, err
		}
		return service.changeInputStates(payload)
	case "get_input_states":
		payload, err := decodePayload[getInputStatesPayload](request)
		if err != nil {
			return nil, err
		}
		return service.getInputStates(payload)
	case "shutdown":
		return map[string]any{"stopped": true}, service.shutdown()
	default:
		return nil, errors.New("unsupported public peer command")
	}
}

func main() {
	service := newPeerService()
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	encoder := json.NewEncoder(os.Stdout)
	for scanner.Scan() {
		var request requestEnvelope
		if err := json.Unmarshal(scanner.Bytes(), &request); err != nil || request.ID == "" {
			_ = writeResponse(encoder, responseEnvelope{Kind: "response", OK: false, Error: &errorEnvelope{Code: "request_invalid", Message: "public peer request is invalid"}})
			continue
		}
		result, err := handleRequest(service, request)
		if err != nil {
			_ = writeResponse(encoder, responseEnvelope{Kind: "response", ID: request.ID, OK: false, Error: &errorEnvelope{Code: publicPeerErrorCode(err), Message: "public peer command failed"}})
			continue
		}
		_ = writeResponse(encoder, responseEnvelope{Kind: "response", ID: request.ID, OK: true, Result: result})
		if request.Command == "shutdown" {
			return
		}
	}
	_ = service.shutdown()
}
