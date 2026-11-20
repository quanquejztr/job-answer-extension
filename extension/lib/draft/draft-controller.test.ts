import { createPanelStateStore } from '../capture/panel-state-store';
import { createTargetStore } from '../targeting/target-store';
import { createTarget, type Clock } from '../targeting/target';
import type { DraftRequest, DraftResponse } from '../../schemas/draft';
import type { PanelState } from '../../schemas/internal-message';
import { appErrorFor, type ErrorCode } from '../../schemas/error';
import type { NativeCall, NativeResult } from '../native/native-client';
import { createDraftController } from './draft-controller';

const clock: Clock = { monotonicMs: () => 0, wallMs: () => 0 };
const QUESTION = 'Why do you want to work at Acme?';
const DRAFT: DraftResponse = {
  answer: 'Deterministic answer.',
  evidenceIds: ['f_1', 'f_2'],
  warnings: [{ code: 'MODEL_NOTE', severity: 'info', message: 'Note.' }],
  usedFacts: [
    { id: 'f_1', text: 'One' },
    { id: 'f_2', text: 'Two' },
  ],
};

interface Pending {
  request: DraftRequest;
  cancelled: number;
  resolve(r: NativeResult<DraftResponse>): void;
}

function setup() {
  const pushes: [number, PanelState][] = [];
  const panel = createPanelStateStore((id, s) => pushes.push([id, s]));
  const targets = createTargetStore(clock);
  const pending: Pending[] = [];
  const native = {
    generateDraft(request: DraftRequest): NativeCall<DraftResponse> {
      let resolve: (r: NativeResult<DraftResponse>) => void = () => undefined;
      const result = new Promise<NativeResult<DraftResponse>>((r) => (resolve = r));
      const entry: Pending = { request, cancelled: 0, resolve };
      pending.push(entry);
      return {
        result,
        cancel() {
          entry.cancelled += 1;
          resolve({ ok: false, error: appErrorFor('PROVIDER_CANCELLED') });
        },
      };
    },
  };
  const controller = createDraftController({
    native,
    panel,
    targets,
    now: () => new Date('2026-11-19T15:04:05.123Z'),
  });
  const capture = (tabId: number, captureId = 'c1', question = QUESTION) =>
    panel.set(tabId, {
      kind: 'captured',
      question,
      source: 'content-script',
      captureId,
      field: { status: 'found', label: 'Why Acme?' },
    });
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return { panel, targets, pending, controller, capture, pushes, flush };
}

const fail = (code: ErrorCode): NativeResult<DraftResponse> => ({
  ok: false,
  error: appErrorFor(code),
});

