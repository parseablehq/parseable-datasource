// Mirrors Prism's /Users/PKB/github/prism/src/utils/formatBytes.ts so the
// Grafana plugin displays stats in the exact same form. HumanizeNumber is
// hand-rolled instead of depending on `numeral` to keep the bundle slim.

export const formatBytes = (a: number, b = 1) => {
  if (!+a) {
    return '0 Bytes';
  }
  const c = b < 0 ? 0 : b;
  const d = Math.floor(Math.log(a) / Math.log(1024));
  return `${parseFloat((a / Math.pow(1024, d)).toFixed(c))} ${
    ['Bytes', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'][d]
  }`;
};

export const HumanizeNumber = (val: number, precision?: number): string => {
  if (!isFinite(val)) {
    return '0';
  }
  const abs = Math.abs(val);
  let scaled = val;
  let suffix = '';
  if (abs >= 1e12) {
    scaled = val / 1e12;
    suffix = 't';
  } else if (abs >= 1e9) {
    scaled = val / 1e9;
    suffix = 'b';
  } else if (abs >= 1e6) {
    scaled = val / 1e6;
    suffix = 'm';
  } else if (abs >= 1e3) {
    scaled = val / 1e3;
    suffix = 'k';
  }
  if (!suffix) {
    // No abbreviation — return integer form to match numeral's `0.[0]a` on
    // sub-thousand values (e.g. 999 → "999").
    return String(val);
  }
  const formatted =
    precision != null
      ? scaled.toFixed(precision)
      : scaled % 1 === 0
      ? scaled.toFixed(0)
      : scaled.toFixed(1).replace(/\.0$/, '');
  return (formatted + suffix).toUpperCase();
};

export const sanitizeEventsCount = (val: any) => {
  return typeof val === 'number' ? HumanizeNumber(val) : '0';
};

export const bytesStringToInteger = (str: string) => {
  if (!str || typeof str !== 'string') {
    return null;
  }
  const chunks = str.split(' ');
  return Array.isArray(chunks) && !isNaN(Number(chunks[0])) ? parseInt(chunks[0], 10) : null;
};

export const sanitizeBytes = (val: any) => {
  // API may send raw number (Prism shape) or a string like "12345 Bytes".
  // Accept either; fall back to 0 only when both paths fail.
  if (typeof val === 'number' && isFinite(val)) {
    return val > 0 ? formatBytes(val) : '0 Bytes';
  }
  const size = bytesStringToInteger(val);
  return size ? formatBytes(size) : '0 Bytes';
};
