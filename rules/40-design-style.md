# Design and Writing Style Rules

The interface is a focused writing workspace inside a narrow Chrome side panel. It should feel calm, direct, and trustworthy.

## Visual system

- Use the operating-system UI font stack.
- Use a four-pixel spacing scale.
- Use an eight-pixel default corner radius; use smaller radii only for compact controls.
- Use a neutral surface palette with one accessible blue accent.
- Define semantic Tailwind tokens for background, surface, text, muted text, border, accent, success, warning, and danger.
- Meet WCAG AA contrast for text and interactive states.
- Use one primary action per state.
- Prefer whitespace, dividers, and typographic hierarchy over nested cards.
- Keep motion brief and functional; respect reduced-motion preferences.

## Components

- Use Radix primitives for behaviors such as dialogs, tooltips, and confirmations when native elements are insufficient.
- Keep controls keyboard accessible with visible focus.
- Every input has a programmatic label and helpful error association.
- Loading indicators include meaningful text.
- Warnings remain visible until resolved or acknowledged.
- Destructive actions such as deleting profile data require clear confirmation.
- Insertion and clipboard actions provide immediate, non-ambiguous feedback.

## Side-panel hierarchy

The normal order is:

1. Captured question.
2. Job-context status or editor.
3. Draft editor.
4. Evidence/warnings summary when relevant.
5. Secondary refinement actions.
6. Primary **Insert answer** action.

Do not place Insert before the draft editor or style it as an automatic next step.

## Copy style

- Use short, literal labels: “Draft answer,” “Insert answer,” “Choose field,” “Copy answer.”
- Explain what happened and what the user can do next.
- Avoid marketing language, anthropomorphism, and claims of perfect accuracy.
- Never say an answer is “undetectable,” “guaranteed,” or “safe to submit.”
- Distinguish generated, edited, inserted, and copied states.
- Error copy states the problem without exposing internals, followed by one actionable next step.

## Avoid

- Decorative gradients, glass effects, excessive shadows, or animated backgrounds.
- Generic sparkle/robot/brain AI imagery.
- Dense dashboards, unnecessary metrics, or gamification.
- Multiple competing primary buttons.
- Toast-only critical errors.
- Color as the only signal.
- Confirm-shaming or pressure to accept an unreviewed draft.
