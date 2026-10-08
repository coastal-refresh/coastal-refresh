"use strict";

const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const sgMail = require("@sendgrid/mail");
const { Mail } = require("@sendgrid/helpers/classes");

const { handleInquiry, MAX_BODY_BYTES } = require("../src/inquiry");

// ---- test harness ---------------------------------------------------------

const realSend = sgMail.send;
const realSetApiKey = sgMail.setApiKey;
const originalEnv = { ...process.env };

let sent;
let logs;
let sendBehavior;

beforeEach(() => {
  sent = [];
  logs = [];
  sendBehavior = async () => [{ statusCode: 202 }, {}];
  sgMail.setApiKey = () => {};
  sgMail.send = async (msg) => {
    sent.push(msg);
    return sendBehavior(msg);
  };
  process.env.SENDGRID_API_KEY = "test-key-not-real";
  process.env.CONTACT_FROM_EMAIL = "sender@example.test";
  process.env.CONTACT_TO_EMAIL = "owner@example.test";
});

afterEach(() => {
  sgMail.send = realSend;
  sgMail.setApiKey = realSetApiKey;
  process.env = { ...originalEnv };
});

function makeContext() {
  const capture = (level) => (...args) => logs.push({ level, text: args.map(String).join(" "), args });
  return {
    invocationId: "inv-123",
    log: capture("log"),
    warn: capture("warn"),
    error: capture("error"),
  };
}

const VALID = {
  firstName: "Dana",
  lastName: "O'Neil-Smith",
  email: "dana@example.com",
  phone: "205-555-1234",
  message: "We'd love a quote for our condo.",
  website: "",
};

function post(body, contentType = "application/json", extraHeaders = {}) {
  const init = { method: "POST", headers: { "content-type": contentType, ...extraHeaders } };
  if (body !== undefined) {
    init.body = typeof body === "string" || body instanceof Uint8Array ? body : JSON.stringify(body);
  }
  return new Request("http://localhost/api/submit-inquiry", init);
}

function postForm(fields) {
  return post(new URLSearchParams(fields).toString(), "application/x-www-form-urlencoded");
}

async function run(request) {
  return handleInquiry(request, makeContext());
}

// Runs with the context exposed so tests can inspect what was logged.
async function runWithLogs(request) {
  const context = makeContext();
  const res = await handleInquiry(request, context);
  return { res, logs };
}

function assertRejected(res, status, messagePattern) {
  assert.equal(res.status, status);
  assert.ok(res.jsonBody.error, "expected an error message");
  if (messagePattern) {
    assert.match(res.jsonBody.error, messagePattern);
  }
  assert.equal(sent.length, 0, "no email should be sent for a rejected request");
}

// ---- success paths ---------------------------------------------------------

test("valid JSON submission sends one email and returns ok", async () => {
  const res = await run(post(VALID));
  assert.equal(res.status, 200);
  assert.deepEqual(res.jsonBody, { ok: true });
  assert.equal(sent.length, 1);
  const msg = sent[0];
  assert.equal(msg.to, "owner@example.test");
  assert.equal(msg.from, "sender@example.test");
  assert.equal(msg.replyTo.email, "dana@example.com");
  assert.equal(msg.subject, "New inquiry from Dana O'Neil-Smith");
  assert.equal(
    msg.text,
    ["Name: Dana O'Neil-Smith", "Email: dana@example.com", "Phone: +1 205-555-1234", "", VALID.message].join("\n")
  );
  assert.equal(msg.html, undefined, "email stays plain text");
});

test("valid URL-encoded submission redirects to the sent confirmation", async () => {
  const res = await run(postForm(VALID));
  assert.equal(res.status, 303);
  assert.equal(res.headers.Location, "/?sent=1#contact");
  assert.equal(sent.length, 1);
});

test("content type parameters and casing are accepted", async () => {
  const res = await run(post(VALID, "Application/JSON; charset=UTF-8"));
  assert.equal(res.status, 200);
});

