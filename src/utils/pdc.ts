import type { FeatureToggles } from '@grafana/data';
import { gte } from 'semver';

const secureSocksFeature = 'secureSocksDSProxyEnabled' as keyof FeatureToggles;

export const supportsSecureSocksProxy = (featureToggles: FeatureToggles, grafanaVersion: string): boolean =>
  Boolean(featureToggles[secureSocksFeature]) && gte(grafanaVersion, '10.0.0');

export const buildPdcTarget = (base: string, requestUrl: string, params?: Record<string, unknown>): string => {
  const baseUrl = new URL(base);
  const targetUrl = new URL(requestUrl, baseUrl);
  if (targetUrl.origin !== baseUrl.origin) {
    throw new Error('PDC requests must target the configured Parseable server');
  }

  const basePath = baseUrl.pathname.replace(/\/$/, '');
  if (basePath && targetUrl.pathname !== basePath && !targetUrl.pathname.startsWith(basePath + '/')) {
    throw new Error('PDC request path is outside the configured Parseable URL');
  }

  Object.entries(params ?? {}).forEach(([key, value]) => {
    targetUrl.searchParams.delete(key);
    const values = Array.isArray(value) ? value : [value];
    values.forEach((item) => {
      if (item !== undefined && item !== null) {
        targetUrl.searchParams.append(key, String(item));
      }
    });
  });

  return (targetUrl.pathname.slice(basePath.length) || '/') + targetUrl.search;
};
