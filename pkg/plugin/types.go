package plugin

import (
	"encoding/json"
	"time"
)

type apiMetrics []map[string]interface{}

type grafanaQuery struct {
	QueryText     string `json:"queryText"`
	QueryLanguage string `json:"queryLanguage,omitempty"`
	Stream        string `json:"stream,omitempty"`
	Range         *bool  `json:"range,omitempty"`
	Instant       *bool  `json:"instant,omitempty"`
}

type parseableQueryRequest struct {
	Query     string    `json:"query"`
	StartTime time.Time `json:"startTime"`
	EndTime   time.Time `json:"endTime"`
}

// ---------------------------------------------------------------------------
// Prometheus-compatible response decoding (used by the PromQL query path)
// ---------------------------------------------------------------------------

type promResponse struct {
	Status string       `json:"status"`
	Error  string       `json:"error,omitempty"`
	Data   promRespData `json:"data"`
}

type promRespData struct {
	ResultType string          `json:"resultType"`
	Result     json.RawMessage `json:"result"`
}

// Matrix result: [{ metric: {...}, values: [[ts, "val"], ...] }, ...]
type promMatrixSeries struct {
	Metric map[string]string `json:"metric"`
	Values [][2]interface{}  `json:"values"`
}

// Vector result: [{ metric: {...}, value: [ts, "val"] }, ...]
type promVectorSample struct {
	Metric map[string]string `json:"metric"`
	Value  [2]interface{}    `json:"value"`
}