test("phone is optional", async () => {
  const { phone, ...noPhone } = VALID;
  const res = await run(post(noPhone));
  assert.equal(res.status, 200);
  assert.match(sent[0].text, /Phone: \(not provided\)/);
});

test("phone formats normalize to +1 XXX-XXX-XXXX", async () => {
  for (const phone of ["(205) 555-1234", "1-205-555-1234", "205.555.1234"]) {
    sent.length = 0;
    const res = await run(post({ ...VALID, phone }));
    assert.equal(res.status, 200, phone);
    assert.match(sent[0].text, /Phone: \+1 205-555-1234/);
  }
});

test("international and Unicode names are accepted", async () => {
  const names = [
    ["José", "García"],
    ["Zoë", "Müller-Łukasiewicz"],
    ["Søren", "Ångström"],
    ["李", "小龍"],
    ["Σοφία", "Παπαδοπούλου"],
    ["Ольга", "Иванова"],
    ["Siobhán", "O’Brien"],
    ["Mary Jo", "St. John"],
    ["Nguyễn", "Thị"],
  ];
  for (const [firstName, lastName] of names) {
    sent.length = 0;
    const res = await run(post({ ...VALID, firstName, lastName }));
    assert.equal(res.status, 200, `${firstName} ${lastName}`);
    assert.match(sent[0].subject, new RegExp(`^New inquiry from ${firstName}`));
  }
});

test("extra fields are ignored and never emailed", async () => {
  const res = await run(post({ ...VALID, bcc: "evil@example.com", subject: "hijack", extra: { a: 1 } }));
  assert.equal(res.status, 200);
  assert.equal(sent[0].bcc, undefined);
  assert.notEqual(sent[0].subject, "hijack");
  assert.doesNotMatch(sent[0].text, /evil@example\.com/);
});

test("a message up to the limit is accepted without truncation", async () => {
  const message = "a".repeat(3000);
  const res = await run(post({ ...VALID, message }));
  assert.equal(res.status, 200);
  assert.ok(sent[0].text.endsWith(message));
});

test("message line breaks are preserved and control characters stripped", async () => {
  const res = await run(post({ ...VALID, message: "line one\r\nline two\u0000\u0007\ttabbed" }));
  assert.equal(res.status, 200);
  assert.ok(sent[0].text.endsWith("line one\nline two\ttabbed"));
});

// ---- validation failures -----------------------------------------------------

test("empty submission is rejected", async () => {
  assertRejected(await run(post({})), 400, /first name/i);
  assertRejected(await run(post("")), 400, /invalid/i);
  assertRejected(await run(post(undefined)), 400, /invalid/i);
});

test("each missing required field is rejected with a helpful message", async () => {
  const cases = { firstName: /first name/i, lastName: /last name/i, email: /email/i, message: /message/i };
  for (const [field, pattern] of Object.entries(cases)) {
    const body = { ...VALID };
    delete body[field];
    const res = await run(post(body));
    assertRejected(res, 400, pattern);
    assert.equal(res.jsonBody.field, field);
  }
});

test("whitespace-only required fields count as missing", async () => {
  assertRejected(await run(post({ ...VALID, message: "   \n\t " })), 400, /message/i);
});

test("invalid email addresses are rejected", async () => {
  const bad = [
    "not-an-email",
    "a@b",
    "a@@b.com",
    "@b.com",
    "a@.com",
    "a@b..com",
    "a b@c.com",
    "Evil<x@y.com>",
    "a@b.com, c@d.com",
    "a@b.com;c@d.com",
    '"quoted"@b.com',
    "a@-b.com",
    ".a@b.com",
    `${"a".repeat(65)}@b.com`,
  ];
  for (const email of bad) {
    const res = await run(post({ ...VALID, email }));
    assertRejected(res, 400, /valid email/i);
    assert.equal(res.jsonBody.field, "email", email);
  }
});

