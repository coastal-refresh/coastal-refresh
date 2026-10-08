# Accessibility review (WCAG 2.2 AA target)

Reviewed 2026-10-08. This is a **code review plus automated and scripted browser
checks**. It is not an audit, and passing automated tools is not evidence of
ADA or WCAG conformance — automated scanners find only a minority of
accessibility problems. The manual checks at the bottom are still required.

## What was checked and how

- Source review of `index.html`, `portfolio.html`, `services.html`,
  `css/styles.css`, `js/main.js`.
- axe-core 4 in headless Chrome (tags `wcag2a`, `wcag2aa`, `wcag21a`,
  `wcag21aa`, `wcag22aa`, `best-practice`) on all three pages at 1280px and
  390px wide, before and after the changes.
- Scripted keyboard walk-through (tab order, skip link, focus ring, mobile menu,
  honeypot not focusable, focus not hidden under the sticky header, target sizes).
- Scripted form tests: success, server-side validation errors, focus movement
  and ARIA state.
- Contrast ratios computed from the palette values.
- Reflow: no horizontal scrolling at 320px wide.

## Automated result

| Page | Before | After |
| --- | --- | --- |
| Home | `landmark-one-main`, `region` (12) | no violations |
| Portfolio | `landmark-one-main`, `region` (4) | no violations |
| Services | `heading-order`, `landmark-one-main`, `region` (3) | no violations |

axe only reports on what is visible when it runs (for example it cannot see the
error message colour until an error is shown), so the contrast items below were
also computed by hand.

## Defects fixed

| # | Issue | WCAG | Fix |
| --- | --- | --- | --- |
| 1 | No landmarks: page content not inside `<main>` | 1.3.1, 2.4.1 | Wrapped page content in `<main id="main">` on every page |
| 2 | No way to bypass the repeated header navigation | 2.4.1 | "Skip to main content" link, visible on keyboard focus |
| 3 | Form error text was 2.85:1 against the page background | 1.4.3 | New `--color-error` (#a8341a, 6.1:1) |
| 4 | Form field borders were 1.65:1 (field boundary hard to see) | 1.4.11 | New `--color-input-border` (#8a847c, 3.4:1) on inputs/textarea |
| 5 | Guest-review stars 1.9:1, and read aloud as "black star" ×5 | 1.4.11, 1.1.1 | Darker `--color-star` (#c46f22, 3.4:1); stars are `aria-hidden` with a "5 out of 5 stars" text alternative |
| 6 | Form status region was `display:none` while empty, so screen readers may not announce the first message | 4.1.3 | Kept in the accessibility tree while empty (visually hidden instead) |
| 7 | Server-side errors only said "Something went wrong" | 3.3.1, 3.3.3 | Specific message shown; focus moves to the field with `aria-invalid` and `aria-describedby` pointing at the message |
| 8 | Inputs had no autocomplete hints | 1.3.5 | `given-name`, `family-name`, `email`, `tel-national` |
| 9 | Required fields only marked by `*` in the label | 3.3.2 | Added "Fields marked * are required." (inputs already have `required`); message field has a character-limit hint |
| 10 | Focus ring relied on browser defaults (inconsistent on the dark footer) | 2.4.7 | Explicit 3px `:focus-visible` outline, light on the footer |
| 11 | Heading levels jumped from h1 to h3 on Services | 1.3.1 | Visually hidden `<h2>` before the service cards (no visual change) |
| 12 | Menu button lacked `aria-controls`/`type`; nav unlabelled | 4.1.2 | Added `type="button"`, `aria-controls="site-nav"`, `aria-label="Main"` |
| 13 | Logo link's accessible name was "…logo" (describes the image, not the link) | 2.4.4 | Alt is now "Going Coastal Refresh Co. home" |
| 14 | Image links to an external site opened a new tab with no warning, and the name was the testimonial text | 2.4.4, 3.2.5 | Visually hidden "(opens … in a new tab)" |
| 15 | Smooth scrolling still applied for people who ask for reduced motion | 2.3.3 (AAA, best practice) | `scroll-behavior:auto` under `prefers-reduced-motion` |
| 16 | Names limited to Latin-1 letters rejected valid names | Inclusive design | Any Unicode letter; client and server rules match |

The honeypot field is out of the tab order (`tabindex="-1"`), hidden from
assistive technology (`aria-hidden`), and off-screen; verified it never receives
keyboard focus.

Colours and sizes were otherwise left untouched. A pixel comparison of every
page against the original showed identical output apart from the star colour
(portfolio, mobile view only).

## Verified passing (no change needed)

- `lang="en"` and unique, descriptive `<title>` on every page.
- Text contrast: body 13.0:1, muted 6.7:1 (5.5:1 on the beige cards), brand
  teal 6.8:1, button text 6.8:1, footer text ≥ 7.9:1.
- Zoom/reflow: no horizontal scrolling at 320px wide.
- Targets: no non-inline interactive element smaller than 24×24px.
- Reduced motion: scroll-reveal animation is disabled for
  `prefers-reduced-motion` and never hides content when JavaScript is off.
- Viewport meta does not block pinch-zoom.
- Every `<label>` is programmatically tied to its input.

## Needs manual verification (cannot be confirmed from code)

1. **Screen readers** — NVDA + Firefox/Chrome, JAWS, VoiceOver on macOS and iOS,
   TalkBack: confirm the "Sending…", success and error messages are announced
   once, the focus move to an invalid field reads sensibly, and the honeypot
   is never announced.
2. **Keyboard-only run-through of the whole site** in Safari and Firefox as well
   as Chrome (this review only scripted Chrome).
3. **Browser zoom to 200% and 400%** and OS "large text" settings. Layout holds
   at 320px; at 256px (500% zoom) there is some horizontal overflow, which is
   beyond the 320px WCAG requires but worth a look.
4. **Text-spacing override** (WCAG 1.4.12) with a bookmarklet/extension.
5. **Images of text** (1.4.5): the intro, "Meet Dave & Donna", testimonial,
   portfolio flyers and guest-reviews graphics are client-designed pictures
   with text baked in. Their `alt` text reproduces the content, but a long-term
   improvement is real HTML text (the mobile testimonial and review cards
   already are). Decide with the owner whether that is wanted.
6. **Current-page indicator** in the nav is shown by colour (plus
   `aria-current="page"` for assistive tech). Consider an underline so it does
   not rely on colour alone (1.4.1).
7. **Alt text quality** — a person who knows the photos should confirm the long
   portfolio `alt` descriptions are accurate, and decide whether they are
   better as visible captions.
8. **Colour contrast of text inside the images** cannot be measured from code.
9. **Windows High Contrast / forced-colors mode** rendering.
10. Retest after any content or design change; consider a third-party audit if
    the business wants a conformance statement.
