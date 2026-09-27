// Who is invited, where, and when: the three lists a guest reads as facts.
//
// These are canonical rows, not draft text. `wedding_people`, `venues` and
// `wedding_events` are the tables `private.build_invitation_snapshot` draws a frozen
// version from, so a name typed here is the name a guest sees — which is the reason this
// half of the editor writes immediately instead of waiting for "Save Draft" like the
// prose and styling do.
//
// What this layer deliberately does not do:
//   * It names no table outside this file. Pages call the functions below;
//     `grep -rn "\\.from(" src` still has one home to inspect.
//   * It does not widen RLS. Each call carries the wedding id and runs as the signed-in
//     user, so a foreign wedding reads as an empty list rather than as an error, and a
//     write to a row that is not the caller's is answered by an update that changed no
//     row. That is why every write re-reads the affected row: a zero-row answer from a
//     policy is reported as a failure, never as Saved.
//   * It sends no machine key the host did not choose, and no coordinate. `venues.latitude`
//     and `venues.longitude` stay absent — a map link is the venue fact this stage has.
//     `group_key` stays NULL for the same reason (see `HOST_DEFINED_KEY`).
//   * It does not carry a database sentence to the screen. `fail()` logs the error's code
//     and hands back the phrase chosen here; a foreign-key refusal is mapped to one
//     because that is the only case where the constraint tells the host what to do next.
//
// The `wedding_events_wedding_id_venue_id_fkey` composite key is the database's own rule
// that a ceremony may only point at a venue of the same wedding. Nothing here re-implements
// it: the ceremony form's venue choices come from `listVenues` for that wedding, and a
// venue id from elsewhere is refused by the constraint.

import { supabase } from './client';
import { describe, codeOf } from '@/lib/safeError';
import type { QueryResult } from './weddings';
import type { Database } from './types';

type PersonRow = Database['public']['Tables']['wedding_people']['Row'];
type VenueRow = Database['public']['Tables']['venues']['Row'];
type EventRow = Database['public']['Tables']['wedding_events']['Row'];

type PersonProjection = Pick<PersonRow, 'id' | 'display_name' | 'role_label' | 'group_label' | 'display_order'>;
type VenueProjection = Pick<VenueRow, 'id' | 'name' | 'address_text' | 'map_url'>;
type EventProjection = Pick<
  EventRow,
  'id' | 'display_name' | 'starts_at_local' | 'ends_at_local' | 'timezone' | 'venue_id' | 'display_order' | 'enabled'
>;

const PERSON_COLUMNS = 'id, display_name, role_label, group_label, display_order';
const VENUE_COLUMNS = 'id, name, address_text, map_url';
const EVENT_COLUMNS =
  'id, display_name, starts_at_local, ends_at_local, timezone, venue_id, display_order, enabled';

/**
 * The key every person and ceremony a host adds is stored under. Stage 3 has no reviewed
 * vocabulary for relationships or rites — the tradition-pack stage owns one — so the
 * alternative to this placeholder is a key invented from what the host typed, which would
 * read as a claim about somebody's relative. Nothing displays a key: the renderer prints
 * the host's own label, and none when there is not one.
 */
const HOST_DEFINED_KEY = 'host_defined';

/** The name CHECKs are the database's (`length(btrim(display_name)) > 0`); saying it here
 *  spends no request and answers with an instruction rather than a constraint name. */
const NAME_NEEDED = 'a name is needed before this can be saved';
/** Stricter than the column CHECK (`map_url ~ '^https://'`) on purpose: a link with a
 *  space in it is a half-pasted address, and no map service resolves one. */
const MAP_LINK_REFUSED = 'the map link must be a full https:// address, with no spaces';
const TIME_NEEDED = 'a start date and time is needed before this can be saved';
const TIME_ORDER_REFUSED = 'the end time has to be after the start time';
/** 23503 is the only database code whose meaning the host can act on, and the constraint
 *  it comes from is exactly the rule "a venue a ceremony uses is not free to remove". */
const FOREIGN_KEY_VIOLATION = '23503';