test("invalid optional phone numbers are rejected", async () => {
  for (const phone of ["12345", "555-1234", "abcdefghij", "+44 20 7946 0958", "2".repeat(40), "205-555-1234 ext 5"]) {
    const res = await run(post({ ...VALID, phone }));
    assertRejected(res, 400, /phone/i);
    assert.equal(res.jsonBody.field, "phone", phone);
  }
});

test("names with digits or symbols are rejected", async () => {
  for (const firstName of ["R2D2", "Dana<script>", "Dana‮", "...", "-", "Dana@work", "Dana_"]) {
    const res = await run(post({ ...VALID, firstName }));
    assertRejected(res, 400, /letters/i);
    assert.equal(res.jsonBody.field, "firstName", firstName);
  }
});

test("header-injection attempts are neutralised", async () => {
  const res = await run(
    post({ ...VALID, firstName: "Dana\r\nBcc: evil@example.com", lastName: "Smith", email: "dana@example.com" })
  );
  // CR/LF are stripped, leaving a name that fails the letters-only rule.
  assertRejected(res, 400);

  sent.length = 0;
  const res2 = await run(post({ ...VALID, email: "dana@example.com\r\nBcc: evil@example.com" }));
  assertRejected(res2, 400, /valid email/i);
});

test("overlong values are rejected, not truncated", async () => {
  const cases = [
    ["firstName", "a".repeat(81), /80 characters/],
    ["lastName", "b".repeat(81), /80 characters/],
    ["email", `${"a".repeat(60)}@${"b".repeat(190)}.com`, /254 characters/],
    ["message", "m".repeat(3001), /3,000 characters/],
  ];
  for (const [field, value, pattern] of cases) {
    const res = await run(post({ ...VALID, [field]: value }));
    assertRejected(res, 400, pattern);
    assert.equal(res.jsonBody.field, field);
  }
});

// ---- malformed / hostile requests ----------------------------------------------

test("malformed JSON is rejected with 400 and not logged", async () => {
  const { res, logs: captured } = await runWithLogs(post('{"firstName": "Dana", secret-body-text'));
  assertRejected(res, 400, /invalid/i);
  assert.ok(!captured.some((l) => l.text.includes("secret-body-text")), "raw body must not be logged");
});

test("JSON null, arrays and primitives are rejected without throwing", async () => {
  for (const body of ["null", "[]", '[{"firstName":"Dana"}]', '"a string"', "42", "true"]) {
    const res = await run(post(body));
    assertRejected(res, 400, /invalid/i);
  }
});

test("unexpected field types are rejected without throwing", async () => {
  const bad = [
    { firstName: 123 },
    { lastName: ["Smith"] },
    { email: { address: "a@b.com" } },
    { message: null },
    { message: true },
    { phone: 2055551234 },
    { phone: null },
    { website: { nested: true } },
  ];
  for (const override of bad) {
    const res = await run(post({ ...VALID, ...override }));
    assertRejected(res, 400, /invalid/i);
  }
});

test("invalid UTF-8 is rejected", async () => {
  const res = await run(post(new Uint8Array([0x7b, 0x22, 0xff, 0xfe, 0x22, 0x7d])));
  assertRejected(res, 400, /invalid/i);
});

test("unsupported content types are rejected with 415", async () => {
  for (const type of ["text/plain", "multipart/form-data; boundary=x", "application/xml", ""]) {
    const res = await run(post(JSON.stringify(VALID), type));
    assertRejected(res, 415, /content type/i);
  }
  // No content-type header at all.
  const req = new Request("http://localhost/api/submit-inquiry", { method: "POST", body: "x=1" });
  req.headers.delete("content-type");
  assertRejected(await run(req), 415);
});

