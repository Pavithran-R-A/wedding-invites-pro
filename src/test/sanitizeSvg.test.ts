import { describe, it, expect } from 'vitest';
import { sanitizeSvg } from '@/lib/sanitizeSvg';

const hasScriptTag = (html: string) => /<script/i.test(html);
const hasEventHandler = (html: string) => /\son\w+\s*=/i.test(html);
const hasJsUrl = (html: string) => /javascript:/i.test(html);

describe('sanitizeSvg — trusted SVG rendering boundary', () => {
  it('returns empty string for empty/nullish input', () => {
    expect(sanitizeSvg('')).toBe('');
    expect(sanitizeSvg(null)).toBe('');
    expect(sanitizeSvg(undefined)).toBe('');
  });

  it('preserves harmless presentation-only template SVG', () => {
    const safe =
      '<svg viewBox="0 0 100 140" xmlns="http://www.w3.org/2000/svg">' +
      '<rect x="10" y="10" width="80" height="120" fill="#fbf6f0" stroke="#c9972f" stroke-width="2"/>' +
      '<circle cx="50" cy="40" r="12" fill="#6b1e2a"/>' +
      '<path d="M20 100 L80 100" stroke="#c9972f" fill="none"/>' +
      '<text x="50" y="120" text-anchor="middle" font-size="10">Shubham</text>' +
      '</svg>';
    const out = sanitizeSvg(safe);
    expect(out).toContain('<svg');
    expect(out).toContain('<rect');
    expect(out).toContain('<circle');
    expect(out).toContain('<path');
    expect(out).toContain('Shubham');
  });

  it('removes <script> payloads', () => {
    const evil = '<svg><script>alert("xss")</script><rect width="10" height="10"/></svg>';
    const out = sanitizeSvg(evil);
    expect(hasScriptTag(out)).toBe(false);
    expect(out).not.toContain('alert(');
  });

  it('removes inline event handlers (onload/onclick/onerror)', () => {
    const cases = [
      '<svg onload="alert(1)"><rect width="10" height="10"/></svg>',
      '<svg><rect onclick="alert(1)" width="10" height="10"/></svg>',
      '<svg><image href="x" onerror="alert(1)"/></svg>',
    ];
    for (const evil of cases) {
      expect(hasEventHandler(sanitizeSvg(evil))).toBe(false);
    }
  });

  it('removes javascript: URLs in href/action/xlink', () => {
    const cases = [
      '<svg><a href="javascript:alert(1)"><text>click</text></a></svg>',
      '<svg><use xlink:href="javascript:alert(1)"/></svg>',
    ];
    for (const evil of cases) {
      expect(hasJsUrl(sanitizeSvg(evil))).toBe(false);
    }
  });

  it('removes dangerous external resource references (http/https external href)', () => {
    const evil = '<svg><image href="https://evil.example/track.png"/></svg>';
    const out = sanitizeSvg(evil);
    expect(out).not.toContain('evil.example');
  });

  it('blocks embedded HTML via foreignObject', () => {
    const evil =
      '<svg><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">' +
      '<img src=x onerror="alert(1)"><script>alert(2)</script></div></foreignObject></svg>';
    const out = sanitizeSvg(evil);
    expect(out.toLowerCase()).not.toContain('foreignobject');
    expect(out.toLowerCase()).not.toContain('<div');
    expect(out.toLowerCase()).not.toContain('<img');
    expect(hasScriptTag(out)).toBe(false);
    expect(hasEventHandler(out)).toBe(false);
  });

  it('blocks CDATA-based executable SVG (svg animate onload)', () => {
    const evil = '<svg><animate attributeName="href" values="javascript:alert(1)" dur="0s" fill="freeze"/></svg>';
    const out = sanitizeSvg(evil);
    expect(out.toLowerCase()).not.toContain('<animate');
    expect(hasJsUrl(out)).toBe(false);
  });
});
