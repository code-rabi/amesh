package nodeclient

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
)

// Envelope is the daemon-side runtime envelope for control-plane traffic.
type Envelope struct {
	Type      string         `json:"type"`
	RequestID string         `json:"requestId"`
	SessionID *string        `json:"sessionId"`
	Source    string         `json:"source"`
	Target    string         `json:"target"`
	Payload   map[string]any `json:"payload"`
}

// Client maintains the long-lived websocket tunnel to the control plane.
type Client struct {
	serverURL string
	conn      *websocket.Conn
	mu        sync.Mutex
}

// RegistrationResult contains durable credentials returned by the control plane.
type RegistrationResult struct {
	NodeID         string
	ReconnectToken string
}

// New creates a websocket control-plane client.
func New(serverURL string) *Client {
	return &Client{serverURL: serverURL}
}

// Connect dials the control plane websocket endpoint.
func (client *Client) Connect(ctx context.Context) error {
	headers := http.Header{}
	conn, _, err := websocket.Dial(ctx, client.serverURL, &websocket.DialOptions{
		HTTPHeader: headers,
	})
	if err != nil {
		return fmt.Errorf("dial control plane: %w", err)
	}
	client.conn = conn
	return nil
}

// Close terminates the active websocket connection.
func (client *Client) Close() error {
	if client.conn == nil {
		return nil
	}
	return client.conn.Close(websocket.StatusNormalClosure, "closing")
}

// Send serializes and writes one envelope over the websocket tunnel.
func (client *Client) Send(ctx context.Context, envelope Envelope) error {
	if client.conn == nil {
		return fmt.Errorf("send websocket envelope: not connected")
	}
	payload, err := json.Marshal(envelope)
	if err != nil {
		return fmt.Errorf("encode websocket envelope: %w", err)
	}
	client.mu.Lock()
	defer client.mu.Unlock()
	if err := client.conn.Write(ctx, websocket.MessageText, payload); err != nil {
		return fmt.Errorf("write websocket envelope: %w", err)
	}
	return nil
}

// Read blocks until the next envelope arrives.
func (client *Client) Read(ctx context.Context) (Envelope, error) {
	if client.conn == nil {
		return Envelope{}, fmt.Errorf("read websocket envelope: not connected")
	}
	_, data, err := client.conn.Read(ctx)
	if err != nil {
		return Envelope{}, fmt.Errorf("read websocket envelope: %w", err)
	}
	var envelope Envelope
	if err := json.Unmarshal(data, &envelope); err != nil {
		return Envelope{}, fmt.Errorf("decode websocket envelope: %w", err)
	}
	return envelope, nil
}

// Register sends the initial register envelope and waits for durable credentials.
func (client *Client) Register(ctx context.Context, envelope Envelope) (RegistrationResult, error) {
	if err := client.Send(ctx, envelope); err != nil {
		return RegistrationResult{}, err
	}

	reply, err := client.Read(ctx)
	if err != nil {
		return RegistrationResult{}, err
	}
	if reply.Type != "node.registered" {
		return RegistrationResult{}, fmt.Errorf("unexpected register reply %q", reply.Type)
	}

	nodeID, _ := reply.Payload["nodeId"].(string)
	reconnectToken, _ := reply.Payload["reconnectToken"].(string)
	if nodeID == "" || reconnectToken == "" {
		return RegistrationResult{}, fmt.Errorf("register reply missing durable credentials")
	}
	return RegistrationResult{
		NodeID:         nodeID,
		ReconnectToken: reconnectToken,
	}, nil
}

// HeartbeatLoop sends node heartbeats until the context is cancelled.
func (client *Client) HeartbeatLoop(ctx context.Context, nodeID string) error {
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			if err := client.Send(ctx, Envelope{
				Type:      "node.heartbeat",
				RequestID: fmt.Sprintf("hb-%d", time.Now().UnixNano()),
				Source:    nodeID,
				Target:    "server",
				Payload: map[string]any{
					"nodeId":     nodeID,
					"observedAt": time.Now().UTC().Format(time.RFC3339),
				},
			}); err != nil {
				return err
			}
		}
	}
}
