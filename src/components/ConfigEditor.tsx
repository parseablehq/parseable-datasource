import React from 'react';
import { DataSourceHttpSettings } from '@grafana/ui';
import { DataSourcePluginOptionsEditorProps } from '@grafana/data';
import { MyDataSourceOptions, MySecureJsonData } from '../types';

interface Props extends DataSourcePluginOptionsEditorProps<MyDataSourceOptions, MySecureJsonData> {}

export const ConfigEditor = ({ onOptionsChange, options }: Props) => {
  return (
    <div className="gf-form-group">
      <DataSourceHttpSettings
        defaultUrl={'https://demo.parseable.com'}
        dataSourceConfig={options}
        onChange={onOptionsChange}
      />
    </div>
  );
};
