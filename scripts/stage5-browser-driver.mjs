// VIVAAHVARNAM — Stage 5 browser driver (§27 / §28 / §29 / §31 / §32).
//
// Why this file exists: the Stage 4 instrument (`stage4-render-qualification.mjs`) builds documents
// through the same HTTP calls a host's browser makes, then reads the *rendered guest page*. That is
// the right instrument for render qualification, but §27 asks a different question — whether a
// person can actually complete the no-pack workflow by clicking the shipped product — so it needs a
// driver that types into fields, presses buttons and reads live regions. This is that driver, and it
// is deliberately a maintenance instrument, not a product surface.
//
// Deliberate properties:
//   * No new dependency. Chrome is launched with `--remote-debugging-port` and spoken to over raw
//     CDP with Node's built-in WebSocket, exactly like the Stage 4 instrument. Adding Playwright or
//     Puppeteer would change `package.json` and the lockfile in a stage whose closure §34 requires
//     to be reproducible from `npm ci`.
//   * Every page lives in its own browser context, so "the guest opened the link in a clean
//     context" (§27) is a property of the harness and not a hope. Host-session storage cannot leak
//     into a guest page, and a guest page that writes anything to storage is therefore measurable.
//   * Network is captured per session, with request headers and response bodies read back from
//     Chrome. The preview issue list, the freeze verdict and the guest DTO are asserted against the
//     bytes the server actually returned — a DOM that agrees with a failed request is a defect, not
//     a pass.
//   * Text fields are filled through the framework's own change path (native value setter +
//     `input`/`change`), which is how a keystroke reaches React state. Buttons and radios get real
//     mouse events, so a disabled button refuses the way a guest would find it refuses.
//
// It creates accounts and rows in the local stack and cleans them up by run tag. Nothing here can
// reach a hosted project: the caller passes an origin this module checks for loopback first.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

