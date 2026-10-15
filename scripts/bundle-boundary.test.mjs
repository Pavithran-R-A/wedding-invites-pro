// Proof that the bundle-boundary sweep can fail.
//
// `scripts/check-bundle-boundary.mjs` is the authoritative reading of §9.4 — "the encoder is reachable
// from the render entry and from a host's press, never from a guest's page" — measured on the bytes a
// browser downloads. A sweep that only ever runs against a real `dist/` has one observed outcome, and
// an observed outcome is not a capability: if a rule could not fire, a clean report would mean nothing.
// So each rule below is shown firing on a synthetic bundle, and the compliant fixture is shown clean on
// the same rules.
//
// The fixtures imitate Vite's emitted shapes because the reader is syntax-specific on purpose, and each
// shape it depends on is pinned here rather than trusted from a comment:
//
//   * a static edge is `import{a as x}from"./chunk.js"`;
//   * a lazy edge is `import("./chunk.js"),__vite__mapDeps([0,1,2])`, whose indices resolve against the
//     chunk's own `m.f=["assets/…"]` list — and the closing parenthesis of `import(` sits between them,
//     which is the detail that made an earlier version of the reader report zero preloads;
//   * that list begins with the imported chunk itself and then its static dependencies, exactly as
//     measured on this repo's `dist/assets/index-*.js`, so the reader keeps it verbatim: a route chunk
//     carrying the library inline is a case worth reporting, not noise to filter out;
//   * a document names its eager files in a `<script src>` and in `<link rel="modulepreload" href>`, and
//     a stylesheet in the same attribute shape must not become a graph node.
//
// The last group is the one that matters most, because it is a rule about the checker's own model: a
// single-page app's router holds one lazy edge per route, so following every dynamic edge from a guest
// page reaches the editor. That is true of the router and false of the guest's download, and the sweep
// has to measure the second — hence the fixture that puts the encoder behind the host route and expects
// the guest door to stay clean.

import { describe, expect, it } from "vitest";

import {
  auditBundle,
  eagerAssetsOf,
  edgesOf,
  memoryBundle,
} from "./check-bundle-boundary.mjs";

const ASSETS = {
  // The eager shell: what `index.html` fetches before any route resolves.
  "assets/app.js": `const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/shared.js","assets/PublicInvitation.js","assets/GuestDoor.js","assets/EditProject.js"])))=>i.map(i=>d[i]);
import{a as x}from"./shared.js";
const routes=[p(()=>import("./PublicInvitation.js"),__vite__mapDeps([1,0])),p(()=>import("./GuestDoor.js"),__vite__mapDeps([2,0])),p(()=>import("./EditProject.js"),__vite__mapDeps([3,0]))];
`,
  "assets/shared.js": `import{b as y}from"./button.js";export const shared=y;`,
  "assets/button.js": `export const b=1;`,
  // The two guest doors.
  "assets/PublicInvitation.js": `import{a as z}from"./shared.js";export default function P(){return z}`,
  "assets/GuestDoor.js": `import{a as w}from"./shared.js";export default function G(){return w}`,
  // The host editor, whose plate affordance is the only place the app may reach the encoder.
  "assets/EditProject.js": `import{a as v}from"./shared.js";
const Plate=lazy(()=>import("./ShareQrPlate.js"),void 0);
`,
  "assets/ShareQrPlate.js": `import{t}from"./qrTarget.js";export const words={"target-private-door":"refused"};`,
  "assets/qrTarget.js": `import{u}from"./util.js";export const level="errorCorrectionLevel";export const mask="maskPattern";export const alnum="Alphanumeric";export const bits="getEncodedBits";export const scale="data-qr-module-scale";`,
  "assets/util.js": `export const u=1;`,
  // The render harness, where the encoder belongs.
  "assets/render.js": `import{t as r}from"./qrTarget.js";import{a as q}from"./shared.js";`,
};

const DOCUMENTS = {
  "index.html": `<html><head>
<link rel="stylesheet" crossorigin href="/assets/index.css">
<script type="module" crossorigin src="/assets/app.js"></script>
<link rel="modulepreload" crossorigin href="/assets/shared.js">
</head><body><div id="root"></div></body></html>`,
  "render.html": `<html><head>
<script type="module" crossorigin src="/assets/render.js"></script>
<link rel="modulepreload" crossorigin href="/assets/shared.js">
</head><body></body></html>`,
};

/** A bundle built from the compliant fixture with these files replaced or added. */
const bundleWith = (changes) => memoryBundle({ ...ASSETS, ...DOCUMENTS, ...changes });

