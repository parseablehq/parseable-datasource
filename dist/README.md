# Parseable Datasource for Grafana

This data source plugin allows you to query and visualize log data stored in Parseable server.

## Pre-requisites

[Parseable server](https://github.com/parseablehq/parseable) setup and receiving logs from your application. Read more on [Parseable documentation](https://www.parseable.io/docs/quick-start).

## Installation

- Install the plugin using the Grafana CLI, using the command `grafana-cli plugins install parseable-datasource`. Then restart Grafana. Alternatively, you can install the plugin from your Grafana instance (Configuration > Data sources > Add Data source).

- Add Parseable as a data source at the data source configuration page.

- Configure the data source specifying URL and port like `https://demo.parseable.io:443`. Parseable supports basic auth currently, so toggle the "Basic Auth" option under "Auth" section and enter the username and password under "Basic Auth Details" section. For Parseable demo server use `parseable` as both, username and password.

- Push the `Save and Test` button, if there is an error message, check the credentials and connection.

<img src="https://github.com/parseablehq/parseable-datasource/blob/main/src/img/configuration.png?raw=true" width="300" height="300">

## Usage

Once the plugin is configured with correct Parseable server instance. You can start using it to query logs and visualize them. You can use the query editor to write your own queries.

### Importing Dashboards

This plugin has a a pre-made dashboard called "Parseable Demo Data". You can find it by navigating to the data sources configuration page, selecting the Parseable data source and clicking on the Dashboards tab.

This dashboard is aimed at visualizing the logs stored in the Parseable demo server. You can use it as a starting point for your own dashboards. To use this dashboard, you will need to configure the data source with the Parseable demo server URL `https://demo.parseable.io` and credentials `parseable`, `parseable`.

## Screenshots

![query editor](https://github.com/parseablehq/parseable-datasource/blob/main/src/img/query-editor.png?raw=true)
![log dashboard](https://github.com/parseablehq/parseable-datasource/blob/main/src/img/log-visualisation.png?raw=true)
![log text view](https://github.com/parseablehq/parseable-datasource/blob/main/src/img/log-view-text.png?raw=true)
