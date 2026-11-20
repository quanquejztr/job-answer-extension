import { createCaptureListener } from '../lib/capture/content-capture';
import { createInsertListener } from '../lib/insertion/insert-listener';
import { locateField } from '../lib/targeting/find-field';
import { createRevalidateListener } from '../lib/targeting/revalidate-field';

export default defineContentScript({
  // Injected on demand with chrome.scripting.executeScript after a user gesture
  // (activeTab), never registered in the manifest. An empty `matches` in the
  // manifest makes Chrome refuse to load the extension.
  registration: 'runtime',
  matches: [],
  main() {
    // The worker may inject again on each click; register the listener once per
    // frame. Isolated-world globals persist across injections.
    const flag = '__jobAnswerCaptureInstalled';
    if (Reflect.get(globalThis, flag) === true) return;
    Reflect.set(globalThis, flag, true);

    const listener = createCaptureListener({
      runtimeId: browser.runtime.id,
      getSelectionText: () => window.getSelection()?.toString() ?? '',
      findField: () => locateField(window.getSelection(), document),
    });
    const revalidate = createRevalidateListener({ runtimeId: browser.runtime.id, document });
    const insert = createInsertListener({ runtimeId: browser.runtime.id, document });
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
      // Each listener answers only its own message type and stays silent otherwise.
      const reply = listener(message, sender) ?? revalidate(message, sender);
      if (reply !== undefined) {
        sendResponse(reply);
        return false;
      }
      // Insert replies after the verification frame, so keep the channel open.
      return insert(message, sender, sendResponse);
    });
  },
});
