package plugin

import (
	"encoding/json"
	"os"
	"testing"
)

// Regression: make sure our matrix / sample decoding works against the real
// Parseable /query_range response shape, including RFC3339 timestamps returned
// even when timestamp_format=unix is requested.
func TestPromMatrixDecode_Parseable(t *testing.T) {
	path := os.Getenv("PROM_RESP_JSON")
	if path == "" {
		path = "/tmp/prom_resp.json"
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Skipf("skipping: %v (set PROM_RESP_JSON to point at a captured response)", err)
	}
	var pr promResponse
	if err := json.Unmarshal(data, &pr); err != nil {
		t.Fatalf("unmarshal promResponse: %v", err)
	}
	if pr.Status != "success" {
		t.Fatalf("status = %q want success", pr.Status)
	}
	if pr.Data.ResultType != "matrix" {
		t.Fatalf("resultType = %q want matrix", pr.Data.ResultType)
	}
	var series []promMatrixSeries
	if err := json.Unmarshal(pr.Data.Result, &series); err != nil {
		t.Fatalf("unmarshal matrix: %v", err)
	}
	if len(series) == 0 {
		t.Fatal("no series")
	}
	frames := matrixToFrames(series)
	if len(frames) == 0 {
		t.Fatal("no frames")
	}
	// Expect: 1 frame, Time + one value field per series.
	f := frames[0]
	if got, want := len(f.Fields), 1+len(series); got != want {
		t.Fatalf("fields = %d want %d", got, want)
	}
	// Time field should have at least one entry.
	if f.Fields[0].Len() == 0 {
		t.Fatal("time field empty")
	}
	t.Logf("decoded %d series into frame with %d rows", len(series), f.Fields[0].Len())
}
