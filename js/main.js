/*
  MOBILE MENU TOGGLE

  Shows/hides the navigation links on small screens when the menu
  button is tapped. There is nothing here that needs to change when
  editing page content.
*/
document.addEventListener("DOMContentLoaded", function () {
  var toggle = document.querySelector(".nav-toggle");
  var nav = document.querySelector(".main-nav");

  if (!toggle || !nav) {
    return;
  }

  toggle.addEventListener("click", function () {
    var isOpen = nav.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
  });
});

/*
  SCROLL-REVEAL ANIMATION

  The client's original Wix site fades each section's headline/text in
  (some with a slight blur-to-sharp effect) as the page loads or as you
  scroll to them. This recreates that same effect with plain CSS
  transitions - see the "SCROLL-REVEAL ANIMATION" block in
  css/styles.css for the actual transition/timing values.

  This is progressive enhancement: elements are only ever hidden by a
  class that THIS script adds, so if JavaScript doesn't run (or the
  visitor has "reduce motion" turned on), everything just displays
  normally with no animation - nothing depends on this to be visible.
*/
document.addEventListener("DOMContentLoaded", function () {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }

  // Each entry: which elements to animate, whether they get the blur
  // effect, whether multiple elements should cascade in with a delay
  // between each one, and whether they reveal immediately (for
  // above-the-fold hero content) instead of waiting to scroll into view.
  var groups = [
    { selector: ".hero-logo, .hero h1, .hero-lede, .hero-tagline", stagger: true, immediate: true },
    { selector: ".section-intro", blur: true },
    { selector: ".service-card", stagger: true },
    { selector: ".flyer-group", stagger: true },
    { selector: ".review-card", stagger: true },
    { selector: ".contact-layout > *", stagger: true },
    { selector: ".testimonial-original, .testimonial-layout", blur: true },
    { selector: ".reviews-image", blur: true },
    { selector: ".intro-graphic img, .about-graphic img", blur: true }
  ];

  var immediateEls = [];
  var observedEls = [];

  groups.forEach(function (group) {
    document.querySelectorAll(group.selector).forEach(function (el, i) {
      el.classList.add("reveal-init");
      if (group.blur) {
        el.classList.add("reveal-blur");
      }
      if (group.stagger) {
        el.classList.add("reveal-delay-" + ((i % 3) + 1));
      }
      (group.immediate ? immediateEls : observedEls).push(el);
    });
  });

  // Hero content reveals shortly after the page loads, cascading in.
  immediateEls.forEach(function (el, i) {
    window.setTimeout(function () {
      el.classList.add("reveal-visible");
    }, 50 + i * 90);
  });

  if (!("IntersectionObserver" in window)) {
    observedEls.forEach(function (el) {
      el.classList.add("reveal-visible");
    });
    return;
  }

  var observer = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("reveal-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15, rootMargin: "0px 0px -40px 0px" }
  );

  observedEls.forEach(function (el) {
    observer.observe(el);
  });
});

