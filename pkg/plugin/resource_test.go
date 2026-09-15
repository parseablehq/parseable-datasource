package plugin

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
)

type resourceResponseSender struct {
	response *backend.CallResourceResponse
}

func (s *resourceResponseSender) Send(response *backend.CallResourceResponse) error {
	s.response = response
	return nil
}

func TestCallResourceProxiesRelativeParseableRequest(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/base/api/v1/about" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if r.URL.Query().Get("stream") != "logs" {
			t.Fatalf("unexpected query: %s", r.URL.RawQuery)
		}
		if r.Method != http.MethodPost {
			t.Fatalf("unexpected method: %s", r.Method)
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatal(err)
		}
		if string(body) != `{"check":true}` {
			t.Fatalf("unexpected body: %s", body)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer server.Close()

	datasource := &Datasource{
		settings:   backend.DataSourceInstanceSettings{URL: server.URL + "/base"},
		httpClient: server.Client(),
	}
	sender := &resourceResponseSender{}
	err := datasource.CallResource(context.Background(), &backend.CallResourceRequest{
		Path:   "proxy",
		Method: http.MethodPost,
		URL:    "/proxy?target=%2Fapi%2Fv1%2Fabout%3Fstream%3Dlogs",
		Headers: map[string][]string{
			"Content-Type": {"application/json"},
		},
		Body: []byte(`{"check":true}`),
	}, sender)
	if err != nil {
		t.Fatal(err)
	}
	if sender.response.Status != http.StatusCreated {
		t.Fatalf("unexpected status: %d", sender.response.Status)
	}
	if string(sender.response.Body) != `{"ok":true}` {
		t.Fatalf("unexpected response: %s", sender.response.Body)
	}
}

func TestCallResourceRejectsAbsoluteTarget(t *testing.T) {
	datasource := &Datasource{httpClient: http.DefaultClient}
	sender := &resourceResponseSender{}
	err := datasource.CallResource(context.Background(), &backend.CallResourceRequest{
		Path:   "proxy",
		Method: http.MethodGet,
		URL:    "/proxy?target=https%3A%2F%2Fexample.com%2Fsecret",
	}, sender)
	if err != nil {
		t.Fatal(err)
	}
	if sender.response.Status != http.StatusBadRequest {
		t.Fatalf("unexpected status: %d", sender.response.Status)
	}
}
