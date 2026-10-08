# Azure configuration, limits and deployment checks

## 1. Required configuration changes

**None.** The three existing Application Settings are still the only ones the
API reads; no new settings, services or paid resources are needed:

| Setting | Purpose | Change? |
| --- | --- | --- |
| `SENDGRID_API_KEY` | SendGrid Mail Send key | No |
| `CONTACT_FROM_EMAIL` | Verified SendGrid sender | No |
| `CONTACT_TO_EMAIL` | Where inquiries land (default `goingcoastalrefresh@gmail.com`) | No |

Values must never be committed, logged or pasted into tickets. If
`SENDGRID_API_KEY` or `CONTACT_FROM_EMAIL` is missing the API now returns a
generic 500 to the visitor ("Could not send your message…") and logs a fixed
line with the invocation ID.

Files added that affect deployment (the GitHub Actions workflow is unchanged):

- `api/package-lock.json` — pins the two direct dependencies and their 32
  transitive packages (all from `registry.npmjs.org`) so deploys are
  repeatable. Currently `@azure/functions` 4.16.5, `@sendgrid/mail` 8.1.6.
- `staticwebapp.config.json` — blocks the public URLs `/docs/*` and
  `/README.md` (internal notes that would otherwise be published, because the
  workflow deploys the whole repo root), adds security headers (section 2a),
  maps `.woff2` to `font/woff2`, and pins the API runtime to `node:22`
  (section 2, item 1). Nothing else depends on it, but see section 2a before
  removing the headers.
- `assets/fonts/` — the self-hosted font files (about 250 KB, well inside the
  Static Web Apps limits).

## 2. Recommended, needs your approval

1. **API runtime (now pinned).** Earlier the repo did not set
   `platform.apiRuntime` and the default was unknown. The deploy log of the
   2026-08-24 production run (GitHub Actions run 32679075935, Oryx build)
   reports `Functions Runtime: ~4, node version: 22` (Node 22.22.0), so the
   default was already Node 22; `staticwebapp.config.json` now pins
   `"apiRuntime": "node:22"` to match, so a future change of the platform
   default cannot silently move the API. Both `node:20` and `node:22` are listed
   as supported by Microsoft (Node 18 ended 2025-05-31). Verify after the next
   deploy that the contact form still works (checklist item 1 below).
2. **Enable Application Insights on the Static Web App** (Monitoring) if it is
   not already on, with a short retention period. Managed functions have **no
   logs at all** without it, so the sanitized failure lines would otherwise be
   lost and failed submissions would go unnoticed. Check current Azure
   Monitor pricing and ingestion allowance first; this is a cost decision for
   the owner. Then add an alert on `SendGrid send failed` traces.
3. **Rate limiting** — see section 4.

## 2a. Security headers and Content-Security-Policy

Observed on the deployed Azure site on 2026-10-08 (the 2026-08-24 build of
`main`; platform defaults only): HTTP redirects to HTTPS (301),
`Strict-Transport-Security: max-age=10886400; includeSubDomains; preload`,
`Referrer-Policy: same-origin`, `X-Content-Type-Options: nosniff`. There was no
Content-Security-Policy, `Permissions-Policy` or framing protection.

`staticwebapp.config.json` now adds, via `globalHeaders` (applied to static
files only — Microsoft documents that global headers do not affect API
responses):

| Header | Value | Why |
| --- | --- | --- |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'` | The site loads only its own scripts, styles, fonts and images (`data:` is used by one decorative icon in the stylesheet). Blocks injected third-party code and framing. No `unsafe-inline`. |
| `X-Frame-Options` | `DENY` | Same framing protection for browsers that ignore CSP `frame-ancestors`. |
| `Permissions-Policy` | camera, microphone, geolocation, payment, usb, motion sensors all off | The site uses none of these features. |

Verified in headless Chrome with these exact headers applied: all three pages at
1280 px and 390 px load with 0 CSP violations, 0 requests to other origins, no
console errors, self-hosted fonts loaded, the mobile menu works, and the form
works both through `fetch` and as a no-JavaScript POST with its 303 redirect
(`form-action 'self'` permits it). Automated checks in `api/test/site.test.js`
fail if inline script/style, a third-party origin, a tracker or browser storage
is later added. **If a future feature needs an outside resource (map, video,
analytics), the CSP must be widened deliberately** — that is the intended
behaviour, and a privacy-policy change would be needed as well.