/*
  CONTACT FORM SUBMISSION

  The form's action/method (see index.html) already work as a plain
  HTML POST to /api/submit-inquiry, so the form still works with
  JavaScript off. When JS is available, this intercepts the submit to
  send it via fetch instead, so visitors get an inline success/error
  message without leaving the page.

  It also handles the ?sent=1 / ?sent=0 redirect the API sends back
  for that plain-HTML fallback path, showing the same status message
  after the page reloads.
*/
document.addEventListener("DOMContentLoaded", function () {
  var form = document.querySelector(".contact-form");
  if (!form) {
    return;
  }

  var status = form.querySelector(".form-status");
  var submitButton = form.querySelector("button[type='submit']");

  // Live-format the phone field as the visitor types, capping it at 10 US
  // digits (an accidentally-typed leading "1" is dropped) so it always
  // matches the field's XXX-XXX-XXXX pattern. The API re-normalizes this
  // itself before emailing it, so this is just a typing convenience.
  var phoneInput = form.querySelector("#phone");
  if (phoneInput) {
    phoneInput.addEventListener("input", function () {
      var digits = phoneInput.value.replace(/\D/g, "");
      if (digits.length > 10 && digits.charAt(0) === "1") {
        digits = digits.slice(1);
      }
      digits = digits.slice(0, 10);

      if (digits.length > 6) {
        phoneInput.value = digits.slice(0, 3) + "-" + digits.slice(3, 6) + "-" + digits.slice(6);
      } else if (digits.length > 3) {
        phoneInput.value = digits.slice(0, 3) + "-" + digits.slice(3);
      } else {
        phoneInput.value = digits;
      }
    });
  }

  function showStatus(message, isError) {
    if (!status) {
      return;
    }
    status.textContent = message;
    status.classList.toggle("form-status-error", Boolean(isError));
    status.classList.toggle("form-status-success", !isError);
  }

  var params = new URLSearchParams(window.location.search);
  if (params.has("sent")) {
    showStatus(
      params.get("sent") === "1"
        ? "Thanks! Your message has been sent - we'll be in touch soon."
        : "Something went wrong sending your message. Please check the form and try again, or email or call/text us directly.",
      params.get("sent") !== "1"
    );
    params.delete("sent");
    var cleanQuery = params.toString();
    window.history.replaceState(
      {},
      "",
      window.location.pathname + (cleanQuery ? "?" + cleanQuery : "") + window.location.hash
    );
  }

  var GENERIC_ERROR =
    "Something went wrong sending your message. Please email or call/text us directly.";

  // A field flagged as invalid by the server stays flagged until the visitor
  // edits it.
  function clearInvalid(field) {
    field.removeAttribute("aria-invalid");
    field.removeAttribute("aria-describedby");
  }

  Array.prototype.forEach.call(form.elements, function (field) {
    field.addEventListener("input", function () {
      if (field.getAttribute("aria-invalid")) {
        clearInvalid(field);
        // The textarea has its own hint that must stay described.
        if (field.id === "message") {
          field.setAttribute("aria-describedby", "message-hint");
        }
      }
    });
  });

  // Marks the field the server complained about, ties the error message to it
  // for screen readers, and moves focus there.
  function flagField(name) {
    var field = name && form.elements[name];
    if (!field || !field.focus) {
      return;
    }
    var describedBy = field.id === "message" ? "message-hint " : "";
    field.setAttribute("aria-invalid", "true");
    field.setAttribute("aria-describedby", describedBy + "form-status");
    field.focus();
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();

    // The "website" field is a hidden spam trap (see index.html); it is
    // sent along so the API can discard bot submissions.
    var data = {
      firstName: form.elements["firstName"].value,
      lastName: form.elements["lastName"].value,
      email: form.elements["email"].value,
      phone: form.elements["phone"].value,
      message: form.elements["message"].value,
      website: form.elements["website"] ? form.elements["website"].value : "",
    };

    if (submitButton) {
      submitButton.disabled = true;
    }
    showStatus("Sending your message...", false);

    fetch(form.action, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    })
      .then(function (response) {
        if (response.ok) {
          showStatus("Thanks! Your message has been sent - we'll be in touch soon.", false);
          form.reset();
          return;
        }
        // The API explains validation problems (4xx) in plain language;
        // anything else (server/platform trouble) gets the generic message.
        return response
          .json()
          .catch(function () {
            return {};
          })
          .then(function (body) {
            var isValidationError = response.status >= 400 && response.status < 500;
            showStatus(isValidationError && body.error ? body.error : GENERIC_ERROR, true);
            if (isValidationError) {
              flagField(body.field);
            }
          });
      })
      .catch(function () {
        showStatus(GENERIC_ERROR, true);
      })
      .finally(function () {
        if (submitButton) {
          submitButton.disabled = false;
        }
      });
  });
});