export function assertLoopback(origin, label) {
  const host = new URL(origin).hostname;
  if (!LOOPBACK.has(host)) throw new Error(`refusing to run: ${label}=${origin} is not loopback`);
  return origin;
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Read `label` out of the page and return its control, so journeys can be written against the
 *  words a host reads rather than against generated ids. */
const FIND_BY_LABEL = `((labelText, want) => {
  const labels = [...document.querySelectorAll('label')].filter(
    (l) => l.textContent.trim().replace(/\\s+/g, ' ') === labelText);
  if (!labels.length) return null;
  const forId = labels.find((l) => l.htmlFor)?.htmlFor;
  const byId = forId ? document.getElementById(forId) : null;
  if (byId) return byId;
  const inside = labels.map((l) => l.querySelector('input,select,textarea')).find(Boolean);
  if (inside) return inside;
  const scope = labels[0].parentElement;
  return scope ? scope.querySelector(want === 'textarea' ? 'textarea' : 'input,select,textarea') : null;
})`;

const SET_VALUE = `((el, value) => {
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype
    : el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype
      : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new window.Event('input', { bubbles: true }));
  el.dispatchEvent(new window.Event('change', { bubbles: true }));
  return el.value;
})`;

export async function openBrowser({ cdpPort = 9411 } = {}) {
  const userData = mkdtempSync(join(tmpdir(), 'stage5-chrome-'));
  const chrome = process.env.STAGE5_CHROME
    ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  if (!existsSync(chrome)) throw new Error(`no Chromium found at ${chrome}`);
  const child = spawn(chrome, [
    '--headless=new', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${userData}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--disable-background-timer-throttling', '--remote-allow-origins=*',
  ], { stdio: 'ignore' });

  let version = null;
  for (let attempt = 0; attempt < 80 && !version; attempt += 1) {
    await sleep(250);
    try {
      const res = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
      if (res.ok) version = await res.json();
    } catch {
      // not listening yet
    }
  }
  if (!version) throw new Error('Chromium did not open a DevTools endpoint');

  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((ok, err) => {
    ws.addEventListener('open', ok);
    ws.addEventListener('error', err);
  });

  let nextId = 1;
  const pending = new Map();
  const listeners = [];
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id !== undefined) {
      const entry = pending.get(msg.id);
      pending.delete(msg.id);
      if (entry) entry.resolve(msg);
    } else if (msg.method) {
      for (const fn of listeners) fn(msg);
    }
  });
  const send = (method, params = {}, sessionId) => new Promise((ok, err) => {
    const id = nextId++;
    pending.set(id, {
      resolve: (msg) => (msg.error
        ? err(new Error(`${method}: ${msg.error.message}`))
        : ok(msg.result)),
    });
    ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); err(new Error(`${method} timed out`)); }
    }, 90_000);
  });

  const open = [];
  return {
    /** The browser-level CDP door, for the calls that are not bound to a page session.
     *  Stage 9's capability probe needs it: §11.4 caps live browser contexts at one on this shared
     *  host, so the probe creates a context and disposes it *before* any page exists, which only the
     *  browser socket can do. */
    cdp: (method, params = {}) => send(method, params),
    /** The `/json/version` payload Chrome answered with, verbatim — the raster tier's `answered-keys`
     *  row prints it every run. Chrome 155.0.8059.40 on this host answers `Browser`, `Protocol-Version`,
     *  `User-Agent`, `V8-Version`, `WebKit-Version` and `webSocketDebuggerUrl`, and answers no `Version`
     *  or `Revision` key at all. Exposed because Stage 9's render worker refuses to draw an artefact on an
     *  unrecorded browser major
     *  (`specs/2026-10-13-stage9-render-exports-design.md` §6.4) and puts that string into
     *  `render_config_hash`; re-fetching it from a second place would be a second opinion about the
     *  same process. */
    version,
    async newPage(name) {
      const context = await send('Target.createBrowserContext', { disposeOnDetach: true });
      const target = await send('Target.createTarget', {
        url: 'about:blank', browserContextId: context.browserContextId });
      const attached = await send('Target.attachToTarget', {
        targetId: target.targetId, flatten: true });
      const session = attached.sessionId;
      const s = (method, params) => send(method, params, session);
      await s('Page.enable');
      await s('Runtime.enable');
      await s('Network.enable');
      await s('DOM.enable');

      /** Requests seen on *this* session only. Chrome broadcasts network events to the browser
       *  socket, so the sessionId filter is what keeps the host page's traffic out of the guest's
       *  classification. Flattened sessions carry the id on the message envelope, not inside
       *  `params` — reading only `params.sessionId` silently drops every event and leaves an empty
       *  log, which would make "no hosted Supabase contact" pass by saying nothing was seen. */
      const requests = new Map();
      listeners.push((msg) => {
        const eventSession = msg.sessionId ?? msg.params?.sessionId;
        if (!msg.method?.startsWith('Network.') || eventSession !== session) return;
        if (msg.method === 'Network.requestWillBeSent') {
          requests.set(msg.params.requestId, {
            url: msg.params.request.url,
            method: msg.params.request.method,
            headers: msg.params.request.headers ?? {},
            type: msg.params.type,
            hasResponseBody: false,
          });
        } else if (msg.method === 'Network.requestWillBeSentExtraInfo') {
          /** The header set the network service actually put on the wire. `requestWillBeSent` carries
           *  what the *renderer* proposed, and Chrome applies referrer policy, cookies and its own
           *  defaults afterwards — so a page under `<meta name=referrer content=no-referrer>` still
           *  shows a proposed `Referer` here. Reading only the proposed set would let the harness
           *  report a leak the browser never sent. */
          const entry = requests.get(msg.params.requestId);
          if (entry) entry.sentHeaders = msg.params.headers ?? {};
        } else if (msg.method === 'Network.responseReceived') {
          const entry = requests.get(msg.params.requestId);
          if (entry) {
            entry.status = msg.params.response.status;
            entry.mimeType = msg.params.response.mimeType;
            entry.hasResponseBody = true;
          }
        }
      });

      const page = makePage(name, target.targetId, s, session, requests, open);
      open.push(page);
      return page;
    },
    async close() {
      for (const page of open) {
        try { await send('Target.closeTarget', { targetId: page.targetId }); } catch { /* gone */ }
      }
      ws.close();
      child.kill();
      // The profile directory holds the signed-in host's tokens, so leaving it behind is a
      // credential-bearing scratch directory. Windows keeps the last file locked briefly after
      // the process is signalled, so the delete is retried and, if it still refuses, the exact
      // path is reported rather than silently kept.
      await sleep(1_500);
      try {
        rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
        return { profileRemoved: true, profilePath: userData };
      } catch {
        return { profileRemoved: false, profilePath: userData };
      }
    },
    profilePath: userData,
  };
}

