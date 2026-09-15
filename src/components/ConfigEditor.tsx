import React from 'react';
import { css } from '@emotion/css';
import { DataSourceHttpSettings, InlineField, Switch, useStyles2 } from '@grafana/ui';
import { DataSourcePluginOptionsEditorProps } from '@grafana/data';
import { config } from '@grafana/runtime';
import { MyDataSourceOptions, MySecureJsonData } from '../types';
import { supportsSecureSocksProxy } from '../utils/pdc';

interface Props extends DataSourcePluginOptionsEditorProps<MyDataSourceOptions, MySecureJsonData> {}

export const ConfigEditor = ({ onOptionsChange, options }: Props) => {
  const styles = useStyles2(getStyles);
  const pdcSupported = supportsSecureSocksProxy(config.featureToggles, config.buildInfo.version);

  return (
    <div className="gf-form-group">
      <DataSourceHttpSettings
        defaultUrl={'https://demo.parseable.com'}
        dataSourceConfig={options}
        onChange={onOptionsChange}
      />
      {pdcSupported && (
        <InlineField
          label="Secure SOCKS Proxy"
          labelWidth={26}
          tooltip="Route requests to Parseable through Grafana Cloud Private Data Source Connect (PDC)."
        >
          <div className={styles.toggleContainer}>
            <Switch
              value={Boolean(options.jsonData.enableSecureSocksProxy)}
              onChange={(event) =>
                onOptionsChange({
                  ...options,
                  jsonData: {
                    ...options.jsonData,
                    enableSecureSocksProxy: event.currentTarget.checked,
                  },
                })
              }
            />
          </div>
        </InlineField>
      )}
    </div>
  );
};

const getStyles = () => ({
  toggleContainer: css({
    display: 'flex',
    alignItems: 'center',
    minHeight: 32,
  }),
});
