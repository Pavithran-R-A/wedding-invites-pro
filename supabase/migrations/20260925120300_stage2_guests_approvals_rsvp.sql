-- Stage 2 / file 4 of 9 — guest households, event scope, RSVP, family approval.
--
-- Sharing unit is the household, not the individual contact record: a wedding
-- invite is addressed to a family or a flat, and the old `guests` table modelled
-- one row per person with a plaintext bearer token in it. That shape is not
-- repaired here; it is archived (file 8) and replaced.
--
-- Phase 19 decision — there is NO `invitation_recipients` table.
-- While one household is both the sharing unit and the RSVP unit, individuals
-- inside it add a second identity space without a query that needs it. The
-- promotion criterion is recorded in docs/architecture/domain-model.md: a
-- recipient becomes a row when it needs its own token or its own answer.

-- ===========================================================================
-- Households
-- ===========================================================================

CREATE TABLE public.guest_households (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wedding_id uuid NOT NULL REFERENCES public.weddings(id) ON DELETE CASCADE,
  display_name text NOT NULL CHECK (length(btrim(display_name)) > 0),
  -- What the invitation greets them as. Deliberately free text: any CHECK
  -- vocabulary here would encode family structure we have no right to assume.
  salutation text,
  expected_party_size integer CHECK (expected_party_size IS NULL OR expected_party_size > 0),
  host_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (wedding_id, id)
);

CREATE INDEX guest_households_wedding_name_idx ON public.guest_households (wedding_id, display_name);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.guest_households
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

-- ===========================================================================
-- Event scope: which events this household is invited to
-- ===========================================================================

-- The primary key carries wedding_id first so a single composite FK from
-- `rsvp_responses` can assert household, event AND wedding agreement at once.
-- A scope row with zero events is representable (nothing forces at least one)
-- and is treated by later stages as a data error to surface, not a silent
-- "invited to nothing"; a CHECK cannot express "at least one row exists".
CREATE TABLE public.household_event_scopes (
  wedding_id uuid NOT NULL REFERENCES public.weddings(id) ON DELETE CASCADE,
  household_id uuid NOT NULL,
  event_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (wedding_id, household_id, event_id),
  -- Both composites name wedding_id first, so a scope row cannot pair wedding A's
  -- household with wedding A's event *column* while actually pointing at wedding
  -- B's household or event: each side must already agree on the wedding.
  FOREIGN KEY (wedding_id, household_id)
    REFERENCES public.guest_households(wedding_id, id) ON DELETE CASCADE,
  FOREIGN KEY (wedding_id, event_id) REFERENCES public.wedding_events(wedding_id, id)
);

CREATE INDEX household_event_scopes_event_idx
  ON public.household_event_scopes (wedding_id, event_id);

-- ===========================================================================
-- RSVP
-- ===========================================================================

-- "No response for an event the household is not scoped to" is enforced by
-- making a response key itself an existing scope row, instead of a cross-table
-- CHECK (which PostgreSQL cannot evaluate over other tables).
CREATE TABLE public.rsvp_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Direct cascade to the aggregate, *in addition* to the scope FK below: without
  -- it, deleting a wedding would be blocked by its own guests' answers, because
  -- the scope rows it needs to remove are referenced here with NO ACTION.
  wedding_id uuid NOT NULL REFERENCES public.weddings(id) ON DELETE CASCADE,
  household_id uuid NOT NULL,
  event_id uuid NOT NULL,
  attending text NOT NULL CHECK (attending IN ('attending', 'declined')),
  party_size integer NOT NULL DEFAULT 0 CHECK (party_size >= 0),
  -- 'guest' is only writable by the backend (Stage 8); the RLS WITH CHECK in
  -- file 6 restricts client rows to 'host_manual' so a host cannot forge which
  -- side of the phone the answer came from.
  response_source text NOT NULL CHECK (response_source IN ('guest', 'host_manual')),
  responded_at timestamptz NOT NULL DEFAULT now(),
  -- Optional questions (meal, transport, accommodation) must not become
  -- per-wedding mandatory columns, so they land here as one bounded object.
  answers jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(answers) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- One current answer per household/event: a repeat submission overwrites, and
  -- UNIQUE doubles as the index PostgreSQL will not create for a referencing FK.
  UNIQUE (wedding_id, household_id, event_id),
  FOREIGN KEY (wedding_id, household_id, event_id)
    REFERENCES public.household_event_scopes(wedding_id, household_id, event_id)
);

