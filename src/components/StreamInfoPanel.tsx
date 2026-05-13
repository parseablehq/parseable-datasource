import React, { useState } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { Icon, Tooltip, useStyles2 } from '@grafana/ui';
import { StreamStatsResponse } from '../types';
import { FieldTypeMap, ParsedType, typeLabel, typeDisplayName } from '../utils/fieldTypes';
import { sanitizeBytes, sanitizeEventsCount } from '../utils/format';

interface StreamInfoPanelProps {
  fieldNames: string[];
  fieldTypeMap: FieldTypeMap;
  stats?: StreamStatsResponse;
}

function getTypeBadgeColorKey(pt: ParsedType): string {
  switch (pt) {
    case 'number':
      return 'info';
    case 'text':
      return 'success';
    case 'timestamp':
      return 'warning';
    case 'boolean':
      return 'primary';
    default:
      return 'secondary';
  }
}

export const StreamInfoPanel: React.FC<StreamInfoPanelProps> = ({ fieldNames, fieldTypeMap, stats }) => {
  const styles = useStyles2(getStyles);
  const [columnsOpen, setColumnsOpen] = useState(true);
  const [statsOpen, setStatsOpen] = useState(true);

  if (fieldNames.length === 0 && !stats?.stream) {
    return null;
  }

  return (
    <div className={styles.panel}>
      <div className={styles.panelTitle}>Dataset Info</div>

      {/* Stats Section */}
      {stats?.stream && (
        <>
          <div className={styles.sectionHeader} onClick={() => setStatsOpen(!statsOpen)}>
            <Icon name={statsOpen ? 'angle-down' : 'angle-right'} size="sm" />
            <span>Stats</span>
          </div>
          {statsOpen && (
            <div className={styles.statsGrid}>
              <div className={styles.statItem}>
                <span className={styles.statLabel}>Events</span>
                <span className={styles.statValue}>
                  {typeof stats.ingestion?.count === 'number' ? sanitizeEventsCount(stats.ingestion.count) : '-'}
                </span>
              </div>
              <div className={styles.statItem}>
                <span className={styles.statLabel}>Ingested</span>
                <span className={styles.statValue}>{stats.ingestion?.size ? sanitizeBytes(stats.ingestion.size) : '-'}</span>
              </div>
              <div className={styles.statItem}>
                <span className={styles.statLabel}>Stored</span>
                <span className={styles.statValue}>{stats.storage?.size ? sanitizeBytes(stats.storage.size) : '-'}</span>
              </div>
            </div>
          )}
        </>
      )}

      {/* Columns Section */}
      {fieldNames.length > 0 && (
        <>
          <div className={styles.sectionHeader} onClick={() => setColumnsOpen(!columnsOpen)}>
            <Icon name={columnsOpen ? 'angle-down' : 'angle-right'} size="sm" />
            <span>Columns ({fieldNames.length})</span>
          </div>
          {columnsOpen && (
            <div className={styles.columnList}>
              {fieldNames.map((name) => {
                const pt = fieldTypeMap[name];
                return (
                  <Tooltip key={name} content={typeDisplayName(pt)}>
                    <div className={styles.columnItem}>
                      <span
                        className={`${styles.typeBadge} ${(styles as any)[`type_${getTypeBadgeColorKey(pt)}`] || ''}`}
                      >
                        {typeLabel(pt)}
                      </span>
                      <span className={styles.columnName}>{name}</span>
                    </div>
                  </Tooltip>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
};

const getStyles = (theme: GrafanaTheme2) => ({
  panel: css({
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    background: theme.colors.background.secondary,
    minWidth: 200,
    maxWidth: 250,
    maxHeight: 460,
    overflowY: 'auto' as const,
    flexShrink: 0,
  }),
  panelTitle: css({
    padding: `${theme.spacing(0.75)} ${theme.spacing(1)}`,
    fontWeight: theme.typography.fontWeightBold,
    fontSize: theme.typography.bodySmall.fontSize,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    color: theme.colors.text.primary,
  }),
  sectionHeader: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    padding: `${theme.spacing(0.5)} ${theme.spacing(1)}`,
    cursor: 'pointer',
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.secondary,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    userSelect: 'none' as const,
    '&:hover': {
      background: theme.colors.action.hover,
    },
  }),
  statsGrid: css({
    padding: `0 ${theme.spacing(1)} ${theme.spacing(0.5)}`,
  }),
  statItem: css({
    display: 'flex',
    justifyContent: 'space-between',
    padding: `${theme.spacing(0.25)} 0`,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  statLabel: css({
    color: theme.colors.text.secondary,
  }),
  statValue: css({
    color: theme.colors.text.primary,
    fontWeight: theme.typography.fontWeightMedium,
    fontFamily: theme.typography.fontFamilyMonospace,
  }),
  columnList: css({
    display: 'flex',
    flexDirection: 'column',
    paddingBottom: theme.spacing(0.5),
  }),
  columnItem: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.75),
    padding: `${theme.spacing(0.25)} ${theme.spacing(1)}`,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  typeBadge: css({
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: '10px',
    fontWeight: theme.typography.fontWeightBold,
    width: 20,
    textAlign: 'center' as const,
    flexShrink: 0,
  }),
  type_info: css({ color: theme.colors.info.text }),
  type_success: css({ color: theme.colors.success.text }),
  type_warning: css({ color: theme.colors.warning.text }),
  type_primary: css({ color: theme.colors.primary.text }),
  type_secondary: css({ color: theme.colors.text.secondary }),
  columnName: css({
    color: theme.colors.text.primary,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  }),
});
