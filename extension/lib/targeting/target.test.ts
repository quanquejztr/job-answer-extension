import type { FieldCandidate } from '../../schemas/field-target';
import {
  advance,
  createTarget,
  invalidate,
  isExpired,
  type Clock,
  type TrackedTarget,
} from './target';
import { createTargetStore } from './target-store';

const candidate: FieldCandidate = {
  labelText: 'Why Acme?',
  fingerprint: {
    tag: 'textarea',
    contentEditable: false,
    labelText: 'Why Acme?',
    sizeBucket: [300, 100],
    domPath: [0, 2],
  },
};

function fakeClock(start = 5_000): Clock & { mono: number; wall: number } {
  return {
    mono: start,
    wall: Date.UTC(2026, 10, 19, 12, 0, 0),
    monotonicMs() {
      return this.mono;
    },
    wallMs() {
      return this.wall;
    },
  };
}

const make = (clock: Clock): TrackedTarget =>
  createTarget(
    { id: 't1', tabId: 3, frameId: 2, pageOrigin: 'https://x.example', candidate },
    clock,
  );

describe('createTarget', () => {
  it('builds a captured FieldTarget with locator, fingerprint, and a 10 minute expiry', () => {
    const clock = fakeClock();
    expect(make(clock)).toEqual({
      deadlineMs: 5_000 + 600_000,
      target: {
        id: 't1',
        tabId: 3,
        frameId: 2,
        pageOrigin: 'https://x.example',
        labelText: 'Why Acme?',
        locator: { frameId: 2, domPath: [0, 2] },
        fingerprint: candidate.fingerprint,
        state: 'captured',
        expiresAt: '2026-11-19T12:10:00.000Z',
      },
    });
  });
});

describe('isExpired', () => {
  it('is valid until exactly 10 minutes, expired at 10 minutes and after', () => {
    const clock = fakeClock(0);
    const tracked = make(clock);
    clock.mono = 599_999;
    expect(isExpired(tracked, clock)).toBe(false);
    clock.mono = 600_000;
    expect(isExpired(tracked, clock)).toBe(true);
    clock.mono = 700_000;
    expect(isExpired(tracked, clock)).toBe(true);
  });

  it('ignores wall-clock changes (monotonic clock decides)', () => {
    const clock = fakeClock(0);
    const tracked = make(clock);
    clock.wall += 24 * 3600 * 1000; // user changes the system clock
    expect(isExpired(tracked, clock)).toBe(false);
    clock.wall -= 48 * 3600 * 1000;
    expect(isExpired(tracked, clock)).toBe(false);
  });
});

describe('state transitions', () => {
  it('moves captured -> validated -> approved -> inserted, one step at a time', () => {
    let t = make(fakeClock());
    for (const next of ['validated', 'approved', 'inserted'] as const) {
      const moved = advance(t, next);
      expect(moved?.target.state).toBe(next);
      if (moved === undefined) throw new Error('transition refused');
      t = moved;
    }
  });

  it.each([
    ['captured', 'approved'],
    ['captured', 'inserted'],
    ['captured', 'captured'],
    ['validated', 'inserted'],
    ['validated', 'captured'],
    ['approved', 'validated'],
    ['inserted', 'approved'],
    ['captured', 'invalidated'],
  ] as const)('refuses %s -> %s via advance', (from, to) => {
    const t = make(fakeClock());
    const at: TrackedTarget = { ...t, target: { ...t.target, state: from } };
    expect(advance(at, to)).toBeUndefined();
  });

  it('does not mutate its input', () => {
    const t = make(fakeClock());
    advance(t, 'validated');
    invalidate(t, 'navigation');
    expect(t.target.state).toBe('captured');
    expect(t.invalidatedBy).toBeUndefined();
  });
});

describe('invalidate', () => {
  it.each(['captured', 'validated', 'approved'] as const)('invalidates a %s target', (state) => {
    const t = make(fakeClock());
    const at: TrackedTarget = { ...t, target: { ...t.target, state } };
    for (const reason of [
      'navigation',
      'tab-closed',
      'expired',
      'revalidation-failed',
      'replaced',
    ] as const) {
      const out = invalidate(at, reason);
      expect(out.target.state).toBe('invalidated');
      expect(out.invalidatedBy).toBe(reason);
    }
  });

  it('keeps the first reason and offers no way back from invalidated', () => {
    const once = invalidate(make(fakeClock()), 'navigation');
    expect(invalidate(once, 'expired').invalidatedBy).toBe('navigation');
    for (const to of ['captured', 'validated', 'approved', 'inserted'] as const)
      expect(advance(once, to)).toBeUndefined();
  });

  it('leaves an inserted target alone (inserted is final)', () => {
    const t = make(fakeClock());
    const inserted: TrackedTarget = { ...t, target: { ...t.target, state: 'inserted' } };
    expect(invalidate(inserted, 'navigation')).toBe(inserted);
    expect(advance(inserted, 'validated')).toBeUndefined();
  });
});

describe('target store', () => {
  it('keeps one target per tab and replaces on set', () => {
    const clock = fakeClock();
    const store = createTargetStore(clock);
    store.set(1, make(clock));
    store.set(2, { ...make(clock), target: { ...make(clock).target, id: 'other', tabId: 2 } });
    expect(store.get(1)?.target.id).toBe('t1');
    expect(store.get(2)?.target.id).toBe('other');
    store.set(1, { ...make(clock), target: { ...make(clock).target, id: 'newer' } });
    expect(store.get(1)?.target.id).toBe('newer');
    expect(store.get(3)).toBeUndefined();
  });

  it('invalidates an overdue target on read and keeps the reason', () => {
    const clock = fakeClock(0);
    const store = createTargetStore(clock);
    store.set(1, make(clock));
    clock.mono = 599_999;
    expect(store.get(1)?.target.state).toBe('captured');
    clock.mono = 600_000;
    expect(store.get(1)).toMatchObject({
      target: { state: 'invalidated' },
      invalidatedBy: 'expired',
    });
  });

  it('invalidate keeps the record as invalidated; remove forgets it; both tolerate unknown tabs', () => {
    const clock = fakeClock();
    const store = createTargetStore(clock);
    store.set(1, make(clock));
    store.invalidate(1, 'navigation');
    expect(store.get(1)).toMatchObject({ invalidatedBy: 'navigation' });
    store.remove(1);
    expect(store.get(1)).toBeUndefined();
    expect(() => {
      store.invalidate(9, 'navigation');
      store.remove(9);
      store.update(9, make(clock));
    }).not.toThrow();
    expect(store.get(9)).toBeUndefined();
  });
});
