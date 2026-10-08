"use strict";

const sgMail = require("@sendgrid/mail");

// Overall cap on the request body. A real submission is a few KB at most
// (message limit below is 3,000 chars); anything near this size is not a
// contact-form submission.
const MAX_BODY_BYTES = 64 * 1024;

const DEFAULT_TO_EMAIL = "goingcoastalrefresh@gmail.com";

// Maximum lengths of the *sanitized* values that get emailed. Keep in sync
// with the maxlength attributes on the form in index.html and with the
// messages shown by js/main.js. Values over a limit are rejected, never
// silently truncated.
const MAX_LENGTHS = {
  firstName: 80,
  lastName: 80,
  email: 254,
  message: 3000,
};
// Raw phone input is only bounded so the digit-stripping below has a sane
// ceiling; the form itself caps this field at 12 characters.
const MAX_RAW_PHONE_LENGTH = 30;

const FIELD_LABELS = {
  firstName: "First name",
  lastName: "Last name",
  email: "Email address",
  message: "Message",
};
const REQUIRED_MESSAGES = {
  firstName: "Please enter your first name.",
  lastName: "Please enter your last name.",
  email: "Please enter your email address.",
  message: "Please enter a message.",
};

// Any Unicode letter or combining mark, plus the punctuation real names use:
// space, apostrophe (straight or curly), period, hyphen. Must contain at
// least one letter. No digits or other symbols.
const NAME_PATTERN = /^(?=.*\p{L})[\p{L}\p{M}'\u2019 .-]+$/u;
// Characters that can never appear in a mailbox address we're willing to put
// in a Reply-To header (whitespace, list/display-name syntax, quoting).
const EMAIL_FORBIDDEN_CHARS = /[\s<>(),;:"\\[\]]/;

const SEND_FAILED_MESSAGE = "Could not send your message. Please try again or email us directly.";

const INVALID_PHONE = Symbol("invalid-phone");
const KNOWN_STRING_FIELDS = ["firstName", "lastName", "email", "phone", "message", "website"];

class ApiError extends Error {
  constructor(status, message, field) {
    super(message);
    this.status = status;
    this.field = field;
  }
}

async function handleInquiry(request, context) {
  // "json" = the fetch() path in js/main.js; "form" = the plain HTML form
  // POST fallback, which gets a redirect back to the page instead of JSON.
  let mode = "json";
  try {
    const mediaType = getMediaType(request);
    if (mediaType === "application/json") {
      mode = "json";
    } else if (mediaType === "application/x-www-form-urlencoded") {
      mode = "form";
    } else {
      throw new ApiError(415, "Unsupported content type.");
    }

    const text = await readBodyText(request);
    const input = pickInput(parseBody(text, mode));

    // Honeypot: real visitors never see or fill this field. Report success
    // so a bot learns nothing, but send nothing.
    if (input.website && input.website.trim() !== "") {
      context.warn(`Inquiry ignored: honeypot field was filled (invocationId=${context.invocationId}).`);
      return respond(mode, 200);
    }

    const fields = validate(input);

    const apiKey = process.env.SENDGRID_API_KEY;
    const fromEmail = process.env.CONTACT_FROM_EMAIL;
    if (!apiKey || !fromEmail) {
      context.error(
        `SENDGRID_API_KEY or CONTACT_FROM_EMAIL is not configured (invocationId=${context.invocationId}).`
      );
      throw new ApiError(500, SEND_FAILED_MESSAGE);
    }
    sgMail.setApiKey(apiKey);

    try {
      await sgMail.send({
        to: process.env.CONTACT_TO_EMAIL || DEFAULT_TO_EMAIL,
        from: fromEmail,
        replyTo: { email: fields.email },
        subject: `New inquiry from ${fields.firstName} ${fields.lastName}`,
        text: [
          `Name: ${fields.firstName} ${fields.lastName}`,
          `Email: ${fields.email}`,
          `Phone: ${fields.phone || "(not provided)"}`,
          "",
          fields.message,
        ].join("\n"),
        // These are internal notifications; no open pixel or rewritten links.
        trackingSettings: {
          openTracking: { enable: false },
          clickTracking: { enable: false, enableText: false },
        },
      });
    } catch (err) {
      // Never log the error object itself: SendGrid errors carry the request
      // and response, which can include the visitor's details.
      const { category, status, code } = summarizeSendError(err);
      context.error(
        `SendGrid send failed: category=${category}` +
          (status ? ` status=${status}` : "") +
          (code ? ` code=${code}` : "") +
          ` invocationId=${context.invocationId}`
      );
      throw new ApiError(502, SEND_FAILED_MESSAGE);
    }

    return respond(mode, 200);
  } catch (err) {
    if (err instanceof ApiError) {
      // Oversized and wrong-type requests aren't from the HTML form, so they
      // always get the real status code rather than a redirect.
      const asJson = err.status === 413 || err.status === 415 ? true : mode === "json";
      return respond(asJson ? "json" : "form", err.status, err.message, err.field);
    }
    // Unexpected bug: log only the error type, not its message or stack,
    // which could echo submitted data.
    context.error(
      `Unhandled error in submit-inquiry: ${err && err.name ? err.name : "unknown"} (invocationId=${context.invocationId}).`
    );
    return respond("json", 500, SEND_FAILED_MESSAGE);
  }
}

function getMediaType(request) {
  const header = request.headers.get("content-type") || "";
  return header.split(";")[0].trim().toLowerCase();
}

// Reads the body in chunks and gives up as soon as it exceeds MAX_BODY_BYTES,
// regardless of what Content-Length claims (or whether it's present).
//
// Platform note: with the default Azure Functions Node setup the host has
// already received the whole body before the worker sees it, so this bounds
// what *this code* will buffer and parse, not what the platform accepts (the
// Static Web Apps request limit is 30 MB). See docs/AZURE-CONFIGURATION.md.
async function readBodyText(request) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new ApiError(413, "Your message is too large to send.");
  }

  if (!request.body) {
    return "";
  }

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {});
      throw new ApiError(413, "Your message is too large to send.");
    }
    chunks.push(value);
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } catch {
    throw new ApiError(400, "Invalid form submission.");
  }
}

