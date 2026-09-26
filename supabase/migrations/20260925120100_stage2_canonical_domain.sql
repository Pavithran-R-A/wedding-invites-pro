-- Stage 2 / file 2 of 9 — canonical domain: platform content + wedding aggregate + owned children.
--
-- Deliberately absent from this file:
--   * any billing/entitlement column on `weddings` (an old paid claim must not be able to
--     migrate into a right, so the canonical aggregate has nowhere to put one);
--   * `selected_features` (a JSON catch-all with no contract);
--   * any ceremony-vocabulary CHECK (the vocabulary belongs to tradition packs, Stage 4,
--     not to SQL);
--   * any enumeration of roles like bride/groom (see `wedding_people`).

-- ===========================================================================
-- Platform content (admin/service authored; customers never write these)
-- ===========================================================================

CREATE TABLE public.tradition_packs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_key text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  display_name text NOT NULL CHECK (length(btrim(display_name)) > 0),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'deprecated')),
  supported_languages text[] NOT NULL DEFAULT '{en}'
    CHECK (cardinality(supported_languages) > 0
           AND supported_languages <@ ARRAY['en', 'ta', 'te', 'ml', 'kn']::text[]),
  -- Structure (section order, labels, event vocabulary, motifs) is read as one
  -- document and never queried field-wise, so it is JSONB by the general rule.
  structure jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(structure) = 'object'),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- 'approved' is only reachable by naming who approved it and when, so a status
  -- can never be advanced by an edit that forgets the review.
  CHECK ((status = 'approved') = (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)),
  UNIQUE (pack_key, revision)
);

CREATE TABLE public.design_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  display_name text NOT NULL CHECK (length(btrim(display_name)) > 0),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'deprecated')),
  supported_languages text[] NOT NULL DEFAULT '{en}'
    CHECK (cardinality(supported_languages) > 0
           AND supported_languages <@ ARRAY['en', 'ta', 'te', 'ml', 'kn']::text[]),
  -- Migrated from the legacy `templates.preview_svg`. The column keeps a
  -- format-specific name because it is consumed through the client-side SVG
  -- sanitiser boundary; whatever lands here must stay untrusted markup.
  preview_svg text,
  layout_settings jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(layout_settings) = 'object'),
  -- Review state, so that `status = 'approved'` names a person rather than a mood.
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'approved') = (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)),
  UNIQUE (template_key, revision)
);

-- The legacy `price_tier` column is not carried forward: a tier label on
-- platform content is guessed commerce metadata (Phase 27), and its values are
-- preserved unchanged in the archived `legacy.templates` row.

-- ===========================================================================
-- Canonical aggregate
-- ===========================================================================

