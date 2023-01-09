import React, { ComponentType, ChangeEvent, useState } from 'react';
import { LegacyForms, AsyncSelect, Label, InlineField, InlineFieldRow } from '@grafana/ui';
import { QueryEditorProps, SelectableValue } from '@grafana/data';
import { DataSource } from '../datasource';
import { MyDataSourceOptions, MyQuery } from '../types';

const { FormField } = LegacyForms;

interface Props extends QueryEditorProps<DataSource, MyQuery, MyDataSourceOptions> {
  payload?: string;
}

export const QueryEditor: ComponentType<Props> = ({ datasource, onChange, onRunQuery, query }) => {

  const { queryText } = query;
  const [stream, setStream] = React.useState<SelectableValue<string | number>>();

  const loadAsyncOptions = React.useCallback(() => {
    return datasource.listMetrics().then(
      (result) => {
        const stream = result.map((data) => ({ label: data.name, value: data.name }));
        setStream(stream);
        return stream;
      },
      (response) => {
        setStream({ label: '', value: '' });
        throw new Error(response.statusText);
      }
    );
  }, [datasource]);

  const [value, setValue] = useState<SelectableValue<string>>();
  const [schema, setSchema] = React.useState<string | number>();

  const loadSchemaOptions = React.useCallback((value) => {
    if (value) {
      return datasource.listSchema(value).then(
        (result) => {
          const schema = result.map((data) => (data.name));
          const schemaToText = schema.join(", ")
          setSchema(schemaToText);
          return schema;
        },
        (response) => {
          throw new Error(response.statusText);
        }
      );
    }
  }, [value]);

  const onQueryTextChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange({ ...query, queryText: event.target.value });
  };

  React.useEffect(() => {
    const getData = setTimeout(() => {
      onRunQuery()
    },
      2000)
    return () => clearTimeout(getData)
  }, [queryText])

  React.useEffect(() => {
    loadSchemaOptions(value)
  }, [value]);

  return (
    <>
      <div className="gf-form">
        <InlineField>
          <Label >
            StreamName:
            <div style={{ width: 200 + 'px', marginRight: '20px', marginLeft: '20px' }}>
              <AsyncSelect
                loadOptions={loadAsyncOptions}
                defaultOptions
                value={value}
                onChange={v => {
                  setValue(v);
                }}
              />
            </div>
          </Label>
        </InlineField>

        <InlineFieldRow>
          <div>
            <Label>
              Schema: {schema}
            </Label>
          </div>
        </InlineFieldRow>
      </div>

      <FormField
        labelWidth={12}
        inputWidth={100}
        value={queryText || ''}
        onChange={onQueryTextChange}
        label="SQL Query"
        tooltip="Enter the search SQL query here."
      />
    </>
  );
};