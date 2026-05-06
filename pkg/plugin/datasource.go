package plugin

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	url2 "net/url"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/datasource"
	"github.com/grafana/grafana-plugin-sdk-go/backend/httpclient"
	"github.com/grafana/grafana-plugin-sdk-go/backend/instancemgmt"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/grafana/grafana-plugin-sdk-go/backend/tracing"
	"github.com/grafana/grafana-plugin-sdk-go/data"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

var (
	_ backend.QueryDataHandler      = (*Datasource)(nil)
	_ backend.CheckHealthHandler    = (*Datasource)(nil)
	_ instancemgmt.InstanceDisposer = (*Datasource)(nil)
)

var (
	errRemoteRequest  = errors.New("remote request error")
	errRemoteResponse = errors.New("remote response error")
)

func NewDatasource(ctx context.Context, settings backend.DataSourceInstanceSettings) (instancemgmt.Instance, error) {
	opts, err := settings.HTTPClientOptions(ctx)
	if err != nil {
		return nil, fmt.Errorf("http client options: %w", err)
	}

	cl, err := httpclient.New(opts)
	if err != nil {
		return nil, fmt.Errorf("httpclient new: %w", err)
	}
	return &Datasource{
		settings:   settings,
		httpClient: cl,
	}, nil
}

var DatasourceOpts = datasource.ManageOpts{
	TracingOpts: tracing.Opts{
		CustomAttributes: []attribute.KeyValue{},
	},
}

type Datasource struct {
	settings backend.DataSourceInstanceSettings

	httpClient *http.Client
}

func (d *Datasource) Dispose() {
	d.httpClient.CloseIdleConnections()
}

func (d *Datasource) QueryData(ctx context.Context, req *backend.QueryDataRequest) (*backend.QueryDataResponse, error) {
	response := backend.NewQueryDataResponse()
	for _, q := range req.Queries {
		res, err := d.query(ctx, req.PluginContext, q)
		switch {
		case err == nil:
		case errors.Is(err, context.DeadlineExceeded):
			res = backend.ErrDataResponse(backend.StatusTimeout, "gateway timeout")
		case errors.Is(err, errRemoteRequest):
			res = backend.ErrDataResponse(backend.StatusBadGateway, "bad gateway request")
		case errors.Is(err, errRemoteResponse):
			res = backend.ErrDataResponse(backend.StatusInternal, err.Error())
		default:
			res = backend.ErrDataResponse(backend.StatusInternal, err.Error())
		}
		response.Responses[q.RefID] = res
	}

	return response, nil
}

