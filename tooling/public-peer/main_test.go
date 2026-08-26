package main

import (
	"testing"
	"time"
)

func TestPublicPeerErrorCodeIsSafeAndSpecific(t *testing.T) {
	cases := map[error]string{
		errPeerConnectFailed: "connection_failed",
		errPeerSyncFailed:    "initial_sync_failed",
		errPeerSyncTimedOut:  "initial_sync_timed_out",
		errPeerTokenExpired:  "token_expired",
		errPeerTokenInvalid:  "token_invalid",
		errPeerKickedOffline: "kicked_offline",
	}
	for err, want := range cases {
		if got := publicPeerErrorCode(err); got != want {
			t.Fatalf("publicPeerErrorCode(%v) = %q, want %q", err, got, want)
		}
	}
	if got := publicPeerErrorCode(assertionError{}); got != "command_failed" {
		t.Fatalf("unexpected fallback code %q", got)
	}
}

type assertionError struct{}

func (assertionError) Error() string { return "unclassified" }

func TestConnectSuccessSignalsPeerReadiness(t *testing.T) {
	service := newPeerService()
	listener := &peerListener{service: service}
	listener.OnConnectSuccess()
	select {
	case err := <-service.syncReady:
		if err != nil {
			t.Fatalf("connect success returned readiness error: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("connect success did not signal peer readiness")
	}
}