test("oversized bodies are rejected with 413 (declared Content-Length)", async () => {
  const big = JSON.stringify({ ...VALID, junk: "x".repeat(MAX_BODY_BYTES + 1) });
  const res = await run(post(big, "application/json", { "content-length": String(big.length) }));
  assertRejected(res, 413);
});

test("oversized bodies are rejected with 413 even if Content-Length is missing or lies", async () => {
  const big = JSON.stringify({ ...VALID, junk: "x".repeat(MAX_BODY_BYTES + 1) });

  // Lying low.
  assertRejected(await run(post(big, "application/json", { "content-length": "20" })), 413);

  // Streamed with no Content-Length at all: stops reading once past the cap.
  let pulled = 0;
  const chunk = new TextEncoder().encode("x".repeat(8 * 1024));
  const stream = new ReadableStream({
    pull(controller) {
      pulled += 1;
      if (pulled > 1000) {
        controller.close();
      } else {
        controller.enqueue(chunk);
      }
    },
  });
  const req = new Request("http://localhost/api/submit-inquiry", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: stream,
    duplex: "half",
  });
  assert.equal(req.headers.get("content-length"), null);
  assertRejected(await run(req), 413);
  assert.ok(pulled < 100, `should stop reading early, pulled ${pulled} chunks`);
});

test("oversized URL-encoded bodies get 413 JSON rather than a redirect", async () => {
  const big = new URLSearchParams({ ...VALID, junk: "x".repeat(MAX_BODY_BYTES + 1) }).toString();
  const res = await run(post(big, "application/x-www-form-urlencoded"));
  assertRejected(res, 413);
});

test("a body just under the cap is still processed", async () => {
  const res = await run(post({ ...VALID, junk: "x".repeat(MAX_BODY_BYTES - 1000) }));
  assert.equal(res.status, 200);
});

// ---- form (non-JS) fallback -------------------------------------------------------

test("URL-encoded validation errors redirect back with sent=0", async () => {
  const res = await run(postForm({ ...VALID, email: "nope" }));
  assert.equal(res.status, 303);
  assert.equal(res.headers.Location, "/?sent=0#contact");
  assert.equal(sent.length, 0);
});

// ---- honeypot ------------------------------------------------------------------------

test("filled honeypot reports success but sends nothing", async () => {
  const { res, logs: captured } = await runWithLogs(post({ ...VALID, website: "http://spam.example" }));
  assert.equal(res.status, 200);
  assert.deepEqual(res.jsonBody, { ok: true });
  assert.equal(sent.length, 0);
  assert.ok(captured.every((l) => !l.text.includes("spam.example") && !l.text.includes(VALID.email)));
});

test("filled honeypot on the form path also looks successful", async () => {
  const res = await run(postForm({ ...VALID, website: "x" }));
  assert.equal(res.status, 303);
  assert.equal(res.headers.Location, "/?sent=1#contact");
  assert.equal(sent.length, 0);
});

test("whitespace-only or empty honeypot does not trigger", async () => {
  assert.equal((await run(post({ ...VALID, website: "   " }))).status, 200);
  assert.equal((await run(post({ ...VALID, website: "" }))).status, 200);
});

// ---- SendGrid configuration and failures --------------------------------------------

test("missing SendGrid configuration returns a generic 500 and sends nothing", async () => {
  for (const name of ["SENDGRID_API_KEY", "CONTACT_FROM_EMAIL"]) {
    process.env.SENDGRID_API_KEY = "test-key-not-real";
    process.env.CONTACT_FROM_EMAIL = "sender@example.test";
    delete process.env[name];
    const res = await run(post(VALID));
    assertRejected(res, 500);
    assert.doesNotMatch(res.jsonBody.error, /sendgrid|configured|api key/i);
  }
});

test("recipient falls back to the default when CONTACT_TO_EMAIL is unset", async () => {
  delete process.env.CONTACT_TO_EMAIL;
  await run(post(VALID));
  assert.equal(sent[0].to, "goingcoastalrefresh@gmail.com");
});

