import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { EXTENSION_ID, EXTENSION_KEY, EXTENSION_ORIGIN } from './extension-key';

describe('extension key', () => {
  it('derives the pinned extension ID from the public key', () => {
    const der = Buffer.from(EXTENSION_KEY, 'base64');
    const hex = createHash('sha256').update(der).digest('hex').slice(0, 32);
    const id = [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
    expect(id).toBe(EXTENSION_ID);
  });

  it('builds the single allowed native-host origin', () => {
    expect(EXTENSION_ORIGIN).toBe(`chrome-extension://${EXTENSION_ID}/`);
    expect(EXTENSION_ID).toMatch(/^[a-p]{32}$/);
  });
});

describe('shared extension fixture', () => {
  it('matches tests/protocol-fixtures/extension.json and the host manifest template', async () => {
    const { readFileSync } = await import('node:fs');
    const { NATIVE_HOST_NAME } = await import('./native-host');
    const fixture = JSON.parse(
      readFileSync('tests/protocol-fixtures/extension.json', 'utf8'),
    ) as Record<string, string>;
    expect(fixture).toEqual({
      extensionId: EXTENSION_ID,
      origin: EXTENSION_ORIGIN,
      nativeHostName: NATIVE_HOST_NAME,
    });
    const template = JSON.parse(
      readFileSync('installer/templates/native-host.json.tmpl', 'utf8'),
    ) as { name: string };
    expect(template.name).toBe(NATIVE_HOST_NAME);
  });
});
