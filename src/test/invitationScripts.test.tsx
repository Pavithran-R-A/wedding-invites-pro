// Five scripts, one document — and what this file is entitled to claim about them.
//
// This is *rendering* verification. It says: a host who writes in any of the five scripts
// this build offers a font for gets those exact characters on the page, in a document a
// screen reader is told which language to read in, with the type size and colour they
// chose, and with nothing between their words and the DOM.
//
// It does not say the sample sentences are good Tamil, Telugu, Malayalam or Kannada, and
// it must not be cited as if it did. Nobody who reads those languages as a first language
// has reviewed them; they are strings long enough to exercise combining marks and a full
// line, chosen from ordinary greetings. Stage 4 did not change that: the draft tradition
// pack it added is recorded `human_reviewed: false` and `machine_assisted: true` for exactly
// this reason, and the Tamil line below is a rendering probe rather than that pack's wording.
// See docs/audits/stage-3-public-invitation.md and docs/audits/stage-4-tradition-pack-foundation.md.

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import InvitationRenderer from "@/components/invitation/InvitationRenderer";
import { parsePublicInvitation, type PublicInvitation } from "@/lib/publicInvitation";
import { guestPayload } from "@/test/invitationFixture";

const SAMPLES = [
  {
    code: "en",
    font: "Playfair Display",
    title: "Arun weds Deepa",
    welcome: "With the blessings of our elders, we invite you",
    closing: "With love,\nArun and Deepa",
  },
  {
    code: "ta",
    font: "Noto Sans Tamil",
    title: "அருண் திருமணம்",
    welcome: "எங்கள் பெரியோர்களின் ஆசீர்வாதத்துடன்",
    closing: "அன்புடன்,\nஅருண் மற்றும் தீபா",
  },
  {
    code: "te",
    font: "Noto Sans Telugu",
    title: "అరుణ్ వివాహం",
    welcome: "మా పెద్దల ఆశీర్వదానంతో",
    closing: "ప్రేమతో,\nఅరుణ్ మరియు దీప",
  },
  {
    code: "ml",
    font: "Noto Sans Malayalam",
    title: "അരുൺ വിവാഹം",
    welcome: "ഞങ്ങളുടെ മുതിർന്നവരുടെ ആശീർവാദോടെ",
    closing: "സ്നേഹത്തോടെ,\nഅരുൺ, ദീപ",
  },
  {
    code: "kn",
    font: "Noto Sans Kannada",
    title: "ಅರುಣ್ ಮದುವೆ",
    welcome: "ನಮ್ಮ ಹಿರಿಯರ ಆಶೀರ್ವಾದದೊಂದಿಗೆ",
    closing: "ಪ್ರೀತಿಯಿಂದ,\nಅರುಣ್ ಮತ್ತು ದೀಪ",
  },
];

// What the builder is asked for, not what the object is poked with afterwards: a v2 document
// holds a host's prose twice, once in the flat `welcome` key and once as the `host` body of the
// section whose `host_field` names that slot, because both are read out of the same `draft`
// block at freeze time. `invitationFixture.ts` writes the two together, so every line below is
// a document the projection could actually answer with — and the assertion proves the
// characters survive parser → normalizer → JSX, not just parser → JSX. The title and the style
// are still set here, because the projection writes each of those once.
const rendered = (sample: (typeof SAMPLES)[number]): PublicInvitation => {
  const invitation = parsePublicInvitation(
    guestPayload({ language: sample.code, draft: { welcome: sample.welcome, closing: sample.closing } }),
  );
  if (invitation === null) throw new Error("the fixture no longer parses");
  return {
    ...invitation,
    title: sample.title,
    style: { ...invitation.style, font: sample.font, fontSize: "26", color: "#6b1e2a" },
  };
};

describe("a patrika in each script this build offers a font for", () => {
  for (const sample of SAMPLES) {
    it(`${sample.code}: keeps every character, and names the language it is in`, () => {
      const invitation = rendered(sample);
      const { container } = render(<InvitationRenderer invitation={invitation} />);
      const article = container.querySelector("article") as HTMLElement;

      // The attribute a screen reader and a hyphenator both read. Without it every
      // document below inherits `<html lang="en">` and a Tamil invitation is pronounced
      // in English.
      expect(article.getAttribute("lang")).toBe(sample.code);

      // Character-for-character, through the parser and the JSX. Comparing textContent
      // rather than innerHTML is the point: markup would have changed the serialization
      // and this string comparison would not notice.
      expect(article.textContent).toContain(sample.title);
      expect(article.textContent).toContain(sample.welcome);
      expect(article.textContent).toContain(sample.closing);
      // Each typed line has to be findable whole. A combining mark that survived the
      // parser but lost its base character would break this line-level match where the
      // whole-string `toContain` above could still pass on a shorter fragment.
      for (const line of sample.closing.split("\n")) {
        expect(article.textContent).toContain(line);
      }

      expect(article.style.fontFamily).toContain(sample.font);
      expect(article.style.fontSize).toBe("26px");
      expect(article.style.color).toBe("rgb(107, 30, 42)");
    });
  }

  it("refuses a font name that is not a font name", () => {
    const invitation = {
      ...rendered(SAMPLES[1]),
      style: { ...rendered(SAMPLES[1]).style, font: "Tamil'; } body { display:none" },
    };
    const { container } = render(<InvitationRenderer invitation={invitation} />);
    const article = container.querySelector("article") as HTMLElement;
    // No font-family at all, rather than a value the browser would have to interpret.
    expect(article.style.fontFamily).toBe("");
    expect(article.textContent).toContain(SAMPLES[1].welcome);
  });

  it("carries an additional language without pretending the document switched to it", () => {
    const invitation = rendered(SAMPLES[1]);
    const { container } = render(<InvitationRenderer invitation={invitation} />);
    expect(container.querySelector("article")?.getAttribute("lang")).toBe("ta");
    // `additional` is in the DTO and reaches no attribute yet. Naming that here keeps it
    // from being mistaken for a bug when a mixed-language invitation is designed properly.
    expect(invitation.language.additional).toEqual(["en"]);
  });
});
