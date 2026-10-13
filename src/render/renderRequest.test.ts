// The render harness's front door.
//
// `render.html` is a document that draws a wedding invitation for a machine, in a browser
// context that a local operator controls, from a value somebody hands it. The approved design
// (`docs/superpowers/specs/2026-10-13-stage9-render-exports-design.md` §11.1) makes one promise
// about that value: *the harness never accepts HTML, a file path, a remote URL, a font name or a
// stylesheet as input — there is no such parameter in its interface, and the DTO is injected as a
// value rather than fetched.* This file is where that promise is either true or a slogan, so the
// tests below are all about what the harness does with a shape it was not taught.
//
// Four properties, each with a case that would break it:
//
//   * **Two fields per branch, not zero.** A document request carries exactly a surface and a
//     document; a plate request carries exactly a surface, a box and an address. A stray `html` /
//     `stylesheet` / `scriptUrl` / `font` key is dropped rather than honoured — and dropped *before*
//     the renderer sees it, because the renderer's own guards are about host text, not about an
//     input channel that should never have carried a font name at all.
//   * **Nothing is dereferenced.** §11.1's "never accepts … a remote URL" is about an *asset*: the
//     harness has no parameter that makes it load, open or fetch anything. The plate branch does
//     take an address, because drawing a QR code is a function of a string, not a request for it —
//     the value is put through `./qrTarget` and painted as modules. That is why the distinction is
//     asserted here rather than argued: a `qr` request accepts one field, refuses eight shapes of
//     address by rule name, and never reaches the network that `render.html`'s `connect-src 'none'`
//     already closes.
//   * **The document is the parser's output, not the caller's.** The same
//     `parseInvitationObject` a guest's page goes through, so a document a guest cannot be shown
//     is a document that cannot be printed.
//   * **A refusal names a rule, never a value.** The reason string is what a worker writes into
//     a log and a manifest, so an echoed input would put an attacker's bytes into the operator's
//     terminal — and this repository already masks token-shaped strings for exactly that reason
//     (`scripts/stage5-network-privacy.mjs:144-148`).
//
// One stylistic note so nobody "simplifies" it back: the refusals below are read with
// `if (outcome.ok === false)`, never `if (!outcome.ok)`. `tsconfig.app.json` runs with `strict:
// false`, so `strictNullChecks` is off, and a boolean discriminant does not narrow the union under
// that setting — measured, not remembered: the `!` form compiles to "Property 'reason' does not
// exist on type …" while `=== false` narrows both branches. The same comparison is used in
// `src/render/main.tsx`, where a `!` would have been a *runtime* no-op but a type error, so the
// rule is not a test-file quirk.

import { describe, expect, it } from "vitest";
import { parseRenderRequest, RENDER_REFUSAL_REASONS, type RenderOutcome } from "./renderRequest";
import { DOCUMENT_SURFACES, QR_SURFACE } from "@/lib/renderSurfaces";
import {
  QR_MINIMUM_MODULE_SCALE_PIXELS,
  QR_PRINT_BOX_PIXELS,
  QR_QUIET_ZONE_MODULES,
  QR_VARIANTS,
} from "./qrPlate";
import { parseInvitationObject } from "@/lib/publicInvitation";
import { guestInvitation, guestInvitationPacked, guestInvitationV1 } from "@/test/invitationFixture";

/** One real, shaped public address: `https` + a public host + `/i/` + a 43-character token (§9.3).
 *  Mixed case on purpose — a lowercase-only sample lets the encoder use a denser-packing mode and
 *  the plate geometry the harness then derives is not the one a host's address gets. */
const TOKEN = "Wm3vYq8ZkR2nT7xLpA4sDf6gHj9klNbPcQeRtYuiOpa";
const PLATE_TARGET = `https://vivaahvarnam.in/i/${TOKEN}`;

/** 165 characters: version 9, whose modules no longer reach §4's floor inside a 25 mm box, while 40
 *  mm and 60 mm still print it (`s9-qr-plate-pinned.txt`). */
const LONG_165 = `https://${"v".repeat(100)}.example.in/i/${TOKEN}`;

/** 2,365 characters, past what version 40 holds at level `M` (2,331), so the encoder itself says no
 *  (§5's refusal) rather than handing back a symbol that cannot carry the address. */
const LONG_2365 = `https://${"v".repeat(2300)}.example.in/i/${TOKEN}`;

/** Every shape the harness is meant to accept, one per frozen-version kind the projection
 *  answers for: a v2 document with a pack, one without, and the Stage 3 shape that carries no
 *  section list. Three documents × three surfaces, because nothing about a surface may depend on
 *  which kind of document arrived. */
const documents = [guestInvitation(), guestInvitationPacked(), guestInvitationV1()];

