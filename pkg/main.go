package main

import (
	"os"

	"github.com/grafana/grafana-plugin-sdk-go/backend/datasource"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/parseablehq/parseable-datasource/pkg/plugin"
)

func main() {
	if err := datasource.Manage("parseable-parseable-datasource", plugin.NewDatasource, plugin.DatasourceOpts); err != nil {
		log.DefaultLogger.Error(err.Error())
		os.Exit(1)
	}
}