CREATE TABLE public.weddings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  -- Language codes are a CHECK list, not an enum and not a table. A table would
  -- need per-language attributes we do not have yet; an enum cannot be narrowed
  -- and would be shared by columns that must stay independent. Adding a code is
  -- one forward migration touching every list below (asserted behaviourally by
  -- the Stage 2 language tests rather than by a helper function).
  -- NULL means "no language chosen yet", which is a different fact from 'en'.
  -- The column is nullable because the legacy rows it must ingest were nullable,
  -- and a migration that substitutes 'en' would be inventing a language for a
  -- family that never picked one. Stage 3 must refuse to render without it.
  primary_language text
    CHECK (primary_language IS NULL OR primary_language IN ('en', 'ta', 'te', 'ml', 'kn')),
  additional_languages text[] NOT NULL DEFAULT '{}'::text[]
    CHECK (additional_languages <@ ARRAY['en', 'ta', 'te', 'ml', 'kn']::text[]
           AND NOT (primary_language = ANY (additional_languages))),
  tradition_pack_id uuid REFERENCES public.tradition_packs(id) ON DELETE RESTRICT,
  design_template_id uuid REFERENCES public.design_templates(id) ON DELETE RESTRICT,
  -- Visual settings only. Renamed from `selected_features` and constrained to an
  -- object so the old catch-all cannot return under a new name.
  style_settings jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(style_settings) = 'object'),
  estimated_guest_count integer NOT NULL DEFAULT 0 CHECK (estimated_guest_count >= 0),
  lifecycle_status text NOT NULL DEFAULT 'draft'
    CHECK (lifecycle_status IN ('draft', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX weddings_owner_user_id_idx ON public.weddings (owner_user_id);

-- Every human named on the invitation. Content, not an account: a person never
-- needs a login, and this table must stay disjoint from `profiles`.
--
-- `role_key` and `group_key` are free labels with no CHECK vocabulary on
-- purpose. Encoding ('bride','groom') would bake in a marriage-role assumption
-- that fails for other couples, and any inferred `religion`/`caste`/`community`
-- column would be us inventing an identity for someone who never declared it.
CREATE TABLE public.wedding_people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wedding_id uuid NOT NULL REFERENCES public.weddings(id) ON DELETE CASCADE,
  display_name text NOT NULL CHECK (length(btrim(display_name)) > 0),
  role_key text NOT NULL CHECK (length(btrim(role_key)) > 0),
  role_label text,
  group_key text,
  group_label text,
  display_order integer NOT NULL DEFAULT 0 CHECK (display_order >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX wedding_people_wedding_order_idx ON public.wedding_people (wedding_id, display_order);

-- Wedding-scoped. Two couples sharing a hall get two rows that must never be
-- joined or searched across weddings, so there is no uniqueness on name/address
-- and no directory view.
CREATE TABLE public.venues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wedding_id uuid NOT NULL REFERENCES public.weddings(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  address_text text,
  map_url text CHECK (map_url IS NULL OR map_url ~ '^https://'),
  -- Coordinates are advisory (a map link is the guest-facing fact), hence nullable.
  latitude numeric(9,6) CHECK (latitude IS NULL OR (latitude >= -90 AND latitude <= 90)),
  longitude numeric(9,6) CHECK (longitude IS NULL OR (longitude >= -180 AND longitude <= 180)),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Target for composite FKs below: makes "venue of wedding A used by wedding B"
  -- unrepresentable rather than merely policy-frowned upon.
  UNIQUE (wedding_id, id)
);

-- A function. `starts_at_local` is deliberately `timestamp` without time zone:
-- a muhurtham is a wall-clock fact ("07:30 at the hall"), and storing it in UTC
-- would let a server timezone or DST shift the one number the family cares about.
CREATE TABLE public.wedding_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wedding_id uuid NOT NULL REFERENCES public.weddings(id) ON DELETE CASCADE,
  event_key text NOT NULL CHECK (length(btrim(event_key)) > 0),
  display_name text NOT NULL CHECK (length(btrim(display_name)) > 0),
  starts_at_local timestamp NOT NULL,
  ends_at_local timestamp,
  timezone text NOT NULL DEFAULT 'Asia/Kolkata' CHECK (length(btrim(timezone)) > 0),
  venue_id uuid,
  display_order integer NOT NULL DEFAULT 0 CHECK (display_order >= 0),
  notes text,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at_local IS NULL OR ends_at_local > starts_at_local),
  -- NO ACTION (not RESTRICT) is the load-bearing choice. During the CASCADE from
  -- `weddings` the event row still points at its venue at the instant the venue row
  -- is taken, and RESTRICT is evaluated as each row goes, so it would refuse an owner
  -- deleting its own wedding. NO ACTION defers the check to the end of the statement,
  -- by which point the event row has gone with the wedding. Asserted both ways by
  -- group 11f of supabase/tests/stage2/20_attacks.sql: an in-use venue cannot be
  -- deleted alone, and the wedding carrying it still can be.
  FOREIGN KEY (wedding_id, venue_id) REFERENCES public.venues(wedding_id, id)
    ON DELETE NO ACTION,
  UNIQUE (wedding_id, id)
);

CREATE INDEX wedding_events_wedding_order_idx ON public.wedding_events (wedding_id, display_order);
CREATE INDEX wedding_events_venue_id_idx ON public.wedding_events (venue_id);

-- The editable working copy. Stable facts (people, events, venues) live in their
-- own tables; only wording is JSONB, so the domain is never one opaque blob.
CREATE TABLE public.invitation_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wedding_id uuid NOT NULL REFERENCES public.weddings(id) ON DELETE CASCADE UNIQUE,
  content jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(content) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ===========================================================================
-- Centralised updated_at (one mechanism, no per-table copies)
-- ===========================================================================

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.tradition_packs
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.design_templates
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.weddings
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.wedding_people
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.venues
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.wedding_events
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.invitation_drafts
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

-- ===========================================================================
-- Server-authoritative platform content: customers must not write it at all,
-- even though the RLS layer will additionally have no INSERT/UPDATE policy.
-- ===========================================================================

CREATE TRIGGER no_client_write_tradition_packs BEFORE INSERT OR UPDATE ON public.tradition_packs
  FOR EACH ROW EXECUTE FUNCTION private.reject_client_write();
CREATE TRIGGER no_client_write_design_templates BEFORE INSERT OR UPDATE ON public.design_templates
  FOR EACH ROW EXECUTE FUNCTION private.reject_client_write();
