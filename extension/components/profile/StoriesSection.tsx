import { useState } from 'react';
import { MAX_STORIES, MAX_STORY_CHARS, MAX_TITLE_CHARS } from '../../lib/constants/limits';
import type { ProfileActions } from '../../lib/profile/use-profile';
import { countChars, hasErrors, validateStory } from '../../lib/profile/validation';
import type { Story } from '../../schemas/profile';
import { TextField } from './Controls';
import { ItemForm, useItemSubmit, useValidationFocus } from './ItemForm';
import { ItemSection, preview } from './ItemSection';

function StoryForm({
  item,
  actions,
  onDone,
  onCancel,
}: {
  item: Story | null;
  actions: ProfileActions;
  onDone(): void;
  onCancel(): void;
}) {
  const [title, setTitle] = useState(item?.title ?? '');
  const [text, setText] = useState(item?.text ?? '');
  const { formRef, attempted, reportInvalid } = useValidationFocus();
  const errors = attempted ? validateStory({ title, text }) : {};
  const submit = useItemSubmit({
    validate: () => {
      if (!hasErrors(validateStory({ title, text }))) return true;
      reportInvalid();
      return false;
    },
    sensitiveTexts: () => [title, text],
    build: () => ({
      kind: 'story',
      item: {
        ...(item === null ? {} : { id: item.id }),
        title: title.trim(),
        text: text.trim(),
      },
    }),
    save: actions.save,
    onSaved: onDone,
  });
  return (
    <ItemForm
      title={item === null ? 'Add a story' : 'Edit story'}
      noun="story"
      saveLabel="Save story"
      submitState={submit}
      onCancel={onCancel}
      formRef={formRef}
    >
      <TextField
        label="Title"
        value={title}
        onChange={setTitle}
        error={errors.title}
        counter={{ count: countChars(title), max: MAX_TITLE_CHARS }}
      />
      <TextField
        label="Story"
        multiline
        rows={8}
        value={text}
        onChange={setText}
        error={errors.text}
        hint="A project or work story in your own words."
        counter={{ count: countChars(text), max: MAX_STORY_CHARS }}
      />
    </ItemForm>
  );
}

export function StoriesSection({
  stories,
  actions,
}: {
  stories: readonly Story[];
  actions: ProfileActions;
}) {
  return (
    <ItemSection
      title="Stories"
      singular="story"
      description="Project and work stories. Every draft sends all of them, in full, to the provider you choose."
      items={stories}
      max={MAX_STORIES}
      addLabel="Add story"
      emptyText="No stories yet."
      labelOf={(s) => s.title}
      usage={(n, max) => `${n} of ${max} stories saved.`}
      limitMessage={`You have reached the limit of ${MAX_STORIES} stories. Delete one to add another.`}
      deleteTitle="Delete this story?"
      onDelete={(s) => actions.remove({ kind: 'story', id: s.id })}
      renderItem={(s) => (
        <>
          <p className="font-medium">{s.title}</p>
          <p className="mt-1">{preview(s.text, 240)}</p>
        </>
      )}
      renderForm={({ item, onDone, onCancel }) => (
        <StoryForm item={item} actions={actions} onDone={onDone} onCancel={onCancel} />
      )}
    />
  );
}