A CSP is defence in depth, not a substitute for the input handling in
`api/src/inquiry.js`. The emulation above cannot prove how Azure itself
serves the headers; check them after deploy (section 6, item 12).

## 2b. Other public copies of the site

- **GitHub Pages** was found enabled on 2026-10-08 with source branch
  `feature/privacy-security-hardening`, publishing the repo root at
  `https://coastal-refresh.github.io/coastal-refresh/`. That copy ignores
  `staticwebapp.config.json`, so none of the headers or blocks above apply
  there; `/docs/*`, `/README.md` and `/api/src/inquiry.js` are readable, and the
  contact form cannot work (there is no API on Pages: `/api/submit-inquiry`
  returns 404). It also duplicates the public site under another URL. Decide
  whether it is meant to exist; if not, disable it (Repo settings → Pages).
- **The GitHub repository is public**, so everything committed — including
  `docs/` — is readable on GitHub regardless of the Azure route rules. Do not
  commit owner-sensitive audit notes, credentials or customer data to it.

## 3. Request-body size limit — what is and is not enforced

Implemented in `api/src/inquiry.js`:

- Content-Length above 64 KiB is rejected with **413** immediately.
- Otherwise the body is read from the request stream in chunks and reading is
  **cancelled as soon as 64 KiB is exceeded**, whether Content-Length is
  missing, chunked, or lying. Tested with a streamed 8 MB body, which stops
  after a handful of chunks.
- The check happens before UTF-8 decoding and JSON parsing, so oversized input
  never reaches the parser.

**Limitation (not complete protection):** with the default Azure Functions
Node.js setup the Functions host receives the *whole* request and hands it to
the Node worker, so by the time this code runs the bytes have already been
accepted by the platform. The check bounds what this code buffers, decodes and
parses and gives a predictable 413, but it does not stop Azure from receiving a
large upload.

What was investigated:

- Azure Static Web Apps documents a fixed **30 MB** request-size limit on all
  plans; there is no setting to lower it.
- The Functions host's own limit is `FUNCTIONS_REQUEST_BODY_SIZE_LIMIT`
  (default 100 MB), but managed functions reserve the `FUNCTIONS_` prefix for
  the service, so it can't be set there.
- `@azure/functions` can stream the body from the host with
  `app.setup({ enableHttpStream: true })`, which requires Functions host
  ≥ 4.28 — and the SDK **throws at startup** if the host is older. Managed
  functions don't document their host version, so enabling it could take the
  whole API down. It was deliberately not enabled. Even if it worked, the front
  gateway's buffering is outside this code's control.
- Only a gateway in front of the site (e.g. Front Door/WAF, or API Management)
  could cap bodies before they reach the app. That is paid infrastructure and
  is not recommended for this site's size.

Practical risk: low. The 30 MB ceiling, anonymous-endpoint cost model
(Consumption) and SendGrid's own quota are the real limits; this was an
availability/abuse-hardening item, not a data-exposure one.

## 4. Spam and rate limiting

Implemented (no new infrastructure, no third-party requests):

- **Honeypot field** `website`: invisible and unreachable for people; the API
  quietly returns success and sends nothing when it is filled. Each occurrence
  logs a fixed warning (no content), so a false positive (e.g. an aggressive
  autofill extension) would be visible as a count of
  "honeypot field was filled" lines.
- Strict server-side validation, type checks and size limits; invalid requests
  never reach SendGrid.

**Not implemented: real rate limiting.** Static Web Apps managed functions have
no built-in per-client throttling. An in-memory counter was deliberately not
added: each serverless instance has its own memory, instances start and stop
at will, and a determined sender is spread across them — it would give a
false sense of safety. Options if abuse appears:

| Option | Cost / effort | Notes |
| --- | --- | --- |
| Azure Table Storage counter keyed by a hash of client IP + time window (needs a Storage account, connection string as an App Setting, `@azure/data-tables` dependency) | A storage account costs cents per month at this volume; ~1 day to build and test | Enforces limits across instances. A hashed IP is still personal data to disclose. Needs approval (new Azure resource + dependency). |
| Cloudflare Turnstile or similar challenge | Free tier, but adds a third-party request on the page and a privacy disclosure | Strong against bots; contradicts the "no third-party requests" goal, so not chosen. |
| Azure Front Door + WAF rate-limit rule in front of the site | Paid (base fee plus usage; check current pricing) | Heavyweight for a small brochure site. |
| Operational guard: SendGrid usage alerts and a restricted ("Mail Send" only) API key | Free | Detection rather than prevention. Recommended regardless. |

