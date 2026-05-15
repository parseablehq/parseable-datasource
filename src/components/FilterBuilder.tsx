import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2, SelectableValue } from '@grafana/data';
import { Select, Button, IconButton, useStyles2, useTheme2, getSelectStyles } from '@grafana/ui';
import { FilterCondition } from '../types';
import { FieldTypeMap, getOperators, typeDisplayName } from '../utils/fieldTypes';
import { isNullOperator } from '../utils/queryBuilder';
import { DataSource } from '../datasource';
import { HumanizeNumber } from '../utils/format';

const INITIAL_PAGE = 5;
const NEXT_PAGE = 5000;

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

  const [valueOptions, setValueOptions] = useState<Array<{ value: string; count: number }>>([]);
  const [valueOffset, setValueOffset] = useState(0);
  const [valueHasMore, setValueHasMore] = useState(false);
  const [valueLoading, setValueLoading] = useState(false);
  const requestIdRef = useRef(0);

  const fetchValues = useCallback(
    async (column: string, offset: number, limit: number) => {
      if (!streamName) {
        return [];
      }
      try {
        return await datasource.getDistinctValues(streamName, column, { offset, limit });
      } catch {
        return [];
      }
    },
    [streamName, datasource]
  );

  useEffect(() => {
    const column = newColumn?.value;
    if (!column || !streamName) {
      setValueOptions([]);
      setValueOffset(0);
      setValueHasMore(false);
      return;
    }
    const reqId = ++requestIdRef.current;
    setValueLoading(true);
    setValueOptions([]);
    setValueOffset(0);
    setValueHasMore(false);
    fetchValues(column, 0, INITIAL_PAGE).then((rows) => {
      if (reqId !== requestIdRef.current) {
        return;
      }
      setValueOptions(rows);
      setValueOffset(rows.length);
      setValueHasMore(rows.length === INITIAL_PAGE);
      setValueLoading(false);
    });
  }, [newColumn, streamName, fetchValues]);

  const loadMoreValues = useCallback(async () => {
    const column = newColumn?.value;
    if (!column || valueLoading || !valueHasMore) {
      return;
    }
    const reqId = ++requestIdRef.current;
    setValueLoading(true);
    const rows = await fetchValues(column, valueOffset, NEXT_PAGE);
    if (reqId !== requestIdRef.current) {
      return;
    }
    setValueOptions((prev) => [...prev, ...rows]);
    setValueOffset((prev) => prev + rows.length);
    setValueHasMore(rows.length === NEXT_PAGE);
    setValueLoading(false);
  }, [newColumn, fetchValues, valueOffset, valueHasMore, valueLoading]);

  const valueSelectOptions: Array<SelectableValue<string>> = useMemo(
    () =>
      valueOptions.map((row) => ({
        label: row.value,
        value: row.value,
        description: HumanizeNumber(row.count),
      })),
    [valueOptions]
  );

  const theme = useTheme2();
  const grafanaSelectStyles = getSelectStyles(theme);

  const MenuListWithMore = useMemo(() => {
    const styles2 = styles;
    const menuClass = grafanaSelectStyles.menu;
    const Comp: React.FC<any> = (menuProps) => {
      const { innerRef, innerProps, maxHeight } = menuProps;
      return (
        <div {...innerProps} className={menuClass} style={{ maxHeight }}>
          <div ref={innerRef} className={styles2.menuScroll} style={{ maxHeight: 'inherit' }}>
            {menuProps.children}
            {(valueHasMore || valueLoading) && (
              <div
                role="button"
                className={styles2.showMore}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (!valueLoading) {
                    loadMoreValues();
                  }
                }}
              >
                {valueLoading ? 'Loading…' : 'Show more values'}
              </div>
            )}
          </div>
        </div>
      );
    };
    return Comp;
  }, [valueHasMore, valueLoading, loadMoreValues, styles, grafanaSelectStyles.menu]);

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
            <Select
              key={newColumn?.value || 'value'}
              options={valueSelectOptions}
              value={newValue ? { label: newValue, value: newValue } : null}
              onChange={(v) => setNewValue(v?.value || '')}
              components={{ MenuList: MenuListWithMore }}
              isLoading={valueLoading}
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
  menuScroll: css({
    overflowY: 'auto',
    overflowX: 'hidden',
    padding: theme.spacing(0.5),
  }),
  showMore: css({
    marginTop: theme.spacing(0.5),
    padding: `${theme.spacing(0.75)} ${theme.spacing(1.25)}`,
    borderTop: `1px solid ${theme.colors.border.weak}`,
    color: theme.colors.text.link,
    cursor: 'pointer',
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    userSelect: 'none',
    textAlign: 'center',
    [`&:hover`]: {
      background: theme.colors.action.hover,
    },
  }),
});
