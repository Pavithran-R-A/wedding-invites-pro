// The host's own words, in the four slots the snapshot freezes.
//
// These are not styling and not content management: `private.build_invitation_snapshot`
// reads exactly `welcome`, `family_introduction`, `event_notes` and `closing` out of
// `invitation_drafts.content`, and those four keys are the whole of what a guest reads as
// prose. Keeping the editor to those four is what stops the draft from becoming the
// `selected_features` bag Stage 2 refused to carry forward — a jsonb column that could
// hold anything, and therefore meant nothing.
//
// Each field is a plain `<textarea>`: a line break the host typed is a line break the
// renderer honours (`white-space: pre-line`), and nothing between the two turns their
// words into markup.

import { useId } from 'react';
import { Label } from '@/components/ui/label';
import type { InvitationDraftContent } from '@/integrations/supabase/weddings';

interface Slot {
  key: keyof InvitationDraftContent;
  label: string;
  hint: string;
  rows: number;
}

const SLOTS: Slot[] = [
  {
    key: 'welcome',
    label: 'The opening',
    hint: 'First thing a guest reads. Names, a greeting, a blessing — as you would write it.',
    rows: 4,
  },
  {
    key: 'familyIntroduction',
    label: 'Who is inviting',
    hint: 'The families and elders whose names appear with the invitation.',
    rows: 4,
  },
  {
    key: 'eventNotes',
    label: 'A note about the ceremonies',
    hint: 'Anything guests should know about the gatherings — dress, timings, whom to greet.',
    rows: 3,
  },
  {
    key: 'closing',
    label: 'The last words',
    hint: 'How the invitation ends.',
    rows: 3,
  },
];

export interface DraftTextEditorProps {
  value: InvitationDraftContent;
  onChange: (value: InvitationDraftContent) => void;
  disabled?: boolean;
}

const DraftTextEditor = ({ value, onChange, disabled }: DraftTextEditorProps) => {
  const idPrefix = useId();

  return (
    <div className="space-y-4">
      {SLOTS.map(slot => {
        const inputId = `${idPrefix}-${slot.key}`;
        const hintId = `${inputId}-hint`;
        // An empty slot saves as `null`, not as an empty string, so "the host wrote
        // nothing here" and "the host wrote a blank line" stay different facts downstream.
        const read = (raw: string) => ({ ...value, [slot.key]: raw === '' ? null : raw });
        return (
          <div key={slot.key} className="space-y-1">
            <Label htmlFor={inputId}>{slot.label}</Label>
            <p id={hintId} className="text-[11px] leading-snug text-muted-foreground">
              {slot.hint}
            </p>
            <textarea
              id={inputId}
              aria-describedby={hintId}
              rows={slot.rows}
              disabled={disabled}
              value={value[slot.key] ?? ''}
              onChange={e => onChange(read(e.target.value))}
              className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
        );
      })}
    </div>
  );
};

export default DraftTextEditor;
