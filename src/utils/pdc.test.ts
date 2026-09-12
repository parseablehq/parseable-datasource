import type { FeatureToggles } from '@grafana/data';
import { buildPdcTarget, supportsSecureSocksProxy } from './pdc';

const toggles = (enabled: boolean): FeatureToggles =>
  ({ secureSocksDSProxyEnabled: enabled }) as unknown as FeatureToggles;

describe('supportsSecureSocksProxy', () => {
  it('supports PDC when Grafana and its feature toggle support it', () => {
    expect(supportsSecureSocksProxy(toggles(true), '10.0.0')).toBe(true);
    expect(supportsSecureSocksProxy(toggles(true), '12.4.2')).toBe(true);
  });

  it('hides PDC when the feature toggle is disabled', () => {
    expect(supportsSecureSocksProxy(toggles(false), '12.4.2')).toBe(false);
  });

  it('hides PDC on unsupported Grafana versions', () => {
    expect(supportsSecureSocksProxy(toggles(true), '9.5.21')).toBe(false);
  });
});

describe('buildPdcTarget', () => {
  it('creates a relative target and preserves query parameters', () => {
    expect(
      buildPdcTarget('https://parseable.internal/base', 'https://parseable.internal/base/api/v1/labels?stream=logs', {
        limit: 5,
        'match[]': ['one', 'two'],
      })
    ).toBe('/api/v1/labels?stream=logs&limit=5&match%5B%5D=one&match%5B%5D=two');
  });

  it('rejects another origin or a path outside the configured base', () => {
    expect(() => buildPdcTarget('https://parseable.internal/base', 'https://example.com/api')).toThrow();
    expect(() => buildPdcTarget('https://parseable.internal/base', 'https://parseable.internal/other')).toThrow();
  });
});
