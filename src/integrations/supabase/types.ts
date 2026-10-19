// Database types for the canonical Stage 9 schema: the RLS-governed tables in `public`,
// and the twenty-two browser-callable RPCs in `api`.
//
// Generated, not hand-written:
//
//   supabase gen types typescript --local --schema public --schema api
//
// run from this repository against the project in `supabase/config.toml`, whose
// `project_id` is `localvivaahvarnam` and which `supabase status` reports as
// "Not linked." — so the database behind this file is a container on this machine.
// No remote project was connected or queried to produce it, and `--linked` is not
// part of the command because it must not become one.
//
// Two edits sit between that stdout and this file, and both are mechanical: the blank
// line the generator prints after `} as const` is dropped (rule 5 of
// `npm run dbtypes:check` is what notices if it comes back), and the text is run through
// `prettier --no-semi` so the file stays readable. Prettier is not a project dependency;
// no check reads this file's layout, only its structure.
//
// The Stage 6 regeneration is the exception to that second edit, and the exception is
// recorded rather than smoothed over. CLI 2.119.0 prints the same unformatted stdout here;
// `prettier` is not installed on this machine and nothing was installed to obtain it, so
// the raw output was *diffed* against this file instead of formatted into it. The diff had
// one line of schema in it — `wedding_assets.upload_status` in each of `Row`, `Insert` and
// `Update`, at the position and with the optionality the generator itself chose — and that
// delta was applied in this file's existing one-key-per-line style. Rule 1 of
// `npm run dbtypes:check` is what makes this verifiable rather than merely tidy: it
// compares every column of every public table against the migrations, so the claim is that
// the file matches the schema the generator printed, not that it matches a formatter.
//
// That qualifier is load-bearing, because the previous version of this file had been
// tidied further by hand. `NonNullable<Json>` had been replaced with `Json` on six NOT NULL
// jsonb columns (in each of their `Row`, `Insert` and `Update` forms), and the guest door's
// empty argument list spelled as `never` rather than the generator's
// `Record<PropertyKey, never>`. Both describe the same schema, which is why
// `dbtypes:check`, which compares column names, stayed green over that change. It is the
// generator's own text again now, because a file that says it was generated has to be
// re-derivable from the generator — and because a reader who trusts this header should be
// able to diff a fresh regeneration against it and see only schema changes.
//
// `--schema` names exactly two schemas, and the reason is the grant model:
//   * `private` holds `access_tokens`, `audit_events`, the snapshot builder, the
//     projection and the Stage 4 release guard. It is not exposed to PostgREST at all, so
//     a type that named it would describe a surface the client cannot reach and invite
//     someone to try.
//   * `legacy` holds archived scaffold tables for the same reason.
// `npm run dbtypes:check` fails if either reappears here, and also if this file stops
// matching the migrations that produce it.
//
// Note what `api.Functions` says about the guest door: `resolve_public_invitation` has
// `Args: Record<PropertyKey, never>`. That is the token-never-in-a-URL rule expressed as a
// type — there is no parameter to pass a credential through, and regenerating this file is
// how a later change to that signature becomes visible here instead of surprising the
// client at runtime.
//
// Stage 4 is why the `tradition_packs` entry shrank and a `tradition_pack_releases` entry
// appeared beside it: the pack is now the concept (slug, display name, scope statement) and
// the release is the frozen definition with its review provenance. `weddings` and
// `invitation_versions` renamed their `tradition_pack_id` to `tradition_pack_release_id`,
// so a selection and a pinned snapshot both point at a release, never at a moving concept.
//
// Stage 5 added one column and one RPC, and both are visible here as the generator's own
// text: `tradition_pack_releases.review_packet_hash` — the SHA-256 the lifecycle guard writes
// at draft -> reviewed and re-compares at reviewed -> approved — and `api
// .preview_invitation_document`, the host's live document beside the server's own verdict on
// it. What the file does NOT contain is the maintenance surface: the eleven
// `internal_api` bodies the HTTP battery lists by name as `MAINTENANCE_ONLY`
// (`supabase/tests/api/stage3_publication.test.mjs:1092-1104`) are in no schema this file
// describes, because `--schema` names only `public` and `api`, and a type that named a
// function no browser may
// execute would advertise a door that is shut.
//
// Stage 7 added five RPCs and no columns: the tables the approval workflow writes into were
// created with the scaffold and already appear above, which is why its regeneration is a diff
// of `api.Functions` and nothing else. Three of the five are host verbs that take a wedding or
// request id and act through the caller's JWT; `resolve_family_review` is the reviewer's door
// and carries `Args: Record<PropertyKey, never>` for the same reason the guest door does — the
// credential arrives in the `x-review-token` header, and a parameter would be a query string.
// `submit_family_review` is the one Stage 7 name whose generated `Args` are a lie by omission:
// PostgreSQL records no nullability for a function parameter, so the generator prints
// `p_message: string` and `p_section_key: string` where the function in fact takes either as
// NULL — an approval with no note is exactly that call, and A-01 records the row it produces.
// A-05 is the other half of the same fact: *omitting* either key is a different call, refused
// 404/PGRST202 by the router, so the null has to travel explicitly. The adapter passes the
// nulls the database accepts and says so at the call site; the type is left as the generator
// printed it, because this file's claim is that it can be re-derived, not that it was tidied.
//
// The Stage 7 regeneration is the second time the formatter note above has bitten: CLI 2.119.0
// prints `Generated TypeScript is unformatted. Format it with: npx oxfmt <file>`. `oxfmt` is
// not a project dependency either, was not run, and nothing was installed to obtain it. The
// raw stdout was diffed against this file instead, and only the five function entries — in the
// generator's own key order, optionality and `Record<PropertyKey, never>` spelling — were
// applied. `npm run dbtypes:check` is what makes that verifiable: it compares every column of
// every public table against the migrations that produce them.
//
// Stage 8 adds six RPCs and no columns, and its block below carries a label the others do not need: the
// qualification stack was not running when it was written, so `supabase gen types` could not be executed.
// The six entries are therefore authored from the wrapper DDL at
// `20261009120000_stage8_guest_invitations_rsvp.sql:1120-1170` — parameter names and alphabetical order,
// `uuid[]` as `string[]`, the `DEFAULT NULL` that makes `p_expires_at` optional, the argument-free
// household door as `Record<PropertyKey, never>`, `jsonb` as `Json` — and a real regeneration must
// replace them before Stage 8 is certified. Nothing else moved: Stage 8 gave no public table a column,
// so the part of this file that `dbtypes:check` actually verifies is untouched and still generator-derived.
// That check does not read `api.Functions`, which is why the label lives in this header rather than only
// in a commit message — a mistake in these six entries is a diff at the next regeneration, not a red gate.
//
// Stage 9 adds one table and two RPCs, and it is the regeneration the paragraph above promised:
// `supabase gen types typescript --local --schema public --schema api` was run against the migrated
// `localvivaahvarnam` stack and its stdout captured, so the two new entries below —
// `list_invitation_outputs` and `render_invitation_document`, both host reads granted to
// `authenticated` and to no anonymous caller — are the generator's own text, and so are the Stage 8
// six. Comparing that stdout with this file found one divergence in `api.Functions`, and it was in a
// Stage 8 entry, not a Stage 9 one: `issue_guest_invitations` carried its `Args` keys in the wrapper
// DDL's parameter order rather than the generator's alphabetical order. The keys are now the
// generator's. Everything else in the twenty-one entries agrees character for character once
// whitespace, the generator's quoted keys, its `;` and `,` separators and its `(string)[]` spelling
// are normalised away — which is what the two edits above mean by "mechanical", and this file is now
// re-derivable on that claim rather than merely tidy.
//
// A third suppression belongs to that list rather than being smoothed over it. CLI 2.120.0 — the
// version on this machine now, where Stages 6 and 7 recorded 2.119.0 — prints `ComputedFields: never`
// for every one of the twenty `public` tables, and this file has never carried that line for any of
// them. The Stage 9 table was written without it to match the nineteen around it, so a fresh
// regeneration diffed against this file will show exactly three things: twenty `ComputedFields`
// lines, `invitation_outputs`, and the two function entries. `npm run dbtypes:check` compares column
// names, so none of the three can hide a schema change from it.
//
// `invitation_outputs` appearing here describes a table RLS already governs; it is not an invitation
// to query it. No client file names it at this head, and the read path Stage 9 builds is
// `api.list_invitation_outputs`, because a canonical table read straight out of the adapter is what
// `npm run product:check` refuses.
//
// Stage 10 adds one RPC and no table to the schemas this file describes. Its six money tables —
// packages, orders, payment attempts, payment events, refunds, policy — are all in `private`, which is
// not exposed to PostgREST and is not named by `--schema`, so they appear nowhere here by design; the
// only thing a browser session may execute is `api.commerce_host_summary`, and it is the single new
// entry above. This one was regenerated rather than authored: CLI 2.121.0 — the version on this machine
// now, where Stage 9 recorded 2.120.0 — was run as
// `supabase gen types typescript --local --schema public --schema api` against the migrated
// `localvivaahvarnam` stack and its stdout captured in `q10-logs/s10-dbtypes-1.txt`. The generator again
// printed `Generated TypeScript is unformatted. Format it with: npx oxfmt <generated-file.ts>`, and as
// at Stages 7 and 9 `oxfmt` is not a dependency and nothing was installed to obtain it: the raw stdout
// was diffed against this file instead. That diff is two things, both recorded here rather than
// smoothed over. The one new function entry was applied in this file's existing one-key-per-line style,
// with the generator's own alphabetical position (its `Args` are one parameter, `Returns: Json`) — and
// every table in the generated text carries a `ComputedFields: never` line this file has never carried
// for any of them, which is the third suppression described above, unchanged and still twenty tables
// wide because Stage 10 added no public table to make it twenty-one.
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  api: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      commerce_host_summary: {
        Args: { p_wedding_id: string }
        Returns: Json
      }
      create_invitation_version: {
        Args: { p_wedding_id: string }
        Returns: Json
      }
      get_approval_requests: {
        Args: { p_wedding_id: string }
        Returns: Json
      }
      get_guest_invitation_state: {
        Args: { p_wedding_id: string }
        Returns: Json
      }
      get_invitation_publication_state: {
        Args: { p_wedding_id: string }
        Returns: Json
      }
      issue_guest_invitations: {
        Args: {
          p_expires_at?: string
          p_household_ids: string[]
          p_wedding_id: string
        }
        Returns: Json
      }
      list_invitation_outputs: {
        Args: { p_wedding_id: string }
        Returns: Json
      }
      preview_invitation: { Args: { p_wedding_id: string }; Returns: Json }
      preview_invitation_document: {
        Args: { p_wedding_id: string }
        Returns: Json
      }
      publish_invitation_version: {
        Args: {
          p_expires_at?: string
          p_version_id: string
          p_wedding_id: string
        }
        Returns: Json
      }
      render_invitation_document: {
        Args: { p_version_id: string }
        Returns: Json
      }
      request_family_review: {
        Args: {
          p_expires_at?: string
          p_reviewer_display_name: string
          p_version_id: string
          p_wedding_id: string
        }
        Returns: Json
      }
      resolve_family_review: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      resolve_guest_invitation: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      resolve_public_invitation: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      revoke_family_review: {
        Args: { p_request_id: string }
        Returns: Json
      }
      revoke_guest_invitation: {
        Args: { p_household_id: string }
        Returns: Json
      }
      revoke_invitation_publication: {
        Args: { p_wedding_id: string }
        Returns: Json
      }
      rotate_guest_invitation: {
        Args: { p_household_id: string }
        Returns: Json
      }
      rotate_invitation_token: { Args: { p_wedding_id: string }; Returns: Json }
      submit_family_review: {
        Args: {
          p_decision: string
          p_message: string
          p_reviewer_label: string
          p_section_key: string
        }
        Returns: Json
      }
      submit_guest_rsvp: {
        Args: { p_answers: Json }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      approval_feedback: {
        Row: {
          author_label: string
          created_at: string
          decision: string | null
          feedback_kind: string
          field_key: string | null
          id: string
          message: string | null
          request_id: string
          section_key: string | null
          version_id: string
          wedding_id: string
        }
        Insert: {
          author_label: string
          created_at?: string
          decision?: string | null
          feedback_kind: string
          field_key?: string | null
          id?: string
          message?: string | null
          request_id: string
          section_key?: string | null
          version_id: string
          wedding_id: string
        }
        Update: {
          author_label?: string
          created_at?: string
          decision?: string | null
          feedback_kind?: string
          field_key?: string | null
          id?: string
          message?: string | null
          request_id?: string
          section_key?: string | null
          version_id?: string
          wedding_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "approval_feedback_wedding_id_request_id_version_id_fkey"
            columns: ["wedding_id", "request_id", "version_id"]
            isOneToOne: false
            referencedRelation: "approval_requests"
            referencedColumns: ["wedding_id", "id", "version_id"]
          },
        ]
      }
      approval_requests: {
        Row: {
          created_at: string
          id: string
          invalidated_at: string | null
          requested_at: string
          responded_at: string | null
          reviewer_contact_text: string | null
          reviewer_display_name: string
          status: string
          updated_at: string
          version_id: string
          wedding_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          invalidated_at?: string | null
          requested_at?: string
          responded_at?: string | null
          reviewer_contact_text?: string | null
          reviewer_display_name: string
          status?: string
          updated_at?: string
          version_id: string
          wedding_id: string
        }
        Update: {
          created_at?: string
          id?: string
          invalidated_at?: string | null
          requested_at?: string
          responded_at?: string | null
          reviewer_contact_text?: string | null
          reviewer_display_name?: string
          status?: string
          updated_at?: string
          version_id?: string
          wedding_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "approval_requests_wedding_id_fkey"
            columns: ["wedding_id"]
            isOneToOne: false
            referencedRelation: "weddings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_requests_wedding_id_version_id_fkey"
            columns: ["wedding_id", "version_id"]
            isOneToOne: false
            referencedRelation: "invitation_versions"
            referencedColumns: ["wedding_id", "id"]
          },
        ]
      }
      design_templates: {
        Row: {
          created_at: string
          display_name: string
          id: string
          layout_settings: NonNullable<Json>
          preview_svg: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          revision: number
          status: string
          supported_languages: string[]
          template_key: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name: string
          id?: string
          layout_settings?: NonNullable<Json>
          preview_svg?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          revision: number
          status?: string
          supported_languages?: string[]
          template_key: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          layout_settings?: NonNullable<Json>
          preview_svg?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          revision?: number
          status?: string
          supported_languages?: string[]
          template_key?: string
          updated_at?: string
        }
        Relationships: []
      }
      entitlements: {
        Row: {
          created_at: string
          granted_at: string
          id: string
          metadata: Json | null
          package_code: string
          revoked_at: string | null
          source: string
          status: string
          updated_at: string
          wedding_id: string
        }
        Insert: {
          created_at?: string
          granted_at?: string
          id?: string
          metadata?: Json | null
          package_code: string
          revoked_at?: string | null
          source: string
          status?: string
          updated_at?: string
          wedding_id: string
        }
        Update: {
          created_at?: string
          granted_at?: string
          id?: string
          metadata?: Json | null
          package_code?: string
          revoked_at?: string | null
          source?: string
          status?: string
          updated_at?: string
          wedding_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "entitlements_wedding_id_fkey"
            columns: ["wedding_id"]
            isOneToOne: false
            referencedRelation: "weddings"
            referencedColumns: ["id"]
          },
        ]
      }
      guest_households: {
        Row: {
          created_at: string
          display_name: string
          expected_party_size: number | null
          host_notes: string | null
          id: string
          salutation: string | null
          updated_at: string
          wedding_id: string
        }
        Insert: {
          created_at?: string
          display_name: string
          expected_party_size?: number | null
          host_notes?: string | null
          id?: string
          salutation?: string | null
          updated_at?: string
          wedding_id: string
        }
        Update: {
          created_at?: string
          display_name?: string
          expected_party_size?: number | null
          host_notes?: string | null
          id?: string
          salutation?: string | null
          updated_at?: string
          wedding_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "guest_households_wedding_id_fkey"
            columns: ["wedding_id"]
            isOneToOne: false
            referencedRelation: "weddings"
            referencedColumns: ["id"]
          },
        ]
      }
      household_event_scopes: {
        Row: {
          created_at: string
          event_id: string
          household_id: string
          wedding_id: string
        }
        Insert: {
          created_at?: string
          event_id: string
          household_id: string
          wedding_id: string
        }
        Update: {
          created_at?: string
          event_id?: string
          household_id?: string
          wedding_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "household_event_scopes_wedding_id_event_id_fkey"
            columns: ["wedding_id", "event_id"]
            isOneToOne: false
            referencedRelation: "wedding_events"
            referencedColumns: ["wedding_id", "id"]
          },
          {
            foreignKeyName: "household_event_scopes_wedding_id_fkey"
            columns: ["wedding_id"]
            isOneToOne: false
            referencedRelation: "weddings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "household_event_scopes_wedding_id_household_id_fkey"
            columns: ["wedding_id", "household_id"]
            isOneToOne: false
            referencedRelation: "guest_households"
            referencedColumns: ["wedding_id", "id"]
          },
        ]
      }
      invitation_drafts: {
        Row: {
          content: NonNullable<Json>
          created_at: string
          id: string
          updated_at: string
          wedding_id: string
        }
        Insert: {
          content?: NonNullable<Json>
          created_at?: string
          id?: string
          updated_at?: string
          wedding_id: string
        }
        Update: {
          content?: NonNullable<Json>
          created_at?: string
          id?: string
          updated_at?: string
          wedding_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitation_drafts_wedding_id_fkey"
            columns: ["wedding_id"]
            isOneToOne: true
            referencedRelation: "weddings"
            referencedColumns: ["id"]
          },
        ]
      }
      invitation_outputs: {
        Row: {
          attempt_count: number
          content_digest: string | null
          created_at: string
          format: string
          id: string
          invalidated_at: string | null
          invalidation_reason: string | null
          last_error: string | null
          object_key: string
          output_kind: string
          page_number: number
          ready_at: string | null
          render_config_hash: string
          source_dto_digest: string
          status: string
          storage_domain: string
          target_url_digest: string | null
          updated_at: string
          variant: string
          version_id: string
          wedding_id: string
        }
        Insert: {
          attempt_count?: number
          content_digest?: string | null
          created_at?: string
          format: string
          id?: string
          invalidated_at?: string | null
          invalidation_reason?: string | null
          last_error?: string | null
          object_key: string
          output_kind: string
          page_number?: number
          ready_at?: string | null
          render_config_hash: string
          source_dto_digest: string
          status?: string
          storage_domain: string
          target_url_digest?: string | null
          updated_at?: string
          variant: string
          version_id: string
          wedding_id: string
        }
        Update: {
          attempt_count?: number
          content_digest?: string | null
          created_at?: string
          format?: string
          id?: string
          invalidated_at?: string | null
          invalidation_reason?: string | null
          last_error?: string | null
          object_key?: string
          output_kind?: string
          page_number?: number
          ready_at?: string | null
          render_config_hash?: string
          source_dto_digest?: string
          status?: string
          storage_domain?: string
          target_url_digest?: string | null
          updated_at?: string
          variant?: string
          version_id?: string
          wedding_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitation_outputs_wedding_id_fkey"
            columns: ["wedding_id"]
            isOneToOne: false
            referencedRelation: "weddings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitation_outputs_wedding_id_version_id_fkey"
            columns: ["wedding_id", "version_id"]
            isOneToOne: false
            referencedRelation: "invitation_versions"
            referencedColumns: ["wedding_id", "id"]
          },
        ]
      }
      invitation_versions: {
        Row: {
          created_at: string
          created_by: string
          design_template_id: string | null
          id: string
          snapshot: NonNullable<Json>
          snapshot_schema_version: number
          supersedes_version_id: string | null
          tradition_pack_release_id: string | null
          version_number: number
          wedding_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          design_template_id?: string | null
          id?: string
          snapshot: NonNullable<Json>
          snapshot_schema_version?: number
          supersedes_version_id?: string | null
          tradition_pack_release_id?: string | null
          version_number: number
          wedding_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          design_template_id?: string | null
          id?: string
          snapshot?: NonNullable<Json>
          snapshot_schema_version?: number
          supersedes_version_id?: string | null
          tradition_pack_release_id?: string | null
          version_number?: number
          wedding_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitation_versions_design_template_id_fkey"
            columns: ["design_template_id"]
            isOneToOne: false
            referencedRelation: "design_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitation_versions_tradition_pack_release_id_fkey"
            columns: ["tradition_pack_release_id"]
            isOneToOne: false
            referencedRelation: "tradition_pack_releases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitation_versions_wedding_id_fkey"
            columns: ["wedding_id"]
            isOneToOne: false
            referencedRelation: "weddings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitation_versions_wedding_id_supersedes_version_id_fkey"
            columns: ["wedding_id", "supersedes_version_id"]
            isOneToOne: false
            referencedRelation: "invitation_versions"
            referencedColumns: ["wedding_id", "id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          id: string
          language_pref: string | null
          last_login: string | null
          name: string | null
          phone: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          language_pref?: string | null
          last_login?: string | null
          name?: string | null
          phone?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          language_pref?: string | null
          last_login?: string | null
          name?: string | null
          phone?: string | null
          user_id?: string
        }
        Relationships: []
      }
      publications: {
        Row: {
          created_at: string
          id: string
          published_at: string
          revoked_at: string | null
          status: string
          updated_at: string
          version_id: string
          wedding_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          published_at?: string
          revoked_at?: string | null
          status: string
          updated_at?: string
          version_id: string
          wedding_id: string
        }
        Update: {
          created_at?: string
          id?: string
          published_at?: string
          revoked_at?: string | null
          status?: string
          updated_at?: string
          version_id?: string
          wedding_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "publications_wedding_id_fkey"
            columns: ["wedding_id"]
            isOneToOne: false
            referencedRelation: "weddings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publications_wedding_id_version_id_fkey"
            columns: ["wedding_id", "version_id"]
            isOneToOne: false
            referencedRelation: "invitation_versions"
            referencedColumns: ["wedding_id", "id"]
          },
        ]
      }
      rsvp_responses: {
        Row: {
          answers: NonNullable<Json>
          attending: string
          created_at: string
          event_id: string
          household_id: string
          id: string
          party_size: number
          responded_at: string
          response_source: string
          updated_at: string
          wedding_id: string
        }
        Insert: {
          answers?: NonNullable<Json>
          attending: string
          created_at?: string
          event_id: string
          household_id: string
          id?: string
          party_size?: number
          responded_at?: string
          response_source: string
          updated_at?: string
          wedding_id: string
        }
        Update: {
          answers?: NonNullable<Json>
          attending?: string
          created_at?: string
          event_id?: string
          household_id?: string
          id?: string
          party_size?: number
          responded_at?: string
          response_source?: string
          updated_at?: string
          wedding_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rsvp_responses_wedding_id_fkey"
            columns: ["wedding_id"]
            isOneToOne: false
            referencedRelation: "weddings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rsvp_responses_wedding_id_household_id_event_id_fkey"
            columns: ["wedding_id", "household_id", "event_id"]
            isOneToOne: true
            referencedRelation: "household_event_scopes"
            referencedColumns: ["wedding_id", "household_id", "event_id"]
          },
        ]
      }
      tradition_pack_releases: {
        Row: {
          approved_at: string | null
          author_label: string
          changelog: string | null
          created_at: string
          definition: NonNullable<Json>
          definition_schema_version: number
          deprecated_at: string | null
          id: string
          languages: string[]
          machine_assistance_notes: string | null
          machine_assisted: boolean
          pack_id: string
          release_number: number
          review_basis: string | null
          review_label: string | null
          review_packet_hash: string | null
          review_scope: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          reviewed_languages: string[] | null
          source_reference: string | null
          status: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          author_label: string
          changelog?: string | null
          created_at?: string
          definition: NonNullable<Json>
          definition_schema_version: number
          deprecated_at?: string | null
          id?: string
          languages: string[]
          machine_assistance_notes?: string | null
          machine_assisted?: boolean
          pack_id: string
          release_number: number
          review_basis?: string | null
          review_label?: string | null
          review_packet_hash?: string | null
          review_scope?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewed_languages?: string[] | null
          source_reference?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          author_label?: string
          changelog?: string | null
          created_at?: string
          definition?: NonNullable<Json>
          definition_schema_version?: number
          deprecated_at?: string | null
          id?: string
          languages?: string[]
          machine_assistance_notes?: string | null
          machine_assisted?: boolean
          pack_id?: string
          release_number?: number
          review_basis?: string | null
          review_label?: string | null
          review_packet_hash?: string | null
          review_scope?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewed_languages?: string[] | null
          source_reference?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tradition_pack_releases_pack_id_fkey"
            columns: ["pack_id"]
            isOneToOne: false
            referencedRelation: "tradition_packs"
            referencedColumns: ["id"]
          },
        ]
      }
      tradition_packs: {
        Row: {
          created_at: string
          display_name: string
          id: string
          pack_key: string
          scope_statement: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name: string
          id?: string
          pack_key: string
          scope_statement: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          pack_key?: string
          scope_statement?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      venues: {
        Row: {
          address_text: string | null
          created_at: string
          id: string
          latitude: number | null
          longitude: number | null
          map_url: string | null
          name: string
          notes: string | null
          updated_at: string
          wedding_id: string
        }
        Insert: {
          address_text?: string | null
          created_at?: string
          id?: string
          latitude?: number | null
          longitude?: number | null
          map_url?: string | null
          name: string
          notes?: string | null
          updated_at?: string
          wedding_id: string
        }
        Update: {
          address_text?: string | null
          created_at?: string
          id?: string
          latitude?: number | null
          longitude?: number | null
          map_url?: string | null
          name?: string
          notes?: string | null
          updated_at?: string
          wedding_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venues_wedding_id_fkey"
            columns: ["wedding_id"]
            isOneToOne: false
            referencedRelation: "weddings"
            referencedColumns: ["id"]
          },
        ]
      }
      wedding_assets: {
        Row: {
          asset_kind: string
          created_at: string
          id: string
          is_generated: boolean
          label: string | null
          mime_type: string | null
          object_key: string
          size_bytes: number | null
          updated_at: string
          upload_status: string
          wedding_id: string
        }
        Insert: {
          asset_kind: string
          created_at?: string
          id?: string
          is_generated?: boolean
          label?: string | null
          mime_type?: string | null
          object_key: string
          size_bytes?: number | null
          updated_at?: string
          upload_status?: string
          wedding_id: string
        }
        Update: {
          asset_kind?: string
          created_at?: string
          id?: string
          is_generated?: boolean
          label?: string | null
          mime_type?: string | null
          object_key?: string
          size_bytes?: number | null
          updated_at?: string
          upload_status?: string
          wedding_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wedding_assets_wedding_id_fkey"
            columns: ["wedding_id"]
            isOneToOne: false
            referencedRelation: "weddings"
            referencedColumns: ["id"]
          },
        ]
      }
      wedding_events: {
        Row: {
          created_at: string
          display_name: string
          display_order: number
          enabled: boolean
          ends_at_local: string | null
          event_key: string
          id: string
          notes: string | null
          starts_at_local: string
          timezone: string
          updated_at: string
          venue_id: string | null
          wedding_id: string
        }
        Insert: {
          created_at?: string
          display_name: string
          display_order?: number
          enabled?: boolean
          ends_at_local?: string | null
          event_key: string
          id?: string
          notes?: string | null
          starts_at_local: string
          timezone?: string
          updated_at?: string
          venue_id?: string | null
          wedding_id: string
        }
        Update: {
          created_at?: string
          display_name?: string
          display_order?: number
          enabled?: boolean
          ends_at_local?: string | null
          event_key?: string
          id?: string
          notes?: string | null
          starts_at_local?: string
          timezone?: string
          updated_at?: string
          venue_id?: string | null
          wedding_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wedding_events_wedding_id_fkey"
            columns: ["wedding_id"]
            isOneToOne: false
            referencedRelation: "weddings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wedding_events_wedding_id_venue_id_fkey"
            columns: ["wedding_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["wedding_id", "id"]
          },
        ]
      }
      wedding_people: {
        Row: {
          created_at: string
          display_name: string
          display_order: number
          group_key: string | null
          group_label: string | null
          id: string
          role_key: string
          role_label: string | null
          updated_at: string
          wedding_id: string
        }
        Insert: {
          created_at?: string
          display_name: string
          display_order?: number
          group_key?: string | null
          group_label?: string | null
          id?: string
          role_key: string
          role_label?: string | null
          updated_at?: string
          wedding_id: string
        }
        Update: {
          created_at?: string
          display_name?: string
          display_order?: number
          group_key?: string | null
          group_label?: string | null
          id?: string
          role_key?: string
          role_label?: string | null
          updated_at?: string
          wedding_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wedding_people_wedding_id_fkey"
            columns: ["wedding_id"]
            isOneToOne: false
            referencedRelation: "weddings"
            referencedColumns: ["id"]
          },
        ]
      }
      weddings: {
        Row: {
          additional_languages: string[]
          created_at: string
          design_template_id: string | null
          estimated_guest_count: number
          id: string
          lifecycle_status: string
          owner_user_id: string
          primary_language: string | null
          style_settings: NonNullable<Json>
          title: string
          tradition_pack_release_id: string | null
          updated_at: string
        }
        Insert: {
          additional_languages?: string[]
          created_at?: string
          design_template_id?: string | null
          estimated_guest_count?: number
          id?: string
          lifecycle_status?: string
          owner_user_id: string
          primary_language?: string | null
          style_settings?: NonNullable<Json>
          title: string
          tradition_pack_release_id?: string | null
          updated_at?: string
        }
        Update: {
          additional_languages?: string[]
          created_at?: string
          design_template_id?: string | null
          estimated_guest_count?: number
          id?: string
          lifecycle_status?: string
          owner_user_id?: string
          primary_language?: string | null
          style_settings?: NonNullable<Json>
          title?: string
          tradition_pack_release_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "weddings_design_template_id_fkey"
            columns: ["design_template_id"]
            isOneToOne: false
            referencedRelation: "design_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weddings_tradition_pack_release_id_fkey"
            columns: ["tradition_pack_release_id"]
            isOneToOne: false
            referencedRelation: "tradition_pack_releases"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      app_role: "admin" | "user" | "planner"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  api: {
    Enums: {},
  },
  public: {
    Enums: {
      app_role: ["admin", "user", "planner"],
    },
  },
} as const