function parseBody(text, mode) {
  if (mode === "form") {
    return Object.fromEntries(new URLSearchParams(text));
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    // Deliberately not logging the body or the parse error.
    throw new ApiError(400, "Invalid form submission.");
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new ApiError(400, "Invalid form submission.");
  }
  return data;
}

// Copies only the fields we know about (extras are ignored, never emailed)
// and requires each to be a string when present.
function pickInput(data) {
  const input = {};
  for (const name of KNOWN_STRING_FIELDS) {
    const value = Object.prototype.hasOwnProperty.call(data, name) ? data[name] : undefined;
    if (value !== undefined && typeof value !== "string") {
      throw new ApiError(400, "Invalid form submission.", name === "website" ? undefined : name);
    }
    input[name] = value;
  }
  return input;
}

function validate(input) {
  const fields = {
    firstName: sanitizeSingleLine(input.firstName),
    lastName: sanitizeSingleLine(input.lastName),
    email: sanitizeSingleLine(input.email),
    message: sanitizeMessage(input.message),
  };

  for (const name of ["firstName", "lastName", "email", "message"]) {
    if (!fields[name]) {
      throw new ApiError(400, REQUIRED_MESSAGES[name], name);
    }
    if (fields[name].length > MAX_LENGTHS[name]) {
      throw new ApiError(
        400,
        `${FIELD_LABELS[name]} must be ${MAX_LENGTHS[name].toLocaleString("en-US")} characters or fewer ` +
          `(it is currently ${fields[name].length.toLocaleString("en-US")}).`,
        name
      );
    }
  }

  for (const name of ["firstName", "lastName"]) {
    if (!NAME_PATTERN.test(fields[name])) {
      throw new ApiError(
        400,
        `${FIELD_LABELS[name]} can only contain letters, spaces, hyphens, apostrophes and periods.`,
        name
      );
    }
  }

  if (!isValidEmail(fields.email)) {
    throw new ApiError(400, "Please enter a valid email address.", "email");
  }

  fields.phone = normalizePhone(input.phone);
  if (fields.phone === INVALID_PHONE) {
    throw new ApiError(400, "Please enter a valid 10-digit US phone number.", "phone");
  }

  return fields;
}

// Strips control characters (including CR/LF and the Unicode line/paragraph
// separators) so a field can never inject email headers or break out of the
// single line it belongs on.
function sanitizeSingleLine(raw) {
  const value = typeof raw === "string" ? raw : "";
  return value
    .replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g, "")
    .normalize("NFC")
    .trim();
}

// Same idea, but the message keeps real line breaks and tabs.
function sanitizeMessage(raw) {
  const value = typeof raw === "string" ? raw : "";
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u2028\u2029]/g, "")
    .trim();
}

function isValidEmail(email) {
  const at = email.indexOf("@");
  if (at <= 0 || at !== email.lastIndexOf("@") || EMAIL_FORBIDDEN_CHARS.test(email)) {
    return false;
  }
  const local = email.slice(0, at);
  if (local.length > 64 || local.startsWith(".") || local.endsWith(".") || local.includes("..")) {
    return false;
  }
  const labels = email.slice(at + 1).split(".");
  return labels.length >= 2 && labels.every((l) => l && !l.startsWith("-") && !l.endsWith("-"));
}

// Optional field. Accepts any reasonable US phone formatting the visitor
// (or the client-side mask) might send, and always normalizes to the same
// "+1 XXX-XXX-XXXX" shape for the email - or INVALID_PHONE if what's left
// isn't a real 10-digit US number.
function normalizePhone(raw) {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) {
    return "";
  }
  if (value.length > MAX_RAW_PHONE_LENGTH) {
    return INVALID_PHONE;
  }
  let digits = value.replace(/\D/g, "");
  if (digits.length === 11 && digits.charAt(0) === "1") {
    digits = digits.slice(1);
  }
  if (digits.length !== 10) {
    return INVALID_PHONE;
  }
  return `+1 ${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

// Reduces a SendGrid/network error to a few non-sensitive diagnostics.
function summarizeSendError(err) {
  const code = err && err.code;
  if (Number.isInteger(code)) {
    return { category: "sendgrid_http_error", status: code };
  }
  if (typeof code === "string" && /^[A-Z0-9_]{1,40}$/.test(code)) {
    return { category: "network_error", code };
  }
  return { category: "unknown_error" };
}

function respond(mode, status, errorMessage, field) {
  if (mode === "json") {
    const jsonBody = errorMessage ? { error: errorMessage } : { ok: true };
    if (field) {
      jsonBody.field = field;
    }
    return { status, jsonBody };
  }
  return {
    status: 303,
    headers: { Location: `/?sent=${status === 200 ? "1" : "0"}#contact` },
  };
}

module.exports = { handleInquiry, MAX_BODY_BYTES, MAX_LENGTHS };
