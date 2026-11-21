import { useState } from 'react';
import { MAX_RULE_CHARS, MAX_RULES } from '../../lib/constants/limits';
import type { ProfileActions } from '../../lib/profile/use-profile';
import { countChars, hasErrors, validateRule } from '../../lib/profile/validation';
import { RULE_KINDS, type RuleKind, type WritingRule } from '../../schemas/profile';
import { CheckboxField, SelectField, TextField } from './Controls';
import { ItemForm, useItemSubmit, useValidationFocus } from './ItemForm';
import { ItemSection } from './ItemSection';

const KIND_LABEL: Record<RuleKind, string> = {
  length: 'Length',
  tone: 'Tone',
  style: 'Style',
  avoid: 'Avoid',
};

export const LENGTH_NOTE =
  'Length rules are free text here and are not checked against your answers. The numeric word limit for an answer comes from the draft’s own maximum.';

function RuleForm({
  item,
  actions,
  onDone,
  onCancel,
}: {
  item: WritingRule | null;
  actions: ProfileActions;
  onDone(): void;
  onCancel(): void;
}) {
  const [kind, setKind] = useState<RuleKind>(item?.kind ?? 'tone');
  const [text, setText] = useState(item?.text ?? '');
  const [enabled, setEnabled] = useState(item?.enabled ?? true);
  const { formRef, attempted, reportInvalid } = useValidationFocus();
  const errors = attempted ? validateRule({ text }) : {};
  const submit = useItemSubmit({
    validate: () => {
      if (!hasErrors(validateRule({ text }))) return true;
      reportInvalid();
      return false;
    },
    // Rules are instructions about style, not personal facts: no PRIV-008 scan.
    sensitiveTexts: () => [],
    build: () => ({
      kind: 'rule',
      item: { ...(item === null ? {} : { id: item.id }), kind, text: text.trim(), enabled },
    }),
    save: actions.save,
    onSaved: onDone,
  });
  return (
    <ItemForm
      title={item === null ? 'Add a writing rule' : 'Edit writing rule'}
      noun="rule"
      saveLabel="Save rule"
      submitState={submit}
      onCancel={onCancel}
      formRef={formRef}
    >
      <SelectField<RuleKind>
        label="Kind"
        value={kind}
        onChange={setKind}
        options={RULE_KINDS.map((value) => ({ value, label: KIND_LABEL[value] }))}
      />
      <TextField
        label="Rule"
        value={text}
        onChange={setText}
        error={errors.text}
        hint={kind === 'length' ? LENGTH_NOTE : 'One short instruction for how drafts should read.'}
        counter={{ count: countChars(text), max: MAX_RULE_CHARS }}
      />
      <CheckboxField
        label="Rule is enabled"
        role="switch"
        checked={enabled}
        onChange={setEnabled}
      />
    </ItemForm>
  );
}

export function RulesSection({
  rules,
  actions,
}: {
  rules: readonly WritingRule[];
  actions: ProfileActions;
}) {
  return (
    <ItemSection
      title="Writing rules"
      singular="rule"
      description={`Explicit rules for tone, style, length, and what to avoid. Up to ${MAX_RULES} rules. ${LENGTH_NOTE}`}
      items={rules}
      max={MAX_RULES}
      addLabel="Add rule"
      emptyText="No writing rules yet."
      labelOf={(r) => r.text}
      usage={(n, max) => `${n} of ${max} rules saved.`}
      limitMessage={`You have reached the limit of ${MAX_RULES} rules. Delete one to add another.`}
      deleteTitle="Delete this rule?"
      onDelete={(r) => actions.remove({ kind: 'rule', id: r.id })}
      renderItem={(r) => (
        <>
          <p>
            <span className="font-medium">{KIND_LABEL[r.kind]}:</span> {r.text}
          </p>
          <p className="text-muted mt-1">{r.enabled ? 'Enabled' : 'Disabled'}</p>
        </>
      )}
      renderForm={({ item, onDone, onCancel }) => (
        <RuleForm item={item} actions={actions} onDone={onDone} onCancel={onCancel} />
      )}
    />
  );
}
