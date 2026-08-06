/* JalenBuilds Tools — shared behavior: checkout stub, copy, toast, reveal */
(function () {
  "use strict";

  var JB = (window.JB = window.JB || {});

  /* ---------- toast ---------- */
  var toastEl = null;
  var toastTimer = null;
  JB.toast = function (msg) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "jb-toast";
      toastEl.setAttribute("role", "status");
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove("show");
    }, 2400);
  };

  /* ---------- clipboard ---------- */
  JB.copy = function (text, msg) {
    function done() { JB.toast(msg || "Copied to clipboard"); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallback(); });
    } else { fallback(); }
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); done(); } catch (e) { JB.toast("Copy failed — select the text manually"); }
      document.body.removeChild(ta);
    }
  };

  /* ---------- file download ---------- */
  JB.download = function (filename, content, mime) {
    var blob = new Blob([content], { type: mime || "text/plain;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  };

  /* ---------- checkout ----------
     Payment links come from the environment at build time (see
     scripts/generate-checkout-config.mjs). A product with no configured link —
     which is every product until the operator sets JB_STRIPE_LINK_* — resolves
     to null, and the buy button degrades to the email order flow. A link that
     is not a real https:// URL is treated as unset rather than followed, so a
     half-configured environment can never produce a broken buy button. */
  function productConfig(productId) {
    return (window.JB_CHECKOUT && window.JB_CHECKOUT.products && window.JB_CHECKOUT.products[productId]) || null;
  }

  JB.resolvePaymentLink = function (productId) {
    var cfg = productConfig(productId);
    var link = cfg && typeof cfg.link === "string" ? cfg.link.trim() : "";
    return /^https:\/\/[^\s]+$/.test(link) ? link : null;
  };

  function checkoutModal(product) {
    var cfg = productConfig(product.id) || product;
    var backdrop = document.createElement("div");
    backdrop.className = "jb-modal-backdrop";
    var contact = (window.JB_CHECKOUT && window.JB_CHECKOUT.contact) || "contact@nymrel.com";
    var subject = encodeURIComponent("Order: " + (cfg.name || product.id));
    var mailBody = encodeURIComponent(
      "Hi Nymrel — I'd like to buy " + (cfg.name || product.id) + " (" + (cfg.price || "") + ").\n\nSend me the invoice and delivery details.\n\n— sent from " + location.href
    );
    backdrop.innerHTML =
      '<div class="jb-modal" role="dialog" aria-modal="true" aria-label="Checkout">' +
      "<h3>" + escapeHtml(cfg.name || "Checkout") + "</h3>" +
      '<p class="mono" style="color:var(--brass-bright);letter-spacing:.08em">' + escapeHtml(cfg.price || "") + "</p>" +
      "<p>Card checkout for this product is being switched on. Until it is, we take orders by email: you get an invoice and, once it is paid, a private link that unlocks the download on this page.</p>" +
      '<div class="actions">' +
      '<a class="btn btn-primary" href="mailto:' + contact + "?subject=" + subject + "&body=" + mailBody + '">Order by email</a>' +
      '<button class="btn" data-close>Not now</button>' +
      "</div>" +
      '<p class="help" style="margin:1rem 0 0"><a href="#" data-restore="' + escapeHtml(product.id) + '">Already bought this? Unlock it here.</a></p>' +
      "</div>";
    document.body.appendChild(backdrop);
    /* setTimeout, not rAF: rAF never fires in hidden/throttled tabs, leaving the modal invisible */
    setTimeout(function () { backdrop.classList.add("open"); }, 20);
    function close() {
      backdrop.classList.remove("open");
      setTimeout(function () { backdrop.remove(); }, 220);
    }
    backdrop.addEventListener("click", function (e) {
      if (e.target === backdrop || e.target.hasAttribute("data-close")) close();
    });
    document.addEventListener("keydown", function esc(e) {
      if (e.key === "Escape") { close(); document.removeEventListener("keydown", esc); }
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  JB.buy = function (productId) {
    var cfg = productConfig(productId);
    var link = JB.resolvePaymentLink(productId);
    if (link) {
      window.location.href = link;
    } else {
      checkoutModal({ id: productId, name: cfg && cfg.name, price: cfg && cfg.price });
    }
  };

  /* ---------- pro tier ----------
     The fulfilment runtime and the per-tool builder are loaded on demand, so a
     first visit never pays for them. A page opts in with, on <body>:
       data-pro-product="qr-deluxe" data-pro-module="qr-pro"  */
  var proShim = (JB.pro = { _queue: [], _pending: null, loaded: false });
  proShim.register = function (id, def) { this._queue.push([id, def]); };
  proShim.isUnlocked = function (id) {
    if (window.JB_PRO_OFFLINE) return true;
    /* Mirrors pro-runtime's fallback order. sessionStorage often survives where
       localStorage is blocked, and this shim decides whether the runtime loads
       at all on a return visit. */
    var key = "jbt.pro." + id;
    try { if (localStorage.getItem(key)) return true; } catch (e) { /* blocked */ }
    try { if (sessionStorage.getItem(key)) return true; } catch (e) { /* blocked */ }
    return false;
  };
  proShim.mount = function (id) { this._pending = id; };
  proShim.boot = function (id) { this._pending = id; };

  var proLoading = null;
  JB.loadPro = function () {
    if (JB.pro.loaded) return Promise.resolve(JB.pro);
    if (proLoading) return proLoading;
    proLoading = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = "/assets/pro/pro-runtime.js";
      s.onload = function () { resolve(JB.pro); };
      s.onerror = function () { reject(new Error("pro runtime unavailable")); };
      document.head.appendChild(s);
    }).then(function (pro) {
      var mod = document.body.getAttribute("data-pro-module");
      if (!mod) return pro;
      return new Promise(function (resolve) {
        var s = document.createElement("script");
        s.src = "/assets/pro/" + mod + ".js";
        s.onload = s.onerror = function () { resolve(pro); };
        document.head.appendChild(s);
      });
    });
    return proLoading;
  };

  (function bootPro() {
    /* An offline copy carries the runtime inline and has nothing to fetch. */
    if (window.JB_PRO_OFFLINE) return;
    var productId = document.body && document.body.getAttribute("data-pro-product");
    if (!productId) return;
    var returning = /[?&]jb_pro=/.test(location.search);
    if (!returning && !proShim.isUnlocked(productId)) return;
    JB.loadPro().then(function (pro) { pro.boot(productId); }).catch(function () { /* free tool is unaffected */ });
  })();

  /* ---------- restore purchase ----------
     The only way to reach the unlock used to be a link inside the checkout
     modal — and that modal is exactly what stops rendering the moment a real
     payment link is configured, because JB.buy() then navigates straight to
     Stripe. So switching checkout on silently removed the only recovery path a
     buyer had. Anyone who cleared their storage, switched device, or bought in
     a browser that refused to save the unlock had no way back in.

     The affordance now sits next to the buy button itself, so it exists in both
     states and cannot be removed by turning checkout on. */
  (function mountRestoreLinks() {
    if (window.JB_PRO_OFFLINE) return;
    var buttons = document.querySelectorAll("[data-buy]");
    if (!buttons.length) return;
    Array.prototype.forEach.call(buttons, function (btn) {
      var id = btn.getAttribute("data-buy");
      if (!id) return;
      var host = btn.parentNode;
      if (!host || host.querySelector("[data-restore]")) return;
      var note = document.createElement("p");
      note.className = "help";
      note.style.margin = ".7rem 0 0";
      var a = document.createElement("a");
      a.href = "#";
      a.setAttribute("data-restore", id);
      a.textContent = "Already bought this? Unlock it here.";
      note.appendChild(a);
      host.appendChild(note);
    });
  })();

  /* ---------- wire up ---------- */
  document.addEventListener("click", function (e) {
    var buy = e.target.closest("[data-buy]");
    if (buy) { e.preventDefault(); JB.buy(buy.getAttribute("data-buy")); return; }
    var restore = e.target.closest("[data-restore]");
    if (restore) {
      e.preventDefault();
      var id = restore.getAttribute("data-restore");
      JB.loadPro().then(function (pro) { pro.mount(id); pro.restore(id); });
      return;
    }
    var cp = e.target.closest("[data-copy-target]");
    if (cp) {
      var el = document.querySelector(cp.getAttribute("data-copy-target"));
      if (el) JB.copy(el.textContent);
    }
  });

  /* ---------- reveal on scroll (progressive: only hide once JS can reveal) ---------- */
  if ("IntersectionObserver" in window) {
    document.documentElement.classList.add("reveal-armed");
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
        });
      },
      { threshold: 0.08 }
    );
    document.querySelectorAll(".reveal").forEach(function (el) { io.observe(el); });
  } else {
    document.querySelectorAll(".reveal").forEach(function (el) { el.classList.add("in"); });
  }

  /* ---------- year stamp ---------- */
  document.querySelectorAll("[data-year]").forEach(function (el) { el.textContent = new Date().getFullYear(); });
})();
