# V1 scope freeze

**Status: target, not implementation.** Nothing in the journey below exists end to end today. The
preview build supports sign-up, draft creation, a planning guest count and a styling preview — see
[`feature-readiness.md`](feature-readiness.md) for the per-capability truth.

V1 is one loop, done properly: a couple builds a real multi-event, multi-language invitation,
their family approves it, guests open it on a phone and reply, and the couple can publish and
share it without leaving the product. Everything that does not serve that loop waits.

## Target host journey

```text
sign up
→ create wedding
→ choose tradition/design
→ couple/family
→ events/functions
→ venues
→ wording
→ preview
→ family approval
→ guest households
→ personalisation/scoping
→ full preview
→ payment where required
→ publish
→ share
→ RSVP
→ export
```

Each step is a deliberate reduction of a real-world chore. "Family approval" exists because in the
target market an invitation is rarely a solo decision — an elder has to read it and say yes.
"Personalisation/scoping" exists because one wedding invites many different subsets of people to
different functions, and doing that by hand is where paper invitations currently win.

"Payment where required" is conditional on purpose: payment unlocks publishing and premium human
help, never the ability to be seen by your own guests.

## Target guest journey

```text
tap link
→ fast invitation
→ personalised greeting
→ correct events
→ maps
→ optional RSVP
→ exit
```

- **No account.** A guest never registers to read an invitation.
- **No install.** No app store, no APK, no "open in our app to continue".
- **Fast** is a feature requirement, not a nice-to-have: the guest typically opens the link in a
  chat app's in-app browser, on a mid-range Android phone, sometimes on a weak connection.
- **Exit** is legitimate. A guest who only wanted the venue location should be able to get it and
  leave without being funneled into anything.

## Explicit V1 IN

| Area | In V1 because |
| --- | --- |
| Wedding identity | One durable object the whole product hangs off |
| Hosts / couple | Who is issuing, and whose names appear |
| Family / elders | The names and blessings that make it acceptable to relatives |
| Multi-event | Real South-Indian weddings have several functions |
| Venues / maps | The single most-used piece of information in an invitation |
| Language | One chosen regional language plus English, user-selected |
| Invitation versions | Approval and publication must bind to something immutable |
| Approval | Family review is the product's social unit |
| Households | The unit a guest link is actually addressed to |
| Event scopes | Different guests, different functions |
| RSVP | The reason to send digitally instead of on paper |
| Manual RSVP | Phone-call replies are real; a host must be able to record them |
| URL publishing | The shareable artefact |
| OG preview | A link in WhatsApp must render as the invitation |
| QR | Same invitation, printable/at-the-venue path |
| Image output | For family groups that expect a picture |
| PDF output | For elders and for print |
| Payment entitlement | Server-side, only where it buys a real capability |
| Basic operations/admin | Support, refunds, takedowns, incident response |
| Deletion / privacy | Guests' data must be removable on request |

## Explicit V1 OUT

| Excluded | Why |
| --- | --- |
| Canva-style design tool | We compete on correctness and acceptance, not on free-form canvas |
| Wedding planner super-app | Budgets, vendors, checklists and task management are a different product |
| Seating planner | High effort, low leverage on the moment the product is judged by |
| Travel management | Guests plan travel elsewhere; a map link covers our share |
| Vendor marketplace | Requires two-sided supply and trust we cannot earn in V1 |
| B2B marketplace / bulk reseller | Deferred until single-host demand is proven |
| Social network | No feeds, no following, no network effects as a feature |
| Per-guest sharing fee | Charging a host to be received by their own guests is hostile |
| Mandatory messaging automation | WhatsApp broadcast and phone calls already exist |
| Video as a dependency | Optional later; the product must not require rendering video to work |
| Automatic caste / religion inference | See [`content-governance.md`](content-governance.md) — never derived from identity |
| Unreviewed AI ceremonial translation | Devotional and ceremonial wording needs human review |

## The test for anything new

A proposal belongs in V1 only if it makes at least one of these strictly better:

1. the emotional quality of the invitation document,
2. whether a family will approve sending it,
3. correctness in the chosen language,
4. the guest's phone experience,
5. how little work creation is.

If it only adds revenue surface, or only impresses a reviewer on desktop, it is out.
