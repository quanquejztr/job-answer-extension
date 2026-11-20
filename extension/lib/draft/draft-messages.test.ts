import { vi } from 'vitest';
import type { DraftController } from './draft-controller';
import { handleDraftMessage } from './draft-messages';

const QUESTION = 'Why do you want to work at Acme?';
const start = (over: object = {}, payload: object = {}) => ({
  v: 1,
  requestId: 'r1',
  type: 'draft.start',
  payload: { tabId: 4, captureId: 'c1', question: QUESTION, ...payload },
  ...over,
});
const cancel = { v: 1, requestId: 'r2', type: 'draft.cancel', payload: { tabId: 4 } };

function setup() {
  const controller: DraftController = {
    start: vi.fn(),
    cancel: vi.fn(),
    abandon: vi.fn(),
    cancelAll: vi.fn(),
  };
  const handle = (message: unknown, sender: { id?: string; tab?: unknown }) =>
    handleDraftMessage({ runtimeId: 'me', controller }, message, sender);
  return { controller, handle };
}

describe('handleDraftMessage', () => {
  it('routes draft.start and draft.cancel from an extension page', () => {
    const { controller, handle } = setup();
    expect(handle(start(), { id: 'me' })).toBe(true);
    expect(controller.start).toHaveBeenCalledWith({
      tabId: 4,
      captureId: 'c1',
      question: QUESTION,
    });
    expect(handle(cancel, { id: 'me' })).toBe(true);
    expect(controller.cancel).toHaveBeenCalledWith(4);
  });

  it('ignores other extensions, missing ids, and content scripts', () => {
    const { controller, handle } = setup();
    for (const sender of [{ id: 'evil' }, {}, { id: 'me', tab: { id: 9 } }]) {
      expect(handle(start(), sender)).toBe(false);
      expect(handle(cancel, sender)).toBe(false);
    }
    expect(controller.start).not.toHaveBeenCalled();
    expect(controller.cancel).not.toHaveBeenCalled();
  });

  it.each([
    ['short question', start({}, { question: 'too short' })],
    ['whitespace question', start({}, { question: ' '.repeat(40) })],
    ['long question', start({}, { question: 'x'.repeat(1001) })],
    ['negative tab', start({}, { tabId: -1 })],
    ['string tab', start({}, { tabId: '4' })],
    ['bad capture id', start({}, { captureId: 'bad id' })],
    ['missing capture id', start({}, { captureId: undefined })],
    ['extra payload key', start({}, { extra: 1 })],
    ['extra top key', start({ extra: true })],
    ['wrong version', start({ v: 2 })],
    ['unknown type', start({ type: 'draft.insert' })],
    ['panel.state.get', { v: 1, requestId: 'r', type: 'panel.state.get', payload: { tabId: 1 } }],
    ['null', null],
  ])('ignores %s', (_n, message) => {
    const { controller, handle } = setup();
    expect(handle(message, { id: 'me' })).toBe(false);
    expect(controller.start).not.toHaveBeenCalled();
    expect(controller.cancel).not.toHaveBeenCalled();
  });
});
