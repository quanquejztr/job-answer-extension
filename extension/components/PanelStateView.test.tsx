import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { PanelStateView as View, type PanelActions } from './PanelStateView';
import { ERROR_CATALOG } from '../schemas/error';
import type { PanelField, PanelState } from '../schemas/internal-message';

function actionsFake() {
  return {
    generate: vi.fn<PanelActions['generate']>(),
    insert: vi.fn<PanelActions['insert']>(),
    cancel: vi.fn<PanelActions['cancel']>(),
  };
}

/** The view with fake actions unless a test passes its own. */
function PanelStateView({ state, actions }: { state: PanelState; actions?: PanelActions }) {
  return <View state={state} actions={actions ?? actionsFake()} />;
}

const captured = (
  question: string,
  source: 'content-script' | 'menu-selection' = 'content-script',
  field: PanelField = { status: 'not-found' },
) => ({ kind: 'captured', question, source, captureId: 'c1', field }) as const;

describe('PanelStateView', () => {
  it('Empty shows the guidance text in a polite status region', () => {
    render(<PanelStateView state={{ kind: 'empty' }} />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Select a question on the page, then choose Draft answer.',
    );
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('Unsupported domain explains and offers no actions', () => {
    render(<PanelStateView state={{ kind: 'unsupported-domain' }} />);
    expect(screen.getByRole('status')).toHaveTextContent('This site is not supported.');
    expect(screen.getByRole('status')).toHaveTextContent('LinkedIn, Indeed');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
  });

  it('Captured shows a labeled editable Question textarea, note, and source', () => {
    render(<PanelStateView state={captured('Why do you want to work at Acme?')} />);
    const box = screen.getByRole('textbox', { name: 'Question' });
    expect(box.tagName).toBe('TEXTAREA');
    expect(box).toHaveValue('Why do you want to work at Acme?');
    expect(screen.getByText('Captured from the page.')).toBeInTheDocument();
    expect(screen.getByText(/read from the page/)).toBeInTheDocument();
    expect(box).toHaveAccessibleDescription(/Captured from the page\./);
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Generate draft']);
  });

  it.each([
    [{ status: 'found', label: 'Why Acme?' }, 'Answer field: found (Why Acme?)'],
    [{ status: 'found' }, 'Answer field: found'],
    [{ status: 'not-found' }, 'Answer field: not found'],
    [{ status: 'ambiguous' }, 'Answer field: several fields match'],
  ] as const)('Captured shows the field status %j as plain text', (field, line) => {
    render(
      <PanelStateView
        state={captured('Why do you want to work at Acme?', 'content-script', field)}
      />,
    );
    expect(screen.getByText(line)).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('renders a hostile field label as text, never as markup', () => {
    const label = '<img src=x onerror="window.__pwned=1"><b>Essay</b>';
    const { container } = render(
      <PanelStateView
        state={captured('Why do you want to work at Acme?', 'content-script', {
          status: 'found',
          label,
        })}
      />,
    );
    expect(screen.getByText(`Answer field: found (${label})`)).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
  });

  it('Captured names the menu-selection source', () => {
    render(
      <PanelStateView state={captured('Why do you want to work at Acme?', 'menu-selection')} />,
    );
    expect(screen.getByText(/context menu/)).toBeInTheDocument();
  });

  it('editing the question is local, keyboard operable, and keeps the edit on rerender', async () => {
    const user = userEvent.setup();
    const state = captured('Why do you want to work at Acme?');
    const { rerender } = render(<PanelStateView state={state} />);
    await user.tab();
    const box = screen.getByRole('textbox', { name: 'Question' });
    expect(box).toHaveFocus();
    await user.type(box, ' Be specific.');
    expect(box).toHaveValue('Why do you want to work at Acme? Be specific.');
    rerender(<PanelStateView state={state} />);
    expect(screen.getByRole('textbox', { name: 'Question' })).toHaveValue(
      'Why do you want to work at Acme? Be specific.',
    );
  });

  it('a new capture (new captureId) resets the edit', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <PanelStateView state={captured('Why do you want to work at Acme?')} />,
    );
    await user.type(screen.getByRole('textbox', { name: 'Question' }), 'xyz');
    rerender(
      <PanelStateView
        state={{ ...captured('Why do you want to work at Acme?'), captureId: 'c2' }}
      />,
    );
    expect(screen.getByRole('textbox', { name: 'Question' })).toHaveValue(
      'Why do you want to work at Acme?',
    );
  });

  it('renders an HTML-like question as text, never as markup', () => {
    const html = '<img src=x onerror="window.__pwned=1"><b>Why</b> do you want this job?';
    const { container } = render(<PanelStateView state={captured(html)} />);
    expect(screen.getByRole('textbox', { name: 'Question' })).toHaveValue(html);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
  });

  it.each([['QUESTION_MISSING'], ['INVALID_REQUEST']] as const)(
    'Error %s shows the catalog message and next step in role=alert',
    (code) => {
      render(<PanelStateView state={{ kind: 'error', code }} />);
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent(ERROR_CATALOG[code].message);
      expect(alert).toHaveTextContent(`Next step: ${ERROR_CATALOG[code].userAction}`);
      expect(screen.queryAllByRole('button')).toHaveLength(0);
    },
  );

  it('Error without a userAction omits the next step', () => {
    render(<PanelStateView state={{ kind: 'error', code: 'PROVIDER_CANCELLED' }} />);
    expect(screen.getByRole('alert')).not.toHaveTextContent('Next step');
  });
});

type Generated = Extract<PanelState, { kind: 'generated' }>;
const generatedState = (over: Partial<Generated> = {}): Generated =>
  ({
    kind: 'generated',
    question: 'Why do you want to work at Acme?',
    source: 'content-script',
    captureId: 'c1',
    field: { status: 'found', label: 'Why Acme?' },
    answer: 'First line.\nSecond line.',
    usedFactCount: 2,
    warnings: [],
    draftId: 1,
    maxWords: 150,
    ...over,
  }) satisfies Generated;

describe('PanelStateView drafting states', () => {
  it('Generate draft sends the edited question with the capture id, by mouse or keyboard', async () => {
    const user = userEvent.setup();
    const actions = actionsFake();
    render(
      <PanelStateView state={captured('Why do you want to work at Acme?')} actions={actions} />,
    );
    await user.type(screen.getByRole('textbox', { name: 'Question' }), ' Be brief.');
    await user.click(screen.getByRole('button', { name: 'Generate draft' }));
    expect(actions.generate).toHaveBeenLastCalledWith(
      'c1',
      'Why do you want to work at Acme? Be brief.',
    );
    screen.getByRole('button', { name: 'Generate draft' }).focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(actions.generate).toHaveBeenCalledTimes(3);
    expect(actions.cancel).not.toHaveBeenCalled();
  });

  it('disables Generate draft and explains why when the question is too short', async () => {
    const user = userEvent.setup();
    const actions = actionsFake();
    render(
      <PanelStateView state={captured('Why do you want to work at Acme?')} actions={actions} />,
    );
    const box = screen.getByRole('textbox', { name: 'Question' });
    await user.clear(box);
    await user.type(box, '   short   ');
    const button = screen.getByRole('button', { name: 'Generate draft' });
    expect(button).toBeDisabled();
    expect(screen.getByText(/Enter at least 10 characters/)).toBeInTheDocument();
    await user.click(button);
    expect(actions.generate).not.toHaveBeenCalled();
  });

  it('Generating shows meaningful text, locks the question, and offers Cancel only', async () => {
    const user = userEvent.setup();
    const actions = actionsFake();
    render(
      <PanelStateView
        state={{ ...captured('Why do you want to work at Acme?'), kind: 'generating' }}
        actions={actions}
      />,
    );
    expect(screen.getByText(/Generating a draft/)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Question' })).toHaveAttribute('readonly');
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Cancel']);
    await user.tab();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(actions.cancel).toHaveBeenCalledTimes(1);
    expect(actions.generate).not.toHaveBeenCalled();
  });

  it('keeps the edited question across captured -> generating -> captured with an error', async () => {
    const user = userEvent.setup();
    const base = captured('Why do you want to work at Acme?');
    const { rerender } = render(<PanelStateView state={base} />);
    const box = screen.getByRole('textbox', { name: 'Question' });
    await user.type(box, ' Edited.');
    const edited = 'Why do you want to work at Acme? Edited.';
    rerender(<PanelStateView state={{ ...base, question: edited, kind: 'generating' }} />);
    expect(screen.getByRole('textbox', { name: 'Question' })).toHaveValue(edited);
    rerender(<PanelStateView state={{ ...base, question: edited, error: 'PROVIDER_TIMEOUT' }} />);
    expect(screen.getByRole('textbox', { name: 'Question' })).toHaveValue(edited);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(ERROR_CATALOG.PROVIDER_TIMEOUT.message);
    expect(alert).toHaveTextContent('Next step: Retry');
    expect(screen.getByRole('button', { name: 'Generate draft' })).toBeEnabled();
  });

  it('a captured state with a draft error shows HELPER_UNAVAILABLE guidance in role=alert', () => {
    render(
      <PanelStateView
        state={{ ...captured('Why do you want to work at Acme?'), error: 'HELPER_UNAVAILABLE' }}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('The native helper is unavailable.');
    expect(screen.getByRole('alert')).toHaveTextContent('Run the installer, then retry');
  });

  it('Generated shows an editable labeled Draft answer with fact count and a count against the limit', () => {
    render(<PanelStateView state={generatedState()} />);
    const draft = screen.getByRole('textbox', { name: 'Draft answer' });
    expect(draft.tagName).toBe('TEXTAREA');
    expect(draft).toHaveValue('First line.\nSecond line.');
    expect(draft).not.toHaveAttribute('readonly');
    expect(screen.getByText(/4 of 150 words/)).toBeInTheDocument();
    expect(screen.getByText(/Generated draft\. Facts used: 2/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing has been inserted/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate again' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Insert answer' })).toBeEnabled();
  });

  it('Generated renders warnings as text with severity words', () => {
    render(
      <PanelStateView
        state={generatedState({
          warnings: [
            { code: 'LOW_FACT_SUPPORT', severity: 'warn', message: 'Few facts matched.' },
            { code: 'MODEL_NOTE', severity: 'info', message: 'A note.' },
          ],
        })}
      />,
    );
    expect(screen.getByText('Warning: Few facts matched.')).toBeInTheDocument();
    expect(screen.getByText('Note: A note.')).toBeInTheDocument();
  });

  it('renders an HTML-like answer and warning as text, never as markup', () => {
    const html = '<img src=x onerror="window.__pwned=1"><b>Hi</b>';
    const { container } = render(
      <PanelStateView
        state={generatedState({
          answer: html,
          warnings: [{ code: 'MODEL_NOTE', severity: 'info', message: html }],
        })}
      />,
    );
    expect(screen.getByRole('textbox', { name: 'Draft answer' })).toHaveValue(html);
    expect(screen.getByText(`Note: ${html}`)).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
  });

  it('Generate again sends the current question text', async () => {
    const user = userEvent.setup();
    const actions = actionsFake();
    render(<PanelStateView state={generatedState()} actions={actions} />);
    await user.click(screen.getByRole('button', { name: 'Generate again' }));
    expect(actions.generate).toHaveBeenCalledWith('c1', 'Why do you want to work at Acme?');
  });
});

describe('PanelStateView review and insert', () => {
  const user = () => userEvent.setup();

  it('places Insert answer after the question, draft editor, evidence, and warnings', () => {
    render(
      <PanelStateView
        state={generatedState({
          warnings: [{ code: 'MODEL_NOTE', severity: 'info', message: 'A note.' }],
        })}
      />,
    );
    const follows = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const insert = screen.getByRole('button', { name: 'Insert answer' });
    expect(follows(screen.getByRole('textbox', { name: 'Question' }), insert)).toBe(true);
    expect(follows(screen.getByRole('textbox', { name: 'Draft answer' }), insert)).toBe(true);
    expect(follows(screen.getByText(/Facts used: 2/), insert)).toBe(true);
    expect(follows(screen.getByText('Note: A note.'), insert)).toBe(true);
    expect(follows(screen.getByRole('button', { name: 'Generate again' }), insert)).toBe(true);
    // The last button in the panel is the one primary action.
    expect(screen.getAllByRole('button').at(-1)).toBe(insert);
  });

  it('Insert is not clicked or sent by generation, rendering, or typing', async () => {
    const actions = actionsFake();
    render(<PanelStateView state={generatedState()} actions={actions} />);
    await user().type(screen.getByRole('textbox', { name: 'Draft answer' }), ' more');
    expect(actions.insert).not.toHaveBeenCalled();
  });

  it('Insert answer sends the edited draft with the capture id, by mouse and keyboard', async () => {
    const u = user();
    const actions = actionsFake();
    render(<PanelStateView state={generatedState()} actions={actions} />);
    const draft = screen.getByRole('textbox', { name: 'Draft answer' });
    await u.clear(draft);
    await u.type(draft, 'My own words.');
    await u.click(screen.getByRole('button', { name: 'Insert answer' }));
    expect(actions.insert).toHaveBeenLastCalledWith('c1', 'My own words.');
    screen.getByRole('button', { name: 'Insert answer' }).focus();
    await u.keyboard('{Enter}');
    await u.keyboard(' ');
    expect(actions.insert).toHaveBeenCalledTimes(3);
    expect(actions.generate).not.toHaveBeenCalled();
  });

  it('Enter in the draft textarea adds a line break and inserts nothing', async () => {
    const u = user();
    const actions = actionsFake();
    render(<PanelStateView state={generatedState({ answer: 'One' })} actions={actions} />);
    const draft = screen.getByRole('textbox', { name: 'Draft answer' });
    await u.click(draft);
    await u.keyboard('{Enter}Two');
    expect(draft).toHaveValue('One\nTwo');
    expect(actions.insert).not.toHaveBeenCalled();
    expect(document.querySelector('form')).toBeNull();
  });

  it('edits survive re-renders and are labeled Edited by you (UX-002)', async () => {
    const u = user();
    const state = generatedState();
    const { rerender } = render(<PanelStateView state={state} />);
    expect(screen.getByText(/Generated draft\./)).toBeInTheDocument();
    await u.type(screen.getByRole('textbox', { name: 'Draft answer' }), ' Added.');
    expect(screen.getByText(/Edited by you\./)).toBeInTheDocument();
    expect(screen.queryByText(/Generated draft\./)).not.toBeInTheDocument();
    rerender(<PanelStateView state={{ ...state }} />);
    expect(screen.getByRole('textbox', { name: 'Draft answer' })).toHaveValue(
      'First line.\nSecond line. Added.',
    );
    await u.clear(screen.getByRole('textbox', { name: 'Draft answer' }));
    await u.type(screen.getByRole('textbox', { name: 'Draft answer' }), state.answer);
    expect(screen.getByText(/Generated draft\./)).toBeInTheDocument();
  });

  it('shows the word count against the limit and a character count when the field has a limit', async () => {
    const u = user();
    render(
      <PanelStateView state={generatedState({ answer: 'one two', maxWords: 20, maxChars: 40 })} />,
    );
    expect(screen.getByText('2 of 20 words (7 of 40 characters)')).toBeInTheDocument();
    await u.type(screen.getByRole('textbox', { name: 'Draft answer' }), ' three');
    expect(screen.getByText('3 of 20 words (13 of 40 characters)')).toBeInTheDocument();
  });

  it('disables Insert with a visible reason when the draft is empty or whitespace', async () => {
    const u = user();
    const actions = actionsFake();
    render(<PanelStateView state={generatedState()} actions={actions} />);
    await u.clear(screen.getByRole('textbox', { name: 'Draft answer' }));
    await u.type(screen.getByRole('textbox', { name: 'Draft answer' }), '   ');
    const insert = screen.getByRole('button', { name: 'Insert answer' });
    expect(insert).toBeDisabled();
    expect(screen.getByText(/Insert needs a draft answer/)).toBeInTheDocument();
    expect(insert).toHaveAccessibleDescription(/Insert needs a draft answer/);
    await u.click(insert);
    expect(actions.insert).not.toHaveBeenCalled();
  });

  it('disables Insert over the word limit and enables it again when shortened', async () => {
    const u = user();
    render(<PanelStateView state={generatedState({ answer: 'a b c', maxWords: 20 })} />);
    const draft = screen.getByRole('textbox', { name: 'Draft answer' });
    await u.clear(draft);
    await u.click(draft);
    await u.paste(Array.from({ length: 21 }, () => 'w').join(' '));
    expect(screen.getByRole('button', { name: 'Insert answer' })).toBeDisabled();
    expect(screen.getByText(/21 of 20 words/)).toBeInTheDocument();
    expect(screen.getByText(/Insert needs a draft of 20 words or fewer/)).toBeInTheDocument();
    await u.clear(draft);
    await u.paste('short again');
    expect(screen.getByRole('button', { name: 'Insert answer' })).toBeEnabled();
  });

  it("disables Insert over the field's character limit", async () => {
    const u = user();
    render(<PanelStateView state={generatedState({ answer: 'short', maxChars: 10 })} />);
    expect(screen.getByRole('button', { name: 'Insert answer' })).toBeEnabled();
    await u.type(screen.getByRole('textbox', { name: 'Draft answer' }), ' and then some');
    expect(screen.getByRole('button', { name: 'Insert answer' })).toBeDisabled();
    expect(screen.getByText(/within the field's 10 character limit/)).toBeInTheDocument();
  });

  it.each([[{ status: 'ambiguous' }], [{ status: 'not-found' }]] as const)(
    'disables Insert with the field hint when the field is %j',
    async (field) => {
      const actions = actionsFake();
      render(<PanelStateView state={generatedState({ field })} actions={actions} />);
      const insert = screen.getByRole('button', { name: 'Insert answer' });
      expect(insert).toBeDisabled();
      expect(
        screen.getByText('Insert needs exactly one detected answer field.'),
      ).toBeInTheDocument();
      await userEvent.setup().click(insert);
      expect(actions.insert).not.toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: /choose field/i })).not.toBeInTheDocument();
    },
  );

  it('Inserting locks the draft, disables Insert and Generate again, and says what is happening', () => {
    render(
      <PanelStateView
        state={{ ...generatedState({ editedAnswer: 'My edit.' }), kind: 'inserting' }}
      />,
    );
    expect(screen.getByRole('textbox', { name: 'Draft answer' })).toHaveValue('My edit.');
    expect(screen.getByRole('textbox', { name: 'Draft answer' })).toHaveAttribute('readonly');
    expect(screen.getByRole('textbox', { name: 'Question' })).toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: 'Insert answer' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Generate again' })).toBeDisabled();
    expect(screen.getByText(/Inserting into the answer field/)).toBeInTheDocument();
  });

  it('Inserted names the field as text, says nothing was submitted, and offers no actions', () => {
    const { container } = render(
      <PanelStateView
        state={{
          kind: 'inserted',
          question: 'Why do you want to work at Acme?',
          source: 'content-script',
          captureId: 'c1',
          field: { status: 'found', label: '<img src=x onerror="window.__pwned=1"><b>Why?</b>' },
        }}
      />,
    );
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(
      'Inserted into: <img src=x onerror="window.__pwned=1"><b>Why?</b>',
    );
    expect(status).toHaveTextContent(
      'Select the question on the page again to insert another answer',
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
  });

  it('Inserted without a label still says where', () => {
    render(
      <PanelStateView
        state={{
          kind: 'inserted',
          question: 'Why do you want to work at Acme?',
          source: 'content-script',
          captureId: 'c1',
          field: { status: 'found' },
        }}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Inserted into: the answer field');
  });

  it.each(['FIELD_STALE', 'FIELD_NONEMPTY', 'FIELD_UNSUPPORTED'] as const)(
    'Insert failure %s shows the catalog alert, keeps the edited draft and question, and disables Insert',
    async (code) => {
      const actions = actionsFake();
      render(
        <PanelStateView
          state={generatedState({ editedAnswer: 'My edited draft.', insertError: code })}
          actions={actions}
        />,
      );
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent(ERROR_CATALOG[code].message);
      expect(alert).toHaveTextContent(`Next step: ${ERROR_CATALOG[code].userAction}`);
      expect(screen.getByRole('textbox', { name: 'Draft answer' })).toHaveValue('My edited draft.');
      expect(screen.getByRole('textbox', { name: 'Question' })).toHaveValue(
        'Why do you want to work at Acme?',
      );
      expect(screen.getByText(/Edited by you\./)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Insert answer' })).toBeDisabled();
      expect(
        screen.getByText(/Select the question on the page again to insert/),
      ).toBeInTheDocument();
      await userEvent.setup().click(screen.getByRole('button', { name: 'Insert answer' }));
      expect(actions.insert).not.toHaveBeenCalled();
    },
  );

  it('keeps a typed edit across generated -> inserting -> generated with a failure', async () => {
    const u = user();
    const state = generatedState();
    const { rerender } = render(<PanelStateView state={state} />);
    await u.type(screen.getByRole('textbox', { name: 'Draft answer' }), ' Mine.');
    const edited = 'First line.\nSecond line. Mine.';
    rerender(<PanelStateView state={{ ...state, kind: 'inserting', editedAnswer: edited }} />);
    rerender(
      <PanelStateView state={{ ...state, editedAnswer: edited, insertError: 'FIELD_STALE' }} />,
    );
    expect(screen.getByRole('textbox', { name: 'Draft answer' })).toHaveValue(edited);
  });

  it('a regenerated draft replaces the previous edits (generating unmounts the editor)', async () => {
    const u = user();
    const state = generatedState();
    const { rerender } = render(<PanelStateView state={state} />);
    await u.type(screen.getByRole('textbox', { name: 'Draft answer' }), ' Old edit.');
    rerender(<PanelStateView state={{ ...state, kind: 'generating' }} />);
    expect(screen.queryByRole('textbox', { name: 'Draft answer' })).not.toBeInTheDocument();
    rerender(<PanelStateView state={{ ...state, answer: 'Brand new draft.' }} />);
    expect(screen.getByRole('textbox', { name: 'Draft answer' })).toHaveValue('Brand new draft.');
  });

  it('a new draftId replaces the edits even if the generating state was never rendered', async () => {
    const u = user();
    const state = generatedState();
    const { rerender } = render(<PanelStateView state={state} />);
    await u.type(screen.getByRole('textbox', { name: 'Draft answer' }), ' Old edit.');
    rerender(<PanelStateView state={{ ...state, draftId: 2, answer: 'Second generation.' }} />);
    expect(screen.getByRole('textbox', { name: 'Draft answer' })).toHaveValue('Second generation.');
  });

  it('renders an HTML-like draft as text only', () => {
    const html = '<script>window.__pwned=1</script><b>Bold</b>';
    const { container } = render(<PanelStateView state={generatedState({ answer: html })} />);
    expect(screen.getByRole('textbox', { name: 'Draft answer' })).toHaveValue(html);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
  });

  it('every control is keyboard reachable in reading order, ending at Insert answer', async () => {
    const u = user();
    render(<PanelStateView state={generatedState()} />);
    await u.tab();
    expect(screen.getByRole('textbox', { name: 'Question' })).toHaveFocus();
    await u.tab();
    expect(screen.getByRole('textbox', { name: 'Draft answer' })).toHaveFocus();
    await u.tab();
    expect(screen.getByRole('button', { name: 'Generate again' })).toHaveFocus();
    await u.tab();
    expect(screen.getByRole('button', { name: 'Insert answer' })).toHaveFocus();
  });
});