export interface PersonEntry {
  id: string;
  displayName: string;
  roleLabel: string | null;
  groupLabel: string | null;
  displayOrder: number;
}

export interface VenueEntry {
  id: string;
  name: string;
  addressText: string | null;
  mapUrl: string | null;
}

export interface CeremonyEntry {
  id: string;
  displayName: string;
  /** Wall-clock text as Postgres returns it, e.g. `2026-11-14T07:30:00`. */
  startsAtLocal: string;
  endsAtLocal: string | null;
  timezone: string;
  venueId: string | null;
  displayOrder: number;
  enabled: boolean;
}

/** A row as the form holds it: plain strings, because an input's value is a string and
 *  the empty string is the host's way of saying "nothing here". The mapping to NULL is
 *  this module's job, so no form has to know which columns are nullable. */
export interface PersonDraft {
  displayName: string;
  roleLabel: string;
  groupLabel: string;
  displayOrder: number;
}

export interface VenueDraft {
  name: string;
  addressText: string;
  mapUrl: string;
}

export interface CeremonyDraft {
  displayName: string;
  startsAtLocal: string;
  endsAtLocal: string;
  timezone: string;
  venueId: string;
  displayOrder: number;
  enabled: boolean;
}

const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

const blank = (value: string): boolean => value.trim() === '';
/** '' is "no value" from a form and NULL in a row; a real value is trimmed on the way in
 *  so a name cannot arrive padded with a space the host never typed. */
const textOrNull = (value: string): string | null => (value.trim() === '' ? null : value.trim());

const fail = (context: string, error: unknown): { data: null; error: string } => {
  console.warn(describe('weddingContent', context, error));
  return { data: null, error: context };
};

const refused = (error: string): { data: null; error: string } => ({ data: null, error });

const toPerson = (row: PersonProjection): PersonEntry => ({
  id: row.id,
  displayName: row.display_name,
  roleLabel: row.role_label,
  groupLabel: row.group_label,
  displayOrder: row.display_order,
});

const toVenue = (row: VenueProjection): VenueEntry => ({
  id: row.id,
  name: row.name,
  addressText: row.address_text,
  mapUrl: row.map_url,
});

const toCeremony = (row: EventProjection): CeremonyEntry => ({
  id: row.id,
  displayName: row.display_name,
  startsAtLocal: row.starts_at_local,
  endsAtLocal: row.ends_at_local,
  timezone: row.timezone,
  venueId: row.venue_id,
  displayOrder: row.display_order,
  enabled: row.enabled,
});

/** `.select('id')` after a write is what makes an RLS no-op visible: a policy that does
 *  not match the caller returns no rows rather than an error, and a list of zero affected
 *  rows is not a saved change. */
const wroteRow = (data: { id: string }[] | null): boolean => Array.isArray(data) && data.length > 0;

const personPayload = (draft: PersonDraft) => ({
  display_name: draft.displayName.trim(),
  role_label: textOrNull(draft.roleLabel),
  group_label: textOrNull(draft.groupLabel),
  display_order: draft.displayOrder,
});

const venuePayload = (draft: VenueDraft) => ({
  name: draft.name.trim(),
  address_text: textOrNull(draft.addressText),
  map_url: textOrNull(draft.mapUrl),
});

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

/** The order is the snapshot's own (`display_order, created_at, id`), so the list the
 *  host arranges is the order their guests read. */
export async function listPeople(weddingId: string): Promise<QueryResult<PersonEntry[]>> {
  const { data, error } = await supabase
    .from('wedding_people')
    .select(PERSON_COLUMNS)
    .eq('wedding_id', weddingId)
    .order('display_order')
    .order('created_at')
    .order('id');
  if (error) return fail('the names could not be loaded', error);
  return { data: (data ?? []).map((row: PersonProjection) => toPerson(row)), error: null };
}

