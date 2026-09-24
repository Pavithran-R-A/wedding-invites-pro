import DOMPurify, { type Config } from 'dompurify';

/**
 * Central, trusted boundary for rendering SVG that originates OUTSIDE the app
 * (today: `templates.preview_svg` stored in Supabase and injected via
 * dangerouslySetInnerHTML). Every DB-provided SVG must pass through
 * `sanitizeSvg` before it reaches the DOM.
 *
 * DOMPurify (a maintained, allowlist-based sanitiser) strips executable
 * constructs: <script>, inline event handlers (onload/onclick/...),
 * javascript:/data: URLs, and — via the explicit FORBID list below —
 * foreignObject and other embedded-HTML escape hatches. Harmless,
 * presentational SVG needed by invitation templates is preserved.
 */
const SVG_CONFIG: Config = {
  USE_PROFILES: { svg: true, svgFilters: true },
  FORBID_TAGS: [
    'script',
    'foreignObject',
    'animate',
    'set',
    'handler',
    'listener',
  ],
  FORBID_ATTR: ['onbegin', 'onend', 'onrepeat'],
  ALLOW_DATA_ATTR: false,
  SANITIZE_DOM: true,
  KEEP_CONTENT: false,
};

// Invitation template SVG is self-contained vector art; it must never pull in
// external resources (tracking / data-exfiltration) or execute by URL.
// DOMPurify allows http/https href by default, so strip absolute references.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (!(node instanceof Element)) return;
  for (const attr of ['href', 'xlink:href', 'src', 'action', 'formaction']) {
    const value = node.getAttribute(attr);
    if (value && /^\s*(?:https?:|ftp:|file:|data:|\/\/)/i.test(value)) {
      node.removeAttribute(attr);
    }
  }
});

export function sanitizeSvg(input: string | null | undefined): string {
  if (!input) return '';
  return DOMPurify.sanitize(input, SVG_CONFIG) as string;
}
