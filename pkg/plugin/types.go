package plugin

import "time"

type apiMetrics []map[string]interface{}

type grafanaQuery struct {
	QueryText string `json:"queryText"`
}

type parseableQueryRequest struct {
	Query     string    `json:"query"`
	StartTime time.Time `json:"startTime"`
	EndTime   time.Time `json:"endTime"`
}
