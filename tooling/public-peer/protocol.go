package main

import "encoding/json"

type requestEnvelope struct {
	ID      string          `json:"id"`
	Command string          `json:"command"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

type responseEnvelope struct {
	Kind   string         `json:"kind"`
	ID     string         `json:"id,omitempty"`
	OK     bool           `json:"ok"`
	Result any            `json:"result,omitempty"`
	Error  *errorEnvelope `json:"error,omitempty"`
}

type errorEnvelope struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type loginPayload struct {
	APIAddr       string `json:"apiAddr"`
	WSAddr        string `json:"wsAddr"`
	UserID        string `json:"userID"`
	Token         string `json:"token"`
	Platform      int32  `json:"platform"`
	DataDir       string `json:"dataDir"`
	LogFilePath   string `json:"logFilePath"`
	OperationID   string `json:"operationID"`
	SyncTimeoutMs int    `json:"syncTimeoutMs"`
}

type waitEventPayload struct {
	Name      string `json:"name"`
	AfterSeq  int64  `json:"afterSeq"`
	TimeoutMs int    `json:"timeoutMs"`
}

type sendTextPayload struct {
	RecvID      string `json:"recvID"`
	Text        string `json:"text"`
	OperationID string `json:"operationID"`
}

type changeInputStatesPayload struct {
	ConversationID string `json:"conversationID"`
	Focus          bool   `json:"focus"`
	OperationID    string `json:"operationID"`
}

type getInputStatesPayload struct {
	ConversationID string `json:"conversationID"`
	UserID         string `json:"userID"`
	OperationID    string `json:"operationID"`
}

func decodePayload[T any](request requestEnvelope) (T, error) {
	var payload T
	if len(request.Payload) == 0 {
		return payload, nil
	}
	err := json.Unmarshal(request.Payload, &payload)
	return payload, err
}