const rules = (report) => report.findings.map((f) => f.rule);

describe("the reader's edge syntax", () => {
  it("separates a lazy edge from a static one and resolves its preload indices", () => {
    const edges = edgesOf(ASSETS["assets/app.js"]);
    expect(edges.statics).toEqual(["assets/shared.js"]);
    expect([...edges.dynamic.keys()]).toEqual([
      "assets/PublicInvitation.js",
      "assets/GuestDoor.js",
      "assets/EditProject.js",
    ]);
    expect(edges.dynamic.get("assets/GuestDoor.js")).toEqual(["assets/GuestDoor.js", "assets/shared.js"]);
  });

  it("counts no preload when a lazy edge has no mapDeps list", () => {
    const edges = edgesOf(`const P=lazy(()=>import("./ShareQrPlate.js"),void 0);`);
    expect(edges.dynamic.get("assets/ShareQrPlate.js")).toEqual([]);
    expect(edges.statics).toEqual([]);
  });

  it("reads eager assets from a script src and a modulepreload, and not from a stylesheet", () => {
    expect(eagerAssetsOf(DOCUMENTS["index.html"])).toEqual(["assets/app.js", "assets/shared.js"]);
  });
});

describe("a compliant bundle", () => {
  it("reports clean, and names the boundary it proved", () => {
    const report = auditBundle(bundleWith({}));
    expect(report.findings).toEqual([]);
    expect(report.status).toBe("clean");
    const spoken = report.measures.join(" | ");
    expect(spoken).toContain("encoder chunk(s): qrTarget.js");
    expect(spoken).toContain("loaded by app.js");
  });

  it("keeps the encoder off a guest page even though the router could lazy-open the editor", () => {
    // The false positive this file exists to prevent. A walk that crosses every dynamic edge reaches
    // `EditProject` from a guest's page, because the router holds that edge — but a guest who opens an
    // invitation link never fetches the editor, and §9.4 is about fetches.
    const report = auditBundle(bundleWith({}));
    expect(rules(report)).not.toContain("encoder-reachable-from-guest-route");
    expect(report.measures.join(" ")).toMatch(/PublicInvitation: \d+ chunk\(s\) on opening/);
  });
});

