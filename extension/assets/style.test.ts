import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(__dirname, 'style.css'), 'utf8');

const TOKENS = [
  'background',
  'surface',
  'text',
  'muted',
  'border',
  'accent',
  'on-accent',
  'success',
  'warning',
  'danger',
];

function block(source: string, opener: RegExp): string {
  const match = opener.exec(source);
  if (!match) throw new Error('block not found');
  let depth = 1;
  let i = match.index + match[0].length;
  const start = i;
  while (i < source.length && depth > 0) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') depth--;
    i++;
  }
  return source.slice(start, i - 1);
}

describe('design tokens', () => {
  const light = block(css, /^:root\s*\{/m);
  const dark = block(css, /@media \(prefers-color-scheme: dark\)\s*\{/);
  const theme = block(css, /@theme inline\s*\{/);

  it.each(TOKENS)('defines --%s for light and dark', (name) => {
    const decl = new RegExp(`--${name}:\\s*#[0-9a-fA-F]{6};`);
    expect(light).toMatch(decl);
    expect(dark).toMatch(decl);
  });

  it.each(TOKENS)('exposes --%s to Tailwind', (name) => {
    expect(theme).toContain(`--color-${name}: var(--${name});`);
  });

  it('declares focus, reduced motion, spacing, and radius', () => {
    expect(css).toContain(':focus-visible');
    expect(css).toContain('prefers-reduced-motion: reduce');
    expect(theme).toContain('--spacing: 4px;');
    expect(theme).toContain('--radius: 8px;');
  });
});
