import defaults from 'lodash/defaults';

import React, { ChangeEvent, PureComponent } from 'react';
import { LegacyForms } from '@grafana/ui';
import { QueryEditorProps } from '@grafana/data';
import { DataSource } from '../datasource';
import { MyDataSourceOptions, MyQuery } from '../types';

const { FormField } = LegacyForms;

type Props = QueryEditorProps<DataSource, MyQuery, MyDataSourceOptions>;

export class QueryEditor extends PureComponent<Props> {
  onQueryTextChange = (event: ChangeEvent<HTMLInputElement>) => {
    const { onChange, query } = this.props;
    onChange({ ...query, queryText: event.target.value });
  };

  render() {
    const query = defaults(this.props.query);
    const { queryText } = query;

    return (
      <div className="gf-form">
        <FormField
          labelWidth={12}
          inputWidth={500}
          value={queryText || ''}
          onChange={this.onQueryTextChange}
          label="SQL Query"
          tooltip="Enter the SQL query"
        />
      </div>
    );
  }
}