test("SendGrid failure returns a generic 502 and logs only minimal diagnostics", async () => {
  const sensitive = {
    code: 403,
    message: "Forbidden for dana@example.com",
    response: { body: { errors: [{ message: "sender dana@example.com / 205-555-1234 / We'd love a quote" }] } },
    request: { body: VALID },
  };
  sendBehavior = async () => {
    throw sensitive;
  };
  const context = makeContext();
  const res = await handleInquiry(post(VALID), context);

  assert.equal(res.status, 502);
  assert.match(res.jsonBody.error, /could not send/i);
  assert.doesNotMatch(JSON.stringify(res.jsonBody), /403|sendgrid|dana/i);

  assert.equal(logs.length, 1);
  assert.equal(logs[0].level, "error");
  assert.match(logs[0].text, /category=sendgrid_http_error status=403 invocationId=inv-123/);
  assert.ok(logs[0].args.every((a) => typeof a === "string"), "no error objects are logged");
  for (const secret of ["dana", "205-555", "quote", "Forbidden", "test-key-not-real"]) {
    assert.ok(!logs[0].text.includes(secret), `log leaked ${secret}`);
  }
});

test("network-level SendGrid errors log only the system error code", async () => {
  sendBehavior = async () => {
    throw Object.assign(new Error("getaddrinfo ENOTFOUND api.sendgrid.com for dana@example.com"), {
      code: "ENOTFOUND",
    });
  };
  const res = await run(post(VALID));
  assert.equal(res.status, 502);
  assert.match(logs[0].text, /category=network_error code=ENOTFOUND/);
  assert.ok(!logs[0].text.includes("dana"));
});

test("form-path SendGrid failure redirects with sent=0", async () => {
  sendBehavior = async () => {
    throw new Error("boom");
  };
  const res = await run(postForm(VALID));
  assert.equal(res.status, 303);
  assert.equal(res.headers.Location, "/?sent=0#contact");
});

// ---- tracking ---------------------------------------------------------------------------

test("open and click tracking are explicitly disabled", async () => {
  await run(post(VALID));
  assert.deepEqual(sent[0].trackingSettings, {
    openTracking: { enable: false },
    clickTracking: { enable: false, enableText: false },
  });
});

test("the SendGrid SDK serializes the message with tracking disabled", async () => {
  await run(post(VALID));
  // Run the exact message through the real SDK helper (no network involved)
  // to confirm the settings validate and serialize to the v3 API shape.
  const json = Mail.create(sent[0]).toJSON();
  assert.deepEqual(json.tracking_settings, {
    open_tracking: { enable: false },
    click_tracking: { enable: false, enable_text: false },
  });
  assert.equal(json.reply_to.email, "dana@example.com");
  assert.equal(json.reply_to.name, undefined);
});

// ---- logging hygiene -----------------------------------------------------------------------

test("nothing the visitor submitted is ever logged on any path", async () => {
  const pii = { firstName: "Zelda", lastName: "Fitzgerald", email: "zelda.f@example.org", message: "private-text-123" };
  const scenarios = [
    () => post({ ...pii, phone: "bad" }),
    () => post({ ...pii, website: "bot" }),
    () => post(`{"broken": "${pii.message}`),
    () => post({ ...pii, phone: "205-555-1234" }),
  ];
  for (const make of scenarios) {
    await run(make());
  }
  sendBehavior = async () => {
    throw new Error(`failed for ${pii.email} ${pii.message}`);
  };
  await run(post({ ...pii, phone: "205-555-1234" }));
  process.env.SENDGRID_API_KEY = "";
  await run(post({ ...pii, phone: "205-555-1234" }));

  for (const entry of logs) {
    for (const value of Object.values(pii)) {
      assert.ok(!entry.text.includes(value), `log contains submitted data: ${entry.text}`);
    }
  }
});
