import { vi } from 'vitest';
import { createPanelStateStore } from '../capture/panel-state-store';
import { createTarget, type Clock } from '../targeting/target';
import { createTargetStore } from '../targeting/target-store';
import type { FieldCandidate } from '../../schemas/field-target';
import { InsertRequestSchema, type PanelState } from '../../schemas/internal-message';
import { createInsertFlow, handleInsertMessage, type InsertFlowDeps } from './insert-flow';

const clock: Clock & { now: number } = {
  now: 0,
  monotonicMs() {
    return this.now;
  },
  wallMs: () => 0,
};
const candidate: FieldCandidate = {
  labelText: 'Why Acme?',
  fingerprint: {
    tag: 'textarea',
    contentEditable: false,
    labelText: 'Why Acme?',
    sizeBucket: [300, 100],
    domPath: [0, 1],
  },
};
const QUESTION = 'Why do you want to work at Acme? (secret question text)';
const GENERATED: Extract<PanelState, { kind: 'generated' }> = {
  kind: 'generated',
  question: QUESTION,
  source: 'content-script',
  captureId: 'cap-1',
  field: { status: 'found', label: 'Why Acme?' },
  answer: 'Generated text.',
  usedFactCount: 2,
  warnings: [{ code: 'MODEL_NOTE', severity: 'info', message: 'Fact note FACT-TEXT.' }],
  draftId: 7,
  maxWords: 20,
};

type Message = Parameters<InsertFlowDeps['sendTabMessage']>[1];

interface Opts {
  state?: PanelState;
  target?: boolean;
  /** Reply for field.revalidate.request and insert.request. */
  revalidate?: (m: Message) => unknown;
  insert?: (m: Message) => unknown;
  /** Hold the insert reply until the test releases it. */
  hold?: boolean;
}

function setup(opts: Opts = {}) {
  clock.now = 0;
  const pushes: [number, PanelState][] = [];
  const panel = createPanelStateStore((id, s) => pushes.push([id, s]));
  const targets = createTargetStore(clock);
  if (opts.target !== false) {
    targets.set(
      4,
      createTarget(
        { id: 'cap-1', tabId: 4, frameId: 2, pageOrigin: 'https://a.example', candidate },
        clock,
      ),
    );
  }
  panel.set(4, opts.state ?? GENERATED);
  pushes.length = 0;
  const log: string[] = [];
  const sent: { tabId: number; frameId: number; message: Message }[] = [];
  const releases: (() => void)[] = [];
  let ids = 0;
  const deps: InsertFlowDeps = {
    panel,
    targets,
    newRequestId: () => `rq-${++ids}`,
    sendTabMessage: (tabId, message, options) => {
      sent.push({ tabId, frameId: options.frameId, message });
      log.push(`${message.type}:${targets.get(tabId)?.target.state}`);
      const reply = () =>
        message.type === 'insert.request'
          ? (opts.insert ?? insertOk)(message)
          : (opts.revalidate ?? revalidateOk)(message);
      if (opts.hold === true && message.type === 'insert.request') {
        return new Promise((resolve) => releases.push(() => resolve(reply())));
      }
      return Promise.resolve().then(reply);
    },
  };
  return { flow: createInsertFlow(deps), panel, targets, pushes, sent, log, releases };
}

const revalidateOk = (m: Message) => ({
  v: 1,
  requestId: m.requestId,
  type: 'field.revalidate.result',
  payload: { ok: true },
});
const insertOk = (m: Message) => ({
  v: 1,
  requestId: m.requestId,
  type: 'insert.result',
  payload: { ok: true },
});
const insertFail = (error: string) => (m: Message) => ({
  v: 1,
  requestId: m.requestId,
  type: 'insert.result',
  payload: { ok: false, error },
});
const START = { tabId: 4, captureId: 'cap-1', answer: '  My edited answer.  ' };

