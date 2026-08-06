/* JalenBuilds Tools — Pro fulfilment runtime.
   Loaded on demand (never on first paint). Provides one delivery mechanism for
   every paid tier in the store:

     1. entitlement   — records a purchase locally after the return from checkout
     2. artifact      — per-tool builder modules produce real files in the browser
     3. delivery      — zip / single-file download, re-downloadable at any time

   Everything runs client-side, which is the same promise the free tools make:
   the buyer's own inputs never leave their device. */
(function () {
  "use strict";

  var JB = (window.JB = window.JB || {});
  var shim = JB.pro || {};
  var PRO = (JB.pro = {});

  PRO.loaded = true;

  /* ============================================================
     entitlement
     ============================================================ */

  var KEY_PREFIX = "jbt.pro.";

  /* Entitlement lives in memory first and in storage second.
     Storage is a convenience for the NEXT visit, never the thing that decides
     whether a buyer who has just paid gets their files. A browser in private
     mode, with third-party/all storage blocked, or over quota throws on
     localStorage.setItem — and reading it back returns nothing. When that was
     the only record, the return trip from checkout showed a "purchase
     confirmed" toast and then rendered no delivery panel at all: paid, told it
     worked, given nothing, with no error to report. Memory cannot fail, so it
     is now the source of truth for the session in which the money was taken. */
  var memory = {};
  var durable = true; /* false once a write is known to have failed */

  function writeStore(store, key, value) {
    try {
      if (!store) return false;
      store.setItem(key, value);
      /* Some browsers accept the call and drop the value. Only a read-back proves it. */
      return store.getItem(key) === value;
    } catch (e) {
      return false;
    }
  }

  function readStore(store, key) {
    try {
      return store ? store.getItem(key) : null;
    } catch (e) {
      return null;
    }
  }

  function readReceipt(productId) {
    if (memory[productId]) return memory[productId];
    var key = KEY_PREFIX + productId;
    var raw = readStore(window.localStorage, key) || readStore(window.sessionStorage, key);
    if (!raw) return null;
    try {
      var rec = JSON.parse(raw);
      memory[productId] = rec;
      return rec;
    } catch (e) {
      return null;
    }
  }

  PRO.receipt = readReceipt;

  /* True when this browser will still remember the purchase after a refresh. */
  PRO.isDurable = function () { return durable; };

  PRO.isUnlocked = function (productId) {
    if (window.JB_PRO_OFFLINE) return true;
    return !!readReceipt(productId);
  };

  PRO.grant = function (productId, ref) {
    var rec = { ref: String(ref || "").slice(0, 120), at: new Date().toISOString() };

    /* Unconditional, and first: nothing below can stop delivery. */
    memory[productId] = rec;

    var key = KEY_PREFIX + productId;
    var payload = JSON.stringify(rec);
    var persisted = writeStore(window.localStorage, key, payload);
    if (!persisted) {
      /* Session storage survives a refresh in the same tab even where
         localStorage is blocked, so it is worth the second attempt. */
      persisted = writeStore(window.sessionStorage, key, payload);
      durable = false;
    }
    rec.persisted = persisted;
    return rec;
  };

  /* Ask the verifier whether a reference is a real, paid session for this exact
     product. One function, because there are two ways into an unlock — the
     return trip from checkout and the "already bought this?" restore link — and
     a gate on only one of them is not a gate. Whichever path is cheaper to
     abuse is the one that gets abused, and restore was a text prompt.

     Resolves true/false. Never throws: a verifier that is unreachable answers
     false, because the alternative is handing out the product whenever the
     endpoint is down. */
  PRO.verifyRef = function (productId, ref) {
    var verifyUrl = window.JB_CHECKOUT && window.JB_CHECKOUT.verifyUrl;
    /* No verifier configured is the documented static-site fallback: the
       reference is recorded but not confirmed. It is only safe while nothing
       is for sale — see scripts/README-checkout.md. */
    if (!verifyUrl) return Promise.resolve(!!ref);
    if (!ref) return Promise.resolve(false);
    var url = verifyUrl +
      (verifyUrl.indexOf("?") < 0 ? "?" : "&") +
      "session_id=" + encodeURIComponent(ref) +
      "&product=" + encodeURIComponent(productId);
    return fetch(url, { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) { return !!(data && data.paid); })
      .catch(function () { return false; });
  };

  /* Reference from a completed checkout. Stripe payment links append the
     session id to the success URL, so a return trip carries proof the buyer
     came back from checkout. When JB_CHECKOUT.verifyUrl is configured the
     reference is confirmed server-side first; with no verifier configured the
     presence of the reference is what unlocks. */
  PRO.claimFromUrl = function () {
    var params;
    try {
      params = new URLSearchParams(location.search);
    } catch (e) {
      return Promise.resolve(null);
    }
    var productId = params.get("jb_pro");
    if (!productId) return Promise.resolve(null);
    var ref = params.get("sid") || params.get("session_id") || "";

    function finish(ok) {
      // Drop the checkout params so a refresh or a shared link is clean.
      try {
        params.delete("jb_pro");
        params.delete("sid");
        params.delete("session_id");
        var qs = params.toString();
        history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "") + location.hash);
      } catch (e) { /* ignore */ }
      if (!ok) return null;
      PRO.grant(productId, ref);
      return productId;
    }

    return PRO.verifyRef(productId, ref).then(finish);
  };

  /* ============================================================
     builder registry
     ============================================================ */

  var builders = {};

  /* def = {
       label:    short name of the artifact, shown on the button
       summary:  one line describing what lands on disk
       contents: array of plain-language strings, what is inside
       build:    function -> { filename, files:[{name, text|bytes}] } or a Promise of it
                 (a single-file artifact is just a one-entry files array)
       ready:    optional function -> "" when buildable, else a plain reason
     } */
  PRO.register = function (productId, def) {
    builders[productId] = def;
    if (mountedFor === productId) render();
  };

  (shim._queue || []).forEach(function (item) { PRO.register(item[0], item[1]); });

  /* ============================================================
     zip writer (stored entries, no compression, no dependencies)
     ============================================================ */

  var CRC_TABLE = (function () {
    var table = new Int32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
    return table;
  })();

  function crc32(bytes) {
    var c = -1;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  }

  function toBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    return new TextEncoder().encode(String(value));
  }

  function dosTime(d) {
    return ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() / 2)) & 0xffff;
  }
  function dosDate(d) {
    return (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
  }

  /* files: [{ name, text }] or [{ name, bytes }] -> Blob (application/zip) */
  JB.zip = function (files) {
    var now = new Date();
    var time = dosTime(now);
    var date = dosDate(now);
    var chunks = [];
    var central = [];
    var offset = 0;

    files.forEach(function (file) {
      var nameBytes = new TextEncoder().encode(file.name);
      var data = toBytes(file.bytes !== undefined ? file.bytes : file.text);
      var crc = crc32(data);

      var local = new Uint8Array(30 + nameBytes.length);
      var lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);            // version needed
      lv.setUint16(6, 0x0800, true);        // UTF-8 filename flag
      lv.setUint16(8, 0, true);             // stored
      lv.setUint16(10, time, true);
      lv.setUint16(12, date, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      local.set(nameBytes, 30);

      chunks.push(local, data);

      var dir = new Uint8Array(46 + nameBytes.length);
      var dv = new DataView(dir.buffer);
      dv.setUint32(0, 0x02014b50, true);
      dv.setUint16(4, 20, true);
      dv.setUint16(6, 20, true);
      dv.setUint16(8, 0x0800, true);
      dv.setUint16(10, 0, true);
      dv.setUint16(12, time, true);
      dv.setUint16(14, date, true);
      dv.setUint32(16, crc, true);
      dv.setUint32(20, data.length, true);
      dv.setUint32(24, data.length, true);
      dv.setUint16(28, nameBytes.length, true);
      dv.setUint32(42, offset, true);
      dir.set(nameBytes, 46);
      central.push(dir);

      offset += local.length + data.length;
    });

    var centralSize = central.reduce(function (n, c) { return n + c.length; }, 0);
    var end = new Uint8Array(22);
    var ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);

    return new Blob(chunks.concat(central, [end]), { type: "application/zip" });
  };

  JB.downloadBlob = function (filename, blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  };

  /* ============================================================
     shared report shell — one look for every printable artifact
     ============================================================ */

  PRO.escapeHtml = function (s) {
    return String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };

  var REPORT_CSS =
    ":root{--ink:#1b1a17;--dim:#55524c;--faint:#8a867e;--line:#ddd8cf;--bg:#fbfaf7;--accent:#8a6a2f;--ok:#3f7a35;--warn:#9a6b1f;--bad:#a2432f}" +
    "*{box-sizing:border-box}" +
    "body{margin:0;padding:40px 28px 64px;background:var(--bg);color:var(--ink);font:16px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif}" +
    ".sheet{max-width:820px;margin:0 auto}" +
    "h1{font:400 2.1rem/1.2 Georgia,'Times New Roman',serif;margin:0 0 .3rem}" +
    "h2{font:400 1.35rem/1.3 Georgia,'Times New Roman',serif;margin:2.4rem 0 .8rem;padding-bottom:.4rem;border-bottom:1px solid var(--line)}" +
    "h3{font-size:1.02rem;margin:1.6rem 0 .4rem}" +
    ".kicker{font:600 .7rem/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.16em;text-transform:uppercase;color:var(--accent);margin-bottom:.9rem}" +
    ".lede{color:var(--dim);margin:.2rem 0 0}" +
    ".meta{font:.78rem/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--faint);margin-top:1.4rem}" +
    "table{width:100%;border-collapse:collapse;margin:.8rem 0 0;font-size:.92rem}" +
    "th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}" +
    "th{font:600 .7rem/1 ui-monospace,monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--faint)}" +
    "td.num,th.num{text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}" +
    "pre{background:#f2efe8;border:1px solid var(--line);border-radius:6px;padding:12px 14px;overflow:auto;font:.8rem/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;word-break:break-word}" +
    "code{font:.86em ui-monospace,SFMono-Regular,Menlo,monospace;background:#f2efe8;padding:1px 5px;border-radius:4px}" +
    ".item{border:1px solid var(--line);border-radius:8px;padding:16px 18px;margin:12px 0;background:#fff}" +
    ".item h3{margin-top:0}" +
    ".rank{font:600 .72rem/1 ui-monospace,monospace;letter-spacing:.1em;color:var(--accent);text-transform:uppercase}" +
    ".pill{display:inline-block;font:600 .68rem/1 ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase;padding:4px 8px;border:1px solid var(--line);border-radius:20px;color:var(--dim)}" +
    ".pill.ok{color:var(--ok);border-color:var(--ok)}.pill.warn{color:var(--warn);border-color:var(--warn)}.pill.bad{color:var(--bad);border-color:var(--bad)}" +
    "ul,ol{padding-left:1.2rem}li{margin:.25rem 0}" +
    ".foot{margin-top:3rem;padding-top:1rem;border-top:1px solid var(--line);font:.76rem/1.6 ui-monospace,monospace;color:var(--faint)}" +
    "@media print{body{background:#fff;padding:0}.item{break-inside:avoid}h2{break-after:avoid}}";

  /* Returns a complete, self-contained HTML document string. */
  PRO.reportHtml = function (opts) {
    return "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n" +
      "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n" +
      "<meta name=\"robots\" content=\"noindex\">\n" +
      "<title>" + PRO.escapeHtml(opts.title) + "</title>\n<style>" + REPORT_CSS + "</style>\n</head>\n<body>\n" +
      "<div class=\"sheet\">\n" +
      "<div class=\"kicker\">" + PRO.escapeHtml(opts.kicker || "JalenBuilds Tools") + "</div>\n" +
      "<h1>" + PRO.escapeHtml(opts.title) + "</h1>\n" +
      (opts.lede ? "<p class=\"lede\">" + PRO.escapeHtml(opts.lede) + "</p>\n" : "") +
      "<p class=\"meta\">Generated " + PRO.escapeHtml(new Date().toLocaleString()) + " · in your browser, from your own inputs</p>\n" +
      opts.body +
      "<div class=\"foot\">" + PRO.escapeHtml(opts.footer || "nymrel.com · JalenBuilds LLC") +
      "<br>Print this page to save it as a PDF.</div>\n" +
      "</div>\n</body>\n</html>\n";
  };

  /* A .ics calendar file — used by the tools that promise a dated re-check. */
  PRO.icsFile = function (opts) {
    function stamp(d) {
      return d.getUTCFullYear() +
        ("0" + (d.getUTCMonth() + 1)).slice(-2) +
        ("0" + d.getUTCDate()).slice(-2) + "T" +
        ("0" + d.getUTCHours()).slice(-2) +
        ("0" + d.getUTCMinutes()).slice(-2) +
        ("0" + d.getUTCSeconds()).slice(-2) + "Z";
    }
    function fold(line) {
      var out = [];
      while (line.length > 73) { out.push(line.slice(0, 73)); line = " " + line.slice(73); }
      out.push(line);
      return out.join("\r\n");
    }
    function esc(s) {
      return String(s).replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
    }
    var start = opts.date;
    var end = new Date(start.getTime() + 30 * 60000);
    var uid = "jbt-" + start.getTime() + "-" + Math.random().toString(36).slice(2, 8) + "@jalenbuilds";
    return [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//JalenBuilds Tools//Pro//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      "UID:" + uid,
      "DTSTAMP:" + stamp(new Date()),
      "DTSTART:" + stamp(start),
      "DTEND:" + stamp(end),
      fold("SUMMARY:" + esc(opts.summary)),
      fold("DESCRIPTION:" + esc(opts.description)),
      opts.url ? fold("URL:" + esc(opts.url)) : null,
      "BEGIN:VALARM",
      "TRIGGER:-PT60M",
      "ACTION:DISPLAY",
      fold("DESCRIPTION:" + esc(opts.summary)),
      "END:VALARM",
      "END:VEVENT",
      "END:VCALENDAR"
    ].filter(Boolean).join("\r\n") + "\r\n";
  };

  /* ============================================================
     offline single-file build — inlines this page into one .html
     ============================================================ */

  function base64(buffer) {
    var bytes = new Uint8Array(buffer);
    var binary = "";
    var CHUNK = 0x8000;
    for (var i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  }

  function fetchText(url) {
    return fetch(url, { credentials: "same-origin" }).then(function (r) {
      if (!r.ok) throw new Error("Could not load " + url);
      return r.text();
    });
  }

  /* Keeps only the latin @font-face blocks and embeds them as data URIs, so the
     saved file keeps the studio's typography with no network. */
  function inlineFonts(cssUrl) {
    return fetchText(cssUrl).then(function (css) {
      var blocks = css.match(/@font-face\s*\{[^}]*\}/g) || [];
      var keep = blocks.filter(function (b) { return /-latin\.woff2/.test(b); });
      var urls = [];
      keep.forEach(function (b) {
        var m = /url\(([^)]+)\)/.exec(b);
        if (m) urls.push(m[1].replace(/['"]/g, "").trim());
      });
      return Promise.all(urls.map(function (u) {
        return fetch(u, { credentials: "same-origin" })
          .then(function (r) { return r.ok ? r.arrayBuffer() : null; })
          .then(function (buf) { return buf ? "data:font/woff2;base64," + base64(buf) : null; })
          .catch(function () { return null; });
      })).then(function (dataUris) {
        return keep.map(function (block, i) {
          if (!dataUris[i]) return "";
          return block.replace(/url\([^)]+\)/, "url(" + dataUris[i] + ")").replace(/\s*unicode-range:[^;]+;/, "");
        }).join("\n");
      });
    });
  }

  /* opts = {
       filename, title, module (pro module basename), note (one line shown in the file)
     } */
  PRO.buildOfflineApp = function (opts) {
    var pageUrl = location.pathname;
    return Promise.all([
      fetchText(pageUrl),
      fetchText("/assets/site.css"),
      fetchText("/assets/site.js"),
      fetchText("/assets/pro/pro-runtime.js"),
      opts.module ? fetchText("/assets/pro/" + opts.module + ".js") : Promise.resolve(""),
      inlineFonts("/assets/fonts/fonts.css"),
      fetchText("/favicon.svg").catch(function () { return ""; })
    ]).then(function (parts) {
      var html = parts[0], siteCss = parts[1], siteJs = parts[2];
      var runtimeJs = parts[3], moduleJs = parts[4], fontCss = parts[5], faviconSvg = parts[6];

      var doc = new DOMParser().parseFromString(html, "text/html");

      // Strip what only makes sense on the live site.
      doc.querySelectorAll(
        "[data-pro-strip], link[rel='canonical'], link[rel='preload'], " +
        "meta[property^='og:'], meta[name^='twitter:'], script[type='application/ld+json'], " +
        "link[rel='stylesheet'], header.site nav.primary, footer.site"
      ).forEach(function (el) { el.remove(); });

      // Any remaining site-relative link would dead-end offline.
      doc.querySelectorAll("a[href^='/']").forEach(function (a) {
        var span = doc.createElement("span");
        span.textContent = a.textContent;
        a.parentNode.replaceChild(span, a);
      });

      var favicon = doc.querySelector("link[rel='icon']");
      if (favicon) {
        if (faviconSvg) favicon.setAttribute("href", "data:image/svg+xml;utf8," + encodeURIComponent(faviconSvg));
        else favicon.remove();
      }

      var style = doc.createElement("style");
      style.textContent = fontCss + "\n" + siteCss;
      doc.head.appendChild(style);

      if (opts.title) {
        doc.title = opts.title;
        var desc = doc.querySelector("meta[name='description']");
        if (desc) desc.remove();
      }

      // Replace external scripts with their contents, in the original order.
      var scripts = Array.prototype.slice.call(doc.querySelectorAll("script[src]"));
      scripts.forEach(function (el) {
        var src = el.getAttribute("src") || "";
        var inline = doc.createElement("script");
        if (/checkout-config\.js$/.test(src)) {
          inline.textContent =
            "window.JB_PRO_OFFLINE=true;\n" +
            "window.JB_CHECKOUT={contact:" + JSON.stringify((window.JB_CHECKOUT && window.JB_CHECKOUT.contact) || "contact@nymrel.com") + ",products:{}};";
        } else if (/\/site\.js$/.test(src)) {
          inline.textContent = siteJs;
        } else if (/pro-runtime\.js$/.test(src)) {
          inline.textContent = runtimeJs;
        } else {
          inline.textContent = "/* " + src + " unavailable offline */";
        }
        el.parentNode.replaceChild(inline, el);
      });

      // Vendored libraries the page depends on are fetched and inlined too.
      var vendorNeeds = scripts.filter(function (el) { return /\/vendor\//.test(el.getAttribute("src") || ""); });
      var vendorPromise = Promise.all(vendorNeeds.map(function (el) {
        return fetchText(el.getAttribute("src")).then(function (code) {
          return { src: el.getAttribute("src"), code: code };
        });
      }));

      return vendorPromise.then(function (vendors) {
        vendors.forEach(function (v) {
          Array.prototype.slice.call(doc.querySelectorAll("script")).forEach(function (s) {
            if (s.textContent.indexOf("/* " + v.src + " unavailable offline */") === 0) s.textContent = v.code;
          });
        });

        // Pro runtime + module, appended last so they run after the free tool boots.
        var runtime = doc.createElement("script");
        runtime.textContent = runtimeJs;
        doc.body.appendChild(runtime);

        if (moduleJs) {
          var mod = doc.createElement("script");
          mod.textContent = moduleJs;
          doc.body.appendChild(mod);
        }

        var banner = doc.createElement("div");
        banner.setAttribute("style", "position:fixed;left:0;right:0;bottom:0;z-index:60;padding:8px 14px;background:#14100a;color:#f2bd6f;font:600 11px/1.4 ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase;text-align:center");
        banner.textContent = opts.note || "Offline copy — Pro. Works with no internet connection.";
        doc.body.appendChild(banner);

        return "<!doctype html>\n" + doc.documentElement.outerHTML + "\n";
      });
    });
  };

  /* ============================================================
     delivery panel
     ============================================================ */

  var PANEL_CSS =
    ".pro-deliver{border:1px solid var(--brass,#b08d4f);border-radius:12px;padding:1.5rem 1.6rem;background:" +
    "color-mix(in srgb, var(--brass,#b08d4f) 7%, transparent)}" +
    ".pro-deliver h3{margin:.2rem 0 .5rem;font-size:1.3rem}" +
    ".pro-deliver ul{margin:.4rem 0 1.2rem;padding-left:1.1rem;color:var(--ink-dim,#a8a49b)}" +
    ".pro-deliver li{margin:.2rem 0}" +
    ".pro-deliver .pro-actions{display:flex;gap:.6rem;flex-wrap:wrap;align-items:center}" +
    ".pro-deliver .pro-note{color:var(--ink-faint,#86827a);font-size:.82rem;margin:.9rem 0 0}" +
    ".pro-deliver .pro-note a{color:inherit}" +
    ".pro-deliver .pro-extra{margin:0 0 1.1rem}" +
    ".pro-deliver .pro-extra label{display:block;font:600 .7rem/1 var(--font-mono,ui-monospace,monospace);letter-spacing:.12em;" +
    "text-transform:uppercase;color:var(--ink-faint,#86827a);margin-bottom:.45rem}" +
    ".pro-deliver .pro-extra select,.pro-deliver .pro-extra input,.pro-deliver .pro-extra textarea{width:100%;max-width:26rem}";

  var mountedFor = null;
  var panelEl = null;
  var activeRefresh = null;

  /* Shown only when this browser refused to remember the purchase. The download
     above already works — the risk is the buyer closing the tab and losing the
     unlock with no idea it was never saved. Silence there is how a paid customer
     becomes an angry one, so we say it plainly and hand them the reference. */
  function storageWarningHtml() {
    if (durable) return "";
    var rec = memory[mountedFor] || {};
    var contact = (window.JB_CHECKOUT && window.JB_CHECKOUT.contact) || "contact@nymrel.com";
    return (
      '<p class="pro-note" style="border-top:1px solid var(--line,#333);margin-top:1rem;padding-top:.9rem">' +
      "<strong>This browser will not remember your purchase.</strong> Private browsing, or blocked site " +
      "storage, stops us saving the unlock. Your download above works right now — build it before you " +
      "close this tab." +
      (rec.ref
        ? " To unlock it again later, keep this reference: <code>" + PRO.escapeHtml(rec.ref) + "</code>"
        : "") +
      ' Then use <a href="#" data-restore="' + PRO.escapeHtml(mountedFor) + '">Already bought this?</a>' +
      ' on a return visit, or email <a href="mailto:' + contact + "?subject=" +
      encodeURIComponent("Pro download — storage blocked — " + mountedFor) + '">' + contact + "</a>.</p>"
    );
  }

  function ensurePanel() {
    if (panelEl) return panelEl;

    var style = document.createElement("style");
    style.textContent = PANEL_CSS;
    document.head.appendChild(style);

    var section = document.createElement("section");
    section.className = "section wrap";
    section.id = "pro-delivery";
    section.setAttribute("data-pro-strip", "");
    section.innerHTML =
      '<div class="kicker">Your purchase</div><div class="pro-deliver panel"></div>';

    var pricing = document.querySelector(".pricing");
    var anchor = pricing ? pricing.closest("section") : null;
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(section, anchor);
    else document.querySelector("main").appendChild(section);

    panelEl = section.querySelector(".pro-deliver");
    return panelEl;
  }

  function render() {
    if (!mountedFor) return;
    var def = builders[mountedFor];
    if (!def || !PRO.isUnlocked(mountedFor)) return;

    var el = ensurePanel();
    var contents = (def.contents || []).map(function (c) {
      return "<li>" + PRO.escapeHtml(c) + "</li>";
    }).join("");

    el.innerHTML =
      '<h3>' + PRO.escapeHtml(def.label) + '</h3>' +
      '<p style="margin:0 0 .6rem;color:var(--ink-dim,#a8a49b)">' + PRO.escapeHtml(def.summary || "") + '</p>' +
      (contents ? "<ul>" + contents + "</ul>" : "") +
      (def.extraHtml ? '<div class="pro-extra">' + def.extraHtml + "</div>" : "") +
      '<div class="pro-actions">' +
      '<button class="btn btn-primary" type="button" data-pro-build></button>' +
      '<span class="pro-note" data-pro-reason style="margin:0"></span>' +
      "</div>" +
      '<p class="pro-note">Yours to keep — rebuild it from this page any time. Trouble with a download? ' +
      '<a href="mailto:' + ((window.JB_CHECKOUT && window.JB_CHECKOUT.contact) || "contact@nymrel.com") +
      '?subject=' + encodeURIComponent("Pro download — " + (def.label || mountedFor)) + '">Email us</a>.</p>' +
      storageWarningHtml();

    var btn = el.querySelector("[data-pro-build]");
    var reasonEl = el.querySelector("[data-pro-reason]");
    var readyLabel = "Download " + (def.filenameLabel || "your files");
    var building = false;

    /* The buyer usually lands here before they have finished filling the free
       tool in, so the button has to keep re-checking rather than freezing the
       answer it got on first paint. Only the button and its note are touched,
       so anything typed into a module's own controls survives. */
    function refreshReady() {
      if (building) return;
      var blocked = def.ready ? def.ready() : "";
      btn.disabled = !!blocked;
      btn.textContent = blocked ? "Download — not ready yet" : readyLabel;
      reasonEl.textContent = blocked || "";
    }

    if (!document.body.getAttribute("data-pro-ready-watch")) {
      document.body.setAttribute("data-pro-ready-watch", "1");
      var readyTimer = null;
      ["input", "change", "click"].forEach(function (evt) {
        document.addEventListener(evt, function () {
          clearTimeout(readyTimer);
          readyTimer = setTimeout(function () { if (typeof activeRefresh === "function") activeRefresh(); }, 80);
        }, true);
      });
    }
    activeRefresh = refreshReady;
    refreshReady();

    btn.addEventListener("click", function () {
      var blocked = def.ready ? def.ready() : "";
      if (blocked) { JB.toast(blocked); return; }
      building = true;
      btn.disabled = true;
      var original = btn.textContent;
      btn.textContent = "Building…";
      Promise.resolve()
        .then(function () { return def.build(); })
        .then(function (result) {
          if (!result || !result.files || !result.files.length) throw new Error("Nothing to deliver");
          if (result.files.length === 1) {
            var only = result.files[0];
            JB.downloadBlob(only.name, new Blob([only.bytes || only.text], { type: only.mime || "text/plain;charset=utf-8" }));
          } else {
            JB.downloadBlob(result.filename, JB.zip(result.files));
          }
          JB.toast(result.toast || "Downloaded — check your downloads folder");
        })
        .catch(function (err) {
          JB.toast("Could not build that file — " + (err && err.message ? err.message : "try again"));
        })
        .then(function () {
          building = false;
          btn.textContent = original;
          refreshReady();
        });
    });

    if (typeof def.onRender === "function") def.onRender(el);
  }

  /* If the builder module fails to load, someone who has paid would otherwise
     see nothing at all. Show them a way to reach a human instead. */
  function renderFallback() {
    if (!mountedFor || builders[mountedFor] || !PRO.isUnlocked(mountedFor)) return;
    var contact = (window.JB_CHECKOUT && window.JB_CHECKOUT.contact) || "contact@nymrel.com";
    var el = ensurePanel();
    el.innerHTML =
      "<h3>Your purchase is recorded</h3>" +
      "<p style=\"margin:0 0 .6rem;color:var(--ink-dim,#a8a49b)\">The builder for this page did not load, so the download is not ready here. " +
      "Refresh first — if it still does not appear, email us and we will send the files directly.</p>" +
      '<div class="pro-actions">' +
      '<a class="btn btn-primary" href="mailto:' + contact + "?subject=" +
      encodeURIComponent("Pro download did not load — " + mountedFor) + '">Email us</a>' +
      '<button class="btn" type="button" onclick="location.reload()">Refresh</button>' +
      "</div>";
  }

  PRO.mount = function (productId) {
    mountedFor = productId;
    if (!PRO.isUnlocked(productId)) return;
    render();
    setTimeout(renderFallback, 4000);
  };

  PRO.refresh = render;

  /* Buyers on a second device, and anyone the studio invoiced by hand, can
     re-enter the reference from their receipt to unlock the download here. */
  /* Restore is the second door into an unlock, and it used to be the unlocked
     one: any six characters granted the tier. Gating only the checkout return
     would have moved the free unlock one click sideways — the "Already bought
     this?" link sits next to the buy button on every tool page. Same verifier,
     same answer. */
  PRO.restore = function (productId) {
    var ref = window.prompt("Paste the reference from your receipt. It unlocks the download in this browser.");
    if (ref === null) return false;
    ref = String(ref).trim();
    if (!/^[A-Za-z0-9_-]{6,}$/.test(ref)) {
      JB.toast("That does not look like a receipt reference — check your emailed receipt");
      return false;
    }
    JB.toast("Checking your reference…");
    PRO.verifyRef(productId, ref).then(function (ok) {
      if (!ok) {
        JB.toast("We could not confirm that reference for this product — email " +
                 ((window.JB_CHECKOUT && window.JB_CHECKOUT.contact) || "contact@nymrel.com"));
        return;
      }
      PRO.grant(productId, ref);
      render();
      JB.toast("Unlocked in this browser");
    });
    return true;
  };

  /* Boot: claim a fresh purchase, then show the panel if this browser owns it. */
  PRO.boot = function (productId) {
    PRO.mount(productId);
    /* Read before claimFromUrl strips them: a buyer who arrives WITH a
       reference and is refused must be told. Silence there is the same
       charge-and-deliver-nothing outcome the verifier exists to prevent, only
       now it can happen to someone who genuinely paid — a Stripe outage, or a
       webhook-slow session — and they would see an ordinary tool page with no
       hint that anything went wrong and nothing to quote in an email. */
    var arrivedWithRef = false;
    try {
      var q = new URLSearchParams(location.search);
      arrivedWithRef = !!q.get("jb_pro") && !!(q.get("sid") || q.get("session_id"));
    } catch (e) { /* ignore */ }

    PRO.claimFromUrl().then(function (claimed) {
      if (!claimed) {
        if (arrivedWithRef) {
          JB.toast("We could not confirm that purchase yet — if you were charged, email " +
                   ((window.JB_CHECKOUT && window.JB_CHECKOUT.contact) || "contact@nymrel.com"));
        }
        return;
      }
      render();
      var panel = document.getElementById("pro-delivery");
      if (panel) panel.scrollIntoView({ behavior: "smooth", block: "center" });
      JB.toast("Purchase confirmed — your files are ready below");
    });
  };

  if (window.JB_PRO_OFFLINE) {
    /* Offline copy: the buyer already owns it, so mount without a checkout trip. */
    var offlineId = document.body && document.body.getAttribute("data-pro-product");
    if (offlineId) PRO.mount(offlineId);
  } else if (typeof shim._pending === "string") {
    PRO.boot(shim._pending);
  }
})();