CREATE INDEX rsvp_responses_wedding_event_idx ON public.rsvp_responses (wedding_id, event_id);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.rsvp_responses
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

-- ===========================================================================
-- Approval requests and their append-only feedback
-- ===========================================================================

-- A request is bound to one exact version, so a newer version cannot inherit an
-- older approval: the newer version has no request row, and there is no path
-- that resolves "approved" for a version other than the one named here.
CREATE TABLE public.approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NO ACTION, not CASCADE. Deleting a wedding is an ordinary client action
  -- (`owners_delete_own_weddings`), and a cascade would have carried the request
  -- rows away while `approval_requests_no_client_write` watched: an FK cascade
  -- fires the child's triggers as the child table's owner, so a guard that tests
  -- the acting role's name never sees the client who started it. Measured on
  -- PostgreSQL 16.15: the child's trigger fires, but as the child table's owner, so
  -- the client identity is gone by then. Asserted from the outside by group 11 of
  -- `supabase/tests/stage2/20_attacks.sql`.
  wedding_id uuid NOT NULL REFERENCES public.weddings(id) ON DELETE NO ACTION,
  version_id uuid NOT NULL,
  reviewer_display_name text NOT NULL CHECK (length(btrim(reviewer_display_name)) > 0),
  reviewer_contact_text text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'changes_requested', 'invalidated', 'expired')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  invalidated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (wedding_id, version_id)
    REFERENCES public.invitation_versions(wedding_id, id),
  CHECK ((status IN ('approved', 'changes_requested')) = (responded_at IS NOT NULL)),
  CHECK (invalidated_at IS NULL OR status = 'invalidated'),
  -- Exposed so a feedback row can pin the request *and* the version it was
  -- answered about in one constraint.
  UNIQUE (wedding_id, id, version_id)
);

CREATE INDEX approval_requests_wedding_requested_idx
  ON public.approval_requests (wedding_id, requested_at DESC);
CREATE INDEX approval_requests_version_id_idx ON public.approval_requests (version_id);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.approval_requests
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

-- An approval record is evidence about who was asked and who answered. Only the
-- server may open or move one.
CREATE TRIGGER approval_requests_no_client_write
  BEFORE INSERT OR UPDATE ON public.approval_requests
  FOR EACH ROW EXECUTE FUNCTION private.reject_client_write();

-- Append-only: a re-approval is another row, never an overwrite, because "what
-- did we ask her about, and what did she say" has to survive disputes.
CREATE TABLE public.approval_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wedding_id uuid NOT NULL,
  request_id uuid NOT NULL,
  version_id uuid NOT NULL,
  feedback_kind text NOT NULL CHECK (feedback_kind IN ('decision', 'comment')),
  decision text CHECK (decision IN ('approved', 'changes_requested')),
  -- Locators are free keys from the resolved document, not FKs: they address a
  -- section of a snapshot, which is JSON content rather than a row.
  section_key text,
  field_key text,
  message text,
  author_label text NOT NULL CHECK (length(btrim(author_label)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- One constraint ties the comment to the request and to the exact version that
  -- request reviewed, so feedback cannot be re-parented onto another version.
  -- NO ACTION, not CASCADE: `feedback_append_only_no_delete` declares this
  -- conversation history that cannot be un-said, and the one thing that guard
  -- cannot see is a cascade (it fires as the child table's owner, not as the
  -- role that deleted the parent). So the erasure has to be refused by relational
  -- integrity instead, and a trusted role that really means to remove a request
  -- deletes its feedback first. The separate durable record of who did what is
  -- `private.audit_events`, which is deliberately kept out of every cascade path
  -- (file 5).
  FOREIGN KEY (wedding_id, request_id, version_id)
    REFERENCES public.approval_requests(wedding_id, id, version_id) ON DELETE NO ACTION,
  CHECK ((feedback_kind = 'decision') = (decision IS NOT NULL)),
  CHECK (feedback_kind <> 'comment' OR length(btrim(coalesce(message, ''))) > 0)
);

CREATE INDEX approval_feedback_request_idx
  ON public.approval_feedback (wedding_id, request_id, created_at);

CREATE TRIGGER feedback_append_only_no_update BEFORE UPDATE ON public.approval_feedback
  FOR EACH ROW EXECUTE FUNCTION private.reject_client_write();
CREATE TRIGGER feedback_append_only_no_delete BEFORE DELETE ON public.approval_feedback
  FOR EACH ROW EXECUTE FUNCTION private.reject_client_delete();
