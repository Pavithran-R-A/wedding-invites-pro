// The one authoritative answer to "why can this not be frozen yet?".
//
// §20's requirement is a single list, and the reason it has to be a single list is that the
// page used to have two opinions. Before Stage 5 the preview panel printed what *this browser*
// could not draw; the server's own refusal arrived only when the host pressed the button, so a
// host who saw an empty list could still be refused. These are now different things, printed
// apart and named apart:
//
//   * This panel prints `issues`, the records `api.preview_invitation_document` returns from the
//     same `private.invitation_issue_records` the freeze-time gate reads. It is the freeze
//     answer, and the only sentence here is the product copy `invitationAuthoring.ts` builds
//     from a record's `message_key` — never Postgres' `message`, `details`, `hint`, a table or a
//     constraint, which the adapter has already thrown away.
//   * The panel beside the canvas prints what this *build* could not place, and says it is not a
//     freeze verdict. A host on an older bundle with a newer release needs to know that a
//     section is missing from their screen; that fact is a rendering limitation, not a rule the
//     database refused them for.
//
// Nothing here recomputes whether a section is full. `blocking` is the server's flag and it is
// used as it arrived: a client that re-derived the rule would be a second implementation, and
// the second one is the one that drifts. Disabling the freeze button off this list is a
// convenience, not enforcement — `api.create_invitation_version` checks the same records again.
//
// A finding names the place to fix it, and the link goes there when the place exists on this
// screen. Two of the codes point somewhere this page does not own: the pack choice is the panel
// above, and the invitation language is the planning page, so those become a link with words in
// it rather than a focus that would land nowhere.

import { Link } from 'react-router-dom';
import type { AuthoringSection, InvitationIssue } from '@/integrations/supabase/publication';
import type { PublicInvitation } from '@/lib/publicInvitation';
import type { AuthoringTarget } from '@/lib/invitationAuthoring';
import {
  authoritativeIssues,
  headingOf,
  labelForSection,
} from '@/lib/invitationAuthoring';

export interface AuthoritativeIssuesProps {
  /** The server's records for this wedding, in the order it wrote them. */
  issues: InvitationIssue[];
  /** The same declaration the outline is drawn from, so a link only points at a block that is
   *  actually on the screen. */
  authoring: AuthoringSection[];
  invitation: PublicInvitation | null;
  weddingId: string;
}

const GROUP_ANCHOR: Record<'people' | 'venues' | 'ceremonies', string> = {
  people: 'people-heading',
  venues: 'venues-heading',
  ceremonies: 'ceremonies-heading',
};

/** Which places on this screen a declaration actually mounts. A link to a block a release never
 *  declared would be an anchor to nothing, and a dead jump button reads as a defect in the
 *  invitation rather than in the layout. */
const mountedAnchors = (authoring: AuthoringSection[]): Set<string> => {
  const anchors = new Set<string>();
  for (const section of authoring) {
    anchors.add(`authoring-${section.sectionKey}`);
    if (section.kind === 'people_list') anchors.add(GROUP_ANCHOR.people);
    if (section.kind === 'event_list') {
      anchors.add(GROUP_ANCHOR.venues);
      anchors.add(GROUP_ANCHOR.ceremonies);
    }
  }
  return anchors;
};

const AnchorLink = ({ href, children }: { href: string; children: string }) => (
  <a
    href={`#${href}`}
    className="text-[11px] font-medium underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
  >
    {children}
  </a>
);

const TargetLink = ({
  target,
  anchors,
  weddingId,
}: {
  target: AuthoringTarget;
  anchors: Set<string>;
  weddingId: string;
}) => {
  if (target.kind === 'prose') {
    const href = `authoring-${target.sectionKey}`;
    if (!anchors.has(href)) return null;
    return <AnchorLink href={href}>Go to that section</AnchorLink>;
  }
  if (target.kind === 'group') {
    const href = GROUP_ANCHOR[target.group];
    if (!anchors.has(href)) return null;
    return <AnchorLink href={href}>Go to that list</AnchorLink>;
  }
  if (target.kind === 'release-choice') {
    return <AnchorLink href="tradition-heading">Go to the pack choice</AnchorLink>;
  }
  if (target.kind === 'language-page') {
    return (
      <Link
        to={`/project/${weddingId}/configure`}
        className="text-[11px] font-medium underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Choose the language on the planning page
      </Link>
    );
  }
  return null;
};

export const AuthoritativeIssues = ({
  issues,
  authoring,
  invitation,
  weddingId,
}: AuthoritativeIssuesProps) => {
  if (issues.length === 0) return null;

  const labelOf = labelForSection(authoring, key => headingOf(invitation, key));
  const findings = authoritativeIssues(issues, labelOf);
  const anchors = mountedAnchors(authoring);

  return (
    <section
      className="space-y-2 rounded-lg border border-ceremonial/60 bg-card p-3"
      aria-labelledby="findings-heading"
    >
      <h2 id="findings-heading" className="font-display text-sm font-semibold">
        What the server says stands between this and a version
      </h2>
      <p className="text-[11px] leading-snug text-muted-foreground">
        This is the same check the freeze button runs. The wording is ours; the answer is your
        invitation&apos;s, read from the database rather than guessed at in the browser.
      </p>
      <ol className="space-y-2">
        {findings.map(finding => (
          <li key={finding.id} className="space-y-1">
            <p className="text-xs leading-snug">
              <span
                className={`mr-1 font-medium ${finding.blocking ? 'text-destructive' : 'text-muted-foreground'}`}
              >
                {finding.blocking ? 'Must be fixed. ' : 'A note, not a blocker. '}
              </span>
              {finding.sentence}
            </p>
            <TargetLink target={finding.target} anchors={anchors} weddingId={weddingId} />
          </li>
        ))}
      </ol>
    </section>
  );
};

export default AuthoritativeIssues;
