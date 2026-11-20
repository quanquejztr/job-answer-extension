export const DRAFT_MENU_ID = 'draft-answer';

/** The single context-menu item, shown only when text is selected. */
export const DRAFT_MENU_ITEM = {
  id: DRAFT_MENU_ID,
  title: 'Draft answer',
  contexts: ['selection'] as ['selection'],
};

export interface MenuApi {
  create(item: typeof DRAFT_MENU_ITEM, callback: () => void): unknown;
  /** Reads and clears `runtime.lastError` so a duplicate id is not an unchecked error. */
  clearLastError(): void;
}

/** Call from `runtime.onInstalled` (MV3: menus must be created there, not at worker start). */
export function registerDraftMenu(api: MenuApi): void {
  api.create(DRAFT_MENU_ITEM, () => api.clearLastError());
}
