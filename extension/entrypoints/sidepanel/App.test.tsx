import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { App } from './App';
import type { PanelClient } from '../../lib/messaging/panel-client';
import type { ProfileStatus } from '../../schemas/profile-status-message';
import type { PanelState } from '../../schemas/internal-message';

const EMPTY_TEXT = 'Select a question on the page, then choose Draft answer.';
const EMPTY: PanelState = { kind: 'empty' };

function fakeClient(initial: Record<number, PanelState> = {}, activeTab: number | null = 1) {
  let onState: (tabId: number, state: PanelState) => void = () => undefined;
  let onTab: () => void = () => undefined;
  const state: {
    activeTab: number | null;
    states: Record<number, PanelState>;
    profileStatus: ProfileStatus | undefined;
  } = {
    activeTab,
    states: initial,
    profileStatus: undefined,
  };
  const calls: unknown[][] = [];
  const client: PanelClient = {
    getActiveTabId: () => Promise.resolve(state.activeTab ?? undefined),
    fetchState: (tabId) => Promise.resolve(state.states[tabId] ?? EMPTY),
    onState: (l) => {
      onState = l;
      return () => undefined;
    },
    onActiveTabChange: (l) => {
      onTab = l;
      return () => undefined;
    },
    startDraft: (tabId, captureId, question) => {
      calls.push(['start', tabId, captureId, question]);
      return Promise.resolve();
    },
    cancelDraft: (tabId) => {
      calls.push(['cancel', tabId]);
      return Promise.resolve();
    },
    getProfileStatus: () => Promise.resolve(state.profileStatus),
    startInsert: (tabId, captureId, answer) => {
      calls.push(['insert', tabId, captureId, answer]);
      return Promise.resolve();
    },
    openSettings: () => {
      calls.push(['openSettings']);
      return Promise.resolve();
    },
  };
  return {
    client,
    calls,
    state,
    push: (tabId: number, s: PanelState) => act(() => onState(tabId, s)),
    switchTab: async (tabId: number) => {
      state.activeTab = tabId;
      await act(async () => onTab());
    },
  };
}

type Captured = Extract<PanelState, { kind: 'captured' }>;
const capturedState = (question: string): Captured => ({
  kind: 'captured',
  question,
  source: 'content-script',
  captureId: 'c1',
  field: { status: 'found', label: 'Why Acme?' },
});

describe('side panel shell accessibility smoke', () => {
  it('has a main landmark and exactly one h1', async () => {
    render(<App client={fakeClient().client} />);
    expect(screen.getByRole('main')).toBeInTheDocument();
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent('Job Answer Drafter');
    await screen.findByText(EMPTY_TEXT);
  });

  it('has a polite status region and the empty-state text', async () => {
    render(<App client={fakeClient().client} />);
    const status = await screen.findByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText(EMPTY_TEXT)).toBeInTheDocument();
  });

  it('has no interactive elements without an accessible name', async () => {
    render(
      <App client={fakeClient({ 1: capturedState('Why do you want to work at Acme?') }).client} />,
    );
    await screen.findByRole('textbox');
    const interactive = screen
      .queryAllByRole('button')
      .concat(
        screen.queryAllByRole('link'),
        screen.queryAllByRole('textbox'),
        screen.queryAllByRole('combobox'),
        screen.queryAllByRole('checkbox'),
      );
    expect(interactive.length).toBeGreaterThan(0);
    for (const el of interactive) {
      expect(el).toHaveAccessibleName();
    }
  });

  it('sets a document language in the entry HTML', () => {
    for (const page of ['sidepanel', 'options']) {
      const html = readFileSync(resolve(__dirname, '..', page, 'index.html'), 'utf8');
      const doc = new DOMParser().parseFromString(html, 'text/html');
      expect(doc.documentElement.getAttribute('lang')).toBe('en');
    }
  });
});

