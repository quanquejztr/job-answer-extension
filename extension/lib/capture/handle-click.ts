import { arePagesSupported } from '../domain/blocked';
import { validateSelection } from '../question/selection';
import {
  CaptureResultSchema,
  type CaptureRequest,
  type CaptureResult,
  type PanelField,
  type PanelState,
} from '../../schemas/internal-message';
import { createTarget, type Clock } from '../targeting/target';
import type { TargetStore } from '../targeting/target-store';

/** The subset of `contextMenus.OnClickData` this flow reads. */
export interface ClickInfo {
  selectionText?: string | undefined;
  frameId?: number | undefined;
  frameUrl?: string | undefined;
  pageUrl?: string | undefined;
}

/** The subset of `tabs.Tab` this flow reads. */
export interface ClickTab {
  id?: number | undefined;
  url?: string | undefined;
}

/** Everything the click flow needs from the browser, injected so tests use fakes. */
export interface CaptureDeps {
  openSidePanel(options: { tabId: number }): Promise<unknown>;
  executeScript(options: {
    target: { tabId: number; frameIds: number[] };
    files: string[];
  }): Promise<unknown>;
  sendTabMessage(
    tabId: number,
    message: CaptureRequest,
    options: { frameId: number },
  ): Promise<unknown>;
  setState(tabId: number, state: PanelState): void;
  newRequestId(): string;
  /** Field targets, in worker memory only. */
  targets: TargetStore;
  clock: Clock;
  /** Path of the built content script, relative to the extension root. */
  contentScriptFile: string;
}

/**
 * Handles one "Draft answer" click.
 *
 * Gesture rule: `sidePanel.open` needs the user gesture the click carries, and
 * Chrome drops the gesture at the first `await`. So this function is
 * deliberately NOT `async`: it calls `openSidePanel` as its first statement,
 * synchronously, and only then hands over to the async `capture`.
 */
export function handleMenuClick(deps: CaptureDeps, info: ClickInfo, tab?: ClickTab): Promise<void> {
  if (tab?.id === undefined) return Promise.resolve();
  const tabId = tab.id;
  // A refused open (for example the panel is already open) must not stop capture.
  deps.openSidePanel({ tabId }).catch(() => undefined);
  return capture(deps, info, tab, tabId);
}

async function capture(
  deps: CaptureDeps,
  info: ClickInfo,
  tab: ClickTab,
  tabId: number,
): Promise<void> {
  // A new capture replaces whatever this tab had targeted before, even if this
  // one fails: an old target must never outlive the panel state it belonged to.
  deps.targets.remove(tabId);

  // Domain check first: it covers the top-level tab and the clicked frame, and
  // runs before any injection or capture. Unknown URLs fail closed.
  const frameId = info.frameId ?? 0;
  const urls = [tab.url ?? info.pageUrl, info.frameUrl];
  if (frameId !== 0 && info.frameUrl === undefined) urls.push('about:unknown-frame');
  if (!arePagesSupported(urls)) {
    deps.setState(tabId, { kind: 'unsupported-domain' });
    return;
  }

  const menuCheck = validateSelection(info.selectionText);
  if (!menuCheck.ok) {
    deps.setState(tabId, { kind: 'error', code: menuCheck.code });
    return;
  }

  const requestId = deps.newRequestId();
  const fromPage = await askContentScript(deps, tabId, frameId, requestId);
  // If the frame refused injection (cross-origin iframe without access), or its
  // reply is unusable, fall back to the browser-supplied selection (decision D5
  // is deferred, so this is not an error). No field is looked for in that case.
  if (fromPage === undefined) {
    deps.setState(tabId, {
      kind: 'captured',
      question: menuCheck.question,
      source: 'menu-selection',
      captureId: requestId,
      field: { status: 'not-found' },
    });
    return;
  }

  const field = keepTarget(
    deps,
    tabId,
    frameId,
    pageOrigin(info, tab, frameId),
    fromPage.result,
    requestId,
  );
  deps.setState(tabId, {
    kind: 'captured',
    question: fromPage.question,
    source: 'content-script',
    captureId: requestId,
    field,
  });
}

/** Origin of the frame the click happened in, or undefined if it cannot be determined. */
function pageOrigin(info: ClickInfo, tab: ClickTab, frameId: number): string | undefined {
  const url = frameId === 0 ? (tab.url ?? info.pageUrl ?? info.frameUrl) : info.frameUrl;
  if (url === undefined) return undefined;
  try {
    const { origin } = new URL(url);
    return origin === 'null' ? undefined : origin;
  } catch {
    return undefined;
  }
}

/**
 * Builds and stores the FieldTarget for a found field, and returns the only
 * part the side panel may see (status and label text). The worker, not the
 * page, supplies tab, frame, origin, id, state, and expiry. With no usable
 * origin no target is made and the panel reports "not found".
 */
function keepTarget(
  deps: CaptureDeps,
  tabId: number,
  frameId: number,
  origin: string | undefined,
  result: CaptureResult['payload'],
  captureId: string,
): PanelField {
  if (result.fieldStatus === 'ambiguous') return { status: 'ambiguous' };
  if (result.field === null || origin === undefined) return { status: 'not-found' };
  const tracked = createTarget(
    {
      // The target id is the capture id, so Insert can prove that the draft on
      // screen belongs to the field that was captured with it.
      id: captureId,
      tabId,
      frameId,
      pageOrigin: origin,
      candidate: result.field,
    },
    deps.clock,
  );
  deps.targets.set(tabId, tracked);
  const label = tracked.target.labelText;
  return label === '' ? { status: 'found' } : { status: 'found', label };
}

/** Returns the validated reply from the clicked frame, or undefined on any failure. */
async function askContentScript(
  deps: CaptureDeps,
  tabId: number,
  frameId: number,
  requestId: string,
): Promise<{ question: string; result: CaptureResult['payload'] } | undefined> {
  try {
    await deps.executeScript({
      target: { tabId, frameIds: [frameId] },
      files: [deps.contentScriptFile],
    });
    const request: CaptureRequest = { v: 1, requestId, type: 'capture.request', payload: {} };
    const reply = await deps.sendTabMessage(tabId, request, { frameId });
    // Never trust the page-side reply beyond validation.
    const parsed = CaptureResultSchema.safeParse(reply);
    if (!parsed.success || parsed.data.requestId !== requestId) return undefined;
    const check = validateSelection(parsed.data.payload.question);
    return check.ok ? { question: check.question, result: parsed.data.payload } : undefined;
  } catch {
    return undefined;
  }
}