describe('insert flow order and success', () => {
  it('revalidates, then approves, then inserts, then marks inserted', async () => {
    const t = setup();
    await t.flow.start(START);
    // The revalidation request sees the target captured; the insert request sees it approved.
    expect(t.log).toEqual(['field.revalidate.request:captured', 'insert.request:approved']);
    expect(t.targets.get(4)?.target.state).toBe('inserted');
    expect(t.panel.get(4)).toEqual({
      kind: 'inserted',
      question: QUESTION,
      source: 'content-script',
      captureId: 'cap-1',
      field: { status: 'found', label: 'Why Acme?' },
    });
    expect(t.pushes.map(([, s]) => s.kind)).toEqual(['inserting', 'inserted']);
  });

  it('sends the trimmed edited answer to the target frame only, with exactly the allowed keys', async () => {
    const t = setup();
    await t.flow.start(START);
    const insert = t.sent.find((s) => s.message.type === 'insert.request');
    expect(insert).toMatchObject({ tabId: 4, frameId: 2 });
    expect(Object.keys(insert?.message ?? {}).sort()).toEqual([
      'payload',
      'requestId',
      'type',
      'v',
    ]);
    expect(Object.keys(insert?.message.payload ?? {}).sort()).toEqual([
      'answer',
      'confirmReplace',
      'fingerprint',
      'locator',
      'targetId',
    ]);
    expect(insert?.message.payload).toEqual({
      targetId: 'cap-1',
      answer: 'My edited answer.',
      confirmReplace: false,
      locator: { frameId: 2, domPath: [0, 1] },
      fingerprint: candidate.fingerprint,
    });
    expect(InsertRequestSchema.safeParse(insert?.message).success).toBe(true);
  });

  it('never sends the question, facts, warnings, or generated text to the content script', async () => {
    const t = setup();
    await t.flow.start(START);
    const wire = JSON.stringify(t.sent.map((s) => s.message));
    for (const secret of [QUESTION, 'secret question', 'FACT-TEXT', 'Generated text.', 'usedFact'])
      expect(wire).not.toContain(secret);
  });

  it('shows the inserting state with the user text before the frame answers', async () => {
    const t = setup({ hold: true });
    const pending = t.flow.start(START);
    await vi.waitFor(() => expect(t.releases).toHaveLength(1));
    expect(t.panel.get(4)).toMatchObject({
      kind: 'inserting',
      editedAnswer: 'My edited answer.',
      answer: 'Generated text.',
      draftId: 7,
    });
    t.releases[0]?.();
    await pending;
    expect(t.panel.get(4).kind).toBe('inserted');
  });

  it('a second insert after success is refused, and writes nothing', async () => {
    const t = setup();
    await t.flow.start(START);
    const count = t.sent.length;
    await t.flow.start(START);
    expect(t.sent).toHaveLength(count);
    expect(t.targets.get(4)?.target.state).toBe('inserted');
  });
});

