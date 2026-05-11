package acpbridge

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"sync"

	"github.com/NitayRabi/amesh/internal/acpconfig"
)

type Bridge struct {
	alias   acpconfig.Alias
	client  meshClient
	writeMu sync.Mutex

	sessionMu sync.Mutex
	sessions  map[string]*sessionState
}

type sessionState struct {
	LocalID    string
	RemoteID   string
	EventCount int

	mu     sync.Mutex
	active *activeTurn
}

type activeTurn struct {
	done chan promptResult
}

type promptResult struct {
	stopReason string
	err        error
}

type rpcMessage struct {
	JSONRPC string         `json:"jsonrpc"`
	ID      any            `json:"id,omitempty"`
	Method  string         `json:"method,omitempty"`
	Params  map[string]any `json:"params,omitempty"`
}

type rpcResponse struct {
	JSONRPC string    `json:"jsonrpc"`
	ID      any       `json:"id,omitempty"`
	Result  any       `json:"result,omitempty"`
	Error   *rpcError `json:"error,omitempty"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func New(ctx context.Context, alias acpconfig.Alias) (*Bridge, error) {
	client, err := newControlPlaneClient(ctx, alias.ServerURL, alias.Password)
	if err != nil {
		return nil, err
	}
	return &Bridge{
		alias:    alias,
		client:   client,
		sessions: map[string]*sessionState{},
	}, nil
}

func (bridge *Bridge) Close() error {
	return bridge.client.Close()
}

func (bridge *Bridge) Serve(ctx context.Context, stdin io.Reader, stdout io.Writer) error {
	scanner := bufio.NewScanner(stdin)
	scanner.Buffer(make([]byte, 64*1024), 8*1024*1024)

	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}

		var message rpcMessage
		if err := json.Unmarshal(line, &message); err != nil {
			bridge.writeResponse(stdout, rpcResponse{
				JSONRPC: "2.0",
				Error:   &rpcError{Code: -32700, Message: "parse error"},
			})
			continue
		}
		if message.Method == "" {
			continue
		}

		go bridge.handleMessage(ctx, stdout, message)
	}

	if err := scanner.Err(); err != nil {
		return fmt.Errorf("read ACP input: %w", err)
	}
	return nil
}

func (bridge *Bridge) handleMessage(ctx context.Context, stdout io.Writer, message rpcMessage) {
	switch message.Method {
	case "initialize":
		bridge.writeResponse(stdout, rpcResponse{
			JSONRPC: "2.0",
			ID:      message.ID,
			Result: map[string]any{
				"protocolVersion": 1,
				"agentCapabilities": map[string]any{
					"promptCapabilities": map[string]any{
						"image":           false,
						"audio":           false,
						"embeddedContext": false,
					},
				},
				"agentInfo": map[string]any{
					"name":    "amesh",
					"title":   "amesh " + bridge.alias.Name,
					"version": "0.1.0",
				},
				"authMethods": []any{},
			},
		})
	case "session/new":
		sessionID := "sess_" + randomHex(12)
		state := &sessionState{LocalID: sessionID}
		bridge.sessionMu.Lock()
		bridge.sessions[sessionID] = state
		bridge.sessionMu.Unlock()

		bridge.writeResponse(stdout, rpcResponse{
			JSONRPC: "2.0",
			ID:      message.ID,
			Result: map[string]any{
				"sessionId": sessionID,
			},
		})
	case "session/prompt":
		if message.ID == nil {
			return
		}
		state, err := bridge.lookupSession(message.Params)
		if err != nil {
			bridge.writeResponse(stdout, errorResponse(message.ID, -32602, err.Error()))
			return
		}
		prompt := flattenPrompt(message.Params["prompt"])
		if prompt == "" {
			bridge.writeResponse(stdout, errorResponse(message.ID, -32602, "session/prompt requires text or resource prompt content"))
			return
		}
		if err := bridge.startPromptTurn(ctx, state, message.ID, prompt, stdout); err != nil {
			bridge.writeResponse(stdout, errorResponse(message.ID, -32000, err.Error()))
		}
	case "session/cancel":
		state, err := bridge.lookupSession(message.Params)
		if err != nil {
			return
		}
		state.mu.Lock()
		remoteID := state.RemoteID
		state.mu.Unlock()
		if remoteID != "" {
			_ = bridge.client.CancelSession(ctx, remoteID)
		}
	default:
		if message.ID == nil {
			return
		}
		bridge.writeResponse(stdout, errorResponse(message.ID, -32601, "method not found"))
	}
}

func (bridge *Bridge) lookupSession(params map[string]any) (*sessionState, error) {
	sessionID, _ := params["sessionId"].(string)
	if sessionID == "" {
		return nil, fmt.Errorf("missing sessionId")
	}

	bridge.sessionMu.Lock()
	defer bridge.sessionMu.Unlock()
	state := bridge.sessions[sessionID]
	if state == nil {
		return nil, fmt.Errorf("unknown session %q", sessionID)
	}
	return state, nil
}

func (bridge *Bridge) startPromptTurn(
	ctx context.Context,
	state *sessionState,
	requestID any,
	prompt string,
	stdout io.Writer,
) error {
	state.mu.Lock()
	if state.active != nil {
		state.mu.Unlock()
		return fmt.Errorf("session %s already has an active prompt", state.LocalID)
	}
	turn := &activeTurn{done: make(chan promptResult, 1)}
	state.active = turn
	remoteID := state.RemoteID
	eventCount := state.EventCount
	state.mu.Unlock()

	defer func() {
		state.mu.Lock()
		if state.active == turn {
			state.active = nil
		}
		state.mu.Unlock()
	}()

	var (
		session RemoteSession
		err     error
	)
	if remoteID == "" {
		session, err = bridge.client.StartSession(ctx, bridge.alias.AgentID, prompt)
	} else {
		session, err = bridge.client.ContinueSession(ctx, remoteID, prompt)
	}
	if err != nil {
		return err
	}

	state.mu.Lock()
	if state.RemoteID == "" {
		state.RemoteID = session.ID
	}
	remoteID = state.RemoteID
	if eventCount > len(session.Events) {
		eventCount = len(session.Events)
	}
	state.EventCount = len(session.Events)
	state.mu.Unlock()

	bridge.client.AcknowledgeSnapshot(remoteID, len(session.Events))
	updates, unsubscribe := bridge.client.Subscribe(remoteID)
	defer unsubscribe()

	for _, event := range session.Events[eventCount:] {
		bridge.forwardRemoteEvent(state, turn, event, stdout)
	}
	if completed := terminalResult(session.Status); completed != "" {
		select {
		case turn.done <- promptResult{stopReason: completed}:
		default:
		}
	}

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case result := <-turn.done:
			if result.err != nil {
				bridge.writeResponse(stdout, errorResponse(requestID, -32000, result.err.Error()))
				return nil
			}
			bridge.writeResponse(stdout, rpcResponse{
				JSONRPC: "2.0",
				ID:      requestID,
				Result: map[string]any{
					"stopReason": result.stopReason,
				},
			})
			return nil
		case event := <-updates:
			bridge.forwardRemoteEvent(state, turn, event, stdout)
		}
	}
}

func (bridge *Bridge) forwardRemoteEvent(state *sessionState, turn *activeTurn, event RemoteEvent, stdout io.Writer) {
	switch event.Type {
	case "session.acp.update":
		update, ok := event.Payload["update"].(map[string]any)
		if !ok {
			return
		}
		bridge.writeNotification(stdout, map[string]any{
			"jsonrpc": "2.0",
			"method":  "session/update",
			"params": map[string]any{
				"sessionId": state.LocalID,
				"update":    update,
			},
		})
	case "session.output.delta":
		text, _ := event.Payload["text"].(string)
		if text == "" {
			return
		}
		bridge.writeNotification(stdout, map[string]any{
			"jsonrpc": "2.0",
			"method":  "session/update",
			"params": map[string]any{
				"sessionId": state.LocalID,
				"update": map[string]any{
					"sessionUpdate": "agent_message_chunk",
					"content": map[string]any{
						"type": "text",
						"text": text,
					},
				},
			},
		})
	case "session.output.completed":
		select {
		case turn.done <- promptResult{stopReason: "end_turn"}:
		default:
		}
	case "session.cancelled":
		select {
		case turn.done <- promptResult{stopReason: "cancelled"}:
		default:
		}
	case "session.failed":
		message, _ := event.Payload["error"].(string)
		if message == "" {
			message = "session failed"
		}
		select {
		case turn.done <- promptResult{err: fmt.Errorf(message)}:
		default:
		}
	}
}

func terminalResult(status string) string {
	switch status {
	case "completed":
		return "end_turn"
	case "cancelled":
		return "cancelled"
	default:
		return ""
	}
}

func flattenPrompt(value any) string {
	items, ok := value.([]any)
	if !ok {
		return ""
	}
	parts := make([]string, 0, len(items))
	for _, item := range items {
		block, ok := item.(map[string]any)
		if !ok {
			continue
		}
		switch block["type"] {
		case "text":
			if text, _ := block["text"].(string); text != "" {
				parts = append(parts, text)
			}
		case "resource_link":
			if uri, _ := block["uri"].(string); uri != "" {
				parts = append(parts, uri)
			}
		case "resource":
			if resource, ok := block["resource"].(map[string]any); ok {
				if text, _ := resource["text"].(string); text != "" {
					parts = append(parts, text)
				}
			}
		}
	}
	return joinNonEmpty(parts)
}

func joinNonEmpty(parts []string) string {
	output := ""
	for _, part := range parts {
		if part == "" {
			continue
		}
		if output != "" {
			output += "\n\n"
		}
		output += part
	}
	return output
}

func errorResponse(id any, code int, message string) rpcResponse {
	return rpcResponse{
		JSONRPC: "2.0",
		ID:      id,
		Error: &rpcError{
			Code:    code,
			Message: message,
		},
	}
}

func (bridge *Bridge) writeNotification(stdout io.Writer, payload map[string]any) {
	bridge.writeMu.Lock()
	defer bridge.writeMu.Unlock()
	_ = json.NewEncoder(stdout).Encode(payload)
}

func (bridge *Bridge) writeResponse(stdout io.Writer, response rpcResponse) {
	bridge.writeMu.Lock()
	defer bridge.writeMu.Unlock()
	_ = json.NewEncoder(stdout).Encode(response)
}

func randomHex(bytesLen int) string {
	buf := make([]byte, bytesLen)
	if _, err := rand.Read(buf); err != nil {
		return "fallback"
	}
	return hex.EncodeToString(buf)
}
