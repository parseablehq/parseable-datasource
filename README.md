# Parseable Datasource for Grafana

This data source plugin allows you to query and visualize log data stored in Parseable server.

## Pre-requisites

- [Parseable server](https://github.com/parseablehq/parseable) setup and receiving logs from your application. Read more on [Parseable documentation](https://www.parseable.io/docs/quick-start).
- Grafana installed and running. Read more on [Grafana documentation](https://grafana.com/docs/grafana/latest/installation/).

## Installation & Usage

Refer the Parseable Grafana documentation page: [https://www.parseable.io/docs/integrations/grafana](https://www.parseable.io/docs/integrations/grafana).

## Screenshots

![query editor](https://github.com/parseablehq/parseable-datasource/blob/main/src/img/query-editor.png?raw=true)
![log dashboard](https://github.com/parseablehq/parseable-datasource/blob/main/src/img/log-visualisation.png?raw=true)
![log text view](https://github.com/parseablehq/parseable-datasource/blob/main/src/img/log-view-text.png?raw=true)

## Install Parseable Datasource plugin on local Grafana - For Testing

1. [Download the binary file and install Grafana](https://grafana.com/docs/grafana/latest/setup-grafana/installation/) according to your operating system.
2. Open the extracted file > `conf` > `defaults.ini`.
3. Search for `allow_loading_unsigned_plugins = ` and replace it with:

```
allow_loading_unsigned_plugins = parseable-parseable-datasource
```

4. Create a folder called `data` > inside it, create a new folder called `plugins`. The `data` folder may already exist in your repository; then, you only need to create the `plugins` folder.
5. Copy the compressed plugin file containing assets [Parseable datasource plugin zip file] to the `plugins` folder you created inside `data`.
6. On a terminal, open the `plugins` folder > run:

```
unzip parseable-datasource-*.*.*.zip -d ./parseable-parseable-datasource
```
11. Restart the Grafana server to load the manually installed plugin.

## Dashboards

This repository also contains dashboard developed using Parseable datasource plugin as data source. Refer the [dashboards](./dashboards/) directory for more details.

## Credits

This plugin is developed in collaboration with our friends at [Technocube](https://www.technocube.co/). Thanks to them for their support and contribution.
