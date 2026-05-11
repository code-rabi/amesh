package acpbridge

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"strings"
	"sync"

	"github.com/coder/websocket"
)

type RemoteEvent struct {
	Type    string
	Payload map[string]any
}

type RemoteSession struct {
	ID     string
	Status string
	Events []RemoteEvent
}

type meshClient interface {
	StartSession(ctx context.Context, agentID string, prompt string) (RemoteSession, error)
	ContinueSession(ctx context.Context, sessionID string, prompt string) (RemoteSession, error)
	CancelSession(ctx context.Context, sessionID string) error
	Subscribe(sessionID string) (<-chan RemoteEvent, func())
	AcknowledgeSnapshot(sessionID string, eventCount int)
	Close() error
}

type controlPlaneClient struct {
	baseURL    string
	websocket  string
	httpClient *http.Client

	conn *websocket.Conn

	mu          sync.Mutex
	eventCounts map[string]int
	watchers    map[string]map[chan RemoteEvent]struct{}
}

func newControlPlaneClient(ctx context.Context, serverURL string, password string) (*controlPlaneClient, error) {
	baseURL, websocketURL, err := normalizeServerURLs(serverURL)
	if err != nil {
		return nil, err
	}

	jar, err := cookiejar.New(nil)
	if err != nil {
		return nil, fmt.Errorf("create cookie jar: %w", err)
	}
	httpClient := &http.Client{Jar: jar}
	client := &controlPlaneClient{
		baseURL:     baseURL,
		websocket:   websocketURL,
		httpClient:  httpClient,
		eventCounts: map[string]int{},
		watchers:    map[string]map[chan RemoteEvent]struct{}{},
	}

	if err := client.login(ctx, password); err != nil {
		return nil, err
	}
	if err := client.connect(ctx); err != nil {
		return nil, err
	}
	return client, nil
}

func normalizeServerURLs(raw string) (string, string, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return "", "", fmt.Errorf("parse server URL %q: %w", raw, err)
	}
	if parsed.Scheme == "" {
		return "", "", fmt.Errorf("server URL %q needs a scheme", raw)
	}

	base := *parsed
	ws := *parsed

	switch parsed.Scheme {
	case "http":
		ws.Scheme = "ws"
	case "https":
		ws.Scheme = "wss"
	case "ws":
		base.Scheme = "http"
	case "wss":
		base.Scheme = "https"
	default:
		return "", "", fmt.Errorf("unsupported server URL scheme %q", parsed.Scheme)
	}

	base.Path = ""
	base.RawPath = ""
	base.RawQuery = ""
	base.Fragment = ""

	ws.Path = "/ws"
	ws.RawPath = ""
	ws.RawQuery = "role=browser"
	ws.Fragment = ""

	return strings.TrimRight(base.String(), "/"), ws.String(), nil
}

func (client *controlPlaneClient) login(ctx context.Context, password string) error {
	body, err := json.Marshal(map[string]string{"password": password})
	if err != nil {
		return fmt.Errorf("encode login body: %w", err)
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, client.baseURL+"/api/auth/login", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("build login request: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")

	response, err := client.httpClient.Do(request)
	if err != nil {
		return fmt.Errorf("login request failed: %w", err)
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("login failed with status %d", response.StatusCode)
	}
	return nil
}

func (client *controlPlaneClient) connect(ctx context.Context) error {
	cookies := client.httpClient.Jar.Cookies(mustParseURL(client.baseURL))
	header := http.Header{}
	if len(cookies) > 0 {
		parts := make([]string, 0, len(cookies))
		for _, cookie := range cookies {
			parts = append(parts, cookie.Name+"="+cookie.Value)
		}
		header.Set("Cookie", strings.Join(parts, "; "))
	}

	conn, _, err := websocket.Dial(ctx, client.websocket, &websocket.DialOptions{
		HTTPHeader: header,
	})
	if err != nil {
		return fmt.Errorf("dial ACP event websocket: %w", err)
	}
	client.conn = conn
	go client.readLoop()
	return nil
}

func mustParseURL(raw string) *url.URL {
	parsed, _ := url.Parse(raw)
	return parsed
}

func (client *controlPlaneClient) Close() error {
	if client.conn == nil {
		return nil
	}
	return client.conn.Close(websocket.StatusNormalClosure, "closing")
}

func (client *controlPlaneClient) StartSession(ctx context.Context, agentID string, prompt string) (RemoteSession, error) {
	return client.postSession(ctx, "/api/sessions", map[string]string{
		"agentId": agentID,
		"prompt":  prompt,
	})
}

func (client *controlPlaneClient) ContinueSession(ctx context.Context, sessionID string, prompt string) (RemoteSession, error) {
	return client.postSession(ctx, "/api/sessions/"+sessionID+"/input", map[string]string{
		"prompt": prompt,
	})
}

func (client *controlPlaneClient) CancelSession(ctx context.Context, sessionID string) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, client.baseURL+"/api/sessions/"+sessionID+"/cancel", http.NoBody)
	if err != nil {
		return fmt.Errorf("build cancel request: %w", err)
	}
	response, err := client.httpClient.Do(request)
	if err != nil {
		return fmt.Errorf("cancel session %s: %w", sessionID, err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("cancel session %s failed with status %d", sessionID, response.StatusCode)
	}
	return nil
}

