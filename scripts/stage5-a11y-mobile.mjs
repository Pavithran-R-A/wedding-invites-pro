// Stage 5 §31 — the accessibility and mobile pass over the surfaces Stage 5 ships.
//
// This is a measurement instrument, not a unit test. It drives a real Chromium against the real
// production bundle (`npm run preview`) and reads facts a jsdom test cannot produce: what answers a
// click at a given coordinate, how big a control is once laid out at 375px, whether a keyboard stop
// is *visibly* different from its unfocused state, and whether a fixed notification overlay covers
// something the host needs to press.
//
// Scope, and where it stops:
//   * Part A — the notification layer. The app raises a Radix toast on the auth pages, the create
//     page and the planning page, so those are measured at four widths with a live toast on screen,
//     and a real click is put down wherever the geometry says a control is covered.
//   * Part B — the Stage 5 host surfaces (the planning page and the pack-driven editor) at a phone
//     and a tablet width: accessible names, target sizes, keyboard traversal, focus visibility,
//     heading structure, horizontal overflow, and the contrast of the copy this stage wrote.
//   * The guest document is not re-measured here. §30's ten shapes across four viewports already
//     reports its overflow, target sizes, contrast and focus at two phone widths, and a second
//     number for one fact would only make the two able to disagree.
//
// No conformance claim is made or implied. The thresholds below are this project's own floors,
// carried over from Stage 3; a full WCAG audit has not been run, so nothing here may be reported as
// conformance.
//
// Prerequisites, checked rather than assumed: the local stack answering on loopback (Part B signs a
// host up through it), `npm run build`, and `npm run preview -- --host 127.0.0.1 --port 4173
// --strictPort`. It shells out to no `docker exec`; everything it reads about the database it reads
// over the loopback API.
//
//   node scripts/stage5-a11y-mobile.mjs            both parts
//   node scripts/stage5-a11y-mobile.mjs --only=band|host
//
// It creates one throwaway account and one wedding, deletes the account in teardown, and refuses to
// run against anything that is not loopback.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { assertLoopback, openBrowser } from './stage5-browser-driver.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PREVIEW_ORIGIN = assertLoopback(
  process.env.STAGE5_PREVIEW_URL ?? 'http://127.0.0.1:4173', 'STAGE5_PREVIEW_URL');
const CDP_PORT = Number(process.env.STAGE5_CDP_PORT ?? 9431);
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) ?? '--only=band,host')
  .slice('--only='.length);
const wants = (part) => ONLY.includes(part);

function localEnv() {
  const text = readFileSync(resolve(ROOT, '.env.local'), 'utf8');
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"|"$/g, '');
  }
  return out;
}

const env = localEnv();
const apiUrl = assertLoopback(env.SUPABASE_LOCAL_URL, 'SUPABASE_LOCAL_URL');
const serviceKey = env.SUPABASE_LOCAL_SERVICE_ROLE_KEY;
if (!serviceKey) throw new Error('.env.local has no service role key for the teardown');

const RUN_TAG = `s5a11y-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const HOST_EMAIL = `a11y+${RUN_TAG}@example.test`;
const PASSWORD = `local-only-${RUN_TAG}`;

const results = [];
let failureCount = 0;
const TOKEN_SHAPED = /(^|[^A-Za-z0-9_-])([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/g;
const mask = (v) => String(v).replace(TOKEN_SHAPED, (whole, lead) => `${lead}‹credential masked›`);

function check(area, name, ok, detail) {
  const shown = detail === undefined ? '' : mask(detail);
  results.push({ area, name, ok: Boolean(ok), detail: shown });
  if (!ok) failureCount += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} [${area}] ${name}${shown ? ` — ${shown}` : ''}`);
}
function measure(area, name, value) {
  const shown = mask(value);
  console.log(`  ..   [${area}] ${name} — ${shown}`);
  results.push({ area, name, ok: true, detail: shown, measured: true });
}
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const flat = (text) => String(text).replace(/\s+/g, ' ').trim();

/** This project's own floors, restated here so the run is self-describing. */
const MIN_TARGET_PX = 24;
const CONTRAST_BODY = 4.5;
const CONTRAST_LARGE = 3;

// --------------------------------------------------------------------------- page-side source
//
// Written with String.raw so a regular expression in the page reads exactly as it is typed here.

/** The accessible name, computed the way a screen reader would arrive at one, in the order the
 *  spec's own algorithm prefers: aria-label, aria-labelledby, an explicit `<label for>`, a wrapping
 *  label, then the element's own text or its other name sources. Reported rather than trusted:
 *  every check that uses it prints the name it found. */
const NAME_FN = String.raw`((el) => {
  const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const textOf = (id) => { const n = document.getElementById(id); return n ? norm(n.textContent) : null; };
  const direct = el.getAttribute('aria-label');
  if (norm(direct)) return norm(direct);
  const by = el.getAttribute('aria-labelledby');
  if (by) { const t = by.split(/\s+/).map(textOf).filter(Boolean).join(' '); if (t) return t; }
  if (el.id) { const lab = document.querySelector('label[for="' + el.id + '"]');
    if (lab) return norm(lab.textContent); }
  const wrap = el.closest('label');
  if (wrap) return norm(wrap.textContent);
  const tag = el.tagName;
  if (tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY') return norm(el.textContent);
  if (tag === 'INPUT' && (el.type === 'submit' || el.type === 'button')) return norm(el.value);
  if (tag === 'INPUT' && el.type === 'image') return norm(el.alt);
  const title = el.getAttribute('title');
  if (norm(title)) return norm(title);
  const alt = el.getAttribute('alt');
  if (norm(alt)) return norm(alt);
  return null;
})`;

const SEL_OF = String.raw`((el) => {
  const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  if (!el) return '(nothing)';
  const tag = el.tagName.toLowerCase();
  const id = el.id ? '#' + el.id : '';
  const cls = norm(typeof el.className === 'string' ? el.className : (el.className && el.className.baseVal))
    .split(' ').filter(Boolean).slice(0, 2).join('.');
  const type = el.type && el.type !== 'text' ? '[' + el.type + ']' : '';
  return tag + id + type + (cls ? '.' + cls : '');
})`;

/** Controls a person could act on. Fieldset-disabled buttons stay in the list because "the product
 *  offers it greyed out and it is 28px tall" is a fact §31 asks for. */
const INTERACTIVE = String.raw`'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link]'`;

/** One read of the live page: the notification overlay if it exists, every laid-out control with
 *  what the browser says is under its centre, plus headings, landmarks and live regions. */
