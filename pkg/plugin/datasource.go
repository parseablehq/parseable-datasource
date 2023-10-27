package plugin

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/datasource"
	"github.com/grafana/grafana-plugin-sdk-go/backend/httpclient"
	"github.com/grafana/grafana-plugin-sdk-go/backend/instancemgmt"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/grafana/grafana-plugin-sdk-go/backend/tracing"
	"github.com/grafana/grafana-plugin-sdk-go/data"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
	"io"
	"net/http"
	url2 "net/url"
	"reflect"
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
	ctxLogger := log.DefaultLogger.FromContext(ctx)
	ctxLogger.Debug("QueryData", "queries", len(req.Queries))

	response := backend.NewQueryDataResponse()

	for i, q := range req.Queries {
		ctxLogger.Debug("Processing query", "number", i, "ref", q.RefID)

		if i%2 != 0 {
			response.Responses[q.RefID] = backend.ErrDataResponse(
				backend.StatusBadRequest,
				fmt.Sprintf("user friendly error for query number %v, excluding any sensitive information", i+1),
			)
			continue
		}

		res, err := d.query(ctx, req.PluginContext, q)
		switch {
		case err == nil:
			break
		case errors.Is(err, context.DeadlineExceeded):
			res = backend.ErrDataResponse(backend.StatusTimeout, "gateway timeout")
		case errors.Is(err, errRemoteRequest):
			res = backend.ErrDataResponse(backend.StatusBadGateway, "bad gateway request")
		case errors.Is(err, errRemoteResponse):
			res = backend.ErrDataResponse(backend.StatusValidationFailed, err.Error())
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
	req.Header.Set("Content-Type", "application/json")

	if err != nil {
		ctxLogger.Error("query: failed to create request", "err", err)
		return backend.DataResponse{}, fmt.Errorf("new request with context: %w", err)
	}

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
		body, err := io.ReadAll(httpResp.Body)
		if err != nil {
			ctxLogger.Error("query: failed to read response body", "err", err)
			return backend.DataResponse{}, fmt.Errorf("%w: read body: %s", errRemoteResponse, err)
		}
		return backend.DataResponse{}, fmt.Errorf("%w: expected 200 response, got %d. Response: %s", errRemoteResponse, httpResp.StatusCode, body)
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
