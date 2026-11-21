import { useState } from 'react';
import { MAX_LABEL_CHARS, MAX_SAMPLE_CHARS, MAX_SAMPLES } from '../../lib/constants/limits';
import type { ProfileActions } from '../../lib/profile/use-profile';
import { countChars, hasErrors, validateSample } from '../../lib/profile/validation';
import type { WritingSample } from '../../schemas/profile';
import { TextField } from './Controls';
import { ItemForm, useItemSubmit, useValidationFocus } from './ItemForm';
import { ItemSection, preview } from './ItemSection';

function SampleForm({
  item,
  actions,
  onDone,
  onCancel,
}: {
  item: WritingSample | null;
  actions: ProfileActions;
  onDone(): void;
  onCancel(): void;
}) {
  const [label, setLabel] = useState(item?.label ?? '');
  const [text, setText] = useState(item?.text ?? '');
  const { formRef, attempted, reportInvalid } = useValidationFocus();
  const errors = attempted ? validateSample({ label, text }) : {};
  const submit = useItemSubmit({
    validate: () => {
      if (!hasErrors(validateSample({ label, text }))) return true;
      reportInvalid();
      return false;
    },
    sensitiveTexts: () => [label, text],
    build: () => ({
      kind: 'sample',
      item: { ...(item === null ? {} : { id: item.id }), label: label.trim(), text: text.trim() },
    }),
    save: actions.save,
    onSaved: onDone,
  });
  return (
    <ItemForm
      title={item === null ? 'Add a writing sample' : 'Edit writing sample'}
      noun="writing sample"
      saveLabel="Save writing sample"
      submitState={submit}
      onCancel={onCancel}
      formRef={formRef}
    >
      <TextField
        label="Label"
        value={label}
        onChange={setLabel}
        error={errors.label}
        hint="A short name so you can tell samples apart."
        counter={{ count: countChars(label), max: MAX_LABEL_CHARS }}
      />
      <TextField
        label="Sample text"
        multiline
        rows={10}
        value={text}
        onChange={setText}
        error={errors.text}
        hint="Something you wrote yourself, so drafts can match your voice."
        counter={{ count: countChars(text), max: MAX_SAMPLE_CHARS }}
      />
    </ItemForm>
  );
}

export function SamplesSection({
  samples,
  actions,
}: {
  samples: readonly WritingSample[];
  actions: ProfileActions;
}) {
  return (
    <ItemSection
      title="Writing samples"
      singular="writing sample"
      description={`Up to ${MAX_SAMPLES} samples of your own writing. A draft sends at most two of them to the provider.`}
      items={samples}
      max={MAX_SAMPLES}
      addLabel="Add writing sample"
      emptyText="No writing samples yet."
      labelOf={(s) => s.label}
      usage={(n, max) => `${n} of ${max} writing samples saved. ${max - n} remaining.`}
      limitMessage={`You have reached the limit of ${MAX_SAMPLES} writing samples. Delete one to add another.`}
      deleteTitle="Delete this writing sample?"
      onDelete={(s) => actions.remove({ kind: 'sample', id: s.id })}
      renderItem={(s) => (
        <>
          <p className="font-medium">{s.label}</p>
          <p className="mt-1">{preview(s.text, 240)}</p>
        </>
      )}
      renderForm={({ item, onDone, onCancel }) => (
        <SampleForm item={item} actions={actions} onDone={onDone} onCancel={onCancel} />
      )}
    />
  );
}