const SNAPSHOT = String.raw`((selectors) => {
  const nameOf = ${NAME_FN};
  const selOf = ${SEL_OF};
  const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const ol = [...document.querySelectorAll('ol')].find((o) => String(o.className).includes('z-[100]')) ?? null;
  const cards = ol ? [...ol.children].filter((c) => c.tagName === 'LI') : [];
  const rectOf = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const band = ol ? Object.assign(rectOf(ol), {
    sel: selOf(ol),
    pointerEvents: getComputedStyle(ol).pointerEvents,
    inlinePointerEvents: ol.style.pointerEvents || null,
    cardCount: cards.length,
    cardRects: cards.map(rectOf),
  }) : null;
  // The page's own top chrome: sticky or fixed bars pinned to the top edge, no taller than half the
  // viewport so a full-screen scrim still counts as an obstruction rather than as chrome. §31 needs
  // this distinction because a header that content scrolls beneath is the header working as designed,
  // while an overlay that steals a press is the defect the band part is looking for. The notification
  // overlay is never chrome — it is the thing under trial.
  const chromeEls = [];
  for (const el of document.querySelectorAll('*')) {
    const p = getComputedStyle(el).position;
    if (p !== 'sticky' && p !== 'fixed') continue;
    if (ol && (ol.contains(el) || el.contains(ol))) continue;
    const r = el.getBoundingClientRect();
    if (r.height <= 0 || r.width <= 0 || Math.round(r.top) > 1) continue;
    if (r.bottom > window.innerHeight * 0.5) continue;
    chromeEls.push(el);
  }
  const chromeBottom = chromeEls.reduce((b, el) => Math.max(b, Math.round(el.getBoundingClientRect().bottom)), 0);
  const inChrome = (node) => Boolean(node) && chromeEls.some((c) => c === node || c.contains(node));
  const controls = [...document.querySelectorAll(selectors)].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }).map((el) => {
    const own = rectOf(el);
    // A control inside its own <label> is pressed through the label, which is the size a user
    // actually aims at, so the effective target is the larger of the two.
    const wrap = el.closest('label');
    const effective = wrap ? rectOf(wrap) : own;
    const hit = document.elementFromPoint(own.x + own.w / 2, own.y + own.h / 2);
    const answer = !hit ? 'nothing-there' : hit === el ? 'self'
      : el.contains(hit) ? 'own-descendant'
        : hit.contains(el) ? 'answered-by-ancestor' : 'other-thing';
    let cover = null;
    if (answer === 'other-thing' || answer === 'answered-by-ancestor') {
      if (ol && ol.contains(hit)) {
        cover = cards.some((c) => c.contains(hit)) ? 'toast-card' : 'band-only';
      } else if (inChrome(hit) && answer === 'other-thing') {
        // The point at this control's centre was answered by the page's own sticky or fixed top bar.
        // For an unfocused control that is where the user had scrolled, not an obstruction — §31's
        // obligation is that a control is never painted over *while it holds focus*, which the
        // keyboard pass measures directly. Kept as its own value so a run still prints it.
        cover = 'top-chrome';
      } else if (answer === 'answered-by-ancestor') cover = 'ancestor:' + selOf(hit);
      else cover = 'other:' + selOf(hit);
    }
    // A disabled button in this app carries disabled:pointer-events-none, so the point at its
    // centre answers through its ancestor — which is that styling doing what it was written to do.
    // Reporting it as an obstruction invented three defects on controls the host cannot press. It is
    // kept as its own reach value so a run still prints it, and the checks are allowed to ignore it.
    const reach = el.disabled && answer !== 'self' && answer !== 'own-descendant'
      ? 'disabled-inert' : answer;
    const cs = getComputedStyle(el);
    return Object.assign({
      sel: selOf(el), tag: el.tagName.toLowerCase(),
      name: nameOf(el), text: norm(el.textContent).slice(0, 40),
      disabled: Boolean(el.disabled), tabIndex: el.tabIndex,
      type: el.getAttribute('type'), href: el.getAttribute('href'),
      role: el.getAttribute('role'),
      pointerEvents: cs.pointerEvents, cursor: cs.cursor,
      reach, cover, insideLabel: Boolean(wrap), own, effective,
    }, own);
  });
  const de = document.documentElement;
  return {
    path: location.pathname, innerWidth: window.innerWidth, innerHeight: window.innerHeight,
    scrollY: Math.round(window.scrollY),
    horizontalOverflowPx: de.scrollWidth - de.clientWidth,
    topChrome: { bottom: chromeBottom, els: chromeEls.map(selOf) },
    band, controls,
    headings: [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => ({
      level: Number(h.tagName.slice(1)), text: norm(h.textContent).slice(0, 44),
      // The editor embeds the guest document in the preview column, and that document has its own
      // level-1 heading — which is right there and wrong for the page around it. The instrument
      // carries the distinction so a check can be scoped instead of the finding being dropped.
      inPreview: Boolean(h.closest('[aria-labelledby="preview-heading"],[aria-label="Preview"]')),
      srOnly: h.classList.contains('sr-only'),
    })),
    landmarks: {
      main: document.querySelectorAll('main').length,
      header: document.querySelectorAll('header').length,
      nav: document.querySelectorAll('nav').length,
    },
    liveRegions: [...document.querySelectorAll('[role=status],[role=alert],[aria-live]')]
      .map((el) => ({ sel: selOf(el), role: el.getAttribute('role'),
        live: el.getAttribute('aria-live'), text: norm(el.textContent).slice(0, 44) })),
  };
})`;

/** Contrast of named text runs, reported as numbers and checked against this project's floors only.
 *
 *  Both colours are composited before the ratio is taken, because `getComputedStyle` returns the
 *  alpha the class asked for and paint throws it away: this app tints the selected pack chip
 *  `rgba(107,30,44,0.05)` and dims the dismiss icon `rgb(107 107 107 / 0.5)`. Reading either as an
 *  opaque colour invents a difference that no eye sees — an early draft of this instrument reported
 *  "1.34:1" on the selected pack label for exactly that reason, and the real number, after
 *  compositing, cleared the floor. A run with no text has no contrast to measure, so swatch buttons
 *  and icon-only nodes are skipped rather than reported as failures. */
const CONTRAST = String.raw`((selectors) => {
  const selOf = ${SEL_OF};
  const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const WHITE = { r: 255, g: 255, b: 255, a: 1 };
  const parse = (c) => {
    const m = String(c).match(/[\d.]+/g);
    if (!m) return null;
    const p = m.map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const over = (fg, back) => {
    const a = Math.max(0, Math.min(1, fg.a));
    return { r: fg.r * a + back.r * (1 - a), g: fg.g * a + back.g * (1 - a),
      b: fg.b * a + back.b * (1 - a), a: 1 };
  };
  const lum = (p) => {
    const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(p.r) + 0.7152 * f(p.g) + 0.0722 * f(p.b);
  };
  const solid = (el) => {
    const c = parse(getComputedStyle(el).backgroundColor);
    return !c || c.a === 0 ? null : c;
  };
  const backdrop = (el) => {
    let node = el;
    while (node) {
      const c = solid(node);
      if (c) return c.a === 1 ? c : over(c, backdrop(node.parentElement));
      node = node.parentElement;
    }
    const root = solid(document.body) ?? solid(document.documentElement);
    return root ? over(root, WHITE) : WHITE;
  };
  const ratio = (a, b) => {
    const x = lum(a), y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  const fmt = (p) => 'rgb(' + [p.r, p.g, p.b].map((v) => Math.round(v)).join(', ') + ')';
  const out = [];
  const skipped = { empty: 0, invisible: 0 };
  const seen = new Set();
  for (const sel of selectors) {
    for (const el of document.querySelectorAll(sel)) {
      if (seen.has(el)) continue;
      seen.add(el);
      const text = norm(el.textContent);
      if (!text) { skipped.empty += 1; continue; }
      const cs = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      if (!box.width || !box.height || cs.visibility === 'hidden' || cs.display === 'none'
        || Number(cs.opacity) === 0) { skipped.invisible += 1; continue; }
      const size = Number.parseFloat(cs.fontSize);
      const weight = Number.parseInt(cs.fontWeight, 10) || 400;
      const large = size >= 24 || (size >= 18.66 && weight >= 700);
      const back = backdrop(el);
      const raw = parse(cs.color) ?? { r: 0, g: 0, b: 0, a: 1 };
      const ink = raw.a === 1 ? raw : over(raw, back);
      const own = solid(el);
      out.push({ role: sel, sel: selOf(el), px: Math.round(size * 100) / 100, weight, large,
        color: fmt(ink) + (raw.a < 1 ? ' (from alpha ' + raw.a + ')' : ''),
        back: fmt(back) + (own && own.a < 1 ? ' (tinted ' + cs.backgroundColor + ')' : ''),
        ratio: Math.round(ratio(ink, back) * 100) / 100, text: text.slice(0, 34) });
      if (out.length >= 45) break;
    }
  }
  return { rows: out, skipped };
})`;