func (client *controlPlaneClient) Subscribe(sessionID string) (<-chan RemoteEvent, func()) {
	channel := make(chan RemoteEvent, 32)

	client.mu.Lock()
	if client.watchers[sessionID] == nil {
		client.watchers[sessionID] = map[chan RemoteEvent]struct{}{}
	}
	client.watchers[sessionID][channel] = struct{}{}
	client.mu.Unlock()

	return channel, func() {
		client.mu.Lock()
		if watchers := client.watchers[sessionID]; watchers != nil {
			delete(watchers, channel)
			if len(watchers) == 0 {
				delete(client.watchers, sessionID)
			}
		}
		client.mu.Unlock()
		close(channel)
	}
}

func (client *controlPlaneClient) AcknowledgeSnapshot(sessionID string, eventCount int) {
	client.mu.Lock()
	defer client.mu.Unlock()
	if eventCount > client.eventCounts[sessionID] {
		client.eventCounts[sessionID] = eventCount
	}
}

func (client *controlPlaneClient) postSession(ctx context.Context, path string, payload map[string]string) (RemoteSession, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return RemoteSession{}, fmt.Errorf("encode session request: %w", err)
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, client.baseURL+path, bytes.NewReader(body))
	if err != nil {
		return RemoteSession{}, fmt.Errorf("build session request: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")

	response, err := client.httpClient.Do(request)
	if err != nil {
		return RemoteSession{}, fmt.Errorf("session request failed: %w", err)
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		return RemoteSession{}, fmt.Errorf("session request failed with status %d", response.StatusCode)
	}

	var view struct {
		Session struct {
			ID     string `json:"id"`
			Status string `json:"status"`
		} `json:"session"`
		Events []struct {
			EventType string         `json:"eventType"`
			Payload   map[string]any `json:"payload"`
		} `json:"events"`
	}
	if err := json.NewDecoder(response.Body).Decode(&view); err != nil {
		return RemoteSession{}, fmt.Errorf("decode session response: %w", err)
	}

	session := RemoteSession{
		ID:     view.Session.ID,
		Status: view.Session.Status,
		Events: make([]RemoteEvent, 0, len(view.Events)),
	}
	for _, event := range view.Events {
		session.Events = append(session.Events, RemoteEvent{
			Type:    event.EventType,
			Payload: event.Payload,
		})
	}
	return session, nil
}

func (client *controlPlaneClient) readLoop() {
	for {
		_, data, err := client.conn.Read(context.Background())
		if err != nil {
			client.failWatchers(err)
			return
		}

		var envelope struct {
			Type    string `json:"type"`
			Payload struct {
				Session struct {
					ID string `json:"id"`
				} `json:"session"`
				Events []struct {
					EventType string         `json:"eventType"`
					Payload   map[string]any `json:"payload"`
				} `json:"events"`
			} `json:"payload"`
		}
		if err := json.Unmarshal(data, &envelope); err != nil {
			continue
		}
		if envelope.Type != "session.updated" {
			continue
		}

		sessionID := envelope.Payload.Session.ID
		if sessionID == "" {
			continue
		}

		client.mu.Lock()
		start := client.eventCounts[sessionID]
		if start > len(envelope.Payload.Events) {
			start = len(envelope.Payload.Events)
		}
		watchers := cloneWatchers(client.watchers[sessionID])
		client.eventCounts[sessionID] = len(envelope.Payload.Events)
		client.mu.Unlock()

		for _, event := range envelope.Payload.Events[start:] {
			remoteEvent := RemoteEvent{
				Type:    event.EventType,
				Payload: event.Payload,
			}
			for _, watcher := range watchers {
				select {
				case watcher <- remoteEvent:
				default:
				}
			}
		}
	}
}

func cloneWatchers(source map[chan RemoteEvent]struct{}) []chan RemoteEvent {
	if len(source) == 0 {
		return nil
	}
	watchers := make([]chan RemoteEvent, 0, len(source))
	for watcher := range source {
		watchers = append(watchers, watcher)
	}
	return watchers
}

func (client *controlPlaneClient) failWatchers(err error) {
	client.mu.Lock()
	defer client.mu.Unlock()
	for sessionID, watchers := range client.watchers {
		for watcher := range watchers {
			select {
			case watcher <- RemoteEvent{
				Type: "session.failed",
				Payload: map[string]any{
					"error": fmt.Sprintf("ACP event stream closed: %v", err),
				},
			}:
			default:
			}
		}
		delete(client.watchers, sessionID)
	}
}
