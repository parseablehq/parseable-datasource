import React, { useState, useCallback, useMemo } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2, SelectableValue } from '@grafana/data';
import { Select, AsyncSelect, Button, IconButton, useStyles2 } from '@grafana/ui';
import { FilterCondition } from '../types';
import { FieldTypeMap, getOperators, typeDisplayName } from '../utils/fieldTypes';
import { isNullOperator } from '../utils/queryBuilder';
import { DataSource } from '../datasource';

interface FilterBuilderProps {
  filters: FilterCondition[];
  fieldTypeMap: FieldTypeMap;
  fieldNames: string[];
  streamName?: string;
  datasource: DataSource;
  onChange: (filters: FilterCondition[]) => void;
}

export const FilterBuilder: React.FC<FilterBuilderProps> = ({
  filters,
  fieldTypeMap,
  fieldNames,
  streamName,
  datasource,
  onChange,
}) => {
  const styles = useStyles2(getStyles);
  const [isAdding, setIsAdding] = useState(false);
  const [newColumn, setNewColumn] = useState<SelectableValue<string> | null>(null);
  const [newOperator, setNewOperator] = useState<SelectableValue<string> | null>(null);
  const [newValue, setNewValue] = useState('');

  const columnOptions = useMemo(() => {
    return fieldNames
      .filter((name) => !name.startsWith('p_'))
      .map((name) => ({
        label: name,
        value: name,
        description: typeDisplayName(fieldTypeMap[name]),
      }));
  }, [fieldNames, fieldTypeMap]);

  // Operators change based on the selected column's type
  const operatorOptions = useMemo(() => {
    if (!newColumn?.value) {
      return [];
    }
    return getOperators(fieldTypeMap, newColumn.value).map((op) => ({
      label: op.name,
      value: op.value,
    }));
  }, [newColumn, fieldTypeMap]);

  const removeFilter = useCallback(
    (index: number) => {
      onChange(filters.filter((_, i) => i !== index));
    },
    [filters, onChange]
  );

  const resetAddForm = useCallback(() => {
    setNewColumn(null);
    setNewOperator(null);
    setNewValue('');
    setIsAdding(false);
  }, []);

  const addFilter = useCallback(() => {
    if (!newColumn?.value || !newOperator?.value) {
      return;
    }
    if (!isNullOperator(newOperator.value) && !newValue.trim()) {
      return;
    }

    const filter: FilterCondition = {
      column: newColumn.value,
      operator: newOperator.value,
      value: isNullOperator(newOperator.value) ? null : newValue.trim(),
      type: fieldTypeMap[newColumn.value] || 'text',
    };

    onChange([...filters, filter]);
    resetAddForm();
  }, [newColumn, newOperator, newValue, filters, onChange, resetAddForm, fieldTypeMap]);

  const loadValueSuggestions = useCallback(
    async (inputValue: string): Promise<Array<SelectableValue<string>>> => {
      if (!streamName || !newColumn?.value) {
        return [];
      }
      try {
        const values = await datasource.getDistinctValues(streamName, newColumn.value);
        return values
          .filter((v) => !inputValue || v.toLowerCase().includes(inputValue.toLowerCase()))
          .map((v) => ({ label: v, value: v }));
      } catch {
        return [];
      }
    },
    [streamName, newColumn, datasource]
  );

  const formatFilterDisplay = (filter: FilterCondition): string => {
    if (isNullOperator(filter.operator)) {
      return `${filter.column} ${filter.operator}`;
    }
    return `${filter.column} ${filter.operator} ${filter.value}`;
  };

  return (
    <div className={styles.container}>
      <div className={styles.pillContainer}>
        {filters.map((filter, index) => (
          <div key={index} className={styles.pill}>
            <span className={styles.pillText}>{formatFilterDisplay(filter)}</span>
            <IconButton
              name="times"
              size="sm"
              className={styles.pillRemove}
              onClick={() => removeFilter(index)}
              tooltip="Remove filter"
            />
          </div>
        ))}

        {filters.length > 0 && (
          <Button variant="destructive" fill="text" size="sm" onClick={() => onChange([])}>
            Clear all
          </Button>
        )}

        {!isAdding && (
          <Button variant="secondary" size="sm" icon="plus" onClick={() => setIsAdding(true)}>
            Add filter
          </Button>
        )}
      </div>

      {isAdding && (
        <div className={styles.addRow}>
          <Select
            options={columnOptions}
            value={newColumn}
            onChange={(v) => {
              setNewColumn(v);
              // Reset operator when column changes since available operators differ
              setNewOperator(null);
              setNewValue('');
            }}
            placeholder="Column"
            isClearable
            width={24}
            menuPlacement="bottom"
          />
          <Select
            options={operatorOptions}
            value={newOperator}
            onChange={setNewOperator}
            placeholder="Operator"
            width={20}
            menuPlacement="bottom"
            disabled={!newColumn?.value}
          />
          {newOperator && !isNullOperator(newOperator.value!) && (
            <AsyncSelect
              key={newColumn?.value || 'value'}
              loadOptions={loadValueSuggestions}
              defaultOptions
              value={newValue ? { label: newValue, value: newValue } : null}
              onChange={(v) => setNewValue(v?.value || '')}
              allowCustomValue
              onCreateOption={(v) => setNewValue(v)}
              placeholder="Value"
              width={24}
              menuPlacement="bottom"
            />
          )}
          <Button variant="primary" size="sm" icon="check" onClick={addFilter}>
            Add
          </Button>
          <Button variant="secondary" size="sm" icon="times" onClick={resetAddForm}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
};

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
  }),
  pillContainer: css({
    display: 'flex',
    flexWrap: 'wrap',
    gap: theme.spacing(0.5),
    alignItems: 'center',
  }),
  pill: css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    padding: `${theme.spacing(0.25)} ${theme.spacing(1)}`,
    background: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.medium}`,
    borderRadius: theme.shape.radius.pill,
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.primary,
    maxWidth: 400,
  }),
  pillText: css({
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  }),
  pillRemove: css({
    flexShrink: 0,
    [`&:hover`]: {
      color: theme.colors.error.text,
    },
  }),
  addRow: css({
    display: 'flex',
    gap: theme.spacing(0.5),
    alignItems: 'center',
    flexWrap: 'wrap',
  }),
});
