// Pilot P4: the landing page's own truth table, checked against the screens that exist.
//
// `HowItWorksSection.tsx` carried two columns — "Implemented foundations in this preview" and "Planned for
// V1 — Not built yet" — and four of the five planned items had since shipped: family approval on a version
// (`/r/:token` plus `FamilyReviewPanel.tsx`, Stage 7), personalised guest links and household scoping
// (`/g/:token` plus `GuestInvitationPanel.tsx`, Stage 8), RSVP replies (`GuestRepliesPanel.tsx`, Stage 8)
// and QR/PDF output (`ShareQrPlate.tsx`, `InvitationOutputsPanel.tsx`, Stage 9). `HeroSection.tsx` and
// `Footer.tsx` each disclaimed the same three capabilities in one sentence. This is the same defect as the
// configure screen's stale caution box, one layer further out: a customer reading the front door is talked
// out of the product they can already use, and the disclaimer is the kind of modest-looking copy that reads
// as safe and is not.
//
// The column a claim sits in is the whole subject of this file, so every cell below reads a claim out of a
// named column rather than out of the page. A page that printed both lists in one place would pass a
// `body.textContent` match and lie anyway.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import HowItWorksSection from '@/components/landing/HowItWorksSection';
import HeroSection from '@/components/landing/HeroSection';
import Footer from '@/components/landing/Footer';

const renderLanding = () => render(
  <MemoryRouter>
    <HowItWorksSection />
    <HeroSection />
    <Footer />
  </MemoryRouter>,
);

/** The text of one named column, read from the heading down. `closest('div')` is the card that holds the
 *  heading, its caption and exactly one list — which is what makes "in the planned column" a real claim
 *  instead of "somewhere on the page". */
const column = (heading: string): string => {
  const el = screen.getByRole('heading', { name: heading, level: 3 });
  return el.closest('div')?.textContent ?? '';
};

/** Capabilities that have screens in this build. Each phrase is deliberately loose enough to survive a
 *  rewording of the bullet, and specific enough that the item cannot be re-added to the planned column
 *  without turning this cell red. */
const SHIPPED = [
  /family|reviewer/i,
  /household|guest link/i,
  /repl/i,
  /\bqr\b|printable/i,
];

describe('the landing page separates what is built from what is not, the way the codebase does', () => {
  it('puts every shipped capability in the implemented column', () => {
    renderLanding();
    const built = column('Implemented foundations in this preview');
    for (const shape of SHIPPED) expect(built).toMatch(shape);
  });

  it('keeps shipped capabilities out of the "not built yet" column, which is the lie this file exists for', () => {
    renderLanding();
    const planned = column('Planned for V1');
    for (const shape of SHIPPED) expect(planned).not.toMatch(shape);
  });

  it('retires the sentence that disclaimed three shipped features in the hero and the footer', () => {
    renderLanding();
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/RSVP, personalised\s+guest links, payment and printing are not part of this build/i);
    expect(text).not.toMatch(/guest links, payment and printing are not part/i);
  });

  it('still names the three limits the pilot genuinely has, in the small print', () => {
    renderLanding();
    const text = document.body.textContent ?? '';
    expect(text).toContain('No checkout in this build, nothing hosted yet');
    expect(text).toContain('no reviewed pack wording has been signed off by a reader of the language it writes');
  });

  it('keeps "Payment and checkout" in the planned column, because the pilot is free and that is the reason', () => {
    renderLanding();
    expect(column('Planned for V1')).toContain('Payment and checkout');
    expect(column('Implemented foundations in this preview')).not.toMatch(/checkout|takes money/i);
  });

  it('stops calling the finished flow something it is only intending to do', () => {
    renderLanding();
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/is intended to work/);
    expect(text).not.toMatch(/what we are building towards/);
    expect(screen.getByRole('heading', { name: /How .* works/, level: 2 })).toBeTruthy();
  });

  it('does not claim a hosted deployment, which is the one limit no screen can argue away', () => {
    renderLanding();
    const text = document.body.textContent ?? '';
    expect(text).toContain('Nothing here has been exercised against a hosted deployment, and nothing is deployed.');
  });
});