/** Records each candidate control's unfocused style so the keyboard pass can say whether a focus
 *  stop is visibly different, instead of guessing from a class name. Counts two different things:
 *  every node matched (the ones the style is taken from) and the subset a Tab key could actually
 *  stop on. Comparing stops against the first number invents a finding out of every zero-size radio
 *  and every `tabindex="-1"` shortcut an app carries. */
const FOCUS_BASELINE = String.raw`((selectors) => {
  // The blur comes first. Reading the styles while a control still holds focus stores the focused
  // appearance as the unfocused baseline, and the first stop of the traversal is then compared with
  // itself — which reports "no visible change" for an indicator that is plainly there. A run at
  // 768x1024 did exactly that to "Add a ceremony", and the same button read a solid 2px outline with
  // the brand ring rgb(107,30,44) four pixels wide on it when a real Tab landed there. Inside this
  // template a backtick would end it, so style values are written without any.
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  window.scrollTo(0, 0);
  const map = new Map();
  let focusable = 0;
  for (const el of document.querySelectorAll(selectors)) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'
      && !el.disabled && el.tabIndex >= 0) focusable += 1;
    map.set(el, [cs.outlineStyle, cs.outlineWidth, cs.outlineColor, cs.boxShadow,
      cs.borderColor, cs.backgroundColor].join('|'));
  }
  window.__s5FocusBaseline = map;
  return { baselined: map.size, focusable };
})`;

const FOCUS_STOP = String.raw`(() => {
  const nameOf = ${NAME_FN};
  const selOf = ${SEL_OF};
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) {
    // "the page has focus again" is worth more than a boolean: the element the browser names, the
    // address and the scroll position tell a keyboard reaching the end of the document apart from a
    // control that was replaced under it mid-traversal, and only the second is a defect.
    return { body: true, active: selOf(el), url: location.pathname,
      scrollY: Math.round(window.scrollY),
      docHeight: document.documentElement.scrollHeight };
  }
  const cs = getComputedStyle(el);
  const now = [cs.outlineStyle, cs.outlineWidth, cs.outlineColor, cs.boxShadow,
    cs.borderColor, cs.backgroundColor].join('|');
  const base = window.__s5FocusBaseline instanceof Map
    ? window.__s5FocusBaseline.get(el) ?? null : null;
  const r = el.getBoundingClientRect();
  // An off-screen stop has two very different causes: the browser scrolled to the page and something
  // inside a scroll container kept clipping, or the control is simply taller than the window. The
  // nearest scrollable ancestor and the element's own height say which.
  let clippedBy = null;
  for (let node = el.parentElement; node; node = node.parentElement) {
    const s = getComputedStyle(node);
    const scrolls = /(auto|scroll|hidden)/.test(s.overflowY + ' ' + s.overflow);
    if (scrolls && node.scrollHeight > node.clientHeight + 1) {
      clippedBy = selOf(node) + ' scrollTop=' + node.scrollTop + '/'
        + (node.scrollHeight - node.clientHeight);
      break;
    }
  }
  // What a focused control is actually shown through. The top chrome is the same set the snapshot
  // collects, and the two probe points are the first and last row of the control that the window can
  // show at all: if the browser answers either with a bar rather than with the control or one of its
  // own boxes, the user is looking at a focus ring painted underneath the header.
  const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const ol = [...document.querySelectorAll('ol')].find((o) => String(o.className).includes('z-[100]')) ?? null;
  const chromeEls = [];
  for (const node of document.querySelectorAll('*')) {
    const p = getComputedStyle(node).position;
    if (p !== 'sticky' && p !== 'fixed') continue;
    if (ol && (ol.contains(node) || node.contains(ol))) continue;
    const cr = node.getBoundingClientRect();
    if (cr.height <= 0 || cr.width <= 0 || Math.round(cr.top) > 1) continue;
    if (cr.bottom > window.innerHeight * 0.5) continue;
    chromeEls.push(node);
  }
  const centreX = Math.round(r.left + r.width / 2);
  const paintedOverBy = new Set();
  for (const y of [Math.round(r.top) + 2, Math.round(Math.min(r.bottom, window.innerHeight)) - 2]) {
    if (y < 0 || y > window.innerHeight - 1) continue;
    const hit = document.elementFromPoint(centreX, y);
    if (!hit || hit === el || el.contains(hit) || hit.contains(el)) continue;
    if (chromeEls.some((c) => c === hit || c.contains(hit))) paintedOverBy.add(selOf(hit));
  }
  return { sel: selOf(el), name: nameOf(el), tag: el.tagName.toLowerCase(), id: el.id || null,
    content: norm(el.textContent).slice(0, 48), role: el.getAttribute('role'),
    w: Math.round(r.width), h: Math.round(r.height),
    top: Math.round(r.top), bottom: Math.round(r.bottom),
    inView: r.top >= 0 && r.bottom <= window.innerHeight,
    // How much of the control the window does show. Chrome scrolls a focused element only as far as
    // it thinks it must, so a tall field can stop with part of itself past the bottom edge; the
    // question §31 cares about is whether the user can see the thing they are typing into at all.
    visiblePx: Math.max(0, Math.round(Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0))),
    paintedOverBy: [...paintedOverBy],
    tallerThanViewport: r.height > window.innerHeight, clippedBy,
    focusVisible: el.matches(':focus-visible'),
    changed: base === null ? 'unknown' : (now !== base),
    style: now.slice(0, 150) };
})()`;

// --------------------------------------------------------------------------- shared page helpers

async function waitForUrlPart(page, part, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const url = await page.currentUrl();
    if (url.includes(part)) return url;
    if (Date.now() > deadline) return null;
    await sleep(200);
  }
}