/** Read a request as the document it claims to be.
 *
 *  `RenderRequest` is a union now — a plate request carries no invitation to read — so the document
 *  cases narrow through this rather than through an `if`, which would let the whole battery pass
 *  vacuously on the day the door starts routing `pdf` to the plate branch. A plate shape meeting a
 *  document assertion is a failure, and this is the one place that says so. */
const asDocument = (outcome: RenderOutcome) => {
  if (outcome.ok === false) throw new Error(`the door refused: ${outcome.reason}`);
  if (outcome.request.surface === QR_SURFACE) throw new Error("a document assertion met a plate request");
  return outcome.request;
};

describe("parseRenderRequest", () => {
  it.each([...DOCUMENT_SURFACES])("accepts the %s surface for each frozen-version shape", (surface) => {
    for (const dto of documents) {
      const outcome = parseRenderRequest({ surface, dto });
      expect(outcome.ok).toBe(true);
      expect(asDocument(outcome).surface).toBe(surface);
      expect(asDocument(outcome).invitation).toEqual(parseInvitationObject(dto));
    }
  });

  it("carries the document through the guest page's own parser, not a copy of it", () => {
    // A hand-shaped camelCase object would let the harness invent fields the projection never
    // writes. The refusal has to come from the parser a guest's page goes through, so a document
    // that cannot be shown to a guest cannot be printed either.
    const outcome = parseRenderRequest({ surface: "pdf", dto: { title: "invented" } });
    expect(outcome.ok).toBe(false);
    if (outcome.ok === false) expect(outcome.reason).toBe("invitation-refused");
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "pdf"],
    ["a number", 7],
    ["an array", ["pdf", guestInvitation()]],
    ["an absent document", { surface: "og" }],
    ["an absent surface", { dto: guestInvitation() }],
  ])("refuses %s without throwing", (_label, value) => {
    expect(parseRenderRequest(value).ok).toBe(false);
  });

  it.each([
    "Pdf",
    "pdf ",
    "",
    "ogx",
    "screenshare",
    "pdf;file:///etc/passwd",
    "<script>alert(1)</script>",
    "iVBORw0KGgoAAAANSUhEUg",
    42,
    true,
    null,
    {},
    [],
  ])("refuses the surface value %s rather than guessing one", (surface) => {
    const outcome = parseRenderRequest({ surface, dto: guestInvitation() });
    expect(outcome.ok).toBe(false);
    if (outcome.ok === false) expect(outcome.reason).toBe("surface-unknown");
  });

  it("drops every top-level field it was not taught, and honours none of them", () => {
    // The point of this case is not that the extra keys are ignored *today* — each branch reads its
    // fields by name, so they would be. It is that the object which reaches the renderer carries
    // exactly the keys the door knows, so no later change can find a third channel to read.
    const hostile = {
      surface: "share",
      dto: guestInvitation(),
      html: "<img src=x onerror=alert(1)>",
      stylesheet: "https://fonts.googleapis.com/css2?family=Inter",
      scriptUrl: "file:///C:/Windows/System32/calc.exe",
      font: "Comic Sans MS",
      file: "../../../../etc/passwd",
      url: "http://169.254.169.254/latest/meta-data/",
      width: 1,
      height: 1,
      csp: "default-src *",
    };
    const outcome = parseRenderRequest(hostile);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(Object.keys(outcome.request).sort()).toEqual(["invitation", "surface"]);
      const rendered = JSON.stringify(outcome.request);
      expect(rendered).not.toContain("fonts.googleapis.com");
      expect(rendered).not.toContain("169.254");
      expect(rendered).not.toContain("passwd");
      expect(rendered).not.toContain("Comic Sans");
    }
  });

  it("does not smuggle an unknown field into the document either", () => {
    // `parseInvitationObject` builds its result field by field, so a nested extra key cannot
    // survive — but that is a property of the parser, and this is the case that notices if the
    // parser ever grows a spread.
    const dto = { ...guestInvitation(), remoteStylesheet: "https://fonts.gstatic.com/x.css" };
    const outcome = parseRenderRequest({ surface: "og", dto });
    expect(outcome.ok).toBe(true);
    expect(JSON.stringify(asDocument(outcome).invitation)).not.toContain("gstatic");
    expect(asDocument(outcome).invitation).toEqual(parseInvitationObject(guestInvitation()));
  });

  it("names a rule in every refusal and never repeats the input", () => {
    const hostileSurface = '<script src="https://evil.example/x.js"></script>';
    const outcome = parseRenderRequest({ surface: hostileSurface, dto: guestInvitation() });
    expect(outcome.ok).toBe(false);
    if (outcome.ok === false) {
      expect(RENDER_REFUSAL_REASONS).toContain(outcome.reason);
      expect(outcome.reason).not.toContain("evil.example");
      expect(outcome.reason).not.toContain("script");
    }
  });

  it("refuses a document whose people list is not a list, the same way a guest page would", () => {
    const broken = { ...guestInvitation(), people: "Kalyani & Raghav" };
    expect(parseInvitationObject(broken)).toBeNull();
    const outcome = parseRenderRequest({ surface: "pdf", dto: broken });
    expect(outcome.ok).toBe(false);
    if (outcome.ok === false) expect(outcome.reason).toBe("invitation-refused");
  });

  it("refuses a document that is a hostile string rather than an object", () => {
    for (const dto of ["https://evil.example/dto.json", { toString: () => "file:///etc/passwd" }, 42]) {
      expect(parseRenderRequest({ surface: "og", dto }).ok).toBe(false);
    }
  });
});

