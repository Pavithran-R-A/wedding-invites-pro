// Customer-facing legal copy. Every sentence here is about this build rather than about a plan, because
// the banner on the page promises "what this build actually does today" — and three sentences this page
// used to print had stopped being true while the product grew around them.
//
//   * It said the preview loads its font files from a remote font host. `index.html:24` asks
//     `/fonts/fonts.css` from this same address, `public/fonts/font-manifest.json` names the six
//     families and the packages they were taken from, and the render-asset gate fails a build whose
//     product-facing text names a remote font host again
//     (`scripts/check-render-assets.mjs:374-386`). The disclosure owed now is the opposite one, so this
//     page names no third-party host at all — including in this comment, which the same gate scans.
//   * It said nothing tracks a guest who follows a link. A published address still leaves no record;
//     a household's own link and a family reviewer's link do, because both doors stamp
//     `private.access_tokens.last_used_at` on a read that succeeded
//     (`supabase/migrations/20261009120000_stage8_guest_invitations_rsvp.sql:675-677` and
//     `…stage7_family_approval_review.sql:426-428`) and the host's panel prints the result as
//     "opened on <day>" (`src/components/invitation/GuestInvitationPanel.tsx:700`). A sentence that
//     denies half of that in a privacy policy is worse than no sentence, so the truth is told in two
//     halves here — including what the stamp does not hold.
//   * It said a support and deletion-request channel "will be provided in a later release". Both
//     channels ship now, at `/support` and `/my-data`, over Stage 11's intake substrate — whose own
//     header describes it as receiving a request, routing it and never erasing anything
//     (`supabase/migrations/20261020190300_stage11_privacy_intake.sql:1`). What is genuinely still
//     missing is a self-service download, a self-service removal of a whole account, and the retention
//     rule that decides an erasure; this page says so instead of deferring to a later release.
//
// The data list grew for the same reason. It stopped at drafts while the product stores guest replies,
// uploaded files, frozen versions, threads and requests. Each item below is something a signed-in
// session or a guest can make this build write through `src/integrations/supabase/*`; operator-only
// stores are described by what a customer can observe of them, not enumerated.

import Header from "@/components/landing/Header";
import Footer from "@/components/landing/Footer";
import { PRODUCT } from "@/config/product";

