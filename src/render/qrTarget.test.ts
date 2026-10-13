// The QR door: what a printed address is allowed to look like.
//
// §9.3 of the approved design is a privacy rule wearing the clothes of a validation rule. A
// `guest_invitation` (`/g/`) credential carries a family's salutation, expected party size and RSVP
// state through `api.resolve_guest_invitation`, and an `approval_review` (`/r/`) credential opens a
// relative's review door. Neither belongs on general-purpose printed material: a QR on a poster, a
// sweet box or a wedding card is read by whoever holds the paper, and the design's ADR 0004 `:69`
// boundary is exactly that a shared artefact must not carry a personalised door. Meanwhile
// `private.access_tokens` stores only a digest, so nothing can *reconstruct* an address — the QR is
// rendered from one a session already legitimately holds (§9.1), which makes "what may this
// generator be handed?" the whole of the question.
//
// So the answer is a whitelist, not a blacklist, and the tests below are the whitelist: an absolute
// `https` address on a public origin, with no query, no fragment, no credentials, and a pathname
// matching `/^\/i\/[A-Za-z0-9_-]{43}$/` — the same shape the guest page's own client parser demands
// of a token (`src/integrations/supabase/publicInvitation.ts:42`, `TOKEN_SHAPE`). Everything else is
// refused, and each refusal is a *named rule* rather than the caller's bytes, because the reason
// string is what lands in a worker's log line and a manifest column (§11.5).
//
// Two things this file deliberately does not do: it never fetches the address (nothing in the render
// pipeline requests it — §11.1, and `connect-src 'none'` in `render.html` makes the attempt a policy
// failure rather than a promise), and it does not vouch that the address *works*. Whether the token
// is live is the publication table's business; this door only decides whether the string is printable
// at all.
//
// Every token below is synthetic — forty-three characters typed by hand, not issued by a stack.

import { describe, expect, it } from "vitest";
import { buildQrTarget, QR_TARGET_REFUSALS, PUBLIC_INVITATION_PATH } from "./qrTarget";

const TOKEN = "Wm3vYq8ZkR2nT7xLpA4sDf6gHj9klNbPcQeRtYuiOpa"; // 43 characters, URL-safe
const PATH = `/i/${TOKEN}`;
const ORIGIN = "https://vivaahvarnam.in";

const tokenOf = (length: number, fill = "A") => fill.repeat(length);

describe("PUBLIC_INVITATION_PATH", () => {
  it("is the design's §9.3 shape: a leading /i/, then exactly 43 URL-safe characters", () => {
    expect(PUBLIC_INVITATION_PATH.test(PATH)).toBe(true);
    // The alphabet is the base64url set the mint function writes: letters, digits, `-` and `_`.
    for (const sample of ["a", "Z", "0", "-", "_"]) {
      expect(PUBLIC_INVITATION_PATH.test(`/i/${sample.repeat(43)}`)).toBe(true);
    }
  });

  it("refuses a token one character either side of 43", () => {
    // The abnormal value is the one that matters: a 42- or 44-character string is a truncated or
    // padded credential, and printing either is a QR that answers nothing.
    expect(PUBLIC_INVITATION_PATH.test(`/i/${tokenOf(42)}`)).toBe(false);
    expect(PUBLIC_INVITATION_PATH.test(`/i/${tokenOf(44)}`)).toBe(false);
    expect(PUBLIC_INVITATION_PATH.test(`/i/${tokenOf(0)}`)).toBe(false);
  });

  it("refuses a character outside the minted alphabet, including one that would escape the path", () => {
    for (const bad of [".", "%", "/", "?", "#", "&", "=", "+", " ", "்"]) {
      expect(PUBLIC_INVITATION_PATH.test(`/i/${tokenOf(42)}${bad}`)).toBe(false);
    }
  });

  it("is anchored at both ends", () => {
    expect(PUBLIC_INVITATION_PATH.test(`/i/${tokenOf(43)}trailing`)).toBe(false);
    expect(PUBLIC_INVITATION_PATH.test(`/ii/${tokenOf(43)}`)).toBe(false);
    expect(PUBLIC_INVITATION_PATH.test(`i/${tokenOf(43)}`)).toBe(false);
  });
});

