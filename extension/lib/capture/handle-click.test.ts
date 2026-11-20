import { handleMenuClick, type CaptureDeps } from './handle-click';
import type { PanelState } from '../../schemas/internal-message';
import type { Clock } from '../targeting/target';
import { createTargetStore, type TargetStore } from '../targeting/target-store';

const GOOD = 'Why do you want to work at Acme?';
const TAB = { id: 7, url: 'https://boards.example.com/jobs/1' };

interface Harness {
  deps: CaptureDeps;
  calls: string[];
  states: { tabId: number; state: PanelState }[];
  tabMessages: unknown[];
  targets: TargetStore;
  clock: Clock & { now: number };
}

const FINGERPRINT = {
  tag: 'textarea',
  contentEditable: false,
  idAttr: 'why',
  labelText: 'Why Acme?',
  sizeBucket: [200, 100],
  domPath: [0, 1],
};

function harness(opts: {
  executeScript?: () => Promise<unknown>;
  reply?: (request: { requestId: string }) => unknown;
}): Harness {
  const calls: string[] = [];
  const states: Harness['states'] = [];
  const tabMessages: unknown[] = [];
  const clock = {
    now: 1000,
    monotonicMs() {
      return this.now;
    },
    wallMs: () => Date.UTC(2026, 10, 19, 12, 0, 0),
  };
  const targets = createTargetStore(clock);
  let requestCount = 0;
  const deps: CaptureDeps = {
    openSidePanel: () => {
      calls.push('open');
      return Promise.resolve();
    },
    executeScript: (options) => {
      calls.push('inject');
      expect(options.files).toEqual(['content-scripts/content.js']);
      return (opts.executeScript ?? (() => Promise.resolve([{}])))();
    },
    sendTabMessage: (_tabId, message) => {
      calls.push('send');
      tabMessages.push(message);
      return Promise.resolve(opts.reply?.(message) ?? undefined);
    },
    setState: (tabId, state) => {
      calls.push('setState');
      states.push({ tabId, state });
    },
    newRequestId: () => `req-${++requestCount}`,
    targets,
    clock,
    contentScriptFile: 'content-scripts/content.js',
  };
  return { deps, calls, states, tabMessages, targets, clock };
}

const NONE = { fieldStatus: 'not-found', field: null, candidates: 0 };
const FOUND = {
  fieldStatus: 'found',
  field: { labelText: 'Why Acme?', fingerprint: FINGERPRINT },
  candidates: 1,
};

const goodReply =
  (question: string, field: object = NONE) =>
  (request: { requestId: string }) => ({
    v: 1,
    requestId: request.requestId,
    type: 'capture.result',
    payload: { question, ...field },
  });