const PrivacyPolicy = () => {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container px-4 md:px-6 py-16 max-w-3xl mx-auto prose prose-sm">
        <h1 className="font-display text-3xl font-bold mb-4">Privacy Policy</h1>
        <div className="bg-muted border border-border rounded-xl p-4 mb-6 text-sm text-muted-foreground">
          Provisional policy for {PRODUCT.name}, an early development-stage product. This is a
          pre-launch build; the
          features and data practices described below reflect what this build actually does today and
          will be updated as the product matures. This is not formal legal advice.
        </div>
        <p className="text-muted-foreground mb-6">Last updated: November 2026</p>

        <h2 className="font-display text-xl font-semibold mt-8 mb-3">What you give us when you sign up</h2>
        <ul className="space-y-1 text-sm text-muted-foreground list-disc pl-5">
          <li>Your email address and a password you choose. Both are held by the account service this
            product is built on, Supabase Auth.</li>
          <li>The name you type on the sign-up form. It is stored with the account.</li>
          <li>This build does not ask for a phone number, an address, a photo identity document, or any
            payment detail, and it has no field that would take one.</li>
        </ul>

        <h2 className="font-display text-xl font-semibold mt-8 mb-3">What you store when you write an invitation</h2>
        <ul className="space-y-1 text-sm text-muted-foreground list-disc pl-5">
          <li>The invitation's title, the language it is written in, the design and styling you chose, and
            an estimated guest count you keep as a planning note.</li>
          <li>The people, places and ceremonies you enter: display names, the role labels you give them,
            group labels, venue names and address text, map links, dates, times and timezones, and any
            note you attach.</li>
          <li>The wording you write for the invitation itself.</li>
          <li>Photos and files you upload. These sit in private storage that a guest cannot list, and the
            panel lets you replace or remove them.</li>
          <li>Every version you freeze: a complete copy of that version's content and styling, its number,
            who froze it and when. Freezing is how an invitation stays readable after it is published, so
            a frozen version is not a pointer — it is the content again.</li>
          <li>The record of the link you publish: its status, the date it went out and the date it was
            taken down, if it was. The address itself is kept as a one-way digest, so the stored row
            cannot be turned back into the address.</li>
        </ul>

        <h2 className="font-display text-xl font-semibold mt-8 mb-3">What you store when you invite people</h2>
        <ul className="space-y-1 text-sm text-muted-foreground list-disc pl-5">
          <li>For each household on your list: the name and salutation you type, how many places you
            expect them to need, which ceremonies they are invited to, and any note you write about
            them. Guests are not asked to create an account.</li>
          <li>The link issued for that household, kept as a digest with its expiry and the date it was
            last opened.</li>
          <li>For a family reviewer you invite: the display name and contact text you type for them, and
            the feedback they send back against the version you froze.</li>
        </ul>

        <h2 className="font-display text-xl font-semibold mt-8 mb-3">What a guest sends us</h2>
        <ul className="space-y-1 text-sm text-muted-foreground list-disc pl-5">
          <li>Whether they are coming, how many people are in their party, and the answer to any question
            this invitation asks — recorded against the household it was sent to, with the date they
            answered.</li>
          <li>Nothing else. A guest's reply carries no name typed at the door, no device detail and no
            location. If a family tells you something over the phone instead, the note about it is yours:
            you can record their answer in the same list, and it is stored as your entry.</li>
        </ul>

        <h2 className="font-display text-xl font-semibold mt-8 mb-3">What you send when you ask us something</h2>
        <ul className="space-y-1 text-sm text-muted-foreground list-disc pl-5">
          <li>A support thread: the summary and category you choose, and every message in it — yours and
            the ones whoever handles it writes back. Its status travels with it, and a resolution code is
            recorded when it closes.</li>
          <li>A data request: which invitation it is about, whether you asked for a copy of it or for its
            removal, the note you typed, and where the request stands.</li>
          <li>Both are visible to your account and to whoever handles them. Reading a thread back shows
            you your own messages and the history of how its status moved — not the private note whoever
            handles it writes, and not the record of what they did to the invitation behind the scenes. A
            request's own note is yours alone, and none of these words are copied into the internal trail
            below.</li>
        </ul>

        <h2 className="font-display text-xl font-semibold mt-8 mb-3">The record of the work itself</h2>
        <p className="text-sm text-muted-foreground">
          When someone who runs this product acts on your invitation — taking a published address down,
          moving a support thread, recording a decision about a data request — that act is written to an
          internal trail: what changed, what it was before and after, who did it, and the reason they gave.
          Your own words in a support message or a request note stay in the thread you wrote them in, and
          are not copied into that trail. Opening a thread or a request from your side writes no trail row:
          asking is not an act anyone has to answer for.
        </p>

        <h2 className="font-display text-xl font-semibold mt-8 mb-3">How Your Session Is Stored</h2>
        <p className="text-sm text-muted-foreground">
          When you sign in, your authentication session is stored by Supabase Auth in your browser's
          local storage. This is a browser storage mechanism, not an HttpOnly server-set session
          cookie. Clearing your browser storage signs you out.
        </p>

        <h2 className="font-display text-xl font-semibold mt-8 mb-3">Payments</h2>
        <p className="text-sm text-muted-foreground">
          This build does not process payments and does not take, store, or have access to card
          details, bank information, or any payment credentials. There is currently no checkout.
        </p>

        <h2 className="font-display text-xl font-semibold mt-8 mb-3">Analytics, tracking and third parties</h2>
        <p className="text-sm text-muted-foreground">
          This build does not run advertising or analytics trackers, sets no analytics cookies, and
          loads no third-party script. The typefaces it draws are carried with the build and asked for
          from this site's own address, so loading this site sends nothing to a remote font host.
          Nothing a page does on its own reaches another company's server: every request an open page
          makes goes to this product and nowhere else.
        </p>
        <p className="text-sm text-muted-foreground mt-2">
          There is one door that leads out, and only you can open it. Next to a published address, the
          sharing panel offers <strong>Open in WhatsApp</strong> — a link that hands the invitation's
          address to WhatsApp when you press it, for you to send on. Pressing it is the only moment this
          product passes that address to anyone other than the person you chose to show it to. Copying
          the address and sending it yourself keeps it inside your own hands.
        </p>

        <h2 className="font-display text-xl font-semibold mt-8 mb-3">What a published invitation shares</h2>
        <p className="text-sm text-muted-foreground">
          Freezing a version and publishing it creates a public web address. Anyone who has that
          address can open the invitation without an account: its name, the wording you wrote, the
          names and ceremonies it contains, and the styling you chose. The address itself is the
          only access control — it is unguessable, but it is not a password, so anyone you forward
          it to can read the invitation and pass it on.
        </p>
        <p className="text-sm text-muted-foreground mt-2">
          A guest who opens it is shown a page and nothing else: no sign of your account, your
          email address, or any internal identifier of the wedding, the version or the link. The
          link is stored as a one-way digest, so the address cannot be recovered from the stored
          record. Taking a link down stops new visitors immediately, and a retired address cannot
          be reactivated.
        </p>
        <p className="text-sm text-muted-foreground mt-2">
          Opening an invitation at its published address leaves no record. This build keeps no visit
          counter, no analytics and no list of who read it.
        </p>
        <p className="text-sm text-muted-foreground mt-2">
          Two links are different, and you should know how. A link issued to one household, and a link
          issued to one family reviewer, each record the date they were last opened, and your own panel
          shows you that date. What is kept is the date on the link: no name, no device, no IP address
          and no record of what the visitor did afterwards. A link that fails to open — forged, expired,
          revoked or withdrawn — leaves the date untouched, so the reading cannot be filled with somebody
          probing for live addresses. What a household's date does not prove is also real: that link is
          held by a household, not by one person, so it says the invitation was opened, not by whom.
        </p>

        <h2 className="font-display text-xl font-semibold mt-8 mb-3">Data Retention and Deletion</h2>
        <p className="text-sm text-muted-foreground">
          Your account and everything in it is kept while the account exists. There is no automated
          retention window in this build: nothing expires on a schedule and no row is deleted by a timer.
        </p>
        <p className="text-sm text-muted-foreground mt-2">
          What you can do yourself today: edit or remove the entries you typed in the editor, replace or
          remove a file you uploaded, take a published address down or rotate it so the old one leads
          nowhere, and revoke a household's or a reviewer's link. Removing one of those does not remove
          everything connected to it — a version you froze, a reply already recorded, and the trail above
          all stay.
        </p>
        <p className="text-sm text-muted-foreground mt-2">
          There is no self-service download of your data in this build, and no self-service way to delete
          a whole invitation or account. Those two things are decided and carried out by a person, and
          this build has the channels for asking:
        </p>
        <ul className="space-y-1 text-sm text-muted-foreground list-disc pl-5">
          <li><strong>/support</strong> — open a thread about an invitation or your account, read it
            later, and reply to it.</li>
          <li><strong>/my-data</strong> — file a request for a copy of what this product holds about one
            of your invitations, or for that data to be removed.</li>
        </ul>
        <p className="text-sm text-muted-foreground mt-2">
          Filing either request records the ask and routes it. It does not produce a file and it does not
          remove rows, and the pages say so rather than implying otherwise: the status line under a
          request describes the request, and a request that has not been settled is still waiting. A
          request names one invitation and belongs to the account that filed it; asking again while one is
          open reaches the same request rather than queueing a second one.
        </p>
        <p className="text-sm text-muted-foreground mt-2">
          What happens after you ask is a human decision, and the rule that should decide it — how long an
          invitation's data is kept after the wedding it announces is over — is not written down yet. When
          it is, this section changes to say what the rule is rather than that there isn't one.
        </p>

        <h2 className="font-display text-xl font-semibold mt-8 mb-3">Access Control</h2>
        <p className="text-sm text-muted-foreground">
          Your project and guest data is isolated per account using Supabase row-level security, so
          other signed-in users cannot read or modify it. A link you publish is the one deliberate
          exception, described above.
        </p>
        <p className="text-sm text-muted-foreground mt-2">
          Beyond that, the people who run this product can read a support thread or a data request you
          file, and the invitation it names, because handling it needs that access. It is not an open
          role: it is a named grant attached to specific accounts and to a specific kind of work, it is
          checked against your session rather than against anything a caller types, and what each of them
          does with it lands in the trail described above. No account can hand itself that grant.
        </p>

        <h2 className="font-display text-xl font-semibold mt-8 mb-3">Contact</h2>
        <p className="text-sm text-muted-foreground">
          The two channels above are in the product: sign in and use <strong>/support</strong> or{' '}
          <strong>/my-data</strong>. Both need a signed-in account, because a thread or a request in this
          product is attached to one. There is no published email address for this preview, and this build
          collects no email address in order to send one to you.
        </p>
      </main>
      <Footer />
    </div>
  );
};

export default PrivacyPolicy;