describe('insert flow guards', () => {
  it('ignores a double click while an insert is in progress', async () => {
    const t = setup({ hold: true });
    const first = t.flow.start(START);
    await vi.waitFor(() => expect(t.releases).toHaveLength(1));
    await t.flow.start(START); // second click
    expect(t.sent.filter((s) => s.message.type === 'insert.request')).toHaveLength(1);
    t.releases[0]?.();
    await first;
    expect(t.sent.filter((s) => s.message.type === 'insert.request')).toHaveLength(1);
    expect(t.targets.get(4)?.target.state).toBe('inserted');
  });

  it('ignores a stale capture id', async () => {
    const t = setup();
    await t.flow.start({ ...START, captureId: 'cap-0' });
    expect(t.sent).toHaveLength(0);
    expect(t.pushes).toHaveLength(0);
    expect(t.targets.get(4)?.target.state).toBe('captured');
  });

  it('ignores another tab (no state, no target there)', async () => {
    const t = setup();
    await t.flow.start({ ...START, tabId: 9 });
    expect(t.sent).toHaveLength(0);
    expect(t.targets.get(4)?.target.state).toBe('captured');
  });

  it.each([
    ['generating', { ...GENERATED, kind: 'generating' as const }],
    [
      'captured',
      {
        kind: 'captured' as const,
        question: QUESTION,
        source: 'content-script' as const,
        captureId: 'cap-1',
        field: { status: 'found' as const },
      },
    ],
    ['empty', { kind: 'empty' as const }],
  ])('never inserts while the panel is %s (no finished draft)', async (_n, state) => {
    const generating = state as unknown as PanelState;
    const t = setup({ state: generating });
    await t.flow.start(START);
    expect(t.sent).toHaveLength(0);
    expect(t.targets.get(4)?.target.state).toBe('captured');
  });

  it.each([
    ['empty answer', '   '],
    ['too many words', Array.from({ length: 21 }, () => 'w').join(' ')],
  ])('ignores %s', async (_n, answer) => {
    const t = setup();
    await t.flow.start({ ...START, answer });
    expect(t.sent).toHaveLength(0);
    expect(t.panel.get(4).kind).toBe('generated');
  });

  it('ignores an answer longer than the field maxlength', async () => {
    const t = setup({ state: { ...GENERATED, maxChars: 5 } });
    await t.flow.start({ ...START, answer: 'Longer than five.' });
    expect(t.sent).toHaveLength(0);
  });

  it('ignores when the panel does not show exactly one detected field', async () => {
    const t = setup({ state: { ...GENERATED, field: { status: 'ambiguous' } } });
    await t.flow.start(START);
    expect(t.sent).toHaveLength(0);
  });

  it('ignores after a failed insert (the user must capture again)', async () => {
    const t = setup({ insert: insertFail('FIELD_NONEMPTY') });
    await t.flow.start(START);
    const count = t.sent.length;
    await t.flow.start(START);
    expect(t.sent).toHaveLength(count);
  });
});

describe('insert flow failures', () => {
  const failed = (t: ReturnType<typeof setup>) => t.panel.get(4);

  it.each(['FIELD_NONEMPTY', 'FIELD_UNSUPPORTED', 'FIELD_STALE'] as const)(
    'maps a content-script %s failure to the panel and invalidates the target',
    async (code) => {
      const t = setup({ insert: insertFail(code) });
      await t.flow.start(START);
      expect(t.targets.get(4)?.target.state).toBe('invalidated');
      expect(t.targets.get(4)?.invalidatedBy).toBe('insert-failed');
      expect(failed(t)).toMatchObject({
        kind: 'generated',
        insertError: code,
        draftId: 7, // the same draft, so the panel keeps the same editor
        editedAnswer: 'My edited answer.',
        answer: 'Generated text.',
        question: QUESTION,
      });
    },
  );

  it('revalidation failure -> FIELD_STALE, target invalidated, insert never sent', async () => {
    const t = setup({
      revalidate: (m) => ({
        v: 1,
        requestId: m.requestId,
        type: 'field.revalidate.result',
        payload: { ok: false, reason: 'changed' },
      }),
    });
    await t.flow.start(START);
    expect(t.sent.map((s) => s.message.type)).toEqual(['field.revalidate.request']);
    expect(t.targets.get(4)?.target.state).toBe('invalidated');
    expect(t.targets.get(4)?.invalidatedBy).toBe('revalidation-failed');
    expect(failed(t)).toMatchObject({ kind: 'generated', insertError: 'FIELD_STALE' });
  });

  it('a missing target -> FIELD_STALE without contacting the page', async () => {
    const t = setup({ target: false });
    await t.flow.start(START);
    expect(t.sent).toHaveLength(0);
    expect(failed(t)).toMatchObject({ kind: 'generated', insertError: 'FIELD_STALE' });
  });

  it('a target from another capture -> FIELD_STALE, and that target is left alone', async () => {
    const t = setup();
    t.targets.set(
      4,
      createTarget(
        { id: 'cap-OTHER', tabId: 4, frameId: 2, pageOrigin: 'https://a.example', candidate },
        clock,
      ),
    );
    await t.flow.start(START);
    expect(t.sent).toHaveLength(0);
    expect(t.targets.get(4)?.target.state).toBe('captured');
    expect(failed(t)).toMatchObject({ insertError: 'FIELD_STALE' });
  });

  it('an expired target -> FIELD_STALE', async () => {
    const t = setup();
    clock.now = 10 * 60 * 1000;
    await t.flow.start(START);
    expect(t.sent).toHaveLength(0);
    expect(t.targets.get(4)?.invalidatedBy).toBe('expired');
    expect(failed(t)).toMatchObject({ insertError: 'FIELD_STALE' });
  });

  it('an unreachable frame -> FIELD_STALE', async () => {
    const t = setup({
      insert: () => {
        throw new Error('Receiving end does not exist');
      },
    });
    await t.flow.start(START);
    expect(t.targets.get(4)?.target.state).toBe('invalidated');
    expect(failed(t)).toMatchObject({ insertError: 'FIELD_STALE' });
  });

  it.each([
    ['garbage', () => 'nope'],
    ['undefined', () => undefined],
    [
      'a wrong request id',
      () => ({ v: 1, requestId: 'other', type: 'insert.result', payload: { ok: true } }),
    ],
    [
      'an unknown error code',
      (m: Message) => ({
        v: 1,
        requestId: m.requestId,
        type: 'insert.result',
        payload: { ok: false, error: 'INTERNAL_ERROR' },
      }),
    ],
  ])(
    'an unusable reply (%s) fails as FIELD_UNSUPPORTED and never marks inserted',
    async (_n, insert) => {
      const t = setup({ insert });
      await t.flow.start(START);
      expect(t.targets.get(4)?.target.state).toBe('invalidated');
      expect(failed(t)).toMatchObject({ kind: 'generated', insertError: 'FIELD_UNSUPPORTED' });
    },
  );

  it('a navigation during the insert drops the late result', async () => {
    const t = setup({ hold: true });
    const pending = t.flow.start(START);
    await vi.waitFor(() => expect(t.releases).toHaveLength(1));
    t.panel.reset(4); // what the tab lifecycle does on reload
    t.targets.invalidate(4, 'navigation');
    t.releases[0]?.();
    await pending;
    expect(t.panel.get(4)).toEqual({ kind: 'empty' });
    expect(t.targets.get(4)?.target.state).toBe('invalidated');
  });
});