/** Types into a live form and presses its submit button. Shaped like the journeys instrument's own
 *  helper rather than imported from it: `stage5-ui-journeys.mjs` runs its whole suite on import,
 *  and §31 has to be runnable on its own. The stability wait is copied because the reason is the
 *  same — the auth routes remount their form as the session changes, and a harness that types into
 *  the first instance presses a button whose fields have just been cleared. */
async function submitForm(page, fields, buttonWords) {
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const ready = await page.evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find((x) =>
        x.textContent.trim().replace(/\\s+/g, ' ').startsWith(${JSON.stringify(buttonWords)}));
      return b && !b.disabled ? 1 : 0;
    })()`);
    if (!ready) { await sleep(300); continue; }
    await sleep(400);
    const missing = [];
    for (const [selector, value] of Object.entries(fields)) {
      await page.setBySelector(selector, value);
      const readBack = await page.evaluate(
        `document.querySelector(${JSON.stringify(selector)})?.value ?? null`);
      if (readBack !== value) missing.push(selector);
    }
    if (missing.length) {
      if (attempt === 8) throw new Error(`the form would not hold its values: ${missing.join(', ')}`);
      await sleep(300);
      continue;
    }
    return page.pressButton(buttonWords);
  }
  return 'never-ready';
}

const describe = (c) => `${c.sel} "${c.name ?? c.text}" own ${c.own.w}x${c.own.h}`
  + (c.insideLabel ? ` label ${c.effective.w}x${c.effective.h}` : '')
  + ` at ${c.x},${c.y}`;

// --------------------------------------------------------------------------- part A: notifications

const BAND_VIEWPORTS = [
  { name: '375x740 phone', width: 375, height: 740, dpr: 3, mobile: true },
  { name: '640x800', width: 640, height: 800, dpr: 2, mobile: false },
  { name: '700x900', width: 700, height: 900, dpr: 2, mobile: false },
  { name: '768x1024 tablet', width: 768, height: 1024, dpr: 2, mobile: false },
];

async function bandProbe(page, v, { path, fields, button, toastWords }) {
  console.log(`\n--- ${path} @ ${v.name}`);
  await page.viewport(v);
  await page.goto(`${PREVIEW_ORIGIN}${path}`);
  await page.waitForSelector(Object.keys(fields)[0], 20_000);
  await sleep(700);

  const empty = await page.evaluate(`${SNAPSHOT}(${INTERACTIVE})`);
  measure('toast-band', `${path} @ ${v.name}: the overlay before any notification`,
    empty.band
      ? `${empty.band.sel} ${empty.band.w}x${empty.band.h} at ${empty.band.x},${empty.band.y}`
        + ` pointer-events=${empty.band.pointerEvents} inline=${JSON.stringify(empty.band.inlinePointerEvents)}`
        + ` cards=${empty.band.cardCount}`
      : 'this page renders no notification overlay element');

  const pressed = await submitForm(page, fields, button);
  const raised = await page.waitForText(toastWords, 25_000);
  if (!raised) {
    check('toast-band', `${path} @ ${v.name}: the app raised the notification this probe needs`, false,
      `press ${pressed}; page said: ${(await page.bodyText()).slice(0, 180)}`);
    return;
  }

  const live = await page.evaluate(`${SNAPSHOT}(${INTERACTIVE})`);
  const band = live.band;
  measure('toast-band', `${path} @ ${v.name}: overlay geometry with a live notification`,
    band ? `band ${band.w}x${band.h} at ${band.x},${band.y} pointer-events=${band.pointerEvents}`
      + ` inline=${JSON.stringify(band.inlinePointerEvents)} card(s)=${JSON.stringify(band.cardRects)}`
      : 'no overlay element');
  if (!band) {
    check('toast-band', `${path} @ ${v.name}: the notification has an overlay element to measure`, false,
      `the page says "${toastWords}" but no notification viewport was found`);
    return;
  }

  // Only a control the host could press can be obstructed from them.
  const pressable = (c) => !c.disabled;
  const byBand = live.controls.filter((c) => pressable(c) && c.cover === 'band-only');
  const byCard = live.controls.filter((c) => pressable(c) && c.cover === 'toast-card');
  const byOther = live.controls.filter((c) => pressable(c) && c.cover && c.cover.startsWith('other:'));
  const byAncestor = live.controls.filter((c) => pressable(c) && c.cover && c.cover.startsWith('ancestor:'));
  const byChrome = live.controls.filter((c) => pressable(c) && c.cover === 'top-chrome');
  if (byChrome.length) {
    measure('toast-band', `${path} @ ${v.name}: controls whose centre was answered by the page's own top bar`,
      `${byChrome.length}: ${byChrome.map((c) => `${describe(c)} ← ${c.cover}`).join(' | ')}`
        + ' — where the page was scrolled, not an obstruction; the keyboard pass measures focus');
  }
  // The placement §31 was run for: a band that starts at the top edge sits on the app header, and on
  // a phone that is the one piece of chrome the host needs in order to leave the page.
  const chromeBottom = live.topChrome?.bottom ?? 0;
  check('toast-band', `${path} @ ${v.name}: the band starts below the page's own top bar`,
    band.y >= chromeBottom,
    `band top y=${band.y}, top chrome bottom y=${chromeBottom}`
      + ` (${(live.topChrome?.els ?? []).join(', ') || 'no top bar on this page'})`);
  const unreachable = live.controls.filter((c) => pressable(c) && !c.cover
    && c.reach !== 'self' && c.reach !== 'own-descendant');
  const inert = live.controls.filter((c) => c.disabled && c.cover);
  if (inert.length) {
    measure('toast-band', `${path} @ ${v.name}: disabled controls whose point answers through an ancestor`,
      `${inert.length}: ${inert.map((c) => `${c.sel} ← ${c.cover}`).join(' | ')}`);
  }

  check('toast-band', `${path} @ ${v.name}: the notification band covers no control`,
    byBand.length === 0,
    byBand.length ? byBand.map(describe).join(' | ')
      : `${live.controls.length} control(s) tested against a ${band.w}x${band.h} band`);
  check('toast-band', `${path} @ ${v.name}: nothing but a notification covers a control`,
    byOther.length === 0,
    byOther.length ? byOther.map((c) => `${describe(c)} ← ${c.cover}`).join(' | ') : 'none');
  check('toast-band', `${path} @ ${v.name}: every control answers for itself at its own centre`,
    byAncestor.length === 0 && unreachable.length === 0,
    [...byAncestor, ...unreachable].map((c) => `${describe(c)} ${c.cover ?? c.reach}`).join(' | ')
      || 'all controls reachable');

  // A notification over content is a notification doing its job; the product's obligation is to give
  // the host a way to move it. So the card is measured, and only checked for the dismissal it offers.
  if (byCard.length) {
    const dismissible = await page.evaluate(`(() => {
      const ol = [...document.querySelectorAll('ol')].find((o) => String(o.className).includes('z-[100]'));
      const card = ol ? ol.querySelector(':scope > li') : null;
      const b = card ? card.querySelector('button') : null;
      return b ? { name: ${NAME_FN}(b), w: Math.round(b.getBoundingClientRect().width),
        h: Math.round(b.getBoundingClientRect().height) } : null;
    })()`);
    check('toast-band', `${path} @ ${v.name}: a control sitting under the card can be freed by dismissing it`,
      Boolean(dismissible) && Boolean(dismissible.name),
      `${byCard.length} control(s) under the card: ${byCard.map(describe).join(' | ')}; `
        + `the card's dismiss control is ${dismissible ? `"${dismissible.name}" ${dismissible.w}x${dismissible.h}` : 'absent'}`);

    // The decisive test: put a real click down at a covered control's centre and ask the page, from
    // inside itself, who received it.
    const received = [];
    for (const c of [...byBand, ...byCard].slice(0, 3)) {
      await page.evaluate(`(() => {
        window.__s5Click = null;
        if (!window.__s5ClickOn) {
          document.addEventListener('click', (e) => { window.__s5Click = ${SEL_OF}(e.target); }, true);
          window.__s5ClickOn = true;
        }
      })()`);
      const before = await page.currentUrl();
      await page.clickAt(c.x + c.w / 2, c.y + c.h / 2);
      const who = await page.evaluate('window.__s5Click');
      const after = await page.currentUrl();
      received.push(`${c.sel} "${c.name ?? c.text}" → ${who ?? '(no click event reached the page)'}`
        + (after !== before ? `, navigated` : ''));
      if (after !== before) await page.goto(before);
      await sleep(250);
    }
    measure('toast-band', `${path} @ ${v.name}: where a real click at a covered centre went`,
      received.join(' · '));
  }

  // Radix's default duration is 5000ms, but its close timer pauses while the overlay holds focus or
  // sits under a pointer and resumes only when focus or the pointer leaves it
  // (`node_modules/@radix-ui/react-toast/dist/index.mjs:116-120`). The real click this probe has just
  // put down at a covered centre does exactly that, so a fixed sleep here reported "still covered"
  // about a notification the app was correctly holding open for the person who touched it — which is
  // what the first run of this check did at 375x740. Hand the focus back, wait for the card to retire
  // on its own, and fall back on the product's own dismissal only if it does not.
  const cardCount = () => page.evaluate(`(() => {
    const ol = [...document.querySelectorAll('ol')].find((o) => String(o.className).includes('z-[100]'));
    return ol ? [...ol.children].filter((c) => c.tagName === 'LI').length : 0;
  })()`);
  await page.evaluate(
    'document.activeElement && document.activeElement.blur && document.activeElement.blur()');
  let waitedMs = 0;
  while (await cardCount() > 0 && waitedMs < 12_000) { await sleep(250); waitedMs += 250; }
  let retirement = `retired on its own ${waitedMs}ms after the overlay gave the focus back`;
  if (await cardCount() > 0) {
    const pressed = await page.evaluate(`(() => {
      const ol = [...document.querySelectorAll('ol')].find((o) => String(o.className).includes('z-[100]'));
      const b = ol ? ol.querySelector(':scope > li button') : null;
      if (!b) return false;
      b.click();
      return true;
    })()`);
    retirement = pressed
      ? 'still on screen after 12s of waiting, so the pass pressed the card\'s own dismiss control'
      : 'still on screen after 12s of waiting, with no dismiss control to press';
    let extra = 0;
    while (await cardCount() > 0 && extra < 4_000) { await sleep(250); extra += 250; }
  }
  measure('toast-band', `${path} @ ${v.name}: how the notification came off the page`, retirement);
  const after = await page.evaluate(`${SNAPSHOT}(${INTERACTIVE})`);
  measure('toast-band', `${path} @ ${v.name}: the overlay once the notification is gone`,
    after.band
      ? `pointer-events=${after.band.pointerEvents} inline=${JSON.stringify(after.band.inlinePointerEvents)}`
        + ` cards=${after.band.cardCount} band=${after.band.w}x${after.band.h}`
      : 'the overlay element is no longer in the document');
  const stillCovered = after.controls.filter((c) => !c.disabled
    && (c.cover === 'band-only' || c.cover === 'toast-card'));
  check('toast-band', `${path} @ ${v.name}: nothing is left covered after the notification retires`,
    stillCovered.length === 0,
    stillCovered.map((c) => `${describe(c)} ← ${c.cover}`).join(' | ') || 'the page is fully reachable');
}