Recommendation: stay with the honeypot and monitor. Add the Table Storage
counter only if junk submissions or SendGrid-quota exhaustion actually occur.

## 5. SendGrid

- Per-message `trackingSettings` now disable open tracking and click tracking
  (including plain-text link tracking). Verified against the installed SDK: the
  message serializes to `tracking_settings.open_tracking.enable=false` and
  `click_tracking.{enable,enable_text}=false`. Sender, recipient and Reply-To
  address are unchanged (Reply-To is now passed as `{ email }` rather than a
  bare string so the SDK can't mis-parse it as "Name <email>").
- Account-level settings are separate; confirm in the SendGrid console that
  *Settings → Tracking* has open/click tracking off too (per-message settings
  take precedence for these emails, but there's no reason to leave them on).
- Confirm Email Activity retention and whether any Event Webhook is configured.
  The subject line includes the visitor's name.

## 6. Verifying a deployment

Replace `$SITE` with the site URL. None of these send an email (all are
rejected before SendGrid); only step 1 does, and it is intended to.

1. **Legitimate submission** — use the real form once. Confirm: success message,
   email arrives, and in Gmail *Show original* the HTML/text contains no tracking
   pixel and no rewritten (`sendgrid.net`) links.
2. **Malformed JSON** → 400:
   `curl -i -X POST $SITE/api/submit-inquiry -H 'Content-Type: application/json' -d '{bad'`
3. **JSON null / array** → 400 (previously an unhandled exception):
   `curl -i -X POST $SITE/api/submit-inquiry -H 'Content-Type: application/json' -d 'null'`
4. **Wrong content type** → 415:
   `curl -i -X POST $SITE/api/submit-inquiry -H 'Content-Type: text/plain' -d 'x'`
5. **Oversized** → 413:
   `head -c 100000 /dev/zero | tr '\0' 'a' | curl -i -X POST $SITE/api/submit-inquiry -H 'Content-Type: application/json' --data-binary @-`
6. **Over-long message** → 400 naming the 2,000-character limit.
7. **Logs** (only if Application Insights is on): run a Log Analytics query over
   `traces` for the last day and confirm no names, emails, phone numbers or
   message text appear; only lines like `SendGrid send failed: category=…`.
8. **Fonts**: browser dev tools → Network → filter "font": all `.woff2` requests
   are to your own domain, none to `fonts.googleapis.com`/`gstatic.com`, and
   the files return `Content-Type: font/woff2`. (Static Web Apps' default MIME
   mapping for `.woff2` could not be confirmed from the docs; if the type is
   wrong add `"mimeTypes": {".woff2": "font/woff2"}` to
   `staticwebapp.config.json`.)
9. **Storage/tracking**: Application → Cookies / Local Storage empty; Network
   shows requests only to your own domain.
10. **Docs not public**: `$SITE/docs/PRIVACY-POLICY-DRAFT.md` returns 404.
11. **Desktop and phone**: load all three pages, open the mobile menu, submit
    the form from a phone.
12. **Headers** (browser dev tools → Network → the page → Response headers, or
    `curl -sI $SITE/`): `Content-Security-Policy`, `X-Frame-Options` and
    `Permissions-Policy` are present alongside the platform's HSTS; the console
    shows no "Refused to load…" CSP messages on any page or during a form
    submission.
13. **Internal files**: `$SITE/README.md` returns 404 (it returned 200 on the
    2026-08-24 build).

## 7. Compatibility notes

- `@azure/functions` 4.16.5 (declared `^4.5.0`): uses the v4 programming model
  (`app.http`), unchanged. `request.body` is a web `ReadableStream`; the same
  code is exercised in tests with the standard `Request` class.
- `@sendgrid/mail` 8.1.6 (declared `^8.1.3`): `trackingSettings` and object
  `replyTo` verified in `@sendgrid/helpers`.
- No new production dependencies. Tests use Node's built-in runner
  (`cd api && npm test`); they mock SendGrid and never send email.
- Managed-functions constraint respected: HTTP trigger only, no storage or
  other bindings.
