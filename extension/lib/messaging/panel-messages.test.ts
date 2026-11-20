import { handleWorkerMessage, isTrustedExtensionPage, parseStateMessage } from './panel-messages';
import type { PanelState } from '../../schemas/internal-message';

const get = (tabId: unknown) => ({
  v: 1,
  requestId: 'r1',
  type: 'panel.state.get',
  payload: { tabId },
});
const state: PanelState = { kind: 'unsupported-domain' };
const deps = { runtimeId: 'me', getState: () => state };

describe('handleWorkerMessage', () => {
  it('answers a panel.state.get from an extension page', () => {
    expect(handleWorkerMessage(deps, get(4), { id: 'me' })).toEqual({
      v: 1,
      requestId: 'r1',
      type: 'panel.state',
      payload: { tabId: 4, state },
    });
  });

  it('ignores other extensions, missing ids, and content scripts (sender.tab set)', () => {
    expect(handleWorkerMessage(deps, get(4), { id: 'evil' })).toBeUndefined();
    expect(handleWorkerMessage(deps, get(4), {})).toBeUndefined();
    expect(handleWorkerMessage(deps, get(4), { id: 'me', tab: { id: 9 } })).toBeUndefined();
  });

  it.each([
    ['unknown type', { ...get(4), type: 'panel.reset' }],
    ['capture.result sent to the worker', { ...get(4), type: 'capture.request', payload: {} }],
    ['negative tab', get(-1)],
    ['fractional tab', get(1.5)],
    ['string tab', get('4')],
    ['extra key', { ...get(4), extra: true }],
    ['wrong version', { ...get(4), v: 2 }],
    ['null', null],
  ])('ignores %s', (_name, message) => {
    expect(handleWorkerMessage(deps, message, { id: 'me' })).toBeUndefined();
  });
});

describe('isTrustedExtensionPage with a tab', () => {
  const tab = { id: 9 };
  it('accepts an extension page opened in a tab and rejects pages and content scripts', () => {
    expect(
      isTrustedExtensionPage({ id: 'me', tab, url: 'chrome-extension://me/sidepanel.html' }, 'me'),
    ).toBe(true);
    for (const url of [
      'https://example.com/chrome-extension://me/',
      'chrome-extension://other/sidepanel.html',
      'chrome-extension://me.evil.example/x',
      'https://me/',
      'not a url',
      '',
      undefined,
    ])
      expect(isTrustedExtensionPage({ id: 'me', tab, url }, 'me')).toBe(false);
    expect(
      isTrustedExtensionPage({ id: 'x', tab, url: 'chrome-extension://me/a.html' }, 'me'),
    ).toBe(false);
  });
});

describe('panel-side parsing', () => {
  const push = { v: 1, requestId: 'r', type: 'panel.state', payload: { tabId: 1, state } };
  it('accepts a trusted push and rejects untrusted or malformed ones', () => {
    expect(parseStateMessage(push, { id: 'me' }, 'me')?.payload.tabId).toBe(1);
    expect(parseStateMessage(push, { id: 'x' }, 'me')).toBeUndefined();
    expect(parseStateMessage(push, { id: 'me', tab: {} }, 'me')).toBeUndefined();
    expect(
      parseStateMessage(
        { ...push, payload: { tabId: 1, state: { kind: 'bogus' } } },
        undefined,
        'me',
      ),
    ).toBeUndefined();
  });
  it('isTrustedExtensionPage', () => {
    expect(isTrustedExtensionPage({ id: 'me' }, 'me')).toBe(true);
    expect(isTrustedExtensionPage({ id: 'me', tab: 1 }, 'me')).toBe(false);
  });
});
