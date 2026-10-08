# Going Coastal Refresh Co. — Static Website

This is a plain HTML/CSS/JS rebuild of the client's existing Wix
prototype at `https://goingcoastalrefresh.com/`. It has no build step,
no framework, and no dependency on Wix — it can be opened directly in a
browser, hosted on GitHub Pages, or uploaded to any standard web host.

## How the site is organized

```
index.html       Home page (hero, services, intro, about, testimonial, contact)
portfolio.html   Featured projects, before/after highlights, and full photo gallery
services.html    Service pricing/details (formerly the Wix "Book Online" page)
css/styles.css   All styling and the color/typography variables
js/main.js       Mobile menu, scroll-reveal animations, and contact form submit handling
api/             Azure Functions API (contact form → email via SendGrid) and its tests
assets/fonts/    Self-hosted Fraunces and Inter font files + their license notices
docs/            Privacy/data-flow notes, accessibility review, Azure configuration notes
staticwebapp.config.json   Azure Static Web Apps settings (currently just hides /docs)
images/          All site images, organized by type (see below)
```

```
images/
├── branding/    Logo files
├── portfolio/   Project photos and before/after graphics
├── services/    Photos for the 3 service listings
└── general/     Intro graphic, About section graphic, testimonial graphic
```

## Making common edits

- **Text** (headlines, service descriptions, the About story, contact
  info): open the relevant `.html` file in any text editor — or directly
  on GitHub using the pencil ("Edit this file") icon — and change the
  words between the tags. Everything is commented to say what each block
  controls.
- **Colors**: open `css/styles.css` and look at the top of the file for
  the `:root { ... }` block. Each line is commented with what it
  controls (buttons, backgrounds, text, etc).
- **Images**: replace a file in `images/` while keeping the same
  filename, and the site updates automatically. Or change the `src="..."`
  path in the HTML to point at a new filename.
- **Adding/removing a photo from the gallery**: in `portfolio.html`,
  copy or delete one `<figure><img ...></figure>` line inside the
  `#gallery` section.