describe("the rules fire", () => {
  it("when the eager shell statically imports the encoder", () => {
    const report = auditBundle(bundleWith({
      "assets/shared.js": `import{t}from"./qrTarget.js";import{b as y}from"./button.js";`,
    }));
    expect(rules(report)).toContain("encoder-in-eager-shell");
    expect(report.findings.find(f => f.rule === "encoder-in-eager-shell").message)
      .toContain("statically imports");
  });

  it("when a guest door statically imports the encoder", () => {
    const report = auditBundle(bundleWith({
      "assets/PublicInvitation.js": `import{a as z}from"./shared.js";import{t}from"./qrTarget.js";`,
    }));
    expect(rules(report)).toContain("encoder-reachable-from-guest-route");
  });

  it("when a guest door lazily imports a plate component of its own", () => {
    // Interaction inside the page: the edge is not in the route table, so the sweep follows it.
    const report = auditBundle(bundleWith({
      "assets/GuestDoor.js": `import{a as w}from"./shared.js";
const Q=lazy(()=>import("./ShareQrPlate.js"),void 0);
`,
    }));
    expect(rules(report)).toContain("encoder-reachable-from-guest-route");
    const finding = report.findings.find(f => f.message.includes("GuestDoor"));
    expect(finding.message).toContain("dynamically imports");
  });

  it("when the route table preloads the encoder with a guest door", () => {
    // The half the source-side rule cannot see: nobody wrote an import, and the bundler fetched the
    // library anyway. One arrival is one finding, so the two guest walks must not both report it, and
    // the host route in this fixture is clean — hence no host rule here.
    const report = auditBundle(bundleWith({
      "assets/app.js": `const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/shared.js","assets/qrTarget.js","assets/PublicInvitation.js","assets/GuestDoor.js","assets/EditProject.js"])))=>i.map(i=>d[i]);
import{a as x}from"./shared.js";
const routes=[p(()=>import("./PublicInvitation.js"),__vite__mapDeps([2,0,1])),p(()=>import("./GuestDoor.js"),__vite__mapDeps([3,0])),p(()=>import("./EditProject.js"),__vite__mapDeps([4,0]))];
`,
    }));
    const guest = report.findings.filter(f => f.rule === "encoder-reachable-from-guest-route");
    expect(guest).toHaveLength(1);
    expect(guest[0].path).toBe("assets/qrTarget.js");
    expect(guest[0].message).toContain("app.js preloads it with the route");
    expect(rules(report)).not.toContain("encoder-preloaded-with-host-route");
  });

  it("when opening the host editor brings the encoder down before any press", () => {
    const report = auditBundle(bundleWith({
      "assets/app.js": `const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/shared.js","assets/qrTarget.js","assets/PublicInvitation.js","assets/GuestDoor.js","assets/EditProject.js"])))=>i.map(i=>d[i]);
import{a as x}from"./shared.js";
const routes=[p(()=>import("./PublicInvitation.js"),__vite__mapDeps([2,0])),p(()=>import("./GuestDoor.js"),__vite__mapDeps([3,0])),p(()=>import("./EditProject.js"),__vite__mapDeps([4,0,1]))];
`,
    }));
    expect(rules(report)).toContain("encoder-preloaded-with-host-route");
    expect(rules(report)).not.toContain("encoder-reachable-from-guest-route");
  });

  it("when the plate affordance is eager instead of lazy", () => {
    const report = auditBundle(bundleWith({
      "assets/app.js": `import{a as x}from"./shared.js";import{t}from"./ShareQrPlate.js";`,
    }));
    expect(rules(report)).toContain("qr-affordance-eager");
  });

  it("when the plate affordance cannot be loaded from the app at all", () => {
    // A cut-out feature would look identical to a confined one in every other row of this report.
    const report = auditBundle(bundleWith({
      "assets/EditProject.js": `import{a as v}from"./shared.js";`,
    }));
    expect(rules(report)).toContain("qr-affordance-unreachable");
  });

  it("when the render harness can no longer reach the encoder", () => {
    const report = auditBundle(bundleWith({
      "assets/render.js": `import{a as q}from"./shared.js";`,
    }));
    expect(rules(report)).toContain("render-entry-lost-encoder");
  });

  it("when a guest door stops being its own chunk", () => {
    const withoutDoor = { ...ASSETS, ...DOCUMENTS };
    delete withoutDoor["assets/GuestDoor.js"];
    const report = auditBundle(memoryBundle(withoutDoor));
    expect(rules(report)).toContain("surface-missing");
  });

  it("when no chunk carries the fingerprints, so a clean row would be this file going blind", () => {
    const report = auditBundle(bundleWith({
      "assets/qrTarget.js": `export const t=1;`,
      "assets/ShareQrPlate.js": `export const q=1;`,
      "assets/render.js": `import{a as q}from"./shared.js";`,
    }));
    expect(rules(report)).toContain("fingerprint-stale");
  });

  it("when the chunks expose no import edge this reader knows", () => {
    // Every chunk loses its `from "./x.js"` and `import("./x.js")` forms. The encoder keeps its
    // fingerprints so this fixture measures one defect — the reader going blind — and does not also
    // trip the fingerprint-liveness rule, which has a fixture of its own.
    const report = auditBundle(bundleWith({
      "assets/app.js": `export const app=1;`,
      "assets/shared.js": `export const shared=1;`,
      "assets/button.js": `export const b=1;`,
      "assets/PublicInvitation.js": `export const p=1;`,
      "assets/GuestDoor.js": `export const g=1;`,
      "assets/EditProject.js": `export const e=1;`,
      "assets/ShareQrPlate.js": `export const words={"target-private-door":"refused"};`,
      "assets/qrTarget.js": `export const mask="maskPattern";export const alnum="Alphanumeric";export const bits="getEncodedBits";`,
      "assets/render.js": `export const r=1;`,
      "assets/util.js": `export const u=1;`,
    }));
    expect(rules(report)).toContain("reader-stale");
  });

  it("when there is no bundle to read, and says to build one", () => {
    const report = auditBundle(memoryBundle({ "index.html": DOCUMENTS["index.html"] }));
    const finding = report.findings.find(f => f.rule === "bundle-not-built");
    expect(finding).toBeDefined();
    expect(finding.message).toContain("npm run build");
    expect(report.measures).toEqual([]);
  });

  it("when a document is missing from an otherwise readable bundle", () => {
    const report = auditBundle(memoryBundle({ ...ASSETS, "index.html": DOCUMENTS["index.html"] }));
    expect(rules(report)).toContain("bundle-incomplete");
  });

  it("when the QR library lands in two chunks", () => {
    const report = auditBundle(bundleWith({
      "assets/button.js": `export const b=1;export const second="maskPattern" "Alphanumeric" "getEncodedBits";`,
    }));
    expect(rules(report)).toContain("encoder-duplicated");
  });
});