export async function createPerson(
  weddingId: string,
  draft: PersonDraft,
): Promise<QueryResult<{ id: string }>> {
  if (blank(draft.displayName)) return refused(NAME_NEEDED);
  const { data, error } = await supabase
    .from('wedding_people')
    .insert({ wedding_id: weddingId, role_key: HOST_DEFINED_KEY, ...personPayload(draft) })
    .select('id');
  if (error) return fail('the name could not be added', error);
  if (!wroteRow(data)) return fail('the name could not be added', null);
  return { data: { id: data[0].id }, error: null };
}

export async function updatePerson(
  weddingId: string,
  personId: string,
  draft: PersonDraft,
): Promise<QueryResult<null>> {
  if (blank(draft.displayName)) return refused(NAME_NEEDED);
  const { data, error } = await supabase
    .from('wedding_people')
    .update(personPayload(draft))
    .eq('id', personId)
    .eq('wedding_id', weddingId)
    .select('id');
  if (error) return fail('the name could not be saved', error);
  if (!wroteRow(data)) return fail('the name could not be saved', null);
  return { data: null, error: null };
}

export async function removePerson(
  weddingId: string,
  personId: string,
): Promise<QueryResult<null>> {
  const { data, error } = await supabase
    .from('wedding_people')
    .delete()
    .eq('id', personId)
    .eq('wedding_id', weddingId)
    .select('id');
  if (error) return fail('the name could not be removed', error);
  if (!wroteRow(data)) return fail('the name could not be removed', null);
  return { data: null, error: null };
}

// ---------------------------------------------------------------------------
// Venues
// ---------------------------------------------------------------------------

/** `venues` has no order column, so the newest venue is listed last and the host reads
 *  the list in the order they built it. */
export async function listVenues(weddingId: string): Promise<QueryResult<VenueEntry[]>> {
  const { data, error } = await supabase
    .from('venues')
    .select(VENUE_COLUMNS)
    .eq('wedding_id', weddingId)
    .order('created_at')
    .order('id');
  if (error) return fail('the venues could not be loaded', error);
  return { data: (data ?? []).map((row: VenueProjection) => toVenue(row)), error: null };
}

export async function createVenue(
  weddingId: string,
  draft: VenueDraft,
): Promise<QueryResult<{ id: string }>> {
  if (blank(draft.name)) return refused(NAME_NEEDED);
  if (!blank(draft.mapUrl) && !/^https:\/\/\S+$/.test(draft.mapUrl.trim())) {
    return refused(MAP_LINK_REFUSED);
  }
  const { data, error } = await supabase
    .from('venues')
    .insert({ wedding_id: weddingId, ...venuePayload(draft) })
    .select('id');
  if (error) return fail('the venue could not be added', error);
  if (!wroteRow(data)) return fail('the venue could not be added', null);
  return { data: { id: data[0].id }, error: null };
}

export async function updateVenue(
  weddingId: string,
  venueId: string,
  draft: VenueDraft,
): Promise<QueryResult<null>> {
  if (blank(draft.name)) return refused(NAME_NEEDED);
  if (!blank(draft.mapUrl) && !/^https:\/\/\S+$/.test(draft.mapUrl.trim())) {
    return refused(MAP_LINK_REFUSED);
  }
  const { data, error } = await supabase
    .from('venues')
    .update(venuePayload(draft))
    .eq('id', venueId)
    .eq('wedding_id', weddingId)
    .select('id');
  if (error) return fail('the venue could not be saved', error);
  if (!wroteRow(data)) return fail('the venue could not be saved', null);
  return { data: null, error: null };
}

export async function removeVenue(
  weddingId: string,
  venueId: string,
): Promise<QueryResult<null>> {
  const { data, error } = await supabase
    .from('venues')
    .delete()
    .eq('id', venueId)
    .eq('wedding_id', weddingId)
    .select('id');
  if (error) {
    // The FK is `NO ACTION`, so a venue a ceremony points at cannot go. The code is the
    // only part of the answer worth carrying: the message would name both tables.
    if (codeOf(error) === FOREIGN_KEY_VIOLATION) {
      return refused('a ceremony still uses this venue, so it cannot be removed');
    }
    return fail('the venue could not be removed', error);
  }
  if (!wroteRow(data)) return fail('the venue could not be removed', null);
  return { data: null, error: null };
}