describe('handleMenuClick', () => {
  it('opens the side panel synchronously, before any await or other call', () => {
    const h = harness({ reply: goodReply(GOOD) });
    const pending = handleMenuClick(h.deps, { selectionText: GOOD, frameId: 0 }, TAB);
    // Everything above ran synchronously (no await yet): open must be the very first call.
    expect(h.calls[0]).toBe('open');
    expect(h.calls.filter((c) => c === 'open')).toHaveLength(1);
    return pending;
  });

  it('never waits for sidePanel.open to settle before capturing', async () => {
    const h = harness({ reply: goodReply(GOOD) });
    h.deps.openSidePanel = () => {
      h.calls.push('open');
      return new Promise(() => undefined);
    };
    await handleMenuClick(h.deps, { selectionText: GOOD, frameId: 0 }, TAB);
    expect(h.calls).toEqual(['open', 'inject', 'send', 'setState']);
  });

  it('opens the panel even for a blocked page, still before anything else', async () => {
    const h = harness({});
    const pending = handleMenuClick(
      h.deps,
      { selectionText: GOOD },
      { id: 7, url: 'https://www.linkedin.com/jobs' },
    );
    expect(h.calls[0]).toBe('open');
    await pending;
    expect(h.calls).toEqual(['open', 'setState']);
  });

  it('does nothing without a tab id (nothing to open or capture)', async () => {
    const h = harness({});
    await handleMenuClick(h.deps, { selectionText: GOOD }, { url: TAB.url });
    expect(h.calls).toEqual([]);
  });

  it('still captures when the panel refuses to open', async () => {
    const h = harness({ reply: goodReply(GOOD) });
    h.deps.openSidePanel = () => Promise.reject(new Error('already open'));
    await handleMenuClick(h.deps, { selectionText: GOOD, frameId: 0 }, TAB);
    expect(h.states[0]?.state.kind).toBe('captured');
  });

  describe('blocked and unsupported pages', () => {
    it.each([
      [
        'top-level LinkedIn',
        { selectionText: GOOD },
        { id: 7, url: 'https://www.linkedin.com/jobs/1' },
      ],
      ['top-level Indeed', { selectionText: GOOD }, { id: 7, url: 'https://jobs.indeed.com/x' }],
      [
        'frame on Indeed inside an allowed page',
        { selectionText: GOOD, frameId: 3, frameUrl: 'https://www.indeed.com/apply' },
        TAB,
      ],
      [
        'allowed frame inside a LinkedIn page',
        { selectionText: GOOD, frameId: 3, frameUrl: 'https://example.com/form' },
        { id: 7, url: 'https://linkedin.com/x' },
      ],
      ['chrome page', { selectionText: GOOD }, { id: 7, url: 'chrome://extensions' }],
      ['unknown tab url', { selectionText: GOOD }, { id: 7 }],
      ['unknown frame url', { selectionText: GOOD, frameId: 2 }, TAB],
    ])('%s: unsupported-domain state, no injection, no message', async (_name, info, tab) => {
      const h = harness({ reply: goodReply(GOOD) });
      await handleMenuClick(h.deps, info, tab);
      expect(h.calls).toEqual(['open', 'setState']);
      expect(h.states).toEqual([{ tabId: 7, state: { kind: 'unsupported-domain' } }]);
    });

    it('checks the domain before validating the selection', async () => {
      const h = harness({});
      await handleMenuClick(h.deps, { selectionText: 'hi' }, { id: 7, url: 'https://indeed.com/' });
      expect(h.states[0]?.state).toEqual({ kind: 'unsupported-domain' });
    });

    it('does not block lookalike domains', async () => {
      const h = harness({ reply: goodReply(GOOD) });
      await handleMenuClick(
        h.deps,
        { selectionText: GOOD },
        { id: 7, url: 'https://notlinkedin.com/' },
      );
      expect(h.states[0]?.state.kind).toBe('captured');
    });
  });

  describe('selection validation (AC-021)', () => {
    it.each([
      ['empty', '', 'QUESTION_MISSING'],
      ['missing', undefined, 'QUESTION_MISSING'],
      ['5 characters', 'abcde', 'QUESTION_MISSING'],
      ['only whitespace padding', '   short   ', 'QUESTION_MISSING'],
      ['1001 characters', 'a'.repeat(1001), 'INVALID_REQUEST'],
    ])('%s -> error %s, no injection', async (_name, selectionText, code) => {
      const h = harness({ reply: goodReply(GOOD) });
      await handleMenuClick(h.deps, { selectionText, frameId: 0 }, TAB);
      expect(h.calls).toEqual(['open', 'setState']);
      expect(h.states).toEqual([{ tabId: 7, state: { kind: 'error', code } }]);
    });

    it('accepts exactly 10 and exactly 1000 characters', async () => {
      for (const n of [10, 1000]) {
        const h = harness({ reply: goodReply('a'.repeat(n)) });
        await handleMenuClick(h.deps, { selectionText: 'a'.repeat(n), frameId: 0 }, TAB);
        expect(h.states[0]?.state.kind).toBe('captured');
      }
    });
  });

  describe('capture', () => {
    it('injects only the clicked frame and sends a validated capture.request', async () => {
      const h = harness({ reply: goodReply('Why Acme from the page?') });
      let target: unknown;
      h.deps.executeScript = (options) => {
        target = options.target;
        return Promise.resolve([{}]);
      };
      await handleMenuClick(
        h.deps,
        { selectionText: GOOD, frameId: 5, frameUrl: 'https://example.com/frame' },
        TAB,
      );
      expect(target).toEqual({ tabId: 7, frameIds: [5] });
      expect(h.tabMessages).toEqual([
        { v: 1, requestId: 'req-1', type: 'capture.request', payload: {} },
      ]);
      expect(h.states[0]).toEqual({
        tabId: 7,
        state: {
          kind: 'captured',
          question: 'Why Acme from the page?',
          source: 'content-script',
          captureId: 'req-1',
          field: { status: 'not-found' },
        },
      });
    });

    it('falls back to the menu selection, without error, when injection is refused', async () => {
      const h = harness({
        executeScript: () => Promise.reject(new Error('Cannot access contents of the page.')),
        reply: goodReply('should not be used'),
      });
      await handleMenuClick(
        h.deps,
        { selectionText: `  ${GOOD}  `, frameId: 4, frameUrl: 'https://ats.example.net/form' },
        TAB,
      );
      expect(h.calls).toEqual(['open', 'inject', 'setState']);
      expect(h.states[0]?.state).toEqual({
        kind: 'captured',
        question: GOOD,
        source: 'menu-selection',
        captureId: 'req-1',
        field: { status: 'not-found' },
      });
    });

    it('falls back when the frame does not answer', async () => {
      const h = harness({});
      h.deps.sendTabMessage = () => Promise.reject(new Error('port closed'));
      await handleMenuClick(h.deps, { selectionText: GOOD, frameId: 0 }, TAB);
      expect(h.states[0]?.state).toMatchObject({ kind: 'captured', source: 'menu-selection' });
    });

    it.each([
      ['undefined', () => undefined],
      ['a string', () => 'hello'],
      [
        'wrong type',
        (r: { requestId: string }) => ({ ...goodReply(GOOD)(r), type: 'capture.request' }),
      ],
      ['wrong version', (r: { requestId: string }) => ({ ...goodReply(GOOD)(r), v: 2 })],
      ['another requestId', () => ({ ...goodReply(GOOD)({ requestId: 'other' }) })],
      ['an empty question', goodReply('')],
      ['a short question', goodReply('too short')],
      ['an oversized question', goodReply('a'.repeat(1001))],
      [
        'an unknown payload key',
        (r: { requestId: string }) => {
          const reply = goodReply(GOOD)(r);
          return { ...reply, payload: { ...reply.payload, profile: 'secret' } };
        },
      ],
      [
        'a status that disagrees with the field',
        goodReply('Why Acme from the page?', { ...FOUND, field: null }),
      ],
      [
        'an ambiguous status carrying a field',
        goodReply('Why Acme from the page?', { ...FOUND, fieldStatus: 'ambiguous', candidates: 2 }),
      ],
      [
        'a field with an unknown key',
        goodReply('Why Acme from the page?', {
          ...FOUND,
          field: { ...FOUND.field, tabId: 99 },
        }),
      ],
      [
        'a fingerprint path deeper than 40',
        goodReply('Why Acme from the page?', {
          ...FOUND,
          field: {
            ...FOUND.field,
            fingerprint: { ...FINGERPRINT, domPath: Array.from({ length: 41 }, () => 0) },
          },
        }),
      ],
      [
        'a jobContext',
        (r: { requestId: string }) => {
          const reply = goodReply(GOOD)(r);
          return { ...reply, payload: { ...reply.payload, jobContext: { text: 'x' } } };
        },
      ],
    ])('rejects a reply with %s and uses the menu selection', async (_name, reply) => {
      const h = harness({ reply });
      await handleMenuClick(h.deps, { selectionText: GOOD, frameId: 0 }, TAB);
      expect(h.states[0]?.state).toMatchObject({
        kind: 'captured',
        question: GOOD,
        source: 'menu-selection',
      });
    });

    describe('field targets', () => {
      const foundReply = goodReply('Why Acme from the page?', FOUND);

      it('the worker builds the FieldTarget from the click and the candidate', async () => {
        const h = harness({ reply: foundReply });
        await handleMenuClick(
          h.deps,
          { selectionText: GOOD, frameId: 0, frameUrl: 'https://boards.example.com/jobs/1' },
          TAB,
        );
        expect(h.targets.get(7)).toEqual({
          deadlineMs: 1000 + 600_000,
          target: {
            id: 'req-1', // the capture id, so Insert can tie a draft to its field
            tabId: 7,
            frameId: 0,
            pageOrigin: 'https://boards.example.com',
            labelText: 'Why Acme?',
            locator: { frameId: 0, domPath: [0, 1] },
            fingerprint: FINGERPRINT,
            state: 'captured',
            expiresAt: '2026-11-19T12:10:00.000Z',
          },
        });
        expect(h.states[0]?.state).toMatchObject({
          kind: 'captured',
          field: { status: 'found', label: 'Why Acme?' },
        });
      });

      it('uses the clicked frame for frameId and origin', async () => {
        const h = harness({ reply: foundReply });
        await handleMenuClick(
          h.deps,
          { selectionText: GOOD, frameId: 5, frameUrl: 'https://ats.example.net/form?x=1#y' },
          TAB,
        );
        expect(h.targets.get(7)?.target).toMatchObject({
          frameId: 5,
          pageOrigin: 'https://ats.example.net',
          locator: { frameId: 5 },
        });
      });

      it('never puts the target, locator, or fingerprint in the panel state', async () => {
        const h = harness({ reply: foundReply });
        await handleMenuClick(h.deps, { selectionText: GOOD, frameId: 0 }, TAB);
        const state = JSON.stringify(h.states);
        for (const secret of ['fingerprint', 'locator', 'domPath', 'sizeBucket', 'idAttr'])
          expect(state).not.toContain(secret);
        expect(h.states[0]?.state).toMatchObject({
          field: { status: 'found', label: 'Why Acme?' },
        });
      });

      it('omits an empty label from the panel field', async () => {
        const h = harness({
          reply: goodReply('Why Acme from the page?', {
            ...FOUND,
            field: { labelText: '', fingerprint: { ...FINGERPRINT, labelText: '' } },
          }),
        });
        await handleMenuClick(h.deps, { selectionText: GOOD, frameId: 0 }, TAB);
        expect(h.states[0]?.state).toMatchObject({ field: { status: 'found' } });
        expect(h.states[0]?.state).not.toHaveProperty('field.label');
      });

      it.each([
        ['not-found', NONE, { status: 'not-found' }],
        [
          'ambiguous',
          { fieldStatus: 'ambiguous', field: null, candidates: 3 },
          { status: 'ambiguous' },
        ],
      ])('%s creates no target', async (_name, field, expected) => {
        const h = harness({ reply: goodReply('Why Acme from the page?', field) });
        await handleMenuClick(h.deps, { selectionText: GOOD, frameId: 0 }, TAB);
        expect(h.targets.get(7)).toBeUndefined();
        expect(h.states[0]?.state).toMatchObject({ field: expected });
      });

      it('creates no target when the page origin cannot be determined', async () => {
        const h = harness({ reply: foundReply });
        // Top frame with an opaque-origin URL: fail closed.
        await handleMenuClick(
          h.deps,
          { selectionText: GOOD, frameId: 0 },
          { id: 7, url: 'data:text/html,x' },
        );
        expect(h.targets.get(7)).toBeUndefined();
      });

      it('creates no target on the menu-selection fallback', async () => {
        const h = harness({ executeScript: () => Promise.reject(new Error('no access')) });
        await handleMenuClick(h.deps, { selectionText: GOOD, frameId: 0 }, TAB);
        expect(h.targets.get(7)).toBeUndefined();
        expect(h.states[0]?.state).toMatchObject({ field: { status: 'not-found' } });
      });

      it('a new capture replaces the previous target', async () => {
        const h = harness({ reply: foundReply });
        await handleMenuClick(h.deps, { selectionText: GOOD, frameId: 0 }, TAB);
        await handleMenuClick(h.deps, { selectionText: GOOD, frameId: 0 }, TAB);
        expect(h.targets.get(7)?.target.id).toBe('req-2');
      });

      it('a new capture without a field removes the previous target', async () => {
        const h = harness({ reply: foundReply });
        await handleMenuClick(h.deps, { selectionText: GOOD, frameId: 0 }, TAB);
        h.deps.sendTabMessage = (_t, message) => {
          const request = message as { requestId: string };
          return Promise.resolve(goodReply('Why Acme from the page?')(request));
        };
        await handleMenuClick(h.deps, { selectionText: GOOD, frameId: 0 }, TAB);
        expect(h.targets.get(7)).toBeUndefined();
      });

      it('a failed or unsupported recapture also removes the old target', async () => {
        const h = harness({ reply: foundReply });
        await handleMenuClick(h.deps, { selectionText: GOOD, frameId: 0 }, TAB);
        await handleMenuClick(h.deps, { selectionText: 'hi', frameId: 0 }, TAB);
        expect(h.targets.get(7)).toBeUndefined();
      });

      it('targets are per tab', async () => {
        const h = harness({ reply: foundReply });
        await handleMenuClick(h.deps, { selectionText: GOOD, frameId: 0 }, TAB);
        await handleMenuClick(h.deps, { selectionText: GOOD, frameId: 0 }, { ...TAB, id: 8 });
        expect(h.targets.get(7)?.target.tabId).toBe(7);
        expect(h.targets.get(8)?.target.tabId).toBe(8);
      });

      it('the stored target expires after 10 minutes of the monotonic clock', async () => {
        const h = harness({ reply: foundReply });
        await handleMenuClick(h.deps, { selectionText: GOOD, frameId: 0 }, TAB);
        h.clock.now += 600_000 - 1;
        expect(h.targets.get(7)?.target.state).toBe('captured');
        h.clock.now += 1;
        expect(h.targets.get(7)).toMatchObject({
          target: { state: 'invalidated' },
          invalidatedBy: 'expired',
        });
      });
    });

    it('treats the question as plain text (HTML-like input is kept verbatim)', async () => {
      const html = '<img src=x onerror=alert(1)> Why do you want this job?';
      const h = harness({ reply: goodReply(html) });
      await handleMenuClick(h.deps, { selectionText: html, frameId: 0 }, TAB);
      expect(h.states[0]?.state).toMatchObject({ question: html });
    });
  });
});
