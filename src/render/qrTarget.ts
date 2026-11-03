// The QR door: what a printed address is allowed to look like.
//
// §9.3 exists because a QR on a poster, a sweet box or a printed card is read by whoever holds the
// paper. The invitation's own guest page has a `/i/` address that is public by construction — that is
// what `internal_api.publish_wedding` mints and what the guest door answers — while `/g/` opens a
// household's door (its salutation, expected party size and RSVP state are behind
// `api.resolve_guest_invitation`) and `/r/` opens a relative's review door. A general-purpose printed
// artefact must carry the first and never the other two, so this module is a whitelist rather than a
// blacklist: it accepts one path shape on an `https` origin and refuses everything else by name.
//
// Order is part of the contract, because the reason strings are what a worker logs and a manifest
// stores (§11.5), and a guest's `https://…/g/short` typed into the wrong slot should be reported as
// the door violation it is rather than as a malformed token:
//
//   1. not a string — nothing else can be a URL, and `String(value)` would turn `{}` into a path;
//   2. unparsable — `new URL` throws before any of the below can be asked of it;
//   3. not `https:` — including `http:`, `file:`, `ftp:` and `javascript:`;
//   4. carries credentials — `user:pass@` survives serialisation, so a printed sheet would print it;
//   5. carries a query or fragment — a tracking parameter on paper is a second channel of information
//      leaving the guest who scans it, and a fragment is a client-side route that the invitation's own
//      page does not use;
//   6. origin is not public — a literal IP address, `localhost`, an mDNS `.local` name: those resolve
//      on somebody's laptop and nowhere else, and a wedding card outlives the laptop;
//   7. a private door — `/g/` and `/r/` are refused before the token shape is considered, so a
//      truncated household credential cannot be reported as "not a valid invitation token";
//   8. path shape — `PUBLIC_INVITATION_PATH`, the same 43-character base64url alphabet the guest
//      page's own client parser requires (`src/integrations/supabase/publicInvitation.ts:42`).
//
// The value returned is `url.href`, not the caller's string. That is deliberate twice over: the
// address the encoder draws and the address the manifest digests (§7.2) become one canonical thing,
// and anything `URL` can normalise away — an upper-case host, a default port, an IDN label folded to
// punycode, a `%00` — is normalised before it reaches paper.
//
// What this door does not decide is which host belongs to this deployment. That is the worker's:
// §6 gives it a DTO from an explicitly authorized source and the address is composed from its own
// configuration, so a copy of that policy here would either disagree with the app or be fed by an
// environment variable nobody audits. A wrong-but-well-shaped host is caught where it is visible —
// the manifest's target digest and the output sweep that reads a printed QR back — and
// `src/render/qrTarget.test.ts` asserts that division rather than pretending it away.

/** The one path a printed invitation may carry: `/i/` then a 43-character base64url credential. */
export const PUBLIC_INVITATION_PATH = /^\/i\/[A-Za-z0-9_-]{43}$/;

/** The two doors that are never printed: a household's guest link and a relative's review link.
 *  Exported because the host's response contract has to route the same two prefixes: a crawler that
 *  is told `noindex` about `/i/` by one module while another module forgets `/g/` and `/r/` is a
 *  privacy posture that exists only in one of the two runtimes. Keeping the list here means the
 *  printing door and the serving door cannot drift into two vocabularies for "private address". */
export const PRIVATE_DOOR_PREFIXES = ["/g/", "/r/"];

/** Why the door closed. A fixed vocabulary — a reason is a fact about this module, not a quote from
 *  the caller, because it ends up in a log line and a manifest column. */
export type QrTargetRefusal =
  | "target-not-a-string"
  | "target-unparsable"
  | "target-not-https"
  | "target-carries-credentials"
  | "target-carries-query"
  | "target-origin-not-public"
  | "target-private-door"
  | "target-path-shape";