describe('draft controller', () => {
  it('builds the request from the edited question and moves captured -> generating -> generated', async () => {
    const t = setup();
    t.capture(1);
    t.controller.start({ tabId: 1, captureId: 'c1', question: `  ${QUESTION} Be brief.  ` });
    expect(t.pending).toHaveLength(1);
    expect(t.pending[0]?.request).toEqual({
      question: `${QUESTION} Be brief.`,
      constraints: { maxWords: 150 },
      requestedAt: '2026-11-19T15:04:05.123Z',
    });
    expect(t.panel.get(1)).toMatchObject({
      kind: 'generating',
      question: `  ${QUESTION} Be brief.  `,
      captureId: 'c1',
      field: { status: 'found', label: 'Why Acme?' },
    });
    t.pending[0]?.resolve({ ok: true, value: DRAFT });
    await t.flush();
    expect(t.panel.get(1)).toEqual({
      kind: 'generated',
      question: `  ${QUESTION} Be brief.  `,
      source: 'content-script',
      captureId: 'c1',
      field: { status: 'found', label: 'Why Acme?' },
      answer: 'Deterministic answer.',
      usedFactCount: 2,
      warnings: DRAFT.warnings,
      draftId: 1,
      maxWords: 150,
    });
  });

  it("uses the target's maxlength as maxChars when present and live", () => {
    const t = setup();
    t.capture(1);
    t.targets.set(
      1,
      createTarget(
        {
          id: 't1',
          tabId: 1,
          frameId: 0,
          pageOrigin: 'https://a.example',
          candidate: {
            labelText: 'Why?',
            fingerprint: {
              tag: 'textarea',
              contentEditable: false,
              labelText: 'Why?',
              maxLength: 500,
              sizeBucket: [200, 100],
              domPath: [0],
            },
          },
        },
        clock,
      ),
    );
    t.controller.start({ tabId: 1, captureId: 'c1', question: QUESTION });
    expect(t.pending[0]?.request.constraints).toEqual({ maxWords: 150, maxChars: 500 });
    // An invalidated target is not used.
    t.targets.invalidate(1, 'navigation');
    t.controller.start({ tabId: 1, captureId: 'c1', question: QUESTION });
    expect(t.pending[1]?.request.constraints).toEqual({ maxWords: 150 });
  });

  it('records the limits the draft was made under so Insert can enforce them', async () => {
    const t = setup();
    t.capture(1);
    t.targets.set(
      1,
      createTarget(
        {
          id: 'c1',
          tabId: 1,
          frameId: 0,
          pageOrigin: 'https://a.example',
          candidate: {
            labelText: 'Why?',
            fingerprint: {
              tag: 'textarea',
              contentEditable: false,
              labelText: 'Why?',
              maxLength: 500,
              sizeBucket: [200, 100],
              domPath: [0],
            },
          },
        },
        clock,
      ),
    );
    t.controller.start({ tabId: 1, captureId: 'c1', question: QUESTION });
    t.pending[0]?.resolve({ ok: true, value: DRAFT });
    await t.flush();
    expect(t.panel.get(1)).toMatchObject({ kind: 'generated', maxWords: 150, maxChars: 500 });
  });

  it('gives each generation its own draftId, even when results arrive back to back', async () => {
    const t = setup();
    t.capture(1);
    t.controller.start({ tabId: 1, captureId: 'c1', question: QUESTION });
    t.pending[0]?.resolve({ ok: true, value: DRAFT });
    await t.flush();
    const first = t.panel.get(1);
    t.controller.start({ tabId: 1, captureId: 'c1', question: QUESTION });
    t.pending[1]?.resolve({ ok: true, value: DRAFT });
    await t.flush();
    const second = t.panel.get(1);
    expect(first.kind === 'generated' && second.kind === 'generated').toBe(true);
    if (first.kind === 'generated' && second.kind === 'generated')
      expect(second.draftId).not.toBe(first.draftId);
  });

  it('never starts a draft once the panel shows inserting or inserted', () => {
    const t = setup();
    for (const kind of ['inserting', 'inserted'] as const) {
      t.panel.set(1, {
        kind,
        question: QUESTION,
        source: 'content-script',
        captureId: 'c1',
        field: { status: 'found' },
        ...(kind === 'inserting'
          ? { answer: 'x', usedFactCount: 0, warnings: [], draftId: 1, maxWords: 150 }
          : {}),
      } as PanelState);
      t.controller.start({ tabId: 1, captureId: 'c1', question: QUESTION });
    }
    expect(t.pending).toHaveLength(0);
  });

  it.each([
    'HELPER_UNAVAILABLE',
    'PROTOCOL_VERSION_UNSUPPORTED',
    'INTERNAL_ERROR',
    'PROVIDER_TIMEOUT',
    'FACT_VALIDATION_FAILED',
  ] as const)('%s returns to captured with the edited question preserved', async (code) => {
    const t = setup();
    t.capture(1);
    const edited = `${QUESTION} My edit.`;
    t.controller.start({ tabId: 1, captureId: 'c1', question: edited });
    t.pending[0]?.resolve(fail(code));
    await t.flush();
    expect(t.panel.get(1)).toEqual({
      kind: 'captured',
      question: edited,
      source: 'content-script',
      captureId: 'c1',
      field: { status: 'found', label: 'Why Acme?' },
      error: code,
    });
  });

  it('a new request cancels the old one and the old result is ignored', async () => {
    const t = setup();
    t.capture(1);
    t.controller.start({ tabId: 1, captureId: 'c1', question: QUESTION });
    t.controller.start({ tabId: 1, captureId: 'c1', question: `${QUESTION} Again.` });
    expect(t.pending[0]?.cancelled).toBe(1);
    expect(t.pending[1]?.cancelled).toBe(0);
    // The old request resolves late with a real answer: it must not be shown.
    t.pending[0]?.resolve({ ok: true, value: { ...DRAFT, answer: 'STALE' } });
    await t.flush();
    expect(t.panel.get(1)).toMatchObject({ kind: 'generating', question: `${QUESTION} Again.` });
    t.pending[1]?.resolve({ ok: true, value: DRAFT });
    await t.flush();
    expect(t.panel.get(1)).toMatchObject({ kind: 'generated', answer: 'Deterministic answer.' });
  });

  it('a response for one tab never reaches another tab', async () => {
    const t = setup();
    t.capture(1);
    t.capture(2, 'c2', 'Tell us about a hard problem you solved.');
    t.controller.start({ tabId: 1, captureId: 'c1', question: QUESTION });
    t.controller.start({
      tabId: 2,
      captureId: 'c2',
      question: 'Tell us about a hard problem you solved.',
    });
    expect(t.pending).toHaveLength(2);
    expect(t.pending[0]?.cancelled).toBe(0); // starting on tab 2 leaves tab 1 running
    t.pending[0]?.resolve({ ok: true, value: { ...DRAFT, answer: 'FOR TAB ONE' } });
    await t.flush();
    expect(t.panel.get(1)).toMatchObject({ kind: 'generated', answer: 'FOR TAB ONE' });
    expect(t.panel.get(2)).toMatchObject({ kind: 'generating' });
    t.pending[1]?.resolve(fail('PROVIDER_TIMEOUT'));
    await t.flush();
    expect(t.panel.get(1)).toMatchObject({ kind: 'generated', answer: 'FOR TAB ONE' });
    expect(t.panel.get(2)).toMatchObject({ kind: 'captured', error: 'PROVIDER_TIMEOUT' });
  });

  it('user cancel disconnects, returns to captured without an error, and ignores the late result', async () => {
    const t = setup();
    t.capture(1);
    t.controller.start({ tabId: 1, captureId: 'c1', question: `${QUESTION} Edit.` });
    t.controller.cancel(1);
    expect(t.pending[0]?.cancelled).toBe(1);
    expect(t.panel.get(1)).toEqual({
      kind: 'captured',
      question: `${QUESTION} Edit.`,
      source: 'content-script',
      captureId: 'c1',
      field: { status: 'found', label: 'Why Acme?' },
    });
    await t.flush();
    expect(t.panel.get(1)).toMatchObject({ kind: 'captured' });
    expect('error' in t.panel.get(1)).toBe(false);
    // Cancel with nothing in flight is a no-op.
    const pushed = t.pushes.length;
    t.controller.cancel(1);
    expect(t.pushes).toHaveLength(pushed);
  });

  it('abandon (navigation or close) cancels without touching panel state', async () => {
    const t = setup();
    t.capture(1);
    t.controller.start({ tabId: 1, captureId: 'c1', question: QUESTION });
    const before = t.pushes.length;
    t.controller.abandon(1);
    await t.flush();
    expect(t.pending[0]?.cancelled).toBe(1);
    expect(t.pushes).toHaveLength(before);
    t.pending[0]?.resolve({ ok: true, value: DRAFT });
    await t.flush();
    expect(t.pushes).toHaveLength(before);
  });

  it('cancelAll (panel closed) cancels every request and restores captured states', async () => {
    const t = setup();
    t.capture(1);
    t.capture(2, 'c2');
    t.controller.start({ tabId: 1, captureId: 'c1', question: QUESTION });
    t.controller.start({ tabId: 2, captureId: 'c2', question: QUESTION });
    t.controller.cancelAll();
    expect(t.pending.map((p) => p.cancelled)).toEqual([1, 1]);
    expect(t.panel.get(1).kind).toBe('captured');
    expect(t.panel.get(2).kind).toBe('captured');
  });

  it('a result arriving after navigation reset the tab is ignored', async () => {
    const t = setup();
    t.capture(1);
    t.controller.start({ tabId: 1, captureId: 'c1', question: QUESTION });
    t.controller.abandon(1);
    t.panel.reset(1);
    t.pending[0]?.resolve({ ok: true, value: DRAFT });
    await t.flush();
    expect(t.panel.get(1)).toEqual({ kind: 'empty' });
  });

  it('ignores a stale captureId and refuses unsupported or error states', () => {
    const t = setup();
    t.capture(1, 'new-capture');
    t.controller.start({ tabId: 1, captureId: 'old-capture', question: QUESTION });
    expect(t.pending).toHaveLength(0);
    expect(t.panel.get(1)).toMatchObject({ captureId: 'new-capture', kind: 'captured' });
    t.panel.set(2, { kind: 'unsupported-domain' });
    t.controller.start({ tabId: 2, captureId: 'c1', question: QUESTION });
    t.panel.set(3, { kind: 'error', code: 'QUESTION_MISSING' });
    t.controller.start({ tabId: 3, captureId: 'c1', question: QUESTION });
    expect(t.pending).toHaveLength(0);
  });

  it('with no worker state, trusts the panel capture id and reports the field as not found', () => {
    const t = setup();
    t.controller.start({ tabId: 5, captureId: 'panel-cap', question: QUESTION });
    expect(t.pending).toHaveLength(1);
    expect(t.panel.get(5)).toMatchObject({
      kind: 'generating',
      captureId: 'panel-cap',
      field: { status: 'not-found' },
    });
  });

  it('an out-of-range question never reaches the helper and is reported as INVALID_REQUEST', () => {
    const t = setup();
    t.capture(1);
    t.controller.start({ tabId: 1, captureId: 'c1', question: 'x'.repeat(1001) });
    expect(t.pending).toHaveLength(0);
    expect(t.panel.get(1)).toMatchObject({ kind: 'captured', error: 'INVALID_REQUEST' });
  });

  it('only ever writes panel state: no insertion path exists', () => {
    const t = setup();
    t.capture(1);
    t.controller.start({ tabId: 1, captureId: 'c1', question: QUESTION });
    expect(Object.keys(t.controller).sort()).toEqual(['abandon', 'cancel', 'cancelAll', 'start']);
  });
});
