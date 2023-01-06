# Parseable Datasource for Grafana

This data source plugin allows you to query and visualize log data stored in Parseable server.

## Pre-requisites

[Parseable server](https://github.com/parseablehq/parseable) setup and receiving logs from your application. Read more on [Parseable documentation](https://www.parseable.io/docs/quick-start).

## Installation

- Install the plugin using the Grafana CLI, using the command `grafana-cli plugins install parseable-datasource`. Then restart Grafana. Alternatively, you can install the plugin from your Grafana instance (Configuration > Data sources > Add Data source).

- Add Parseable as a data source at the data source configuration page.

- Configure the data source specifying URL and port like `https://demo.parseable.io:443`. Parseable supports basic auth currently, so toggle the "Basic Auth" option under "Auth" section and enter the username and password under "Basic Auth Details" section. For Parseable demo server use `parseable` as both, username and password.

- Push the `Save and Test` button, if there is an error message, check the credentials and connection.

![data source config](https://github.com/parseablehq/parseable-datasource/blob/main/src/img/configuration.png?raw=true)

## Usage

Once the plugin is configured with correct Parseable server instance. You can start using it to query logs and visualize them. You can use the query editor to write your own queries.

## Screenshots

![log dashboard](https://github.com/parseablehq/parseable-datasource/blob/main/src/img/log-visualisation.png?raw=true)
![log text view](https://github.com/parseablehq/parseable-datasource/blob/main/src/img/log-view-text.png?raw=true)