function makePage(name, targetId, s, session, requests, open) {
  let lastObstruction = null;
  const evaluate = async (expression) => {
    const r = await s('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      throw new Error(`[${name}] page evaluation threw: ${
        r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    }
    return r.result.value;
  };

  const rect = async (expression) => evaluate(`(() => {
    document.querySelectorAll('[data-stage5-press]').forEach((el) => {
      delete el.dataset.stage5Press;
    });
    const el = ${expression};
    if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    el.dataset.stage5Press = '1';
    return { x: r.x, y: r.y, width: r.width, height: r.height,
      disabled: Boolean(el.disabled), tag: el.tagName, text: el.textContent.trim().slice(0, 80) };
  })()`);

  /** The expression that answers "which button says these words". Unscoped it is the whole page;
   *  with a container selector it is that container's own button, matched per container in document
   *  order so the first container holding one wins. `[document]` is the unscoped case, and a
   *  Document has `querySelectorAll`, so both branches read the same way. */
  const buttonFinder = (words, scope) => `(() => {
    const roots = ${scope === null ? '[document]' : `document.querySelectorAll(${JSON.stringify(scope)})`};
    for (const root of roots) {
      const b = [...root.querySelectorAll('button')].find((x) =>
        x.textContent.trim().replace(/\\s+/g, ' ').startsWith(${JSON.stringify(words)}));
      if (b) return b;
    }
    return null;
  })()`;

  /** Presses at the centre of the marked control, but only once the browser agrees that *that
   *  control* — or one of its own descendants — is what answers at the point. Measured on
   *  2026-10-01: between 640px and 767px the app's notification viewport is full width and its toast
   *  card sat on top of the log-in button, so a click there hit the toast, the form never submitted,
   *  and a harness that trusted "I dispatched a click" reported an action that had not happened. So
   *  a press that finds itself covered first dismisses the covering notification if the page offers
   *  a dismiss button, and otherwise returns false — the journeys then report `obstructed`.
   *
   *  Two things this check must not do, both learned the same day:
   *  - It may not accept an **ancestor** answering at the point. An ancestor means the control
   *    itself is not where the coordinates say it is, and Chrome dispatches the event to whatever is
   *    topmost at that point — so the press was reported as taken while the click went to the
   *    surrounding row, the handler never ran, and run 8 of the Stage 5 journeys watched a freeze
   *    return `pressed` with no request, no notice and no version row. `want.contains(hit)` is kept
   *    because a control's own label node is the control for click purposes.
   *  - It may not reuse coordinates captured before the previous attempt. The editor re-renders
   *    under a press (a preview verdict lands, a toast animates out), and a point that was correct
   *    when the control was measured can be a row of blank paper by the time it is dispatched. Each
   *    attempt therefore re-reads the marked element's own rect. */
  const mouseClick = async () => {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const point = await evaluate(`(() => {
        const want = document.querySelector('[data-stage5-press]');
        if (!want) return null;
        const r = want.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      })()`);
      if (!point) {
        lastObstruction = 'the marked control left the page';
        return false;
      }
      const { x, y } = point;
      const state = await evaluate(`(() => {
        const want = document.querySelector('[data-stage5-press]');
        const hit = document.elementFromPoint(${x}, ${y});
        if (!want) return { reach: 'unmarked' };
        if (hit && (hit === want || want.contains(hit))) {
          return { reach: 'clear' };
        }
        const card = hit ? hit.closest('li') : null;
        const dismiss = card ? card.querySelector('button') : null;
        if (dismiss) {
          dismiss.click();
          return { reach: 'dismissed' };
        }
        return { reach: 'obstructed',
          cover: hit ? hit.tagName + ' ' + (hit.textContent ?? '').trim().slice(0, 40) : 'nothing' };
      })()`);
      if (state.reach === 'clear') {
        for (const type of ['mousePressed', 'mouseReleased']) {
          await s('Input.dispatchMouseEvent', {
            type, x, y, clickCount: 1, button: 'left', buttons: type === 'mousePressed' ? 1 : 0 });
        }
        await evaluate(`document.querySelectorAll('[data-stage5-press]').forEach((el) => {
          delete el.dataset.stage5Press;
        })`);
        await sleep(120);
        return true;
      }
      if (state.reach === 'dismissed') {
        // A dismissed notification still animates out, and an auto-dismiss can simply take a
        // moment, so the point is re-tested until the control is reachable again.
        const deadline = Date.now() + 6_000;
        for (;;) {
          const clear = await evaluate(`(() => {
            const want = document.querySelector('[data-stage5-press]');
            if (!want) return false;
            const r = want.getBoundingClientRect();
            const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
            return Boolean(hit && (hit === want || want.contains(hit)));
          })()`);
          if (clear || Date.now() > deadline) break;
          await sleep(250);
        }
      }
      await sleep(160);
      if (attempt === 3) {
        lastObstruction = state.cover ?? state.reach;
        return false;
      }
    }
    return false;
  };

  const page = {
    name,
    targetId,
    async goto(url) {
      const r = await s('Page.navigate', { url });
      if (r.errorText) throw new Error(`[${name}] navigation failed: ${r.errorText}`);
      await sleep(150);
    },
    evaluate,

    /** The raw session-bound CDP door.
     *
     *  It exists because the Stage 9 render worker needs two calls no journey ever needed:
     *  `Page.captureScreenshot` with an exact `clip` (returning bytes in memory rather than writing a
     *  file through `screenshot()`, which has no clip and no format choice) and `Page.printToPDF`.
     *  Adding those as named methods would put export geometry into a maintenance instrument whose
     *  owner is the journeys; the worker owns its own geometry and asserts its own results, and this
     *  is the one door it needs. The `sessionId` binding is the point: a caller cannot reach another
     *  page's target through it, and §11.3's isolation claim stays a property of `newPage`. */
    cdp: (method, params = {}) => s(method, params),

    async currentUrl() { return evaluate('window.location.href'); },
    async reload() { await s('Page.reload', {}); await sleep(400); },

    async waitForSelector(selector, timeoutMs = 20_000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        if (await evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)) return true;
        if (Date.now() > deadline) return false;
        await sleep(120);
      }
    },
    async waitForAbsent(selector, timeoutMs = 20_000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        if (!(await evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`))) return true;
        if (Date.now() > deadline) return false;
        await sleep(120);
      }
    },
    /** Waits for a piece of copy to be on the page. Journeys assert on the words a host reads, so
     *  this is the primitive that proves an outcome was surfaced and not merely stored. */
    async waitForText(text, timeoutMs = 20_000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const found = await evaluate(`document.body.innerText.includes(${JSON.stringify(text)})`);
        if (found) return true;
        if (Date.now() > deadline) return false;
        await sleep(150);
      }
    },
    async hasText(text) { return evaluate(`document.body.innerText.includes(${JSON.stringify(text)})`); },
    async bodyText() { return evaluate('document.body.innerText'); },

    async setByLabel(labelText, value) {
      const out = await evaluate(`(() => {
        const el = (${FIND_BY_LABEL})(${JSON.stringify(labelText)}, 'any');
        if (!el) return 'no-field-for-label';
        if (el.disabled) return 'disabled';
        return (${SET_VALUE})(el, ${JSON.stringify(value)});
      })()`);
      if (out === 'no-field-for-label' || out === 'disabled') {
        throw new Error(`[${name}] could not type into "${labelText}" (${out})`);
      }
      return out;
    },
    async setBySelector(selector, value) {
      const out = await evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return 'no-field';
        if (el.disabled) return 'disabled';
        return (${SET_VALUE})(el, ${JSON.stringify(value)});
      })()`);
      if (out === 'no-field' || out === 'disabled') {
        throw new Error(`[${name}] could not type into ${selector} (${out})`);
      }
      return out;
    },
    async valueByLabel(labelText) {
      return evaluate(`(() => {
        const el = (${FIND_BY_LABEL})(${JSON.stringify(labelText)}, 'any');
        return el ? { value: el.value, disabled: el.disabled, tag: el.tagName } : null;
      })()`);
    },
    /** Puts a real file into a file input, and returns what the input says it now holds.
     *
     *  This is the one control the harness cannot drive by dispatching events: a page may not write
     *  `input.files`, so a journey that wants the *product's* size and type checks to run against a
     *  genuine `File` has to hand the bytes to Chrome itself. `DOM.setFileInputFiles` is that door,
     *  and it is used here rather than in a journey so every caller gets the same read-back.
     *
     *  The read-back matters and is the reason this is not just `s('DOM.setFileInputFiles', …)`:
     *  reaching the node needs an `objectId` from the label lookup, and a journey that assumed the
     *  upload could proceed after a silently-empty picker would then measure the product's refusal
     *  of a zero-byte file instead of the file it meant to send. Whether the page's own framework
     *  *reacted* is deliberately not claimed here — a journey asks that by waiting for the control
     *  the file enables, and `pressButtonWhenReady` reports `disabled` as the product's verdict. */
    async setFileByLabel(labelText, filePath) {
      // Chrome 154 removed `DOM.requestNodeId` and the `objectId` form of `DOM.describeNode` (both
      // answer `-32601 … wasn't found` / `-32000 Either nodeId, backendNodeId or objectId must be
      // specified`), so a Runtime remote object can no longer be turned into a node id. The node is
      // therefore marked in the page and found again through the DOM tree — `DOM.getDocument` →
      // `DOM.querySelector` → `DOM.setFileInputFiles` — which this Chrome still answers. Measured on
      // 2026-10-08 against the running preview: the marked input came back holding
      // `{name:'s6-cdp-probe.png', size:70, type:'image/png'}`.
      const mark = await evaluate(`(() => {
        document.querySelectorAll('[data-stage6-file]').forEach((el) => { delete el.dataset.stage6File; });
        const el = (${FIND_BY_LABEL})(${JSON.stringify(labelText)}, 'any');
        if (!el || el.type !== 'file') return false;
        el.dataset.stage6File = '1';
        return true;
      })()`);
      if (mark !== true) {
        throw new Error(`[${name}] no file input answers to the label "${labelText}"`);
      }
      const clearMarks = () => evaluate(`(() => {
        document.querySelectorAll('[data-stage6-file]').forEach((el) => { delete el.dataset.stage6File; });
        return 1;
      })()`);
      let held = null;
      try {
        await s('DOM.enable');
        const { root } = await s('DOM.getDocument', { depth: 0 });
        const found = await s('DOM.querySelector', {
          nodeId: root.nodeId, selector: '[data-stage6-file="1"]' });
        if (!found?.nodeId) {
          throw new Error(`[${name}] the marked file input was not in the DOM tree the page reported`);
        }
        await s('DOM.setFileInputFiles', { files: [filePath], nodeId: found.nodeId });
        held = await evaluate(`(() => {
          const el = (${FIND_BY_LABEL})(${JSON.stringify(labelText)}, 'any');
          const f = el?.files?.[0];
          return f ? { name: f.name, size: f.size, type: f.type, count: el.files.length } : null;
        })()`);
      } finally {
        await clearMarks();
      }
      if (held === null) {
        throw new Error(`[${name}] "${labelText}" still holds no file after DOM.setFileInputFiles`);
      }
      await sleep(80);
      return held;
    },

    /** Presses a button by its visible words. `'absent'` means the product did not offer the
     *  control, `'disabled'` means it offered and refused, and `'obstructed'` means a click was
     *  dispatched somewhere the control was not — three different claims, and §28 depends on
     *  telling them apart.
     *
     *  `scope` is a CSS selector for a container, and it exists because a label is not always
     *  unique on the page: every content row prints its own "Save row" (`ContentEditor.tsx:221`),
     *  so an unscoped search found the first row's — permanently disabled, because that row was
     *  never edited — and §28 read that as the ceremony row refusing to save. With a scope the
     *  search is answered per container, first container that holds a match wins. */
    async pressButton(words, scope = null) {
      const info = await rect(buttonFinder(words, scope));
      if (!info) return 'absent';
      if (info.disabled) return 'disabled';
      const reached = await mouseClick();
      return reached ? 'pressed' : `obstructed (${lastObstruction ?? 'unknown cover'})`;
    },
    async buttonState(words, scope = null) {
      const info = await rect(buttonFinder(words, scope));
      if (!info) return 'absent';
      return info.disabled ? 'disabled' : 'enabled';
    },
    /** Waits until the product offers the action, presses it, and insists the click landed. A row
     *  save re-renders the editor with `busy` set, so a press aimed at a disabled control is not a
     *  product verdict — it is the harness clicking too early, and silently doing nothing. */
    async pressButtonWhenReady(words, timeoutMs = 25_000, scope = null) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const state = await this.buttonState(words, scope);
        if (state === 'enabled') break;
        if (state === 'absent') {
          throw new Error(`[${name}] no button saying "${words}"${scope ? ` in ${scope}` : ''}`);
        }
        if (Date.now() > deadline) {
          throw new Error(`[${name}] "${words}"${scope ? ` in ${scope}` : ''} stayed ${state} for ${timeoutMs}ms`);
        }
        await sleep(200);
      }
      const out = await this.pressButton(words, scope);
      if (out !== 'pressed') {
        throw new Error(`[${name}] "${words}" did not take the click (${out})`);
      }
      return out;
    },
    /** The caption under the freeze button, which is the product's own explanation of why it is
     *  not offering the action. */
    async buttonCaption(words) {
      return evaluate(`(() => {
        const b = [...document.querySelectorAll('button')].find((x) =>
          x.textContent.trim().replace(/\\s+/g, ' ').startsWith(${JSON.stringify(words)}));
        if (!b) return null;
        const p = b.closest('section') || b.parentElement;
        return p ? p.innerText : null;
      })()`);
    },

    async clickSelector(selector) {
      const info = await rect(`document.querySelector(${JSON.stringify(selector)})`);
      if (!info) throw new Error(`[${name}] nothing at ${selector}`);
      if (info.disabled) throw new Error(`[${name}] ${selector} is disabled`);
      if (!(await mouseClick())) {
        throw new Error(`[${name}] ${selector} was covered by ${lastObstruction ?? 'something else'}`);
      }
      await sleep(120);
      return info;
    },
    /** The pack radio is a controlled input whose `onChange` asks the server first, so it reads back
     *  unchecked on the click's own tick and only settles once the choice is recorded. The checked
     *  state is therefore polled, and 'it never became the selection' is reported as the product's
     *  verdict with the value it kept. The attribute value is quoted because a release id is a uuid
     *  and an unquoted CSS attribute value beginning with a digit is not a valid identifier. */
    async pickRadio(group, value, timeoutMs = 25_000) {
      const start = await evaluate(`(() => {
        const el = document.querySelector(
          'input[type=radio][name="' + ${JSON.stringify(group)} + '"][value="'
          + ${JSON.stringify(value)} + '"]');
        if (!el) return 'absent';
        if (el.disabled) return 'disabled';
        el.click();
        return 'clicked';
      })()`);
      if (start === 'absent' || start === 'disabled') {
        throw new Error(`[${this.name}] radio ${group}=${value} → ${start}`);
      }
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        if (await this.radioValue(group) === value) return 'chosen';
        if (Date.now() > deadline) break;
        await sleep(200);
      }
      throw new Error(`[${this.name}] radio ${group}=${value} was clicked but the panel kept `
        + `"${await this.radioValue(group)}" selected`);
    },
    async radioValue(group) {
      return evaluate(`document.querySelector(
        'input[type=radio][name="' + ${JSON.stringify(group)} + '"]:checked')?.value ?? null`);
    },
    async toggleCheckbox(labelText) {
      const out = await evaluate(`(() => {
        const el = (${FIND_BY_LABEL})(${JSON.stringify(labelText)}, 'checkbox');
        if (!el) return 'absent';
        el.click();
        return String(el.checked);
      })()`);
      if (out === 'absent') throw new Error(`[${name}] no checkbox for "${labelText}"`);
      return out;
    },
    async linkHref(words) {
      return evaluate(`[...document.querySelectorAll('a')]
        .find((a) => a.textContent.trim().includes(${JSON.stringify(words)}))?.getAttribute('href') ?? null`);
    },
    /** A dashboard renders its actions after its first fetch, so the link is waited for rather than
     *  assumed; "no link saying X" after the full deadline is a product verdict, not a race. */
    /** Dispatches a real mouse press at page coordinates and applies no hit-test rescue at all.
     *  Every other press path in this driver refuses an obstructed point, which is right for a
     *  journey that wants its own click to land and wrong for §31, whose whole question is what the
     *  browser would hit if a finger went down there. */
    async clickAt(x, y) {
      for (const type of ['mousePressed', 'mouseReleased']) {
        await s('Input.dispatchMouseEvent', {
          type, x, y, clickCount: 1, button: 'left', buttons: type === 'mousePressed' ? 1 : 0 });
      }
      await sleep(80);
    },

    async clickLink(words, timeoutMs = 20_000) {
      const deadline = Date.now() + timeoutMs;
      let info = null;
      for (;;) {
        info = await rect(`[...document.querySelectorAll('a')].find((a) =>
          a.textContent.trim().includes(${JSON.stringify(words)}))`);
        if (info || Date.now() > deadline) break;
        await sleep(200);
      }
      if (!info) throw new Error(`[${name}] no link saying "${words}" after ${timeoutMs}ms`);
      if (!(await mouseClick())) {
        throw new Error(`[${name}] the "${words}" link was covered by ${lastObstruction ?? 'something else'}`);
      }
      await sleep(250);
    },

    async viewport(v) {
      await s('Emulation.setDeviceMetricsOverride', {
        width: v.width, height: v.height, deviceScaleFactor: v.dpr, mobile: v.mobile });
    },
    async setViewportSizeOnly(v) {
      await s('Emulation.clearDeviceMetricsOverride', {}).catch(() => {});
      await s('Emulation.setDeviceMetricsOverride', {
        width: v.width, height: v.height, deviceScaleFactor: v.dpr, mobile: v.mobile });
    },
    async screenshot(path) {
      const r = await s('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      writeFileSync(path, Buffer.from(r.data, 'base64'));
      return `${(r.data.length / 1024).toFixed(0)} kB base64`;
    },

    // ------------------------------------------------------------------ keyboard (§31)
    async pressTab(count = 1) {
      for (let i = 0; i < count; i += 1) {
        await s('Input.dispatchKeyEvent', {
          type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9,
          nativeVirtualKeyCode: 9, modifiers: 0 });
        await s('Input.dispatchKeyEvent', {
          type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9,
          nativeVirtualKeyCode: 9, modifiers: 0 });
        await sleep(60);
      }
    },
    async pressKey(key, { modifiers = 0 } = {}) {
      await s('Input.dispatchKeyEvent', { type: 'keyDown', key, modifiers });
      await s('Input.dispatchKeyEvent', { type: 'keyUp', key, modifiers });
      await sleep(60);
    },
    /** What a keyboard user can actually see: the focused element, its computed indicator, and the
     *  text it announces. `:focus-visible` only applies after a real key event, which is why the
     *  harness drives Tab rather than calling `.focus()`. */
    async focusInfo() {
      return evaluate(`(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return { tag: 'BODY' };
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        const label = el.labels && el.labels.length
          ? el.labels[0].textContent.trim()
          : (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 60);
        return {
          tag: el.tagName, id: el.id || null, type: el.getAttribute('type'),
          role: el.getAttribute('role'), label, href: el.getAttribute('href'),
          outlineWidth: cs.outlineWidth, outlineStyle: cs.outlineStyle, outlineColor: cs.outlineColor,
          boxShadow: cs.boxShadow.slice(0, 140),
          width: Math.round(r.width), height: Math.round(r.height),
          inArticle: Boolean(el.closest('article')),
        };
      })()`);
    },
    async focusPath(steps = 18) {
      const seen = [];
      for (let i = 0; i < steps; i += 1) {
        await this.pressTab();
        seen.push(await this.focusInfo());
      }
      return seen;
    },

    // ------------------------------------------------------------------ privacy surface (§32)
    async privacyState() {
      return evaluate(`(() => ({
        cookie: document.cookie,
        local: Object.keys(window.localStorage),
        session: Object.keys(window.sessionStorage),
        localBytes: JSON.stringify(window.localStorage).length,
      }))()`);
    },
    /** Chrome's own view of cookies for the page's origin — `document.cookie` cannot see an
     *  HttpOnly cookie, so a "no cookies" claim has to be read from the browser, not the DOM. */
    async cookiesForOrigin() {
      const url = await evaluate('window.location.origin');
      const r = await s('Network.getCookies', { urls: [url] });
      return r.cookies.map((c) => ({ name: c.name, value: `<${String(c.value).length} chars>` }));
    },

    // ------------------------------------------------------------------ network capture
    /** Each entry carries the CDP `requestId`, because reading a body back is a per-request call
     *  and a log that cannot name its own requests can only ever report "nothing was seen". */
    async networkLog() {
      return [...requests.entries()].map(([id, entry]) => (
        { requestId: id, ...entry, headers: { ...entry.headers } }));
    },
    async waitForResponse(urlPart, timeoutMs = 25_000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        for (const [id, entry] of requests) {
          if (entry.url.includes(urlPart) && entry.status && entry.hasResponseBody) {
            return { requestId: id, ...entry };
          }
        }
        if (Date.now() > deadline) return null;
        await sleep(120);
      }
    },
    async responseBody(requestId) {
      const r = await s('Network.getResponseBody', { requestId });
      return r.base64Encoded ? Buffer.from(r.body, 'base64').toString('utf8') : r.body;
    },
    /** The headers the app itself put on an RPC call. §28 and §29 ask whether the *server* refuses a
     *  freeze the UI will not offer, which needs the host's own live credentials on a call the
     *  disabled button never makes — so the header set is read from the captured traffic rather than
     *  hand-assembled, and it is never returned to the report. */
    async rpcHeaders() {
      const seen = [...requests.values()].reverse();
      for (const entry of seen) {
        const h = entry.headers;
        if (!entry.url.includes('/rest/v1/rpc/') || !h?.apikey) continue;
        // Header names are matched by lowercase comparison because each one reaches Chrome with
        // the spelling its sender used: the app's own calls arrive lower-cased, while a call this
        // harness made through `fetchFromPage` keeps the mixed-case `Authorization` it was handed.
        // Matching only the exact, lower-case and upper-case spellings of 'authorization' missed
        // that one, so the newest entry won the scan and looked like it carried no token —
        // measured 2026-10-01, where §28's draft write threw over a header that was present.
        const get = (name) => {
          const key = Object.keys(h).find((k) => k.toLowerCase() === name.toLowerCase());
          return key === undefined ? null : h[key];
        };
        const authorization = get('authorization');
        // An entry only answers the question if it actually holds credentials; an OPTIONS preflight
        // or an anonymous call cannot stand in for the host's session.
        if (authorization === null) continue;
        return { apikey: get('apikey'), authorization, profile: get('content-profile') };
      }
      return null;
    },
    /** Runs `fetch` inside the page, with the page's own session. Used to prove the *server*
     *  refuses an action the UI also refuses — the browser's token, not a maintenance token. */
    async fetchFromPage(path, { method = 'POST', headers = {}, body = null } = {}) {
      return await evaluate(`(async () => {
        const res = await fetch(${JSON.stringify(path)}, {
          method: ${JSON.stringify(method)},
          headers: ${JSON.stringify(headers)},
          body: ${body === null ? 'null' : JSON.stringify(body)},
        });
        return { status: res.status, text: await res.text() };
      })()`);
    },
    async localStorageSnapshot() { return evaluate('({ ...window.localStorage })'); },

    async authHeader() {
      /** The host's live bearer token, read out of the app's own persisted session. Returned to
       *  the caller for one request and never printed — journeys mask what they log. */
      const raw = await evaluate(`(async () => {
        for (const key of Object.keys(window.localStorage)) {
          if (!key.startsWith('sb-')) continue;
          const value = JSON.parse(window.localStorage.getItem(key));
          const token = value?.currentSession?.access_token ?? value?.access_token;
          if (token) return token;
        }
        const found = Object.keys(window.localStorage)
          .map((k) => window.localStorage.getItem(k))
          .find((v) => v && v.includes('access_token'));
        return found ? JSON.parse(found).access_token : null;
      })()`);
      return raw ?? null;
    },
    close: async () => {
      const index = open.indexOf(page);
      if (index >= 0) open.splice(index, 1);
      try { await s('Target.closeTarget', { targetId: page.targetId }); } catch { /* gone */ }
    },
  };
  return page;
}