describe('handleInsertMessage', () => {
  const message = (payload: object = {}, over: object = {}) => ({
    v: 1,
    requestId: 'r1',
    type: 'insert.start',
    payload: { tabId: 4, captureId: 'cap-1', answer: 'Hello there.', ...payload },
    ...over,
  });
  const make = () => {
    const flow = { start: vi.fn(() => Promise.resolve()) };
    return {
      flow,
      handle: (m: unknown, sender: { id?: string; tab?: unknown; url?: string }) =>
        handleInsertMessage({ runtimeId: 'me', flow }, m, sender),
    };
  };

  it('routes insert.start from an extension page', () => {
    const { flow, handle } = make();
    expect(handle(message(), { id: 'me' })).toBe(true);
    expect(flow.start).toHaveBeenCalledWith({
      tabId: 4,
      captureId: 'cap-1',
      answer: 'Hello there.',
    });
  });

  it('accepts an extension page opened in a tab, but not a content script', () => {
    const { flow, handle } = make();
    expect(
      handle(message(), { id: 'me', tab: {}, url: 'chrome-extension://me/sidepanel.html' }),
    ).toBe(true);
    expect(handle(message(), { id: 'me', tab: { id: 9 }, url: 'https://evil.example/' })).toBe(
      false,
    );
    expect(handle(message(), { id: 'evil' })).toBe(false);
    expect(handle(message(), {})).toBe(false);
    expect(flow.start).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['empty answer', message({ answer: '' })],
    ['blank answer', message({ answer: '   ' })],
    ['oversized answer', message({ answer: 'x'.repeat(8001) })],
    ['negative tab', message({ tabId: -1 })],
    ['missing capture id', message({ captureId: undefined })],
    ['extra payload key', message({ question: 'leak' })],
    ['extra top key', message({}, { extra: 1 })],
    ['wrong version', message({}, { v: 2 })],
    ['unknown type', message({}, { type: 'insert.go' })],
  ])('ignores %s', (_n, bad) => {
    const { flow, handle } = make();
    expect(handle(bad, { id: 'me' })).toBe(false);
    expect(flow.start).not.toHaveBeenCalled();
  });
});
