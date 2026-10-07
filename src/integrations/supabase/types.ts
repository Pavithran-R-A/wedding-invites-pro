// Database types for the canonical Stage 5 schema: the RLS-governed tables in `public`,
// and the eight browser-callable RPCs in `api`.
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
// `internal_api.tradition_pack_*` functions are in no schema this file describes, because
// `--schema` names only `public` and `api`, and a type that named a function no browser may
// execute would advertise a door that is shut.
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
      create_invitation_version: {
        Args: { p_wedding_id: string }
        Returns: Json
      }
      get_invitation_publication_state: {
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
      resolve_public_invitation: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      revoke_invitation_publication: {
        Args: { p_wedding_id: string }
        Returns: Json
      }
      rotate_invitation_token: { Args: { p_wedding_id: string }; Returns: Json }
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
