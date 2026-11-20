import { DRAFT_MENU_ITEM, registerDraftMenu } from './menu';

describe('registerDraftMenu', () => {
  it('creates exactly one Draft answer item for selections and clears lastError', () => {
    const created: unknown[] = [];
    let cleared = 0;
    registerDraftMenu({
      create: (item, callback) => {
        created.push(item);
        callback();
      },
      clearLastError: () => (cleared += 1),
    });
    expect(created).toEqual([DRAFT_MENU_ITEM]);
    expect(DRAFT_MENU_ITEM.title).toBe('Draft answer');
    expect(DRAFT_MENU_ITEM.contexts).toEqual(['selection']);
    expect(cleared).toBe(1);
  });
});