describe("buildQrTarget", () => {
  it("accepts a public https invitation address and hands back the address it was given", () => {
    const outcome = buildQrTarget(`${ORIGIN}${PATH}`);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.url).toBe(`${ORIGIN}${PATH}`);
  });

  it("accepts a port and a subdomain, because neither is a path", () => {
    for (const target of ["https://wedding.vivaahvarnam.in" + PATH, "https://vivaahvarnam.in:8443" + PATH]) {
      expect(buildQrTarget(target).ok).toBe(true);
    }
  });

  it("refuses the two private doors by name, whatever they carry", () => {
    // The named refusal is the point: §9.3 says a household or reviewer address must not reach a
    // printed sheet *even by accident*, and a worker that sees `target-private-door` can say so in
    // the UI instead of reporting a malformed link.
    for (const door of ["/g/", "/r/"]) {
      const outcome = buildQrTarget(`${ORIGIN}${door}${tokenOf(43)}`);
      expect(outcome.ok).toBe(false);
      if (outcome.ok === false) expect(outcome.reason).toBe("target-private-door");
    }
    // A short or malformed household address is still a household address: the door prefix is
    // checked before the token shape, so a typo cannot downgrade the refusal to "unrecognised".
    const shortGuestDoor = buildQrTarget(`${ORIGIN}/g/short`);
    expect(shortGuestDoor.ok).toBe(false);
    if (shortGuestDoor.ok === false) expect(shortGuestDoor.reason).toBe("target-private-door");
  });

  it("canonicalises the host, because the printed bytes are the serialised URL and not the typed one", () => {
    // What gets printed is what a scanner reads. `URL` lowercases the host, drops a default port,
    // punycodes a non-ASCII one and keeps a non-default port, so the returned string is the one whose
    // digest the manifest records (§7.2's `target_url_digest`) — pinning it here is what stops "we
    // encoded what we were handed" from becoming "we encoded what the caller's clipboard happened to
    // contain". The IDN row matters twice over: it is a §4 Indic case (a host label in Devanagari is
    // legal) and it is the reason the encoder never sees a multibyte address, since the serialised
    // host is ASCII. Measured in `q9-logs/qr-scratch/s9-qr-url-serialisation.txt`.
    const cases: Array<[string, string]> = [
      [`https://VIVAahvarnam.IN${PATH}`, `${ORIGIN}${PATH}`],
      [`https://vivaahvarnam.in:443${PATH}`, `${ORIGIN}${PATH}`],
      [`https://vivaahvarnam.in:8443${PATH}`, `https://vivaahvarnam.in:8443${PATH}`],
      [
        `https://विवাহ-varnam.in${PATH}`,
        `https://xn---varnam-rtoa3hx0eyb.in${PATH}`,
      ],
    ];
    for (const [typed, printed] of cases) {
      const outcome = buildQrTarget(typed);
      expect(outcome.ok, typed).toBe(true);
      if (outcome.ok) expect(outcome.url, typed).toBe(printed);
    }
  });

  it("refuses every address that is not an https URL, and says which rule fired", () => {
    const cases: Array<[string, string]> = [
      ["not a url at all", "target-unparsable"],
      ["", "target-unparsable"],
      ["/i/short", "target-unparsable"],
      [`http://vivaahvarnam.in${PATH}`, "target-not-https"],
      [`ftp://vivaahvarnam.in${PATH}`, "target-not-https"],
      [`file:///C:/wedding${PATH}`, "target-not-https"],
      [`https://user:pass@vivaahvarnam.in${PATH}`, "target-carries-credentials"],
      [`https://vivaahvarnam.in${PATH}?utm=print`, "target-carries-query"],
      [`https://vivaahvarnam.in${PATH}#hall`, "target-carries-query"],
      [`https://vivaahvarnam.in/weddings${PATH}`, "target-path-shape"],
      [`https://vivaahvarnam.in${PATH}/extra`, "target-path-shape"],
      [`https://vivaahvarnam.in/i/${tokenOf(42)}`, "target-path-shape"],
    ];
    for (const [target, reason] of cases) {
      const outcome = buildQrTarget(target);
      expect(outcome.ok).toBe(false);
      if (outcome.ok === false) expect(outcome.reason, target).toBe(reason);
    }
  });

  it("refuses a non-string without throwing", () => {
    for (const value of [null, undefined, 42, true, {}, [], [PATH]]) {
      const outcome = buildQrTarget(value);
      expect(outcome.ok).toBe(false);
      if (outcome.ok === false) expect(outcome.reason).toBe("target-not-a-string");
    }
  });

  it("refuses an address that points at this machine rather than at the web", () => {
    // A loopback QR is not a security hole — it is a worse outcome than a refusal: paper that prints
    // and then resolves to nothing on the guest's phone. `https://127.0.0.1` is a real thing a local
    // run can produce, so it is refused by name instead of being silently encoded.
    const loopback = [
      "https://localhost" + PATH,
      "https://127.0.0.1" + PATH,
      "https://127.127.127.127" + PATH,
      "https://[::1]" + PATH,
      "https://0.0.0.0" + PATH,
      "https://vivaahvarnam.local" + PATH,
    ];
    expect(loopback.length).toBeGreaterThan(0); // a loop that runs zero times would pass vacuously
    for (const target of loopback) {
      const outcome = buildQrTarget(target);
      expect(outcome.ok).toBe(false);
      if (outcome.ok === false) expect(outcome.reason, target).toBe("target-origin-not-public");
    }
  });

  it("names a rule and never repeats what it was handed", () => {
    // The reason ends up in a log line. An echoed value would put a caller's bytes in an operator's
    // terminal, which is the same reason the network instrument masks token-shaped strings
    // (`scripts/stage5-network-privacy.mjs:144-148`).
    const hostile = `https://vivaahvarnam.in/i/${TOKEN}<script>alert("evil.example")</script>`;
    const outcomes = [
      buildQrTarget(hostile),
      buildQrTarget(`${ORIGIN}/g/${TOKEN}`),
      buildQrTarget(`https://user:pass@vivaahvarnam.in/i/${tokenOf(43)}`),
    ];
    for (const outcome of outcomes) {
      expect(outcome.ok).toBe(false);
      if (outcome.ok === false) {
        expect(QR_TARGET_REFUSALS).toContain(outcome.reason);
        expect(outcome.reason).not.toContain("evil");
        expect(outcome.reason).not.toContain("script");
        expect(outcome.reason).not.toContain("user");
        expect(outcome.reason).not.toContain(TOKEN);
      }
    }
  });

  it("does not decide which host is ours, and that is a stated limit rather than a hole", () => {
    // §9.3's rule is about *doors*: a printed address must be the public `/i/` one and never a
    // household's or a reviewer's. Which origin the deployment publishes from is the worker's
    // business — §6 gives it the DTO "from an explicitly authorized source", and the address it hands
    // over is the one it composed from its own configuration, so a second copy of that policy inside
    // the harness would either disagree with the app or be fed by an environment variable nobody
    // audits. The failure this leaves open is a misconfigured operator, and it is caught where it is
    // visible: the manifest records the target's digest (§7.2) and the output sweep (§12) reads the
    // printed QR back and compares it against the published address. Asserting the acceptance here
    // keeps that division on the record instead of implying a guard this door does not have.
    const outcome = buildQrTarget(`https://evil.example${PATH}`);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.url).toBe(`https://evil.example${PATH}`);
    // What it *does* catch on the same host is everything §9.3 names: the two private doors, a wrong
    // path, a query, and an address that cannot resolve from a guest's phone at all.
    for (const refused of [
      `https://evil.example/g/${tokenOf(43)}`,
      `https://evil.example/i/${tokenOf(42)}`,
      `https://evil.example${PATH}?ref=print`,
    ]) {
      expect(buildQrTarget(refused).ok, refused).toBe(false);
    }
  });

  it("keeps the refusal vocabulary closed, so a worker can map every answer to words", () => {
    // A reason outside this list is a bug in this file, not a value from the caller.
    expect([...QR_TARGET_REFUSALS].sort()).toEqual(
      [
        "target-carries-query",
        "target-not-a-string",
        "target-not-https",
        "target-origin-not-public",
        "target-path-shape",
        "target-private-door",
        "target-unparsable",
        "target-carries-credentials",
      ].sort(),
    );
  });
});
