# Data flow and privacy inventory

Internal working document. Records what the site's **source code** does with
visitor information, and — just as important — what can only be confirmed in
the Azure, SendGrid and Google consoles. It is not a privacy policy; see
[PRIVACY-POLICY-DRAFT.md](PRIVACY-POLICY-DRAFT.md) for that.

Last reviewed against the code on 2026-10-08.

## 1. What the contact form collects

| Field | Required | Notes |
| --- | --- | --- |
| First name, last name | Yes | Up to 80 characters each |
| Email address | Yes | Up to 254 characters; used as the Reply-To of the notification |
| Phone number | No | US 10-digit; normalized to `+1 XXX-XXX-XXXX` |
| Message | Yes | Up to 2,000 characters; whatever the visitor chooses to write |
| (hidden spam-trap field) | — | Real visitors never fill it; contents are not stored or emailed |

**Purpose:** to let Going Coastal Refresh Co. receive and answer a visitor's
inquiry about its services. (Business owner to confirm the wording of any
other purposes, e.g. follow-up marketing — the code does none.)

## 2. Data flow

```
Visitor's browser
   │  HTTPS  POST /api/submit-inquiry   (JSON, or a plain form post without JavaScript)
   ▼
Azure Static Web Apps  ── serves the static pages; routes /api/* to the managed Functions app
   ▼
Azure Functions (managed API, Node.js)  api/src/inquiry.js
   │  validates + sanitizes in memory, builds a plain-text email; nothing is written to disk
   │  HTTPS  Twilio SendGrid Mail Send API
   ▼
Twilio SendGrid  ── sends the email (open/click tracking disabled)
   ▼
Google-hosted mailbox  (CONTACT_TO_EMAIL; default goingcoastalrefresh@gmail.com)
   ▼
Business owner
```

**Email content:** subject `New inquiry from <first> <last>`; body with name,
email, phone (or "(not provided)") and message. Plain text only.

## 3. What the code does *not* do (verified by searching the repository)

- No database, file, queue, blob or table writes. The only runtime
  dependencies are `@azure/functions` and `@sendgrid/mail`; `api/src` imports
  no `fs`, storage, queue or database package.
- No analytics, advertising, tracking pixel or social-media script in any page.
- No Application Insights SDK or custom telemetry in the code.
- No cookies, `localStorage`, `sessionStorage` or IndexedDB use. Measured in a
  fresh headless Chrome profile on all three pages: 0 cookies, 0 storage
  entries. (The owner's earlier private-browser test found no cookies from the
  form submission either.)
- After the font change, the pages make requests **only to the site's own
  origin** (measured). Before the change they also contacted
  `fonts.googleapis.com` and `fonts.gstatic.com`.
- Outbound links: one — the testimonial image links to
  `https://thebeachtobaygroup.com/` (opens in a new tab with
  `rel="noopener noreferrer"`). `mailto:` and `tel:` links leave the browser
  for the visitor's own mail/phone apps.

## 4. Logging

All logging happens in `api/src/inquiry.js` through `context.warn` /
`context.error`. After this change it records only:

| Event | What is logged |
| --- | --- |
| SendGrid call fails | error category (`sendgrid_http_error` / `network_error` / `unknown_error`), HTTP status or system error code, Azure invocation ID |
| Missing configuration | a fixed sentence + invocation ID |
| Honeypot triggered | a fixed sentence + invocation ID |
| Unexpected exception | the exception *type name* + invocation ID (no message or stack, which could echo input) |

Never logged: names, email addresses, phone numbers, messages, request bodies,
email bodies, API keys, or whole SendGrid error objects (those carry the
request and response). A unit test sends distinctive values through every
failure path and asserts none appear in the log output.

Previously the code logged the full SendGrid exception object and the parse
error. Whether older log entries containing such data still exist in Azure
cannot be seen from the repository — see section 6.

## 5. Secrets and configuration

- `SENDGRID_API_KEY`, `CONTACT_FROM_EMAIL`, `CONTACT_TO_EMAIL` are read only in
  `api/src/inquiry.js` via `process.env` (server-side). No page, script or
  stylesheet references them.
- `api/local.settings.json` is git-ignored (verified with `git check-ignore`);
  only `local.settings.json.example` with placeholders is tracked. `.env` and
  `.env.*` were added to `.gitignore` as a safety net (none exist today).
- A scan of all 14 commits found no SendGrid-key-shaped strings or credential
  files.
- The GitHub Actions deploy token is a repository secret
  (`AZURE_STATIC_WEB_APPS_API_TOKEN`); its value was not accessed.
- Note the Reply-To header is the visitor's email address, so anyone who can
  read the inbox sees it — expected, but part of the data flow.

## 6. Known and unknown retention

| Where | What may be held | Status |
| --- | --- | --- |
| Browser | Nothing persisted by the site | Verified |
| Azure Functions worker | Request is processed in memory per invocation | Code-verified; no persistence in code |
| Azure platform logs / Application Insights | At minimum request metadata (URL path, status, timing, client IP) **if** Application Insights is enabled on the Static Web App. Managed functions only produce logs when it is enabled. | **Unknown** — `api/host.json` has App Insights sampling settings but the connection is configured in the Azure portal, not the repo. Check *Static Web App → Monitoring → Application Insights* and its retention. |
| Twilio SendGrid | Delivery processing; its activity/event history may keep the recipient address and the **subject line (which contains the visitor's name)** for a plan-dependent period. | **Unknown** — confirm in the SendGrid account (Email Activity retention, any Event Webhook, suppression lists). Not verifiable from code. |
| Google-hosted mailbox | Every inquiry, until deleted | The owner's mailbox settings, filters and deletion practice decide this. **Unknown** — owner to state. |
| GitHub | Source code only — never submissions | Verified |

## 7. Items the business owner needs to decide or confirm

These are blanks in the draft policy; do not publish it until filled in.

1. Legal business name, mailing address, and the contact address for privacy
   requests.
2. How long inquiries are kept in the mailbox and when they are deleted.
3. Whether inquiry details are ever used for anything besides replying
   (newsletters, marketing, sharing with contractors/partners).
4. How visitor requests to access or delete their information are handled, and
   who answers them.
5. Whether the business wants to describe the SendGrid / Google retention
   settings once checked (section 6).
6. Whether anyone under 13 may use the site (the draft says the site is not
   directed at children — confirm that is accurate).
7. Whether a cookie banner is needed: **none is recommended today** because the
   site sets no cookies and loads no third-party trackers. Revisit if analytics,
   embedded maps/videos, chat widgets or ads are ever added.
