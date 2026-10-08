"use strict";

// Static checks on the public site (HTML/CSS/JS and staticwebapp.config.json).
// They guard properties the Content-Security-Policy and the privacy notes
// depend on: no inline code, no third-party origins, no trackers, no
// browser storage, and links/ids that resolve. They run offline.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const PAGES = ["index.html", "portfolio.html", "services.html"];
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

// The only off-site link on the site today (testimonial photo link).
const ALLOWED_EXTERNAL = new Set(["https://thebeachtobaygroup.com/"]);

const config = JSON.parse(read("staticwebapp.config.json"));

test("staticwebapp.config.json is valid and within the 20 KB platform limit", () => {
  assert.ok(Buffer.byteLength(read("staticwebapp.config.json")) < 20 * 1024);
  assert.ok(Array.isArray(config.routes));
});

test("config blocks internal files that would otherwise be public", () => {
  const blocked = config.routes.filter((r) => r.statusCode === 404).map((r) => r.route);
  assert.ok(blocked.includes("/docs/*"));
  assert.ok(blocked.includes("/README.md"));
});

test("API runtime is pinned to a supported Node version", () => {
  assert.ok(["node:20", "node:22"].includes(config.platform && config.platform.apiRuntime));
});

test("Content-Security-Policy is strict and allows no third-party origins", () => {
  const csp = config.globalHeaders["Content-Security-Policy"];
  assert.ok(csp, "CSP header is configured");
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  assert.doesNotMatch(csp, /https?:\/\/|\*/, "no host sources or wildcards");
  for (const directive of [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "font-src 'self'",
    "connect-src 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ]) {
    assert.ok(csp.includes(directive), `CSP includes ${directive}`);
  }
});

for (const page of PAGES) {
  // Editing notes in comments mention tags such as <h1>; only check real markup.
  const html = read(page).replace(/<!--[\s\S]*?-->/g, "");

  test(`${page}: no inline scripts, inline styles or event-handler attributes (CSP-safe)`, () => {
    assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)[^>]*>/i, "inline <script>");
    assert.doesNotMatch(html, /<style[\s>]/i, "inline <style>");
    assert.doesNotMatch(html, /\sstyle\s*=/i, "style attribute");
    assert.doesNotMatch(html, /\son[a-z]+\s*=/i, "on* handler attribute");
  });

  test(`${page}: every link and resource is local, mailto/tel, or an allowed external`, () => {
    const refs = [...html.matchAll(/\s(?:src|href|action)\s*=\s*"([^"]*)"/gi)].map((m) => m[1]);
    assert.ok(refs.length > 0);
    for (const ref of refs) {
      if (/^(mailto:|tel:)/i.test(ref)) continue;
      if (/^https?:\/\//i.test(ref) || ref.startsWith("//")) {
        assert.ok(ALLOWED_EXTERNAL.has(ref), `unexpected external reference: ${ref}`);
        continue;
      }
      const [file, fragment] = ref.split("#");
      const target = file === "" ? page : file;
      if (target.startsWith("/api/")) continue; // served by the Functions app
      assert.ok(exists(target), `${page} references missing file: ${ref}`);
      if (fragment && target.endsWith(".html")) {
        assert.match(read(target), new RegExp(`\\sid="${fragment}"`), `${page} -> ${ref}: no element with id="${fragment}"`);
      }
    }
  });

  test(`${page}: external links opened in a new tab use rel=noopener`, () => {
    for (const tag of html.match(/<a\s[^>]*target="_blank"[^>]*>/gi) || []) {
      assert.match(tag, /rel="[^"]*noopener[^"]*"/i, tag);
    }
  });

  test(`${page}: language, one h1, one main landmark, skip link, and alt text on every image`, () => {
    assert.match(html, /<html[^>]*\slang="en"/i);
    assert.equal((html.match(/<h1[\s>]/gi) || []).length, 1);
    assert.equal((html.match(/<main[\s>]/gi) || []).length, 1);
    assert.match(html, /<a class="skip-link" href="#main">/);
    for (const img of html.match(/<img\b[^>]*>/gis) || []) {
      assert.match(img, /\salt\s*=\s*"/i, `image without alt attribute: ${img.slice(0, 80)}`);
    }
  });
}

test("no analytics, advertising or social-tracking code anywhere on the site", () => {
  const files = [...PAGES, "js/main.js", "css/styles.css"];
  const trackers =
    /google-analytics|googletagmanager|gtag\(|\bga\(|fbq\(|facebook\.net|connect\.facebook|hotjar|clarity\.ms|doubleclick|googlesyndication|segment\.(com|io)|mixpanel|plausible|matomo|linkedin\.com\/px|snap\.licdn|tiktok|pinterest\.com\/ct/i;
  for (const f of files) {
    assert.doesNotMatch(read(f), trackers, `${f} references a tracking service`);
  }
});

test("no cookies or browser storage are used by the site script", () => {
  assert.doesNotMatch(read("js/main.js"), /document\.cookie|localStorage|sessionStorage|indexedDB/);
});

test("stylesheet loads no external resources; every @font-face file exists", () => {
  const css = read("css/styles.css");
  assert.doesNotMatch(css, /@import|url\(\s*["']?(https?:)?\/\//i);
  const fontFiles = [...css.matchAll(/url\(\s*["']?(\.\.\/assets\/fonts\/[^"')]+)["']?\s*\)/g)].map((m) => m[1].replace("../", ""));
  assert.ok(fontFiles.length >= 6);
  for (const f of fontFiles) assert.ok(exists(f), `missing font file ${f}`);
});

test("the form posts only to the same-origin API route", () => {
  const html = read("index.html");
  assert.match(html, /<form[^>]*action="\/api\/submit-inquiry"[^>]*method="post"/i);
  assert.doesNotMatch(read("js/main.js"), /fetch\(\s*["']https?:/);
});