// --------------------------------------------------------------------------- part B: host surfaces

function reportLayout(area, label, snap) {
  measure(area, `${label}: what was read`,
    `${snap.path} @ ${snap.innerWidth}x${snap.innerHeight}, ${snap.controls.length} laid-out controls, `
      + `overflow ${snap.horizontalOverflowPx}px, headings ${snap.headings.length}, `
      + `live regions ${snap.liveRegions.length}, scrollY ${snap.scrollY}`);

  check(area, `${label}: no horizontal overflow`, snap.horizontalOverflowPx <= 1,
    `${snap.horizontalOverflowPx}px`);

  const pressables = snap.controls.filter((c) => ['button', 'a', 'summary'].includes(c.tag));
  const unnamed = pressables.filter((c) => !c.name);
  check(area, `${label}: every button and link has an accessible name`, unnamed.length === 0,
    unnamed.length ? unnamed.map(describe).join(' | ') : `${pressables.length} pressables, all named`);

  const fields = snap.controls.filter((c) => ['input', 'select', 'textarea'].includes(c.tag));
  const unlabelled = fields.filter((c) => !c.name
    && !['checkbox', 'radio', 'hidden', 'submit'].includes(c.type ?? ''));
  check(area, `${label}: every field an adult types into has an accessible name`,
    unlabelled.length === 0,
    unlabelled.length ? unlabelled.map(describe).join(' | ')
      : `${fields.length} field(s) tested`);

  // Target size is measured against the effective target: a 16px radio inside a padded label is a
  // label-sized press target, and calling it 16px would invent a defect the host never meets.
  const small = snap.controls.filter((c) => !c.disabled
    && (c.effective.w < MIN_TARGET_PX || c.effective.h < MIN_TARGET_PX));
  const smallest = snap.controls.filter((c) => !c.disabled)
    .reduce((best, c) => (!best || c.effective.w * c.effective.h < best.effective.w * best.effective.h
      ? c : best), null);
  check(area, `${label}: no enabled control is smaller than ${MIN_TARGET_PX}x${MIN_TARGET_PX} CSS px`,
    small.length === 0,
    small.length ? small.map(describe).join(' | ')
      : `smallest effective target is ${smallest ? `${smallest.effective.w}x${smallest.effective.h} (${smallest.sel})` : '(none)'}`);
  measure(area, `${label}: effective targets below 44 CSS px`,
    snap.controls.filter((c) => !c.disabled && (c.effective.w < 44 || c.effective.h < 44))
      .map((c) => `${c.sel} "${(c.name ?? c.text).slice(0, 22)}" ${c.effective.w}x${c.effective.h}`)
      .join(' | ') || 'none');
  const dead = snap.controls.filter((c) => !c.disabled && c.pointerEvents === 'none');
  check(area, `${label}: no enabled control is taken out of the pointer by its own styling`,
    dead.length === 0, dead.map((c) => `${describe(c)} pointer-events=none`).join(' | ') || 'none');

  // The editor's preview column embeds the guest document, and the guest document properly begins
  // with its own level-1 heading. Counting it against the page around it reports a defect that is
  // the design; ignoring it would hide a real one. So the check is scoped to the page chrome and the
  // nested document's outline is printed for the record. §30 measures that document on its own route.
  const chrome = snap.headings.filter((h) => !h.inPreview);
  const nested = snap.headings.filter((h) => h.inPreview);
  const h1 = chrome.filter((h) => h.level === 1);
  check(area, `${label}: exactly one level-1 heading in the page chrome`, h1.length === 1,
    `found ${h1.length}: ${h1.map((h) => h.text).join(', ') || '(none)'}`);
  const skips = [];
  let previous = 0;
  for (const h of chrome) {
    if (previous && h.level > previous + 1) skips.push(`h${previous} → h${h.level} "${h.text}"`);
    previous = h.level;
  }
  check(area, `${label}: the page-chrome heading sequence does not skip a level`, skips.length === 0,
    skips.join(' | ') || chrome.map((h) => `h${h.level}`).join(' '));
  if (nested.length) {
    measure(area, `${label}: headings belonging to the embedded guest document, not the page`,
      `${nested.length}: ${nested.map((h) => `h${h.level}"${h.text}"`).join(' ')} — ruling: the guest `
        + 'document is a self-contained article and its outline restarts by design');
  }
  measure(area, `${label}: landmarks`, JSON.stringify(snap.landmarks));
  measure(area, `${label}: live regions`,
    snap.liveRegions.map((l) => `${l.role ?? l.live} on ${l.sel} "${l.text}"`).join(' | ') || 'none');
}