No installation, build tools, or command line are required to edit
content — a text editor (or GitHub's own web editor) is enough.

## What changed from the Wix version, and why

The goal of this rebuild was to preserve the client's existing design,
wording, photos and structure as closely as possible while removing the
Wix platform underneath it. A few things could not be carried over
exactly as-is:

- **Live booking calendar removed.** The original "Book Online" page
  used Wix Bookings, a server-side scheduling system. A static site has
  no server, so each service's "Book Now" button has been replaced with
  a "Request This Service" button that goes to the contact form. The
  page was renamed **Services** in the navigation (the Wix site itself
  already labeled this nav link "Services", even though the page URL
  was `/book-online`), and pricing/duration details are shown as plain
  text instead of inside a live booking widget.
- **Contact form posts to an Azure Functions API.** The Home page form
  submits to `/api/submit-inquiry` (see `api/src/functions/submitInquiry.js`),
  a managed Function that emails the submission via SendGrid. It works
  as a plain HTML form POST even without JavaScript; `js/main.js`
  additionally intercepts the submit to send it via `fetch` and show an
  inline success/error message. See "Contact form email setup" below
  for how to configure it.
- **Two Wix pages merged into one.** Wix generated separate `/portfolio`
  and `/portfolio-gallery` pages that were both about the same project
  photos. These were combined into a single `portfolio.html` with clear
  sections ("Featured Projects," "Before & After Highlights," and
  "Photo Gallery") so there's one page to maintain instead of two.
- **Fonts.** The client's live site actually renders with two licensed
  fonts ("Ogg" for headings, "Neue Haas Grotesk" for body text), not the
  Madefor/Helvetica fallback that shows up in Wix's own CSS. Since Ogg and
  Neue Haas Grotesk aren't available as free web fonts, this rebuild loads
  the closest free Google Fonts match for each instead: "Fraunces" (an
  elegant serif similar to Ogg) for headings, and "Inter" (a clean,
  neutral sans-serif similar to Neue Haas Grotesk) for body text. Both are
  self-hosted from `assets/fonts/` (declared with `@font-face` at the top of
  `css/styles.css`, with their SIL Open Font License notices alongside), so
  visitors' browsers never contact Google. They are set in `css/styles.css`'s
  `--font-heading` / `--font-body` variables.
- **Colors** were reconstructed from the Wix theme's own CSS color
  variables (found in the site's page source), not re-guessed from
  scratch — see `css/styles.css` for the exact values.
- **Several sections of the original site were designed as one large
  image** (with the headline and body text baked into the picture) —
  for example the "Meet Dave & Donna, and Penny" About section, the
  intro pitch graphic, and the Realtor testimonial. Where the content
  was important for the client to be able to edit later (the About
  story), the text was transcribed into real, editable HTML in addition
  to keeping the original graphic. Purely decorative or third-party
  branded graphics (the testimonial, the before/after marketing cards)
  were kept as images only, matching how the client already presented
  them.
- **All images are WebP.** The client's designed graphics were originally
  large PNG/JPG exports (1–3 MB each, since they're screenshots
  containing photos and text). They've been converted to WebP (lossless
  for the flat-color logo files, quality-85 lossy for the photographic
  flyers/graphics) for roughly a 90% size reduction with no visible
  quality loss — see git history for the one-off conversion script used.

Nothing was invented: all service descriptions, pricing, the business
story, the Realtor testimonial, and contact information are copied
directly from the live Wix site.

## Hosting

This project is deployed on **Azure Static Web Apps**, built straight
from this GitHub repo (`main` branch) with no build step. In the Azure
portal's "Build Details" when creating the resource: Build Preset
`Custom`, App location `/`, **Api location `api`** (see below), Output
location left blank. The client's domain (`goingcoastalrefresh.com`)
currently points at Wix; it would need to be repointed at Azure once
the client approves the new site (configured under the Static Web
App's Custom domains blade, not via a repo `CNAME` file).

## Contact form email setup

The contact form's `/api/submit-inquiry` endpoint (an Azure Functions
"managed API", in `api/`) sends the submission as an email via
[SendGrid](https://sendgrid.com). To make it work:

1. Create a free SendGrid account and verify a **Single Sender**
   identity (or a full domain) — this is the address the emails will
   be sent *from*. SendGrid won't send on behalf of an unverified
   address.
2. Create a SendGrid API key (Settings → API Keys → Restricted Access,
   with "Mail Send" permission).
3. In the Azure Static Web App resource → **Configuration**, add these
   Application Settings (never commit these to the repo):
   - `SENDGRID_API_KEY` — the API key from step 2
   - `CONTACT_FROM_EMAIL` — the verified sender address from step 1
   - `CONTACT_TO_EMAIL` — where inquiries should land (defaults to
     `goingcoastalrefresh@gmail.com` if not set)
4. Push to `main` — the GitHub Actions workflow Azure created rebuilds
   and redeploys both the site and the API automatically.

### What the form endpoint enforces

`api/src/inquiry.js` holds the logic (`api/src/functions/submitInquiry.js` only
registers it with Azure). It accepts `application/json` (what `js/main.js`
sends) and `application/x-www-form-urlencoded` (the no-JavaScript fallback);
anything else gets 415. Requests over 64 KiB get 413, malformed or non-object
JSON gets 400, and fields must be strings. Values that are too long are
rejected with a message, never silently cut: names 80 characters, email 254,
message 3,000 — keep those in step with the `maxlength` attributes in
`index.html`. A hidden `website` field is a spam trap: if it's filled in, the
API pretends success and sends nothing. Notification emails are plain text with
SendGrid open/click tracking switched off, and the logs never contain what the
visitor typed. See `docs/AZURE-CONFIGURATION.md` for the request-size and
rate-limiting limits of this setup.

**Tests:** `cd api && npm install && npm test` (Node's built-in test runner;
SendGrid is mocked, so no email is ever sent).

### Documentation

- `docs/DATA-FLOW-AND-PRIVACY-INVENTORY.md` — what is collected, where it goes,
  what is and isn't known about retention
- `docs/PRIVACY-POLICY-DRAFT.md` — **draft** policy with `[CONFIRM]` markers for
  the business owner (not for publishing as is)
- `docs/ACCESSIBILITY-REVIEW.md` — WCAG 2.2 AA review, fixes, manual checks
- `docs/AZURE-CONFIGURATION.md` — settings, limitations, deployment checklist

### Local testing

For local testing, copy `api/local.settings.json.example` to
`api/local.settings.json` (already gitignored) and fill in real values,
then run the Static Web Apps CLI (`swa start` or `func start` from
`api/`) — see the [Azure Static Web Apps local
development docs](https://learn.microsoft.com/azure/static-web-apps/local-development)
for the full setup.
