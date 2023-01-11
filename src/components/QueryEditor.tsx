import React, { ComponentType, ChangeEvent, useState } from 'react';
import { LegacyForms, AsyncSelect, Label, InlineField, InlineFieldRow } from '@grafana/ui';
import { QueryEditorProps, SelectableValue } from '@grafana/data';
import { DataSource } from '../datasource';
import { SchemaFields, MyDataSourceOptions, MyQuery } from '../types';

const { FormField } = LegacyForms;

interface Props extends QueryEditorProps<DataSource, MyQuery, MyDataSourceOptions> {
  payload?: string;
}

export const QueryEditor: ComponentType<Props> = ({ datasource, onChange, onRunQuery, query }) => {

  const { queryText } = query;
  //const [stream, setStream] = React.useState<SelectableValue<string | number>>();

  const loadAsyncOptions = React.useCallback(() => {
    return datasource.listStreams().then(
      (result) => {
        const stream = result.map((data) => ({ label: data.name, value: data.name }));
        return stream;
      },
      (response) => {
        //setStream({ label: '', value: '' });
        throw new Error(response.statusText);
      }
    );
  }, [datasource]);

  const [value, setValue] = useState<SelectableValue<string>>();
  const [schema = '', setSchema] = React.useState<string | number>();
  const [count = '', setEventCount] = React.useState<string | number>();
  const [jsonsize = '', setJsonSize] = React.useState<string | number>();
  const [parquetsize = '', setParquetSize] = React.useState<string | number>();
  const [streamname = '', setStreamName] = React.useState<string | number>();
  //const [fielder, setFielder] = React.useState<string | number>();

  const loadStreamSchema = React.useCallback((value) => {
    if (value) {
      return datasource.streamSchema(value).then(
        (result) => {
          if (result.fields) {
            const schema = result.fields.map((data: SchemaFields) => (data.name));
            const schemaToText = schema.join(", ")
            setSchema(schemaToText);
            return schema;
          }
          return schema;
        },
        (response) => {
          throw new Error(response.statusText);
        }
      );
    }
    return '';
  }, [datasource, schema]);

  const loadStreamStats = React.useCallback((value) => {
    if (value) {
      return datasource.streamStats(value).then(
        (result) => {
          if (result.ingestion) {
            const count = result.ingestion.count;
            const jsonsize = result.ingestion.size;
            const parquetsize = result.storage?.size;
            const streamname = result.stream;
            setJsonSize(jsonsize);
            setParquetSize(parquetsize);
            setStreamName(streamname);
            setEventCount(count);
            return count;
          }
          return count;
        },
        (response) => {
          throw new Error(response.statusText);
        }
      );
    }
    return '';
  }, [datasource, count]);

  const onQueryTextChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange({ ...query, queryText: event.target.value });
  };

  React.useEffect(() => {
    const getData = setTimeout(() => {
      onRunQuery()
    },
      2000)
    return () => clearTimeout(getData)
  }, [onRunQuery, queryText])

  React.useEffect(() => {
    loadStreamSchema(value)
  }, [loadStreamSchema, value]);

  React.useEffect(() => {
    loadStreamStats(value)
  }, [loadStreamStats, value]);

  return (
    <>
      <div className="gf-form">
        <InlineField>
          <Label >
            <div style={{ width: 'fit-content', color: 'blue' }}>
            Select a log stream:
            </div>
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
              <div style={{ width: 'fit-content', textAlign: 'center', color: 'blue'}}>
                Stream {streamname} details
              </div>
            </Label>
            <Label>
              <div style={{ width: 'fit-content', color: 'blue' }}>
                Columns: 
              </div>
              <div style={{ width: 'fit-content' }}>
                { schema}
              </div>
            </Label>
            <Label>
              <div style={{ width: 'fit-content', color: 'blue' }}>
                Total events ingested:             
              </div>
              <div style={{ width: 'fit-content' }}>
                { count}
              </div>
            </Label>
            <Label>
              <div style={{ width: 'fit-content', color: 'blue' }}>
                Total ingested data size:             
              </div>
              <div style={{ width: 'fit-content' }}>
                { jsonsize}
              </div>
            </Label>
            <Label>
              <div style={{ width: 'fit-content', color: 'blue' }}>
                Total compressed data stored:             
              </div>
              <div style={{ width: 'fit-content' }}>
                { parquetsize}
              </div>
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
        tooltip="Enter the search SQL query here (use column names as displayed above)"
      />
    </>
  );
};