export const QR_TARGET_REFUSALS: readonly QrTargetRefusal[] = [
  "target-not-a-string",
  "target-unparsable",
  "target-not-https",
  "target-carries-credentials",
  "target-carries-query",
  "target-origin-not-public",
  "target-private-door",
  "target-path-shape",
];

export type QrTargetOutcome =
  | { ok: true; url: string }
  | { ok: false; reason: QrTargetRefusal };

const refused = (reason: QrTargetRefusal): QrTargetOutcome => ({ ok: false, reason });

/**
 * An address that cannot resolve on a guest's phone is not printable, whatever its path says.
 *
 * Every literal is refused, not only the loopback ones: an IPv4 or IPv6 literal cannot be a public
 * wedding address in the sense that matters (a name a scanner's browser can still look up in six
 * months), and refusing the whole class costs nothing while naming `127.0.0.1` alone would leave
 * `192.168.x.x` — the address a local run actually prints if a worker is pointed at a LAN host —
 * through. `URL` has already folded a single-number host into dotted form, so this sees literals,
 * not spellings.
 */
const isPrivateOrigin = (hostname: string): boolean => {
  const host = hostname.toLowerCase();
  if (host.startsWith("[")) return true; // bracketed IPv6, including `[::1]`
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true; // IPv4 literal, including `0.0.0.0`
  if (/^\d+$/.test(host)) return true; // the numeric form `URL` accepts for `127.1`
  if (!host.includes(".")) return true; // `localhost` and any single-label name
  return host.endsWith(".local") || host.endsWith(".localhost"); // mDNS: this room only
};

/**
 * The origin half of the ladder, in one place.
 *
 * `buildQrTarget` needs it because a printed plate that points at a laptop is a broken plate, and
 * `scripts/deploy-pages.mjs` needs it because a *deployed* host whose browser talks to a machine on
 * someone's desk is the same defect with a public URL in front of it. A second copy of the rule
 * would be a second answer to "is this origin reachable by a guest", and the two would drift in the
 * direction that matters — the one where a tool starts accepting what the printer refuses.
 */
const originOutcome = (value: unknown): { url: URL } | { reason: QrTargetRefusal } => {
  if (typeof value !== "string") return { reason: "target-not-a-string" };

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { reason: "target-unparsable" };
  }

  if (url.protocol !== "https:") return { reason: "target-not-https" };
  if (url.username !== "" || url.password !== "") return { reason: "target-carries-credentials" };
  if (url.search !== "" || url.hash !== "") return { reason: "target-carries-query" };
  if (isPrivateOrigin(url.hostname)) return { reason: "target-origin-not-public" };

  return { url };
};

/**
 * The origin rule alone, named by refusal: `null` for an `https` origin with no credentials, no
 * query, and a hostname a guest's phone could actually resolve. The two path-shaped refusals
 * (`target-private-door`, `target-path-shape`) are deliberately absent — they belong to a printed
 * invitation address, and a database origin has no business carrying either.
 */
export function originRefusal(value: unknown): QrTargetRefusal | null {
  const outcome = originOutcome(value);
  return "reason" in outcome ? outcome.reason : null;
}

/**
 * Read a printable invitation address, or refuse it by rule name.
 *
 * Total and side-effect-free: nothing here fetches, and nothing here throws on hostile input — the
 * two properties that let the same function answer both the harness in a browser and the unit
 * battery in a Node process, and the reason the QR's destination is never probed on the way to being
 * printed (§11.1: the render pipeline requests nothing).
 */
export function buildQrTarget(value: unknown): QrTargetOutcome {
  const origin = originOutcome(value);
  if ("reason" in origin) return refused(origin.reason);
  const { url } = origin;

  if (PRIVATE_DOOR_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
    return refused("target-private-door");
  }
  if (!PUBLIC_INVITATION_PATH.test(url.pathname)) return refused("target-path-shape");

  return { ok: true, url: url.href };
}