/** Read a request as the plate it claims to be — the mirror of `asDocument`, for the same reason. */
const asPlate = (outcome: RenderOutcome) => {
  if (outcome.ok === false) throw new Error(`the door refused: ${outcome.reason}`);
  if (outcome.request.surface !== QR_SURFACE) throw new Error("a plate assertion met a document request");
  return outcome.request;
};

// The plate branch (§5's three print boxes, §9.3's address door, §9.4's geometry). What the
// document battery above is to the projection, this is to the code a guest's camera reads: the
// harness's only output that leaves the house.
//
// The *geometry* numbers are pinned in `./qrPlate.test.ts`, where they were measured against the
// encoder. What is pinned here is the door: which fields it reads, which rule it names first, and
// that a plate can never be handed an invitation or a document an address.
describe("parseRenderRequest — the plate branch", () => {
  it.each([...QR_VARIANTS])("accepts a real /i/ address on the %s box", (variant) => {
    const outcome = parseRenderRequest({ surface: QR_SURFACE, variant, target: PLATE_TARGET });
    expect(outcome.ok).toBe(true);
    const request = asPlate(outcome);
    expect(request.surface).toBe(QR_SURFACE);
    expect(request.variant).toBe(variant);
    expect(request.target).toBe(PLATE_TARGET);
    // Structural facts, not measured constants: the plate the door returns is the plate the
    // geometry module would have derived, and it fits the box that was asked for.
    const { plate } = request;
    expect(plate.modules).toBe(4 * plate.version + 17);
    expect(plate.quietModules).toBe(plate.modules + 2 * QR_QUIET_ZONE_MODULES);
    expect(plate.canvasPixels).toBe(QR_PRINT_BOX_PIXELS[variant]);
    expect(plate.platePixels).toBe(plate.quietModules * plate.moduleScale);
    expect(plate.moduleScale).toBeGreaterThanOrEqual(QR_MINIMUM_MODULE_SCALE_PIXELS);
    expect(plate.matrix.length).toBe(plate.modules * plate.modules);
  });

  it("hands the encoder the canonical address, not the caller's spelling of it", () => {
    // Two independent rewrites — host case and a redundant default port — and one direction only:
    // the manifest records the digest of this string, so a plate drawn from a differently-spelled
    // copy of the same address would be a second artefact nobody asked for.
    const outcome = parseRenderRequest({
      surface: QR_SURFACE,
      variant: "25mm",
      target: `https://VIVAAHVARNAM.IN:443/i/${TOKEN}`,
    });
    expect(asPlate(outcome).target).toBe(PLATE_TARGET);
  });

  it("reads two fields on this branch, so a document smuggled beside a plate is dropped", () => {
    const outcome = parseRenderRequest({
      surface: QR_SURFACE,
      variant: "60mm",
      target: PLATE_TARGET,
      dto: guestInvitation(),
      html: "<img src=x onerror=alert(1)>",
      stylesheet: "https://fonts.googleapis.com/css2?family=Inter",
      file: "../../../../etc/passwd",
      width: 1,
    });
    expect(outcome.ok).toBe(true);
    expect(Object.keys(asPlate(outcome)).sort()).toEqual(["plate", "surface", "target", "variant"]);
    expect("invitation" in asPlate(outcome)).toBe(false);
    const rendered = JSON.stringify(asPlate(outcome));
    expect(rendered).not.toContain("fonts.googleapis.com");
    expect(rendered).not.toContain("passwd");
    expect(rendered).not.toContain("onerror");
  });

  it("drops an address from a document request, so one surface cannot borrow another's field", () => {
    const outcome = parseRenderRequest({ surface: "pdf", dto: guestInvitation(), target: PLATE_TARGET });
    expect(outcome.ok).toBe(true);
    expect(Object.keys(asDocument(outcome)).sort()).toEqual(["invitation", "surface"]);
    expect(JSON.stringify(asDocument(outcome))).not.toContain(TOKEN);
  });

  it.each([
    ["an absent address", { surface: QR_SURFACE, variant: "25mm" }, "target-not-a-string"],
    ["a non-string address", { surface: QR_SURFACE, variant: "25mm", target: 42 }, "target-not-a-string"],
    ["an unparsable address", { surface: QR_SURFACE, variant: "25mm", target: "not a url" }, "target-unparsable"],
    ["a plain-http address", { surface: QR_SURFACE, variant: "25mm", target: `http://vivaahvarnam.in/i/${TOKEN}` }, "target-not-https"],
    ["an address with credentials", { surface: QR_SURFACE, variant: "25mm", target: `https://host:secret@vivaahvarnam.in/i/${TOKEN}` }, "target-carries-credentials"],
    ["an address with a query", { surface: QR_SURFACE, variant: "25mm", target: `${PLATE_TARGET}?utm_source=whatsapp` }, "target-carries-query"],
    ["an on-box address", { surface: QR_SURFACE, variant: "25mm", target: `https://127.0.0.1/i/${TOKEN}` }, "target-origin-not-public"],
    ["a private-door address", { surface: QR_SURFACE, variant: "25mm", target: `https://vivaahvarnam.in/g/${TOKEN}` }, "target-private-door"],
    ["a review-door address", { surface: QR_SURFACE, variant: "25mm", target: `https://vivaahvarnam.in/r/${TOKEN}` }, "target-private-door"],
    ["a short token", { surface: QR_SURFACE, variant: "25mm", target: "https://vivaahvarnam.in/i/Wm3vYq8ZkR2nT7xLpA4sDf6gHj9klNbPcQeRtYuiOp" }, "target-path-shape"],
    ["a path-shaped key", { surface: QR_SURFACE, variant: "25mm", target: "https://vivaahvarnam.in/file.txt" }, "target-path-shape"],
    ["an absent box", { surface: QR_SURFACE, target: PLATE_TARGET }, "qr-variant-unknown"],
    ["a millimetres-only box", { surface: QR_SURFACE, variant: 25, target: PLATE_TARGET }, "qr-variant-unknown"],
    ["a too-dense address on 25 mm", { surface: QR_SURFACE, variant: "25mm", target: LONG_165 }, "plate-too-dense"],
    ["an address past version 40", { surface: QR_SURFACE, variant: "60mm", target: LONG_2365 }, "target-too-long"],
  ] as const)("refuses %s and names the rule the module that owns it uses", (_label, value, reason) => {
    const outcome = parseRenderRequest(value);
    expect(outcome.ok).toBe(false);
    if (outcome.ok === false) {
      expect(outcome.reason).toBe(reason);
      expect(RENDER_REFUSAL_REASONS).toContain(outcome.reason);
    }
  });

  it("refuses the credential before the pixels", () => {
    // A caller that hands over a household door *and* an impossible box gets the finding that
    // matters. Reversing this order would bury "a family's guest list is about to be printed on a
    // poster" under a layout complaint.
    const outcome = parseRenderRequest({
      surface: QR_SURFACE,
      variant: "not-a-box",
      target: `https://vivaahvarnam.in/g/${TOKEN}`,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok === false) expect(outcome.reason).toBe("target-private-door");
  });

  it("names a rule and never repeats the address it was handed", () => {
    const hostile = `https://vivaahvarnam.in/i/${TOKEN}?token=household-secret<script>alert("evil.example")</script>`;
    const outcome = parseRenderRequest({ surface: QR_SURFACE, variant: "25mm", target: hostile });
    expect(outcome.ok).toBe(false);
    if (outcome.ok === false) {
      expect(outcome.reason).toBe("target-carries-query");
      expect(outcome.reason).not.toContain("household-secret");
      expect(outcome.reason).not.toContain(TOKEN);
      expect(outcome.reason).not.toContain("script");
    }
  });

  it("keeps the door's vocabulary closed across both branches", () => {
    // A reason outside this list is a bug in `./renderRequest`, and the worker maps every answer to
    // words it knows — 3 door rules + 8 address rules + 3 geometry rules.
    expect(RENDER_REFUSAL_REASONS).toHaveLength(14);
    expect(new Set(RENDER_REFUSAL_REASONS).size).toBe(14);
    expect([...RENDER_REFUSAL_REASONS].sort()).toEqual(
      [
        "invitation-refused",
        "not-an-object",
        "plate-too-dense",
        "qr-variant-unknown",
        "surface-unknown",
        "target-carries-credentials",
        "target-carries-query",
        "target-not-a-string",
        "target-not-https",
        "target-origin-not-public",
        "target-path-shape",
        "target-private-door",
        "target-too-long",
        "target-unparsable",
      ].sort(),
    );
  });

  it("refuses a plate that is not an object, the same way the document branch does", () => {
    for (const value of [null, undefined, "qr", 7, [QR_SURFACE, PLATE_TARGET]]) {
      expect(parseRenderRequest(value).ok).toBe(false);
    }
  });
});
