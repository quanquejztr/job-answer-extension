import { createPanelClient, type PanelApi } from './panel-client';
import type { Sender } from './panel-messages';

function fakeApi(reply: (message: unknown) => unknown) {
  const listeners = new Set<(m: unknown, s: Sender) => void>();
  const api: PanelApi = {
    runtimeId: 'me',
    queryActiveTabId: () => Promise.resolve(3),
    sendMessage: (m) => Promise.resolve(reply(m)),
    addMessageListener: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    addActiveTabListener: () => () => undefined,
  };
  return { api, listeners };
}

const echo = (tabId: number) => (m: unknown) => {
  const { requestId } = m as { requestId: string };
  return {
    v: 1,
    requestId,
    type: 'panel.state',
    payload: { tabId, state: { kind: 'unsupported-domain' } },
  };
};

describe('panel client', () => {
  it('pulls validated state for a tab', async () => {
    const { api } = fakeApi(echo(3));
    await expect(createPanelClient(api).fetchState(3)).resolves.toEqual({
      kind: 'unsupported-domain',
    });
  });

  it.each([
    ['a reply for another tab', echo(9)],
    ['garbage', () => ({ nope: true })],
    ['no reply', () => undefined],
    ['a thrown error', () => Promise.reject(new Error('worker gone'))],
  ])('falls back to empty on %s', async (_name, reply) => {
    const { api } = fakeApi(reply);
    api.sendMessage = (m) => Promise.resolve().then(() => reply(m));
    await expect(createPanelClient(api).fetchState(3)).resolves.toEqual({ kind: 'empty' });
  });

  it('delivers only trusted, valid pushes', () => {
    const { api, listeners } = fakeApi(echo(3));
    const seen: unknown[] = [];
    const off = createPanelClient(api).onState((tabId, state) => seen.push([tabId, state]));
    const push = {
      v: 1,
      requestId: 'r',
      type: 'panel.state',
      payload: { tabId: 3, state: { kind: 'error', code: 'QUESTION_MISSING' } },
    };
    for (const l of listeners) {
      l(push, { id: 'evil' });
      l(push, { id: 'me', tab: { id: 1 } });
      l({ ...push, type: 'other' }, { id: 'me' });
      l(push, { id: 'me' });
    }
    expect(seen).toEqual([[3, { kind: 'error', code: 'QUESTION_MISSING' }]]);
    off();
    expect(listeners.size).toBe(0);
  });
});

describe('panel client draft commands', () => {
  const QUESTION = 'Why do you want to work at Acme?';

  it('sends a validated draft.start and draft.cancel with fresh request ids', async () => {
    const sent: unknown[] = [];
    const { api } = fakeApi((m) => void sent.push(m));
    const client = createPanelClient(api);
    await client.startDraft(3, 'c1', QUESTION);
    await client.cancelDraft(3);
    await client.startDraft(3, 'c1', QUESTION);
    expect(sent).toMatchObject([
      { v: 1, type: 'draft.start', payload: { tabId: 3, captureId: 'c1', question: QUESTION } },
      { v: 1, type: 'draft.cancel', payload: { tabId: 3 } },
      { v: 1, type: 'draft.start' },
    ]);
    const ids = sent.map((m) => (m as { requestId: string }).requestId);
    expect(new Set(ids).size).toBe(3);
  });

  it('does not send an out-of-range question', async () => {
    const sent: unknown[] = [];
    const { api } = fakeApi((m) => void sent.push(m));
    await createPanelClient(api).startDraft(3, 'c1', 'short');
    expect(sent).toEqual([]);
  });

  it('sends a validated insert.start with the reviewed answer, and nothing for an empty one', async () => {
    const sent: unknown[] = [];
    const { api } = fakeApi((m) => void sent.push(m));
    const client = createPanelClient(api);
    await client.startInsert(3, 'c1', 'My edited answer.');
    await client.startInsert(3, 'c1', '   ');
    await client.startInsert(3, 'c1', 'x'.repeat(8001));
    expect(sent).toEqual([
      expect.objectContaining({
        v: 1,
        type: 'insert.start',
        payload: { tabId: 3, captureId: 'c1', answer: 'My edited answer.' },
      }),
    ]);
  });

  it('swallows a worker that is unreachable', async () => {
    const { api } = fakeApi(() => {
      throw new Error('Could not establish connection');
    });
    const client = createPanelClient(api);
    await expect(client.startDraft(3, 'c1', QUESTION)).resolves.toBeUndefined();
    await expect(client.cancelDraft(3)).resolves.toBeUndefined();
    await expect(client.startInsert(3, 'c1', 'An answer.')).resolves.toBeUndefined();
  });

  it('opens the session port once when the client is created', () => {
    const open = vi.fn();
    const { api } = fakeApi(() => undefined);
    createPanelClient({ ...api, openSessionPort: open });
    expect(open).toHaveBeenCalledTimes(1);
  });
});
