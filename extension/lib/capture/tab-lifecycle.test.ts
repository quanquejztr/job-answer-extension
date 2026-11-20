import type { FieldCandidate } from '../../schemas/field-target';
import { createTarget, type Clock } from '../targeting/target';
import { createTargetStore } from '../targeting/target-store';
import { createPanelStateStore } from './panel-state-store';
import { createTabLifecycle } from './tab-lifecycle';
import type { PanelState } from '../../schemas/internal-message';

const clock: Clock = { monotonicMs: () => 0, wallMs: () => 0 };
const candidate: FieldCandidate = {
  labelText: 'Why?',
  fingerprint: {
    tag: 'textarea',
    contentEditable: false,
    labelText: 'Why?',
    sizeBucket: [200, 100],
    domPath: [0],
  },
};

function setup() {
  const pushes: [number, PanelState][] = [];
  const panel = createPanelStateStore((id, s) => pushes.push([id, s]));
  const targets = createTargetStore(clock);
  for (const tabId of [1, 2]) {
    targets.set(
      tabId,
      createTarget(
        { id: `t${tabId}`, tabId, frameId: 0, pageOrigin: 'https://a.example', candidate },
        clock,
      ),
    );
    panel.set(tabId, {
      kind: 'captured',
      question: 'Why do you want this?',
      source: 'content-script',
      captureId: 'c',
      field: { status: 'found', label: 'Why?' },
    });
  }
  pushes.length = 0;
  const abandoned: number[] = [];
  const draft = { abandon: (tabId: number) => void abandoned.push(tabId) };
  return {
    panel,
    targets,
    pushes,
    abandoned,
    lifecycle: createTabLifecycle({ panel, targets, draft }),
  };
}

describe('tab lifecycle', () => {
  it('navigation or reload invalidates only that tab and resets its panel to Empty', () => {
    const { lifecycle, targets, panel, pushes } = setup();
    lifecycle.onNavigated(1);
    expect(targets.get(1)).toMatchObject({
      target: { state: 'invalidated' },
      invalidatedBy: 'navigation',
    });
    expect(targets.get(2)?.target.state).toBe('captured');
    expect(panel.get(1)).toEqual({ kind: 'empty' });
    expect(pushes).toEqual([[1, { kind: 'empty' }]]);
  });

  it('closing a tab forgets its target and state without a push', () => {
    const { lifecycle, targets, panel, pushes } = setup();
    lifecycle.onClosed(2);
    expect(targets.get(2)).toBeUndefined();
    expect(panel.get(2)).toEqual({ kind: 'empty' });
    expect(pushes).toEqual([]);
    expect(targets.get(1)?.target.state).toBe('captured');
  });

  it("navigation and close abandon only that tab's in-flight draft", () => {
    const { lifecycle, abandoned } = setup();
    lifecycle.onNavigated(1);
    lifecycle.onClosed(2);
    expect(abandoned).toEqual([1, 2]);
  });

  it('events for unknown tabs are harmless', () => {
    const { lifecycle } = setup();
    expect(() => {
      lifecycle.onNavigated(99);
      lifecycle.onClosed(99);
    }).not.toThrow();
  });
});