func (d *Datasource) query(ctx context.Context, pCtx backend.PluginContext, query backend.DataQuery) (backend.DataResponse, error) {
	ctx, span := tracing.DefaultTracer().Start(
		ctx,
		"query processing",
		trace.WithAttributes(
			attribute.String("query.ref_id", query.RefID),
			attribute.String("query.type", query.QueryType),
			attribute.Int64("query.max_data_points", query.MaxDataPoints),
			attribute.Int64("query.interval_ms", query.Interval.Milliseconds()),
			attribute.Int64("query.time_range.from", query.TimeRange.From.Unix()),
			attribute.Int64("query.time_range.to", query.TimeRange.To.Unix()),
		),
	)
	defer span.End()

	ctxLogger := log.DefaultLogger.FromContext(ctx)

	url, err := url2.JoinPath(d.settings.URL, "/api/v1/query")
	if err != nil {
		return backend.DataResponse{}, fmt.Errorf("new request with context: %w", err)
	}

	if len(query.JSON) <= 0 {
		return backend.DataResponse{}, fmt.Errorf("empty query")
	}

	grafanaQuery := grafanaQuery{}
	err = json.Unmarshal(query.JSON, &grafanaQuery)
	if err != nil {
		ctxLogger.Error("query: failed to unmarshal query", "err", err)
		return backend.DataResponse{}, fmt.Errorf("unmarshal query: %w", err)
	}

	// Reject empty queries up front with a clear message rather than letting
	// them fall through to an endpoint that returns a generic 500.
	if grafanaQuery.QueryText == "" {
		return backend.DataResponse{}, fmt.Errorf("query is empty: pick a dataset and enter a PromQL expression or a monitor field before running")
	}

	// Route PromQL queries to the Prometheus-compatible endpoints. Used by
	// Unified Alerting (which always runs through the backend) and by any
	// future backend-served PromQL paths.
	if grafanaQuery.QueryLanguage == "promql" {
		return d.queryPromql(ctx, grafanaQuery, query.TimeRange)
	}

	queryRequest := parseableQueryRequest{
		Query:     grafanaQuery.QueryText,
		StartTime: query.TimeRange.From,
		EndTime:   query.TimeRange.To,
	}
	requestBodyAsString, err := json.Marshal(queryRequest)
	if err != nil {
		ctxLogger.Error("query: failed to marshal query", "err", err)
		return backend.DataResponse{}, fmt.Errorf("marshal query: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewBuffer(requestBodyAsString))
	if err != nil {
		ctxLogger.Error("query: failed to create request", "err", err)
		return backend.DataResponse{}, fmt.Errorf("new request with context: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	httpResp, err := d.httpClient.Do(req)

	switch {
	case err == nil:
		break
	case errors.Is(err, context.DeadlineExceeded):
		return backend.DataResponse{}, err
	default:
		return backend.DataResponse{}, fmt.Errorf("http client do: %w: %s", errRemoteRequest, err)
	}

	defer func() {
		if err := httpResp.Body.Close(); err != nil {
			ctxLogger.Error("query: failed to close response body", "err", err)
		}
	}()

	span.AddEvent("HTTP request done")

	if httpResp.StatusCode != http.StatusOK {
		_, err := io.ReadAll(httpResp.Body)
		if err != nil {
			ctxLogger.Error("query: failed to read response body", "err", err)
			return backend.DataResponse{}, fmt.Errorf("%w: read body: %s", errRemoteResponse, err)
		}
		return backend.DataResponse{}, fmt.Errorf("%w: expected 200 response, got %d", errRemoteResponse, httpResp.StatusCode)
	}

	var body apiMetrics
	if err := json.NewDecoder(httpResp.Body).Decode(&body); err != nil {
		return backend.DataResponse{}, fmt.Errorf("%w: decode: %s", errRemoteRequest, err)
	}
	span.AddEvent("JSON response decoded")

	values := make(map[string][]interface{})

	for i, obj := range body {
		for key, value := range obj {
			if _, ok := values[key]; !ok {
				values[key] = make([]interface{}, len(body))
			}
			values[key][i] = value
		}
	}

	var fields []*data.Field
	for key, value := range values {
		fieldType := getGrafanaFieldType(value[0])
		field := data.NewFieldFromFieldType(fieldType, len(value))
		field.Name = key
		for i, v := range value {
			if v == nil {
				continue
			}
			field.SetConcrete(i, v)
		}
		fields = append(fields, field)
	}

	frame := data.NewFrame(
		"response",
		fields...,
	)
	dataResp := backend.DataResponse{
		Frames: []*data.Frame{
			frame,
		},
	}
	span.AddEvent("Frames created")
	return dataResp, err
}

func getGrafanaFieldType(value interface{}) data.FieldType {
	if value == nil {
		return data.FieldTypeNullableString
	}

	switch reflect.TypeOf(value).Kind() {
	case reflect.String:
		return data.FieldTypeNullableString
	case reflect.Float64:
		return data.FieldTypeNullableFloat64
	case reflect.Bool:
		return data.FieldTypeNullableBool
	case reflect.Map, reflect.Slice, reflect.Array, reflect.Struct:
		return data.FieldTypeNullableJSON
	default:
		return data.FieldTypeNullableString
	}
}

func (d *Datasource) CheckHealth(ctx context.Context, _ *backend.CheckHealthRequest) (*backend.CheckHealthResult, error) {
	ctxLogger := log.DefaultLogger.FromContext(ctx)

	r, err := http.NewRequestWithContext(ctx, http.MethodGet, d.settings.URL, nil)
	if err != nil {
		return newHealthCheckErrorf("could not create request"), nil
	}
	resp, err := d.httpClient.Do(r)
	if err != nil {
		return newHealthCheckErrorf("request error"), nil
	}
	defer func() {
		if err := resp.Body.Close(); err != nil {
			ctxLogger.Error("check health: failed to close response body", "err", err.Error())
		}
	}()
	if resp.StatusCode != http.StatusOK {
		return newHealthCheckErrorf("got response code %d", resp.StatusCode), nil
	}
	return &backend.CheckHealthResult{
		Status:  backend.HealthStatusOk,
		Message: "Data source is working",
	}, nil
}

func newHealthCheckErrorf(format string, args ...interface{}) *backend.CheckHealthResult {
	return &backend.CheckHealthResult{Status: backend.HealthStatusError, Message: fmt.Sprintf(format, args...)}
}

// ---------------------------------------------------------------------------
// PromQL query path (used by Unified Alerting and any backend-served flow)
// ---------------------------------------------------------------------------

// queryPromql dispatches to the range or instant endpoint. Default behaviour
// matches the TypeScript frontend: run range when neither flag is set.
func (d *Datasource) queryPromql(ctx context.Context, gq grafanaQuery, tr backend.TimeRange) (backend.DataResponse, error) {
	wantInstant := gq.Instant != nil && *gq.Instant
	wantRange := (gq.Range != nil && *gq.Range) || !wantInstant
	if wantInstant && !wantRange {
		return d.queryPromqlInstant(ctx, gq, tr)
	}
	return d.queryPromqlRange(ctx, gq, tr)
}

func (d *Datasource) queryPromqlRange(ctx context.Context, gq grafanaQuery, tr backend.TimeRange) (backend.DataResponse, error) {
	start := tr.From.Unix()
	end := tr.To.Unix()
	step := calculateStep(end - start)

	params := url2.Values{}
	params.Set("query", gq.QueryText)
	if gq.Stream != "" {
		params.Set("stream", gq.Stream)
	}
	params.Set("start", strconv.FormatInt(start, 10))
	params.Set("end", strconv.FormatInt(end, 10))
	params.Set("step", step)
	params.Set("timestamp_format", "unix")

	return d.doPromqlRequest(ctx, "/prometheus/api/v1/query_range", params)
}

func (d *Datasource) queryPromqlInstant(ctx context.Context, gq grafanaQuery, tr backend.TimeRange) (backend.DataResponse, error) {
	params := url2.Values{}
	params.Set("query", gq.QueryText)
	if gq.Stream != "" {
		params.Set("stream", gq.Stream)
	}
	params.Set("time", strconv.FormatInt(tr.To.Unix(), 10))
	params.Set("timestamp_format", "unix")

	return d.doPromqlRequest(ctx, "/prometheus/api/v1/query", params)
}

// Build the full URL by parsing the base, setting the path, and attaching
// RawQuery separately. Avoids `url.JoinPath`'s behavior of treating the whole
// second arg as a path — which URL-escapes `?` and yields a 404.
func (d *Datasource) doPromqlRequest(ctx context.Context, path string, params url2.Values) (backend.DataResponse, error) {
	ctxLogger := log.DefaultLogger.FromContext(ctx)

	u, err := url2.Parse(d.settings.URL)
	if err != nil {
		return backend.DataResponse{}, fmt.Errorf("parse base url: %w", err)
	}
	// Append path, avoiding double-slashes.
	basePath := strings.TrimRight(u.Path, "/")
	u.Path = basePath + path
	u.RawQuery = params.Encode()
	apiURL := u.String()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		return backend.DataResponse{}, fmt.Errorf("new request: %w", err)
	}
	req.Header.Set("Accept", "application/json")

	httpResp, err := d.httpClient.Do(req)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return backend.DataResponse{}, err
		}
		return backend.DataResponse{}, fmt.Errorf("http client do: %w: %s", errRemoteRequest, err)
	}
	defer func() {
		if cerr := httpResp.Body.Close(); cerr != nil {
			ctxLogger.Error("promql: failed to close response body", "err", cerr)
		}
	}()

	body, err := io.ReadAll(httpResp.Body)
	if err != nil {
		return backend.DataResponse{}, fmt.Errorf("%w: read body: %s", errRemoteResponse, err)
	}
	if httpResp.StatusCode != http.StatusOK {
		return backend.DataResponse{}, fmt.Errorf("%w: expected 200 response, got %d: %s", errRemoteResponse, httpResp.StatusCode, string(body))
	}

	var pr promResponse
	if err := json.Unmarshal(body, &pr); err != nil {
		return backend.DataResponse{}, fmt.Errorf("%w: decode: %s", errRemoteResponse, err)
	}
	if pr.Status != "success" {
		return backend.DataResponse{}, fmt.Errorf("%w: prom error: %s", errRemoteResponse, pr.Error)
	}

	frames, err := promResultToFrames(pr.Data.ResultType, pr.Data.Result)
	if err != nil {
		return backend.DataResponse{}, fmt.Errorf("%w: to frames: %s", errRemoteResponse, err)
	}
	return backend.DataResponse{Frames: frames}, nil
}

// Mirror the frontend's calculateStep so backend + frontend produce comparable
// time-series resolutions for the same range.
func calculateStep(durationSec int64) string {
	switch {
	case durationSec <= 3600:
		return "15s"
	case durationSec <= 21600:
		return "60s"
	case durationSec <= 86400:
		return "5m"
	case durationSec <= 604800:
		return "15m"
	default:
		return "1h"
	}
}

func promResultToFrames(resultType string, raw json.RawMessage) ([]*data.Frame, error) {
	switch resultType {
	case "matrix":
		var series []promMatrixSeries
		if err := json.Unmarshal(raw, &series); err != nil {
			return nil, fmt.Errorf("matrix decode: %w", err)
		}
		return matrixToFrames(series), nil
	case "vector":
		var samples []promVectorSample
		if err := json.Unmarshal(raw, &samples); err != nil {
			return nil, fmt.Errorf("vector decode: %w", err)
		}
		return vectorToFrames(samples), nil
	case "scalar":
		var sample [2]interface{}
		if err := json.Unmarshal(raw, &sample); err != nil {
			return nil, fmt.Errorf("scalar decode: %w", err)
		}
		return scalarToFrames(sample), nil
	}
	return nil, nil
}

// Build one time-series frame with a common time axis and one value field per
// series. Missing samples are represented as nulls so alert reducers (e.g.
// `last`, `mean`) can handle them consistently.
func matrixToFrames(series []promMatrixSeries) []*data.Frame {
	if len(series) == 0 {
		return []*data.Frame{data.NewFrame("promql")}
	}

	// Union of all timestamps across series, sorted ascending.
	tsSet := map[int64]struct{}{}
	for _, s := range series {
		for _, sample := range s.Values {
			if ms, ok := promSampleTimeMs(sample[0]); ok {
				tsSet[ms] = struct{}{}
			}
		}
	}
	ts := make([]int64, 0, len(tsSet))
	for k := range tsSet {
		ts = append(ts, k)
	}
	sort.Slice(ts, func(i, j int) bool { return ts[i] < ts[j] })

	timeField := data.NewFieldFromFieldType(data.FieldTypeTime, len(ts))
	timeField.Name = "Time"
	for i, ms := range ts {
		timeField.Set(i, time.UnixMilli(ms))
	}

	fields := []*data.Field{timeField}
	for _, s := range series {
		valueMap := map[int64]*float64{}
		for _, sample := range s.Values {
			ms, ok := promSampleTimeMs(sample[0])
			if !ok {
				continue
			}
			if f, ok := promSampleValue(sample[1]); ok {
				valueMap[ms] = &f
			}
		}
		name := buildSeriesName(s.Metric)
		f := data.NewFieldFromFieldType(data.FieldTypeNullableFloat64, len(ts))
		f.Name = name
		f.Labels = data.Labels(s.Metric)
		for i, t := range ts {
			if v, ok := valueMap[t]; ok {
				f.Set(i, v)
			}
		}
		fields = append(fields, f)
	}

	frame := data.NewFrame("promql", fields...)
	return []*data.Frame{frame}
}

// Vector (instant) — one frame with Time / Value / Metric-name columns.
func vectorToFrames(samples []promVectorSample) []*data.Frame {
	timeField := data.NewFieldFromFieldType(data.FieldTypeTime, len(samples))
	timeField.Name = "Time"
	valueField := data.NewFieldFromFieldType(data.FieldTypeNullableFloat64, len(samples))
	valueField.Name = "Value"
	metricField := data.NewFieldFromFieldType(data.FieldTypeString, len(samples))
	metricField.Name = "Metric"

	for i, s := range samples {
		ms, _ := promSampleTimeMs(s.Value[0])
		timeField.Set(i, time.UnixMilli(ms))
		if v, ok := promSampleValue(s.Value[1]); ok {
			valueField.Set(i, &v)
		}
		metricField.Set(i, buildSeriesName(s.Metric))
	}
	frame := data.NewFrame("promql", timeField, valueField, metricField)
	return []*data.Frame{frame}
}

func scalarToFrames(sample [2]interface{}) []*data.Frame {
	ms, _ := promSampleTimeMs(sample[0])
	timeField := data.NewFieldFromFieldType(data.FieldTypeTime, 1)
	timeField.Name = "Time"
	timeField.Set(0, time.UnixMilli(ms))

	valueField := data.NewFieldFromFieldType(data.FieldTypeNullableFloat64, 1)
	valueField.Name = "Value"
	if v, ok := promSampleValue(sample[1]); ok {
		valueField.Set(0, &v)
	}
	frame := data.NewFrame("promql", timeField, valueField)
	return []*data.Frame{frame}
}

// Prometheus sample timestamps come as either a JSON number (unix seconds)
// when timestamp_format=unix, or an RFC3339 string otherwise. We negotiate
// unix in our requests so the numeric branch is the hot path.
func promSampleTimeMs(ts interface{}) (int64, bool) {
	switch v := ts.(type) {
	case float64:
		return int64(v * 1000), true
	case string:
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			return int64(f * 1000), true
		}
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			return t.UnixMilli(), true
		}
	}
	return 0, false
}

// Sample values are always strings in the Prometheus wire format (handles
// NaN/+Inf/-Inf/normal floats alike).
func promSampleValue(val interface{}) (float64, bool) {
	switch v := val.(type) {
	case float64:
		return v, true
	case string:
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			return f, true
		}
	}
	return 0, false
}

// Produce a grafana-friendly series name: `metric{label="v", …}` or just
// the metric name when there are no non-__name__ labels.
func buildSeriesName(labels map[string]string) string {
	name := labels["__name__"]
	if len(labels) <= 1 {
		if name == "" {
			return "value"
		}
		return name
	}
	keys := make([]string, 0, len(labels))
	for k := range labels {
		if k == "__name__" {
			continue
		}
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		parts = append(parts, fmt.Sprintf(`%s="%s"`, k, labels[k]))
	}
	if name == "" {
		return "{" + strings.Join(parts, ", ") + "}"
	}
	return name + "{" + strings.Join(parts, ", ") + "}"
}
