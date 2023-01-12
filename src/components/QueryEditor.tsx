import React, { ComponentType, ChangeEvent, useState } from 'react';
import { LegacyForms, AsyncSelect, InlineField, InlineFieldRow, SeriesTable, Label} from '@grafana/ui';
import { QueryEditorProps, SelectableValue, GraphSeriesValue } from '@grafana/data';
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
  const [count = '', setEventCount] = React.useState<string | GraphSeriesValue>();
  const [jsonsize = '', setJsonSize] = React.useState<string | number>();
  const [parquetsize = '', setParquetSize] = React.useState<string | number>();
  const [streamname = '', setStreamName] = React.useState<string | number>();
  const [time = '', setTime] = React.useState<string | number>();
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
            const time = result.time;
            setJsonSize(jsonsize);
            setParquetSize(parquetsize);
            setStreamName(streamname);
            setEventCount(count);
            setTime(time);
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
      <InlineFieldRow>
        <InlineField>
          <Label>
            Select a log stream:
          </Label>   
        </InlineField>
        <InlineField>          
          <AsyncSelect
            loadOptions={loadAsyncOptions}
            defaultOptions
            value={value}
            onChange={v => {
              setValue(v);
            }}/>
        </InlineField>
        {/* <InlineField>
          <TextArea
            invalid={false}
            placeholder='Select a log stream (above) to view its columns'
            rows={2}
            cols={200}
            disabled={true}
            value={schema}/>
        </InlineField> */}
      </InlineFieldRow>

      <InlineFieldRow>
      <InlineField>
        <SeriesTable 
          series={[
              {
                color: '#299c46',
                isActive: true,
                label: 'Stream name',
                value: streamname
              },
              {
                color: '#299c46',
                isActive: false,
                label: 'Column names',
                value: schema
              },
              {
                color: '#299c46',
                isActive: false,
                label: 'Total ingested event count',
                value: count
              },
              {
                color: '#299c46',
                isActive: false,
                label: 'Total ingested json size',
                value: jsonsize
              },
              {
                color: '#299c46',
                isActive: false,
                label: 'Total stored data size',
                value: parquetsize
              }
            ]}
            timestamp={time}
          />
          </InlineField>
        </InlineFieldRow>

      <br></br>
      <FormField
        labelWidth={12}
        inputWidth={100}
        value={queryText || ''}
        onChange={onQueryTextChange}
        label="SQL Query"
        tooltip="Enter the SQL query here (use column names as above)"
      />
    </>
  );
};
