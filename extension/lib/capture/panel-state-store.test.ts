import { createPanelStateStore } from './panel-state-store';
import type { PanelState } from '../../schemas/internal-message';

describe('panel state store', () => {
  it('keeps per-tab state, defaults to empty, and pushes changes', () => {
    const pushes: [number, PanelState][] = [];
    const store = createPanelStateStore((id, s) => pushes.push([id, s]));
    expect(store.get(1)).toEqual({ kind: 'empty' });
    store.set(1, { kind: 'unsupported-domain' });
    store.set(2, { kind: 'error', code: 'QUESTION_MISSING' });
    expect(store.get(1)).toEqual({ kind: 'unsupported-domain' });
    expect(store.get(2)).toEqual({ kind: 'error', code: 'QUESTION_MISSING' });
    expect(pushes).toHaveLength(2);
  });

  it('reset pushes empty only when the tab had state; remove is silent', () => {
    const pushes: [number, PanelState][] = [];
    const store = createPanelStateStore((id, s) => pushes.push([id, s]));
    store.reset(1);
    expect(pushes).toEqual([]);
    store.set(1, { kind: 'unsupported-domain' });
    store.reset(1);
    expect(pushes.at(-1)).toEqual([1, { kind: 'empty' }]);
    store.set(3, { kind: 'unsupported-domain' });
    const count = pushes.length;
    store.remove(3);
    expect(pushes).toHaveLength(count);
    expect(store.get(3)).toEqual({ kind: 'empty' });
  });
});