describe('side panel state wiring', () => {
  it('pulls state for the active tab on load', async () => {
    render(<App client={fakeClient({ 1: { kind: 'unsupported-domain' } }).client} />);
    expect(await screen.findByText('This site is not supported.')).toBeInTheDocument();
  });

  it('shows pushes for the active tab and ignores pushes for other tabs', async () => {
    const f = fakeClient();
    render(<App client={f.client} />);
    await screen.findByText(EMPTY_TEXT);
    f.push(2, { kind: 'error', code: 'QUESTION_MISSING' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    f.push(1, { kind: 'error', code: 'QUESTION_MISSING' });
    expect(screen.getByRole('alert')).toHaveTextContent('No question was selected.');
  });

  it('shows the state of whichever tab becomes active', async () => {
    const f = fakeClient({
      1: capturedState('Why do you want to work at Acme?'),
      2: { kind: 'unsupported-domain' },
    });
    render(<App client={f.client} />);
    expect(await screen.findByRole('textbox', { name: 'Question' })).toBeInTheDocument();
    await f.switchTab(2);
    await waitFor(() =>
      expect(screen.getByText('This site is not supported.')).toBeInTheDocument(),
    );
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    await f.switchTab(1);
    expect(await screen.findByRole('textbox', { name: 'Question' })).toBeInTheDocument();
  });

  it('falls back to Empty when no tab is active', async () => {
    render(<App client={fakeClient({}, null).client} />);
    expect(await screen.findByText(EMPTY_TEXT)).toBeInTheDocument();
  });
});

describe('side panel draft actions', () => {
  it('Generate draft sends the edited question for the active tab', async () => {
    const user = userEvent.setup();
    const f = fakeClient({ 3: capturedState('Why do you want to work at Acme?') }, 3);
    render(<App client={f.client} />);
    const box = await screen.findByRole('textbox', { name: 'Question' });
    await user.type(box, ' Be brief.');
    await user.click(screen.getByRole('button', { name: 'Generate draft' }));
    expect(f.calls).toEqual([['start', 3, 'c1', 'Why do you want to work at Acme? Be brief.']]);
  });

  it('Cancel asks the worker to cancel the active tab and pushes drive the states', async () => {
    const user = userEvent.setup();
    const f = fakeClient({ 1: capturedState('Why do you want to work at Acme?') });
    render(<App client={f.client} />);
    await screen.findByRole('textbox', { name: 'Question' });
    f.push(1, { ...capturedState('Why do you want to work at Acme?'), kind: 'generating' });
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(f.calls).toEqual([['cancel', 1]]);
    f.push(1, {
      ...capturedState('Why do you want to work at Acme?'),
      kind: 'generated',
      answer: 'Done.',
      evidence: [{ source: 'resume', quote: 'Built a route optimizer in Go' }],
      warnings: [],
      draftId: 1,
      maxWords: 150,
    });
    expect(screen.getByRole('textbox', { name: 'Draft answer' })).toHaveValue('Done.');
    f.push(1, {
      ...capturedState('Why do you want to work at Acme?'),
      error: 'HELPER_UNAVAILABLE',
    });
    expect(screen.getByRole('alert')).toHaveTextContent('The native helper is unavailable.');
  });

  it('Insert answer sends the edited draft with the capture id for the active tab', async () => {
    const user = userEvent.setup();
    const f = fakeClient(
      {
        3: {
          ...capturedState('Why do you want to work at Acme?'),
          kind: 'generated',
          answer: 'Done.',
          evidence: [{ source: 'resume', quote: 'Built a route optimizer in Go' }],
          warnings: [],
          draftId: 1,
          maxWords: 150,
        },
      },
      3,
    );
    render(<App client={f.client} />);
    const box = await screen.findByRole('textbox', { name: 'Draft answer' });
    await user.type(box, ' More.');
    await user.click(screen.getByRole('button', { name: 'Insert answer' }));
    expect(f.calls).toEqual([['insert', 3, 'c1', 'Done. More.']]);
  });

  it('a generated answer for another tab is not shown', async () => {
    const f = fakeClient({ 1: capturedState('Why do you want to work at Acme?') });
    render(<App client={f.client} />);
    await screen.findByRole('textbox', { name: 'Question' });
    f.push(2, {
      ...capturedState('Why do you want to work at Acme?'),
      kind: 'generated',
      answer: 'Secret other-tab answer.',
      evidence: [],
      warnings: [],
      draftId: 1,
      maxWords: 150,
    });
    expect(screen.queryByDisplayValue('Secret other-tab answer.')).not.toBeInTheDocument();
  });
});

describe('side panel profile status', () => {
  const question = 'Why do you want to work at Acme?';
  const HINT = "Add your résumé in the extension's settings before drafting.";
  const READY: ProfileStatus = {
    hasResume: true,
    storyCount: 0,
    provider: 'claude',
    disclosureAccepted: true,
  };

  it('shows the hint and disables Generate draft when the worker reports no résumé', async () => {
    const f = fakeClient({ 1: capturedState(question) });
    f.state.profileStatus = { ...READY, hasResume: false };
    render(<App client={f.client} />);
    expect(await screen.findByText(HINT)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate draft' })).toBeDisabled();
  });

  it('keeps Generate enabled when the status is unavailable or everything is set', async () => {
    for (const n of [undefined, { ...READY, storyCount: 2 }]) {
      const f = fakeClient({ 1: capturedState(question) });
      f.state.profileStatus = n;
      const { unmount } = render(<App client={f.client} />);
      await screen.findByRole('textbox', { name: 'Question' });
      expect(screen.getByRole('button', { name: 'Generate draft' })).toBeEnabled();
      expect(screen.queryByText(HINT)).not.toBeInTheDocument();
      unmount();
    }
  });

  it('asks again when the panel regains focus, so a résumé saved in settings is noticed', async () => {
    const f = fakeClient({ 1: capturedState(question) });
    f.state.profileStatus = { ...READY, hasResume: false };
    render(<App client={f.client} />);
    expect(await screen.findByText(HINT)).toBeInTheDocument();
    f.state.profileStatus = READY;
    window.dispatchEvent(new Event('focus'));
    await waitFor(() => expect(screen.queryByText(HINT)).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Generate draft' })).toBeEnabled();
  });

  it('blocks drafting until a provider is chosen and the disclosure accepted, with a settings link', async () => {
    const user = userEvent.setup();
    const f = fakeClient({ 1: capturedState(question) });
    f.state.profileStatus = { hasResume: true, storyCount: 0, disclosureAccepted: false };
    render(<App client={f.client} />);
    expect(
      await screen.findByText('Choose Claude Code or Codex in settings before drafting.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate draft' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Open settings' }));
    expect(f.calls).toContainEqual(['openSettings']);

    f.state.profileStatus = { ...READY, disclosureAccepted: false };
    window.dispatchEvent(new Event('focus'));
    expect(
      await screen.findByText(
        'Read and accept the first-use disclosure in settings before drafting.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate draft' })).toBeDisabled();

    f.state.profileStatus = READY;
    window.dispatchEvent(new Event('focus'));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Generate draft' })).toBeEnabled(),
    );
    expect(screen.queryByRole('button', { name: 'Open settings' })).not.toBeInTheDocument();
  });

  it('shows the evidence quotes of a generated draft', async () => {
    const f = fakeClient({
      1: {
        ...capturedState(question),
        kind: 'generated',
        answer: 'Done.',
        evidence: [{ source: 'resume', quote: 'Ran the build system for a year' }],
        warnings: [],
        draftId: 1,
        maxWords: 150,
      },
    });
    render(<App client={f.client} />);
    expect(await screen.findByText(/Evidence: 1 quote\./)).toBeInTheDocument();
    expect(screen.getByText('Evidence', { selector: 'summary' })).toBeInTheDocument();
  });
});
