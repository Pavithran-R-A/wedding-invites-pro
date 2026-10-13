// The only script `render.html` runs, and the whole of that document's interface.
//
// This file is where a value becomes pixels for an exported artefact, so its design is the answer
// to one question: what has to be true before somebody calls `Page.captureScreenshot` or
// `Page.printToPDF`? Three things, and the harness states each of them in the DOM rather than in a
// promise an operator might not be holding:
//
//   * the invitation has been *read* by the same parser a guest's page uses (`./renderRequest`), so
//     a document that could not be shown to a guest cannot be printed for anybody;
//   * React has committed. `root.render()` alone does not guarantee that — a concurrent root
//     schedules — which is why the commit is wrapped in `flushSync` and the capture is taken only
//     against a later state value;
//   * the faces are loaded. `document.fonts.ready` resolves once the pending loads that layout
//     started are done, and the stylesheet's own subresources are same-origin (§6.2). What that
//     does *not* do is prove a drawn codepoint has a face; that claim belongs to the per-script
//     glyph probe in §6.3, which measures this state rather than trusting it.
//
// What this file refuses to be: a second renderer, a second content source, or a page that fetches.
// It imports no router, no auth provider, no Supabase client and no `src/lib/api*`, so the harness
// cannot become a way to reach a database with a browser's credentials — `connect-src 'none'` in
// `render.html` would block the attempt anyway, and the import list is why no attempt is worth
// making. It draws one component, `InvitationRenderer`, with one extra prop.
//
// The `data-render-state` vocabulary is the harness's contract with the worker and with the output
// tier, both of which read it from the DOM. `booting` and `waiting` are set here; `rendering`,
// `ready` and `refused` are the three outcomes of handing it a request. A `refused` render also
// names its rule in `data-render-refusal`, taken from the closed set in `./renderRequest` — never
// the caller's bytes, which is what keeps a refusal safe to put in a log line (§11.5).

import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import InvitationRenderer from "@/components/invitation/InvitationRenderer";
import { parseRenderRequest, type RenderRefusalReason } from "./renderRequest";

// The product's own stylesheet first, then the canvas rules that override it. Order is the
// mechanism: `render.css` wins without `!important` because it arrives last, and the live app never
// loads it, so a teaser's geometry cannot follow a guest's page home (§6.1).
import "../index.css";
import "./render.css";

/** The states a harness passes through. Exported because the worker's timeout reason and the
 *  output tier's assertions both name these strings; the DOM attribute is the channel. */
export const RENDER_STATES = ["booting", "waiting", "rendering", "ready", "refused"] as const;
export type RenderState = (typeof RENDER_STATES)[number];

/** What `render.html` puts on `window`, and the only way to ask it to draw anything. */
export interface RenderHarness {
  /**
   * Hand the harness a candidate request. Resolves with the state the document reached, after the
   * commit and the font wait, so the caller can treat `ready` as "capture now".
   */
  mount(value: unknown): Promise<RenderState>;
}

declare global {
  interface Window {
    __vivaahvarnamRender?: RenderHarness;
  }
}

const ROOT_ELEMENT_ID = "render-root";

const setState = (element: HTMLElement, state: RenderState, refusal?: RenderRefusalReason) => {
  element.setAttribute("data-render-state", state);
  if (refusal === undefined) element.removeAttribute("data-render-refusal");
  else element.setAttribute("data-render-refusal", refusal);
};

const boot = (element: HTMLElement): RenderHarness => {
  const root: Root = createRoot(element);

  // One mount at a time. A worker that called this twice before the first promise settled would
  // otherwise interleave two invitations in one document, and a capture taken in that window would
  // be a file containing half of one family's wedding and half of another's — the serialised chain
  // makes the second call wait rather than merge.
  let queue: Promise<unknown> = Promise.resolve();

  const doMount = async (value: unknown): Promise<RenderState> => {
    setState(element, "rendering");
    const outcome = parseRenderRequest(value);

    if (outcome.ok === false) {
      // Clear the canvas on the way out. A refusal that left the previous render on screen would
      // let a caller that ignored the returned state capture the artefact it asked for *last*.
      flushSync(() => root.render(null));
      setState(element, "refused", outcome.reason);
      return "refused";
    }

    flushSync(() =>
      root.render(
        <InvitationRenderer
          invitation={outcome.request.invitation}
          surface={outcome.request.surface}
        />,
      ),
    );
    await document.fonts.ready;
    setState(element, "ready");
    return "ready";
  };

  return {
    mount: (value: unknown): Promise<RenderState> => {
      const run = queue.then(() => doMount(value));
      // The queue advances on a settled-but-rejected run, not on the rejected promise itself.
      // Without the catch, one render that threw would leave every later mount chained to a
      // rejection that never runs — a harness that silently stops drawing anything.
      queue = run.catch(() => undefined);
      return run;
    },
  };
};

const rootElement = document.getElementById(ROOT_ELEMENT_ID);
if (rootElement === null) {
  // A harness document with no root is a build break, not a runtime condition: `render.html` and
  // this file are committed together. Naming it in the thrown message is what puts the reason in
  // the worker's `last_error` instead of in an unexplained timeout.
  throw new Error(`render harness: #${ROOT_ELEMENT_ID} is missing from render.html`);
}

setState(rootElement, "waiting");
window.__vivaahvarnamRender = boot(rootElement);