// ---------------------------------------------------------------------------
// Ceremonies
// ---------------------------------------------------------------------------

export async function listCeremonies(weddingId: string): Promise<QueryResult<CeremonyEntry[]>> {
  const { data, error } = await supabase
    .from('wedding_events')
    .select(EVENT_COLUMNS)
    .eq('wedding_id', weddingId)
    .order('display_order')
    .order('starts_at_local')
    .order('id');
  if (error) return fail('the ceremonies could not be loaded', error);
  return { data: (data ?? []).map((row: EventProjection) => toCeremony(row)), error: null };
}

/** `event_key` is NOT NULL so an insert always sends one (`HOST_DEFINED_KEY`); `timezone`
 *  is left out when the host typed nothing, which lets the column's own default answer
 *  rather than a value this file chose. `ends_at_local` and `venue_id` go the same way: an
 *  empty field sends NULL, not an empty string. */
const ceremonyPayload = (draft: CeremonyDraft) => ({
  display_name: draft.displayName.trim(),
  starts_at_local: draft.startsAtLocal,
  ends_at_local: textOrNull(draft.endsAtLocal),
  venue_id: textOrNull(draft.venueId),
  display_order: draft.displayOrder,
  enabled: draft.enabled,
});

const ceremonyRefusal = (draft: CeremonyDraft): string | null => {
  if (blank(draft.displayName)) return NAME_NEEDED;
  if (!LOCAL_DATE_TIME.test(draft.startsAtLocal.trim())) return TIME_NEEDED;
  const end = draft.endsAtLocal.trim();
  if (end !== '' && !LOCAL_DATE_TIME.test(end)) return TIME_NEEDED;
  if (end !== '' && end <= draft.startsAtLocal.trim()) return TIME_ORDER_REFUSED;
  return null;
};

export async function createCeremony(
  weddingId: string,
  draft: CeremonyDraft,
): Promise<QueryResult<{ id: string }>> {
  const refusal = ceremonyRefusal(draft);
  if (refusal !== null) return refused(refusal);
  const timezone = textOrNull(draft.timezone);
  const { data, error } = await supabase
    .from('wedding_events')
    .insert({
      wedding_id: weddingId,
      event_key: HOST_DEFINED_KEY,
      ...(timezone === null ? {} : { timezone }),
      ...ceremonyPayload(draft),
    })
    .select('id');
  if (error) return fail('the ceremony could not be added', error);
  if (!wroteRow(data)) return fail('the ceremony could not be added', null);
  return { data: { id: data[0].id }, error: null };
}

export async function updateCeremony(
  weddingId: string,
  ceremonyId: string,
  draft: CeremonyDraft,
): Promise<QueryResult<null>> {
  const refusal = ceremonyRefusal(draft);
  if (refusal !== null) return refused(refusal);
  const patch: Database['public']['Tables']['wedding_events']['Update'] = ceremonyPayload(draft);
  // An empty timezone field means "leave what is stored": sending NULL would hit the
  // NOT NULL column, and sending a guess would replace the host's own words.
  const timezone = textOrNull(draft.timezone);
  if (timezone !== null) patch.timezone = timezone;
  const { data, error } = await supabase
    .from('wedding_events')
    .update(patch)
    .eq('id', ceremonyId)
    .eq('wedding_id', weddingId)
    .select('id');
  if (error) return fail('the ceremony could not be saved', error);
  if (!wroteRow(data)) return fail('the ceremony could not be saved', null);
  return { data: null, error: null };
}

export async function removeCeremony(
  weddingId: string,
  ceremonyId: string,
): Promise<QueryResult<null>> {
  const { data, error } = await supabase
    .from('wedding_events')
    .delete()
    .eq('id', ceremonyId)
    .eq('wedding_id', weddingId)
    .select('id');
  if (error) return fail('the ceremony could not be removed', error);
  if (!wroteRow(data)) return fail('the ceremony could not be removed', null);
  return { data: null, error: null };
}
