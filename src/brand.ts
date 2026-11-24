/** Brand colour helpers for documents and customer-facing pages. */
export const DEFAULT_BRAND = '#f59e0b';

export function brandColor(c?: string): string {
  return c && /^#[0-9a-f]{6}$/i.test(c) ? c : DEFAULT_BRAND;
}

/** Black or white text, whichever reads better on the colour. */
export function onBrand(c: string): string {
  const n = parseInt(brandColor(c).slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.4 ? '#111827' : '#ffffff';
}

/** CSS variables to put on a document / page root. */
export function brandVars(c?: string): React.CSSProperties {
  const col = brandColor(c);
  return { ['--brand' as string]: col, ['--on-brand' as string]: onBrand(col) } as React.CSSProperties;
}
