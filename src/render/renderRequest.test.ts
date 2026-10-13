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
// Three properties, each with a case that would break it:
//
//   * **Two fields, not zero.** A request carries exactly a surface and a document. A stray
//     `html` / `stylesheet` / `scriptUrl` / `font` key is dropped rather than honoured — and
//     dropped *before* the renderer sees it, because the renderer's own guards are about host
//     text, not about an input channel that should never have carried a font name at all.
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
import { parseRenderRequest, RENDER_REFUSAL_REASONS } from "./renderRequest";
import { RENDER_SURFACES } from "@/lib/renderSurfaces";
import { parseInvitationObject } from "@/lib/publicInvitation";
import { guestInvitation, guestInvitationPacked, guestInvitationV1 } from "@/test/invitationFixture";

/** Every shape the harness is meant to accept, one per frozen-version kind the projection
 *  answers for: a v2 document with a pack, one without, and the Stage 3 shape that carries no
 *  section list. Three documents × three surfaces, because nothing about a surface may depend on
 *  which kind of document arrived. */
const documents = [guestInvitation(), guestInvitationPacked(), guestInvitationV1()];

describe("parseRenderRequest", () => {
  it.each([...RENDER_SURFACES])("accepts the %s surface for each frozen-version shape", (surface) => {
    for (const dto of documents) {
      const outcome = parseRenderRequest({ surface, dto });
      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        expect(outcome.request.surface).toBe(surface);
        expect(outcome.request.invitation).toEqual(parseInvitationObject(dto));
      }
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
    // The point of this case is not that the extra keys are ignored *today* — the harness reads
    // two fields by name, so they would be. It is that the object which reaches the renderer
    // carries exactly two keys, so no later change can find a third channel to read.
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
    if (outcome.ok) {
      expect(JSON.stringify(outcome.request.invitation)).not.toContain("gstatic");
      expect(outcome.request.invitation).toEqual(parseInvitationObject(guestInvitation()));
    }
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
