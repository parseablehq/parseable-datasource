import React, { PureComponent } from 'react';
import { DataSourceHttpSettings } from '@grafana/ui';
import { DataSourcePluginOptionsEditorProps } from '@grafana/data';
import { MyDataSourceOptions, MySecureJsonData } from '../types';

//const { SecretFormField, FormField } = LegacyForms;

interface Props extends DataSourcePluginOptionsEditorProps<MyDataSourceOptions, MySecureJsonData> {}

interface State {}

export class ConfigEditor extends PureComponent<Props, State> {
  render() {
    const { onOptionsChange, options } = this.props;
    return (
      <div className="gf-form-group">
      <DataSourceHttpSettings
      defaultUrl={'https://demo.parseable.io'}
      dataSourceConfig={options}
      showAccessOptions={true}
      onChange={onOptionsChange}
    />    
    </div>
    );
  }
}