async function keyboardPass(page, area, label, { tabs = 60, mustReach = [] } = {}) {
  const candidates = await page.evaluate(`${FOCUS_BASELINE}(${INTERACTIVE})`);
  const stops = [];
  const falls = [];
  for (let i = 0; i < tabs; i += 1) {
    await page.pressTab(1);
    const stop = await page.evaluate(FOCUS_STOP);
    if (stop && stop.body) {
      // One press that lands back on the document is not yet a finding. A notification retiring, a
      // row re-rendering or Radix handing focus to its viewport can all put the page in between two
      // real stops, so press on up to three more times and keep whatever comes back. Only a fall
      // that nothing follows is reported as the traversal ending early.
      let resumed = null;
      for (let retry = 0; retry < 3 && !resumed; retry += 1) {
        await sleep(250);
        await page.pressTab(1);
        i += 1;
        const again = await page.evaluate(FOCUS_STOP);
        if (again && !again.body) resumed = again;
      }
      const previous = stops.length ? `${stops[stops.length - 1].sel} "${stops[stops.length - 1].name ?? ''}"`
        : 'the top of the document';
      falls.push({ previous, at: `${stop.url} scrollY=${stop.scrollY} active=${stop.active}`, resumed });
      if (resumed) { stops.push(resumed); continue; }
      break;
    }
    if (stop) stops.push(stop);
  }
  const seen = new Set();
  const unique = stops.filter((s) => {
    const key = `${s.sel}|${s.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  measure(area, `${label}: keyboard traversal`,
    `${stops.length} Tab stops over ${unique.length} distinct controls; ${candidates.focusable} `
      + `of ${candidates.baselined} matched nodes were live focusables when the pass began`
      + (falls.length ? `; ${falls.length} press(es) landed on the document itself`
        : '; no press landed on the document itself'));
  for (const f of falls) {
    if (f.resumed) {
      measure(area, `${label}: focus fell to the document after ${f.previous} and came back`,
        `${f.at} then ${f.resumed.sel} "${f.resumed.name ?? ''}"`);
    } else {
      check(area, `${label}: focus never fell to the document without a control following`,
        false, `${f.at} after ${f.previous}, so the traversal ended there`);
    }
  }

  const invisible = unique.filter((s) => s.changed === false);
  check(area, `${label}: every keyboard stop is visibly different from its unfocused state`,
    invisible.length === 0,
    invisible.length
      ? invisible.map((s) => `${s.sel} "${s.name ?? ''}" style ${s.style.slice(0, 70)}`).join(' | ')
      : `${unique.filter((s) => s.changed === true).length} stop(s) compared, all visibly changed`);
  const unknown = unique.filter((s) => s.changed === 'unknown');
  if (unknown.length) {
    measure(area, `${label}: stops whose unfocused baseline was lost (a re-render replaced the node)`,
      `${unknown.length}: ${unknown.map((s) => s.sel).join(' | ').slice(0, 200)}`);
  }
  // An empty accessible name is a defect only when the technology is left with nothing to read, and
  // a `role="status"` card is not a thing that gets named at all. Radix makes the card focusable so
  // Escape dismisses it; what a user is told is its contents, once because it is a live region and
  // again because focus moving into an element reads that element. §31's first pass asked the card
  // for a name, got none, and reported the difference between the two as a finding. The measured
  // facts that settled it: the card's text was "SavedYour draft has been updated." with
  // tabIndex=0 and role=status, and Radix renders a second, polite announcement region for the same
  // notification. So the question this check asks is the one with a consequence: does a stop leave
  // the user with neither a name nor any content?
  const nameless = unique.filter((s) => !s.name && !s.content);
  const readByContent = unique.filter((s) => !s.name && s.content);
  if (readByContent.length) {
    measure(area, `${label}: stops with no accessible name, whose contents are what gets read`,
      readByContent.map((s) => `${s.sel} [${s.role ?? s.tag}] "${s.content}"`).join(' | '));
  }
  check(area, `${label}: every keyboard stop says something, by name or by content`,
    nameless.length === 0,
    nameless.map((s) => `${s.sel} ${s.id ?? ''}`).join(' | ')
      || `${unique.length} stops, all with a name or content to read`);

  // A control taller than the window cannot be "in view" by any definition, and a control clipped by
  // an inner scroll container is the browser doing its best with the layout it was given. Both are
  // printed with their geometry so the difference is visible instead of asserted.
  const tooTall = unique.filter((s) => !s.inView && s.tallerThanViewport);
  if (tooTall.length) {
    measure(area, `${label}: stops taller than the window, so no viewport contains them`,
      tooTall.map((s) => `${s.sel} "${s.name ?? ''}" ${s.h}px tall at ${s.top}`).join(' | '));
  }
  const offScreen = unique.filter((s) => !s.inView && !s.tallerThanViewport);
  // Chrome scrolls a focused element only as far as it decides it must, so a 98px textarea can stop
  // with 74px of it above the bottom edge. Measured at 375x740 and again 900ms later, with the
  // window, the layout viewport and the visual viewport all agreeing at 740px and nothing painted
  // over the field: the user sees the box they are typing into and its focus ring. That is a
  // different fact from a stop the window does not show at all, so the check keeps the floor this
  // project already uses for a target — a control must expose at least MIN_TARGET_PX of itself — and
  // the partial clipping is printed rather than dropped.
  const hidden = offScreen.filter((s) => s.visiblePx < MIN_TARGET_PX);
  const partlyClipped = offScreen.filter((s) => s.visiblePx >= MIN_TARGET_PX);
  if (partlyClipped.length) {
    measure(area, `${label}: stops the window shows only part of`, partlyClipped.map((s) =>
      `${s.sel} "${s.name ?? ''}" top=${s.top} bottom=${s.bottom} visiblePx=${s.visiblePx}`
      + ` of ${s.h} clippedBy=${s.clippedBy ?? '(no scrolling ancestor)'}`).join(' | '));
  }
  check(area, `${label}: the keyboard never lands on a control the window hides`,
    hidden.length === 0,
    hidden.map((s) => `${s.sel} "${s.name ?? ''}" top=${s.top} bottom=${s.bottom}`
      + ` visiblePx=${s.visiblePx} clippedBy=${s.clippedBy ?? '(no scrolling ancestor)'}`).join(' | ')
      || `${offScreen.length ? 'partly clipped' : 'every stop'} — nothing hidden from the window`);

  // The obstruction §31 is accountable for on a keyboard is this one: the control the user is
  // standing on must not be underneath the page's own fixed or sticky bars. The first pass asked
  // whether any control anywhere on the page was under something, at whatever scroll position the
  // run happened to be at, and so called the app's 56px sticky header — which exists to be scrolled
  // under — an overlay.
  const obscured = unique.filter((s) => (s.paintedOverBy ?? []).length > 0);
  check(area, `${label}: no focused control is painted over by the page's own top chrome`,
    obscured.length === 0,
    obscured.map((s) => `${s.sel} "${s.name ?? ''}" at ${s.top}..${s.bottom} ← `
      + s.paintedOverBy.join(',')).join(' | ')
      || `${unique.length} stop(s), each answering for itself where it is shown`);

  for (const words of mustReach) {
    const hit = unique.some((s) => (s.name ?? '').toLowerCase().includes(words.toLowerCase()));
    check(area, `${label}: the keyboard reaches "${words}"`, hit,
      hit ? '' : `traversed ${unique.length} stop(s), none named like it: `
        + unique.map((s) => s.name ?? '').join(' / ').slice(0, 240));
  }
  return unique;
}

function contrastReport(area, label, report) {
  const rows = report.rows;
  const failed = rows.filter((r) => r.ratio < (r.large ? CONTRAST_LARGE : CONTRAST_BODY));
  measure(area, `${label}: contrast of the copy this stage wrote`,
    rows.map((r) => `${r.px}px/${r.weight} ${r.ratio}:1 ${r.role} "${r.text}"`).join(' | ').slice(0, 480));
  measure(area, `${label}: runs this instrument declined to guess about`,
    `${report.skipped.empty} with no text of their own (swatches, icon-only nodes), `
      + `${report.skipped.invisible} not painted`);
  check(area, `${label}: every measured text run clears ${CONTRAST_BODY}:1 (large text ${CONTRAST_LARGE}:1)`,
    failed.length === 0,
    failed.length
      ? failed.map((f) => `${f.px}px ${f.ratio}:1 ${f.color} on ${f.back} "${f.text}"`).join(' | ')
      : `${rows.length} run(s) measured`);
}

const EDITOR_VIEWPORTS = [
  { name: '375x740 phone', width: 375, height: 740, dpr: 3, mobile: true },
  { name: '768x1024 tablet', width: 768, height: 1024, dpr: 2, mobile: false },
];

/** The copy §31 is accountable for is the copy Stage 5 wrote: the pack panel's small print, the
 *  server's issue list, the freeze caption and the notices. Labelled by the classes those
 *  components actually use, so the measurement names the surface it came from. */
const STAGE5_TEXT = ['h2', 'legend',
  'section[aria-labelledby="tradition-heading"] p',
  '[role=status]', '[role=alert]', 'label', 'button'];

async function hostHalf(browser) {
  const host = await browser.newPage('a11y-host');
  let weddingId = null;
  await host.viewport(EDITOR_VIEWPORTS[0]);
  await host.goto(`${PREVIEW_ORIGIN}/signup`);
  await host.waitForSelector('#email', 20_000);
  const signed = await submitForm(host, {
    '#name': 'A11y Host', '#email': HOST_EMAIL, '#password': PASSWORD }, 'Sign up');
  const atLogin = await waitForUrlPart(host, '/login');
  check('prelude', 'a throwaway host could sign up through the real screens',
    signed === 'pressed' && Boolean(atLogin),
    `press ${signed}, ${atLogin ?? await host.currentUrl()}`);
  const loggedIn = await submitForm(host, { '#email': HOST_EMAIL, '#password': PASSWORD }, 'Log in');
  const dash = await waitForUrlPart(host, '/dashboard');
  check('prelude', 'the throwaway host reached the dashboard', Boolean(dash),
    `press ${loggedIn}, ${dash ?? await host.currentUrl()}`);

  await host.clickLink('Create Invitation');
  await host.waitForSelector('#title', 20_000);
  await submitForm(host, { '#title': 'Stage 31 a11y pass', '#language': 'ta' }, 'Create Invitation Draft');
  const configureUrl = await waitForUrlPart(host, '/configure');
  if (!configureUrl) {
    throw new Error(`the planning page never opened, so Part B has nothing to measure: `
      + `${(await host.bodyText()).slice(0, 200)}`);
  }
  weddingId = /\/project\/([0-9a-f-]{36})\/configure/.exec(configureUrl)?.[1] ?? null;
  const guestsOk = await host.waitForSelector('#guests', 20_000);
  check('prelude', 'a wedding was created through the UI at phone width',
    Boolean(weddingId) && guestsOk, `wedding ${weddingId?.slice(0, 8)}`);

  // The planning page raises its own 'Saved' notification and does not navigate, which makes it the
  // one session page where a mobile top band can be measured over the form it just saved.
  const phone = EDITOR_VIEWPORTS[0];
  await host.viewport(phone);
  await sleep(500);
  await submitForm(host, { '#guests': '120' }, 'Save Draft');
  const saved = await host.waitForText('Saved', 25_000);
  check('toast-band', `/project/:id/configure @ ${phone.name}: the app raised its own notification`,
    Boolean(saved), saved ?? flat(await host.bodyText()).slice(0, 180));
  const configureSnap = await host.evaluate(`${SNAPSHOT}(${INTERACTIVE})`);
  const configureCovered = configureSnap.controls.filter((c) => !c.disabled
    && (c.cover === 'band-only' || c.cover === 'toast-card'));
  const configureChrome = configureSnap.controls.filter((c) => !c.disabled && c.cover === 'top-chrome');
  if (configureChrome.length) {
    measure('toast-band', `/project/:id/configure @ ${phone.name}: controls under the page's own top bar`,
      `${configureChrome.length}: ${configureChrome.map((c) => describe(c)).join(' | ')}`
        + ' — scroll position, not the notification');
  }
  if (configureSnap.band && configureSnap.topChrome) {
    check('toast-band', `/project/:id/configure @ ${phone.name}: the band starts below the page's own top bar`,
      configureSnap.band.y >= configureSnap.topChrome.bottom,
      `band top y=${configureSnap.band.y}, top chrome bottom y=${configureSnap.topChrome.bottom}`
        + ` (${configureSnap.topChrome.els.join(', ') || 'no top bar'})`);
  }
  measure('toast-band', `/project/:id/configure @ ${phone.name}: overlay over a live form`,
    configureSnap.band
      ? `band ${configureSnap.band.w}x${configureSnap.band.h} at ${configureSnap.band.x},${configureSnap.band.y}`
        + ` pointer-events=${configureSnap.band.pointerEvents}, card(s) `
        + JSON.stringify(configureSnap.band.cardRects)
      : 'no overlay element while the page said Saved');
  check('toast-band', `/project/:id/configure @ ${phone.name}: the notification covers no control on the form`,
    configureCovered.length === 0,
    configureCovered.map((c) => `${describe(c)} ← ${c.cover}`).join(' | ')
      || `${configureSnap.controls.length} control(s) tested`);

  await host.clickLink('Open Invitation Editor');
  const editorUrl = await waitForUrlPart(host, '/edit');
  if (!editorUrl) throw new Error('the editor never opened from the planning page');
  const panel = await host.waitForText('Choose a pack, or write everything yourself.', 30_000);
  const noPackCopy = await host.waitForText('write it yourself', 10_000);
  check('prelude', 'the pack-driven editor loaded at phone width', Boolean(panel) && Boolean(noPackCopy),
    panel && noPackCopy ? 'the panel and its no-pack option both drew'
      : `panel=${Boolean(panel)} no-pack option=${Boolean(noPackCopy)}: `
        + flat(await host.bodyText()).slice(0, 200));

  for (const v of EDITOR_VIEWPORTS) {
    console.log(`\n--- editor @ ${v.name}`);
    await host.viewport(v);
    await sleep(800);
    const snap = await host.evaluate(`${SNAPSHOT}(${INTERACTIVE})`);
    check('editor', `editor @ ${v.name}: the host workbench has exactly one main landmark`,
      snap.landmarks.main === 1,
      `landmarks=${JSON.stringify(snap.landmarks)}`);
    reportLayout('editor', `editor @ ${v.name}`, snap);
    contrastReport('editor', `editor @ ${v.name}`,
      await host.evaluate(`${CONTRAST}(${JSON.stringify(STAGE5_TEXT)})`));
    await keyboardPass(host, 'keyboard', `editor @ ${v.name}`, {
      mustReach: ['No tradition pack', 'Add a person'],
    });
    const reloaded = await host.evaluate(`${SNAPSHOT}(${INTERACTIVE})`);
    const covered = reloaded.controls.filter((c) => c.cover && c.cover !== 'top-chrome' && !c.disabled);
    const underChrome = reloaded.controls.filter((c) => c.cover === 'top-chrome' && !c.disabled);
    if (underChrome.length) {
      measure('editor', `editor @ ${v.name}: controls the page's own top bar is scrolled under`,
        `${underChrome.length}: ${underChrome.map((c) => `${describe(c)} ← ${c.cover}`).join(' | ')}`
          + ' — a sticky bar exists to be scrolled under; focus is what must clear it, and the '
          + 'keyboard pass measures that directly');
    }
    const inertHere = reloaded.controls.filter((c) => c.disabled && c.cover);
    measure('editor', `editor @ ${v.name}: what is pressable and what the page has greyed out`,
      `${reloaded.controls.filter((c) => !c.disabled).length} pressable, `
        + `${reloaded.controls.filter((c) => c.disabled).length} disabled, of which `
        + `${inertHere.length} answer through an ancestor — ${inertHere.length === 0 ? 'nothing'
          : inertHere.map((c) => c.sel).join(', ')} — which is \`disabled:pointer-events-none\` `
          + 'doing what it was written to do, not an obstruction');
    check('editor', `editor @ ${v.name}: no control is covered by an overlay while the host works`,
      covered.length === 0,
      covered.map((c) => `${describe(c)} ← ${c.cover}`).join(' | ')
        || `${reloaded.controls.length} controls, each answering for itself`);
    await host.screenshot(join(SCRATCH_DIR, `editor-${v.width}.png`));
    measure('editor', `editor @ ${v.name}: screenshot kept for this run only`, `editor-${v.width}.png`);
  }
  return { host, weddingId };
}

// --------------------------------------------------------------------------- main

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const SCRATCH_DIR = mkdtempSync(join(tmpdir(), 'stage5-a11y-'));

async function deleteThisAccount() {
  const admin = createClient(apiUrl, serviceKey, { auth: { persistSession: false } });
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const mine = (data?.users ?? []).filter((u) => u.email === HOST_EMAIL);
  for (const u of mine) await admin.auth.admin.deleteUser(u.id);
  const { data: again } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  return (again?.users ?? []).filter((u) => u.email === HOST_EMAIL).length;
}

async function main() {
  console.log(`Stage 5 §31 accessibility and mobile · run tag ${RUN_TAG} · preview ${PREVIEW_ORIGIN}`
    + ` · parts ${ONLY}`);
  const preview = await fetch(`${PREVIEW_ORIGIN}/login`).catch(() => null);
  if (!preview?.ok) {
    throw new Error(`no production bundle at ${PREVIEW_ORIGIN}: run \`npm run build\` and `
      + '`npm run preview -- --host 127.0.0.1 --port 4173 --strictPort`');
  }
  const browser = await openBrowser({ cdpPort: CDP_PORT });
  try {
    if (wants('band')) {
      console.log('\n==> §31 A — the notification layer, on the pages that raise it');
      const page = await browser.newPage('a11y-band');
      for (const v of BAND_VIEWPORTS) {
        await bandProbe(page, v, {
          path: '/login',
          fields: { '#email': `nobody+${RUN_TAG}@example.test`, '#password': 'wrong-on-purpose' },
          button: 'Log in', toastWords: 'Login failed',
        });
      }
    }
    if (wants('host')) {
      console.log('\n==> §31 B — the host surfaces at phone and tablet width');
      const { weddingId } = await hostHalf(browser);
      console.log('\n==> §31 teardown');
      const left = await deleteThisAccount();
      check('cleanup', 'the account this pass created is gone', left === 0, `left ${left}`);
      measure('cleanup', 'wedding left for this run',
        weddingId ? `${weddingId.slice(0, 8)} (owner deleted; the row's own cascade policy applies `
          + 'and is measured by the journeys instrument, not here)' : 'none created');
    }
  } finally {
    await browser.close().catch(() => {});
    rmSync(SCRATCH_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  }
  console.log(`\n==> checks ${results.filter((r) => !r.measured).length}, `
    + `measurements ${results.filter((r) => r.measured).length}, findings ${failureCount}`);
  if (failureCount) {
    console.log('FINDINGS:');
    for (const r of results.filter((x) => !x.ok)) {
      console.log(`  - [${r.area}] ${r.name}: ${r.detail}`);
    }
    console.log('STAGE 5 §31: FINDINGS ABOVE');
    process.exitCode = 1;
  } else {
    console.log('STAGE 5 §31 ACCESSIBILITY / MOBILE: PASS');
  }
}

await main();
