/* Token Ledger — Pro ($49, one-time).
   Adds the four things the free dashboard cannot do with one file: merge several
   exports into one ledger, tag models to projects and clients, hold the months
   against a budget, and print the result. Plus an offline copy of the whole tool.

   Every figure is recomputed by JBTokens.aggregate — the free dashboard's own
   costing function — so the report and the page can never disagree, and an
   estimate stays labelled an estimate all the way to the printed page. */
(function () {
  "use strict";

  var JB = window.JB;
  if (!JB || !JB.pro) return;
  var esc = JB.pro.escapeHtml;

  var MAX_ROWS = 100000;  // the same data-row cap the free tool applies, per file
  var MAX_FILES = 12;     // merged sources; past this the zip stops being readable

  /* The free tool keeps its state in a closure and exposes it, plus its pure
     helpers, on window.JBTokens. Without it Pro has nothing to read, and says so
     in plain words rather than throwing. */
  function api() {
    var t = window.JBTokens;
    if (!t || !t.state) return null;
    if (typeof t.aggregate !== "function" || typeof t.parseCSV !== "function" || typeof t.detectAll !== "function") return null;
    return t;
  }

  /* ---------- small formatters, matching the dashboard ---------- */

  function addCommas(s) {
    var parts = String(s).split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return parts.join(".");
  }
  function fmtUSD(n) {
    if (!isFinite(n)) n = 0;
    return "$" + addCommas(n.toFixed(2));
  }
  function fmtInt(n) { return addCommas(Math.round(n || 0)); }
  function moneyAxis(v) {
    if (v >= 1e6) return "$" + (v / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
    if (v >= 1e3) return "$" + (v / 1e3).toFixed(1).replace(/\.0$/, "") + "k";
    if (v >= 10) return "$" + Math.round(v);
    return "$" + v.toFixed(2);
  }
  function num(s) {
    if (s == null) return NaN;
    var t = String(s).replace(/[$,\s]/g, "");
    if (t === "") return NaN;
    var v = parseFloat(t);
    return isFinite(v) ? v : NaN;
  }
  function niceMax(max) {
    if (max <= 0) return 1;
    var pow = Math.pow(10, Math.floor(Math.log(max) / Math.LN10));
    var frac = max / pow;
    var nice = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
    return nice * pow;
  }
  function cell(row, idx) { return (idx >= 0 && idx < row.length) ? row[idx] : ""; }

  /* Mirrors the dashboard's date reader so merged.csv carries one date format
     across providers. No total is ever derived from this — totals come from
     JBTokens.aggregate, which does its own date reading. */
  function dayKey(v) {
    if (v == null) return null;
    var s = String(v).trim();
    if (!s) return null;
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[1] + "-" + m[2] + "-" + m[3];
    m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (m) return m[3] + "-" + ("0" + m[1]).slice(-2) + "-" + ("0" + m[2]).slice(-2);
    var d = new Date(s);
    if (!isNaN(d.getTime())) {
      return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
    }
    return null;
  }

  var MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function monthLabel(key) {
    var m = /^(\d{4})-(\d{2})$/.exec(key);
    if (!m) return key;
    return MONTH_NAMES[parseInt(m[2], 10) - 1] + " " + m[1];
  }

  /* ---------- sources ---------- */

  var extra = [];        // files added through the Pro control: {name, headers, rows, map, truncated}
  var mergeNote = "";    // last thing that went wrong while reading a file
  var tagText = "";
  var budgetText = "";

  function liveName(st) {
    if (st.isSample) return "example data (not your account)";
    var chip = document.getElementById("fileChip");
    var label = chip ? String(chip.textContent || "").trim() : "";
    return label || "loaded in the dashboard";
  }

  /* The dashboard's own data counts as the first source. */
  function sources() {
    var t = api();
    if (!t) return [];
    var out = [];
    var st = t.state;
    if (st.rawRows && st.rawRows.length) {
      out.push({
        name: liveName(st),
        headers: st.headers,
        rows: st.rawRows,
        map: st.map,
        truncated: !!st.truncated,
        sample: !!st.isSample
      });
    }
    for (var i = 0; i < extra.length; i++) out.push(extra[i]);
    return out;
  }

  /* The effective per-million rates the free tool itself applies to a model
     name, read back out of aggregate() with a one-row probe. Doing it this way
     means a per-row cost in merged.csv cannot drift from the per-model total in
     the report, and unpriced models come back at 0 exactly as they do on screen. */
  var PROBE_MAP = { date: -1, model: 0, in: 1, out: 2, cost: -1 };
  function rateFor(name, prices) {
    var agg = api().aggregate;
    return {
      "in": agg([[name, "1000000", "0"]], PROBE_MAP, prices).totalCost,
      out: agg([[name, "0", "1000000"]], PROBE_MAP, prices).totalCost
    };
  }

  /* Each source is aggregated on its own map, then the aggregates are added
     together. Providers disagree about whether an export carries a cost column,
     so a source that has one is never quietly folded in with one that does not —
     each keeps its own basis, and the report prints both. */
  function analyze() {
    var t = api();
    var prices = (t.state && t.state.prices) || t.defaultPrices || [];
    var srcs = sources();
    var per = [];
    var models = {}, days = {};
    var totalCost = 0, totalIn = 0, totalOut = 0, usedRows = 0, skippedRows = 0;
    var unpriced = {}, estModelNames = {};
    var estCount = 0, actualCount = 0, sampleCount = 0, truncCount = 0;

    srcs.forEach(function (s) {
      var agg = t.aggregate(s.rows, s.map, prices);
      per.push({ src: s, agg: agg });

      if (agg.estimated) estCount++; else actualCount++;
      if (s.sample) sampleCount++;
      if (s.truncated) truncCount++;

      totalCost += agg.totalCost;
      totalIn += agg.totalIn;
      totalOut += agg.totalOut;
      usedRows += agg.usedRows;
      skippedRows += agg.skippedRows;

      agg.models.forEach(function (m) {
        var e = models[m.name] || (models[m.name] = { name: m.name, req: 0, inTok: 0, outTok: 0, cost: 0 });
        e.req += m.req; e.inTok += m.inTok; e.outTok += m.outTok; e.cost += m.cost;
        if (agg.estimated) estModelNames[m.name] = true;
      });
      agg.days.forEach(function (d) { days[d.key] = (days[d.key] || 0) + d.cost; });
      agg.unpriced.forEach(function (u) { unpriced[u] = true; });
    });

    var modelArr = [];
    for (var k in models) { if (models.hasOwnProperty(k)) modelArr.push(models[k]); }
    modelArr.sort(function (a, b) { return b.cost - a.cost || (b.inTok + b.outTok) - (a.inTok + a.outTok); });

    var dayArr = [], datedCost = 0;
    for (var dk in days) {
      if (!days.hasOwnProperty(dk)) continue;
      dayArr.push({ key: dk, cost: days[dk] });
      datedCost += days[dk];
    }
    dayArr.sort(function (a, b) { return a.key < b.key ? -1 : a.key > b.key ? 1 : 0; });

    var monthMap = {}, monthArr = [];
    dayArr.forEach(function (d) {
      var mk = d.key.slice(0, 7);
      if (!monthMap[mk]) { monthMap[mk] = { key: mk, cost: 0, days: 0 }; monthArr.push(monthMap[mk]); }
      monthMap[mk].cost += d.cost;
      monthMap[mk].days++;
    });
    monthArr.sort(function (a, b) { return a.key < b.key ? -1 : a.key > b.key ? 1 : 0; });

    var unpricedArr = [];
    for (var u in unpriced) { if (unpriced.hasOwnProperty(u)) unpricedArr.push(u); }
    var estModels = [];
    for (var em in estModelNames) { if (estModelNames.hasOwnProperty(em)) estModels.push(em); }

    var undated = totalCost - datedCost;
    if (Math.abs(undated) < 0.005) undated = 0;

    return {
      per: per, prices: prices, models: modelArr, days: dayArr, months: monthArr,
      totalCost: totalCost, totalIn: totalIn, totalOut: totalOut,
      totalTokens: totalIn + totalOut, usedRows: usedRows, skippedRows: skippedRows,
      unpriced: unpricedArr, estModels: estModels, undatedCost: undated,
      estCount: estCount, actualCount: actualCount, sampleCount: sampleCount, truncCount: truncCount
    };
  }

  /* ---------- tags ---------- */

  function parseTagRules(raw) {
    var out = [];
    String(raw || "").split(/\r?\n/).forEach(function (line) {
      var parts = line.split("|");
      if (parts.length < 2) return;
      var match = parts[0].trim();
      var label = parts.slice(1).join("|").trim().replace(/\s+/g, " ");
      if (!match || !label) return;
      out.push({ match: match, lower: match.toLowerCase(), label: label });
    });
    return out;
  }

  /* First rule that matches wins — the same substring rule the price table uses,
     so the two behave the same way on the same model name. */
  function tagFor(name, rules) {
    var lower = String(name).toLowerCase();
    for (var i = 0; i < rules.length; i++) {
      if (lower.indexOf(rules[i].lower) >= 0) return rules[i].label;
    }
    return null;
  }

  /* Buckets only for labels the rules actually hit, plus an explicit untagged
     bucket. Rules that matched nothing are reported as matching nothing. */
  function tagRollup(models, rules, totalCost) {
    var buckets = {}, order = [];
    var untagged = { label: "Untagged", models: 0, cost: 0, tokens: 0, untagged: true };
    var hits = {};

    models.forEach(function (m) {
      var label = tagFor(m.name, rules);
      var b;
      if (label === null) {
        b = untagged;
      } else {
        hits[label] = (hits[label] || 0) + 1;
        b = buckets[label];
        if (!b) { b = buckets[label] = { label: label, models: 0, cost: 0, tokens: 0 }; order.push(b); }
      }
      b.models++;
      b.cost += m.cost;
      b.tokens += m.inTok + m.outTok;
    });

    order.sort(function (a, b) { return b.cost - a.cost; });
    if (untagged.models) order.push(untagged);
    order.forEach(function (b) { b.share = totalCost > 0 ? (b.cost / totalCost) * 100 : 0; });

    var idle = rules.filter(function (r) { return !hits[r.label]; });
    return { buckets: order, idleRules: idle };
  }

  /* ---------- the monthly chart, drawn by hand ---------- */

  function monthChart(months, budget) {
    if (!months.length) return "";
    var W = 760, H = 260, padL = 64, padR = 78, padT = 18, padB = 36;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var n = months.length;
    var max = 0;
    for (var i = 0; i < n; i++) { if (months[i].cost > max) max = months[i].cost; }
    var top = niceMax(Math.max(max, budget > 0 ? budget : 0));
    var baseY = padT + plotH;

    var svg = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Spend by month" ' +
      'preserveAspectRatio="xMidYMid meet" style="width:100%;height:auto;display:block;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">';

    var fr = [1, 2 / 3, 1 / 3];
    for (var g = 0; g < fr.length; g++) {
      var gy = padT + plotH * (1 - fr[g]);
      svg += '<line x1="' + padL + '" y1="' + gy.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + gy.toFixed(1) +
        '" stroke="var(--line)" stroke-width="1"/>' +
        '<text x="' + (padL - 8) + '" y="' + (gy + 3).toFixed(1) + '" text-anchor="end" font-size="9" fill="var(--faint)">' +
        esc(moneyAxis(top * fr[g])) + "</text>";
    }
    svg += '<line x1="' + padL + '" y1="' + baseY + '" x2="' + (W - padR) + '" y2="' + baseY +
      '" stroke="var(--line)" stroke-width="1"/>';

    var slot = plotW / n;
    var barW = Math.min(slot * 0.6, 56);
    for (var b = 0; b < n; b++) {
      var m = months[b];
      var over = budget > 0 && m.cost > budget;
      var x = padL + slot * b + (slot - barW) / 2;
      var bh = top > 0 ? plotH * (m.cost / top) : 0;
      if (bh < 0) bh = 0;
      svg += '<rect x="' + x.toFixed(1) + '" y="' + (baseY - bh).toFixed(1) + '" width="' + barW.toFixed(1) +
        '" height="' + bh.toFixed(1) + '" rx="1.5" fill="' + (over ? "var(--bad)" : "var(--accent)") + '">' +
        "<title>" + esc(monthLabel(m.key) + " · " + fmtUSD(m.cost)) + "</title></rect>" +
        '<text x="' + (x + barW / 2).toFixed(1) + '" y="' + (baseY + 15) + '" text-anchor="middle" font-size="9" fill="var(--faint)">' +
        esc(monthLabel(m.key)) + "</text>";
    }

    if (budget > 0) {
      var by = padT + plotH * (1 - Math.min(budget / top, 1));
      svg += '<line x1="' + padL + '" y1="' + by.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + by.toFixed(1) +
        '" stroke="var(--bad)" stroke-width="1.5" stroke-dasharray="6 4"/>' +
        '<text x="' + (W - padR + 6) + '" y="' + (by + 3).toFixed(1) + '" font-size="9" fill="var(--bad)">Budget ' +
        esc(moneyAxis(budget)) + "</text>";
    }
    return svg + "</svg>";
  }

  /* ---------- report ---------- */

  function tableHtml(head, rows) {
    var th = head.map(function (h) {
      return '<th' + (h.num ? ' class="num"' : "") + ">" + esc(h.label) + "</th>";
    }).join("");
    var body = rows.map(function (r) {
      return "<tr>" + r.map(function (c, i) {
        return "<td" + (head[i] && head[i].num ? ' class="num"' : "") + ">" + (c && c.html ? c.html : esc(c)) + "</td>";
      }).join("") + "</tr>";
    }).join("");
    return "<table><thead><tr>" + th + "</tr></thead><tbody>" + body + "</tbody></table>";
  }

  function sourceRange(agg) {
    if (!agg.hasDate || !agg.days.length) return "no dates";
    var a = agg.days[0].key, b = agg.days[agg.days.length - 1].key;
    return a === b ? a : a + " → " + b;
  }

  function costHeader(data) {
    if (data.estCount && !data.actualCount) return "Est. cost (USD)";
    if (data.estCount && data.actualCount) return "Cost (USD, mixed basis)";
    return "Cost (USD)";
  }
  function costTotalLabel(data) {
    if (data.estCount && !data.actualCount) return "Total spend, estimated from tokens";
    if (data.estCount && data.actualCount) return "Total spend, part read and part estimated";
    return "Total spend, read from your files";
  }

  function reportBody(data, rules, budget) {
    var out = "";

    /* --- sources --- */
    out += "<h2>Sources in this report</h2>";
    out += tableHtml(
      [{ label: "Source" }, { label: "Rows read", num: true }, { label: "Rows skipped", num: true },
       { label: "Dates" }, { label: "Cost basis" }],
      data.per.map(function (p) {
        return [
          p.src.name + (p.src.truncated ? " (capped at " + fmtInt(MAX_ROWS) + " rows)" : ""),
          fmtInt(p.agg.usedRows),
          fmtInt(p.agg.skippedRows),
          sourceRange(p.agg),
          p.agg.estimated ? "estimated from tokens" : "read from the file"
        ];
      })
    );
    if (data.estCount && data.actualCount) {
      out += "<p>These sources do not share a cost basis. Each one was costed on its own terms — the ones " +
        "marked <em>read from the file</em> use the figures the provider printed, the ones marked " +
        "<em>estimated from tokens</em> were priced from the rate table listed at the end. The combined " +
        "totals below are the sum of both, so treat every combined figure as part estimate.</p>";
    }
    if (data.sampleCount) {
      out += '<p><span class="pill bad">Example data</span> One of the sources is the dashboard\'s built-in ' +
        "example, not your account. Clear it and load your own export before using these numbers for anything.</p>";
    }
    if (data.truncCount) {
      out += "<p>A source hit the " + fmtInt(MAX_ROWS) + "-row reading cap. Everything past that row was not read, " +
        "so its totals cover only the rows shown above.</p>";
    }

    /* --- totals --- */
    out += "<h2>Totals</h2>";
    out += tableHtml(
      [{ label: "Measure" }, { label: "Value", num: true }],
      [
        [costTotalLabel(data), fmtUSD(data.totalCost)],
        ["Input tokens", fmtInt(data.totalIn)],
        ["Output tokens", fmtInt(data.totalOut)],
        ["Rows read", fmtInt(data.usedRows)],
        ["Rows skipped as blank", fmtInt(data.skippedRows)],
        ["Days with a readable date", fmtInt(data.days.length)],
        ["Calendar months covered", fmtInt(data.months.length)]
      ]
    );
    if (data.days.length) {
      out += "<p>Dated spend runs " + esc(data.days[0].key) + " to " + esc(data.days[data.days.length - 1].key) + ".</p>";
    }
    if (data.undatedCost > 0) {
      out += "<p><strong>" + esc(fmtUSD(data.undatedCost)) + "</strong> of the total sits on rows with no readable " +
        "date, so it appears in the totals and in the per-model table but not in any month below. Map a date " +
        "column for that source in the dashboard to pull it into the monthly view.</p>";
    }

    /* --- months + budget --- */
    out += "<h2>By month" + (budget > 0 ? " — against a " + esc(fmtUSD(budget)) + " budget" : "") + "</h2>";
    if (!data.months.length) {
      out += "<p>No source had a readable date column, so there is no monthly breakdown. Pick a date column " +
        "under <em>Column mapping</em> in the dashboard and build the report again.</p>";
    } else {
      out += monthChart(data.months, budget);
      var over = data.months.filter(function (m) { return budget > 0 && m.cost > budget; });
      out += tableHtml(
        [{ label: "Month" }, { label: "Days with spend", num: true }, { label: "Spend", num: true },
         { label: "Budget", num: true }, { label: "Difference", num: true }, { label: "Status" }],
        data.months.map(function (m) {
          var diff = budget > 0 ? m.cost - budget : 0;
          return [
            monthLabel(m.key),
            fmtInt(m.days),
            fmtUSD(m.cost),
            budget > 0 ? fmtUSD(budget) : "—",
            budget > 0 ? (diff >= 0 ? "+" : "−") + fmtUSD(Math.abs(diff)) : "—",
            { html: budget > 0
              ? (m.cost > budget ? '<span class="pill bad">Over</span>' : '<span class="pill ok">Within</span>')
              : '<span class="pill">No budget set</span>' }
          ];
        })
      );
      if (budget > 0) {
        out += over.length
          ? "<p><strong>" + over.length + " month" + (over.length === 1 ? "" : "s") + " over budget:</strong> " +
            esc(over.map(function (m) { return monthLabel(m.key) + " at " + fmtUSD(m.cost); }).join(", ")) + ".</p>"
          : "<p>No month in this data went over " + esc(fmtUSD(budget)) + ".</p>";
      } else {
        out += "<p>No monthly budget was entered, so nothing is flagged. Enter one in the Pro panel and build " +
          "the report again to get the budget line and the over/under column.</p>";
      }
      out += "<p>A month here covers only the days present in your export. The first and last months are " +
        "partial whenever the export starts or stops mid-month, so compare them to a budget with that in mind.</p>";
    }

    /* --- models --- */
    out += "<h2>By model</h2>";
    out += tableHtml(
      [{ label: "Model" }, { label: "Rows", num: true }, { label: "Input tokens", num: true },
       { label: "Output tokens", num: true }, { label: costHeader(data), num: true },
       { label: "Share", num: true }],
      data.models.map(function (m) {
        return [
          m.name, fmtInt(m.req), fmtInt(m.inTok), fmtInt(m.outTok), fmtUSD(m.cost),
          (data.totalCost > 0 ? (m.cost / data.totalCost * 100).toFixed(1) : "0.0") + "%"
        ];
      })
    );

    /* --- tags --- */
    out += "<h2>By project and client</h2>";
    if (!rules.length) {
      out += "<p>No tag rules were entered, so every model is untagged. Add rules in the Pro panel — one per " +
        "line, in the form <code>substring | label</code> — and build the report again.</p>";
    } else {
      var roll = tagRollup(data.models, rules, data.totalCost);
      out += tableHtml(
        [{ label: "Tag" }, { label: "Models", num: true }, { label: "Spend", num: true },
         { label: "Share", num: true }, { label: "Tokens", num: true }],
        roll.buckets.map(function (b) {
          return [b.label, fmtInt(b.models), fmtUSD(b.cost), b.share.toFixed(1) + "%", fmtInt(b.tokens)];
        })
      );
      out += "<h3>Rules used</h3><ul>" + rules.map(function (r) {
        return "<li><code>" + esc(r.match) + "</code> → " + esc(r.label) + "</li>";
      }).join("") + "</ul>";
      if (roll.idleRules.length) {
        out += "<p><strong>Matched nothing in this data:</strong> " +
          roll.idleRules.map(function (r) { return "<code>" + esc(r.match) + "</code> (" + esc(r.label) + ")"; }).join(", ") +
          ". Those labels are not in the table above, because no model name contained the rule's text.</p>";
      }
      var untagged = roll.buckets.filter(function (b) { return b.untagged; })[0];
      if (untagged) {
        out += "<p><strong>" + esc(fmtUSD(untagged.cost)) + "</strong> across " + untagged.models +
          " model" + (untagged.models === 1 ? "" : "s") + " matched no rule and is counted as untagged.</p>";
      }
    }

    /* --- provenance --- */
    out += "<h2>Where these numbers came from</h2>";
    out += "<ul>" + data.per.map(function (p) {
      return "<li><strong>" + esc(p.src.name) + "</strong> — " + fmtInt(p.agg.usedRows) + " rows, " +
        (p.agg.estimated
          ? "no cost column found, so spend was <strong>estimated from token counts</strong> using the rates below."
          : "spend was <strong>read from the file's own cost column</strong>; no rate table was applied.") + "</li>";
    }).join("") + "</ul>";

    if (data.estCount) {
      out += "<h3>Rates applied to the estimated sources</h3>" +
        "<p>These are the rates the dashboard's price table resolved for each model name, in USD per million " +
        "tokens. They are editable estimates you control on the page — not quoted provider pricing. Check them " +
        "against your provider's pricing page before relying on the figures.</p>";
      var names = data.estModels.slice().sort();
      out += tableHtml(
        [{ label: "Model" }, { label: "Input $/M", num: true }, { label: "Output $/M", num: true }],
        names.map(function (name) {
          var r = rateFor(name, data.prices);
          return [name, r["in"].toFixed(4), r.out.toFixed(4)];
        })
      );
      out += "<h3>The price table as it stood</h3>";
      out += tableHtml(
        [{ label: "Model name contains" }, { label: "Input $/M", num: true }, { label: "Output $/M", num: true }],
        data.prices.map(function (p) { return [String(p.match || ""), String(p["in"]), String(p.out)]; })
      );
      if (data.unpriced.length) {
        out += "<p><strong>Counted at $0.00:</strong> " +
          data.unpriced.map(function (u) { return "<code>" + esc(u) + "</code>"; }).join(", ") +
          ". No row in the price table matched these model names, so their tokens are in the token totals but " +
          "their spend is not in the cost totals. Add a matching row on the page and build the report again.</p>";
      }
    }

    out += "<h3>How this was produced</h3><ul>" +
      "<li>Each source was totalled separately by the free dashboard's own costing function, then the totals " +
      "were added. The figures here match what the dashboard shows for the same data.</li>" +
      "<li>Reading stops at " + fmtInt(MAX_ROWS) + " data rows per file.</li>" +
      "<li>Rows with no model name and no tokens and no cost are counted as skipped, not as zero spend.</li>" +
      "<li>Every file was read in your browser. Nothing was uploaded, and this report was written on your own " +
      "machine from your own export.</li>" +
      "</ul>";

    return out;
  }

  function reportDoc(data, rules, budget) {
    var lede = data.per.length === 1
      ? "One source, " + fmtInt(data.usedRows) + " rows."
      : data.per.length + " sources merged, " + fmtInt(data.usedRows) + " rows.";
    if (data.months.length) lede += " " + data.months.length + " calendar month" + (data.months.length === 1 ? "" : "s") + ".";
    if (data.estCount && !data.actualCount) lede += " Spend is estimated from token counts.";
    else if (data.estCount) lede += " Spend is part read from file, part estimated from token counts.";
    else lede += " Spend is read from your files.";

    return JB.pro.reportHtml({
      kicker: "Token Ledger Pro",
      title: "Monthly spend report",
      lede: lede,
      body: reportBody(data, rules, budget)
    });
  }

  /* ---------- merged.csv ---------- */

  function csvCell(v) {
    var s = String(v);
    /* neutralise formula-leading cells so a spreadsheet will not execute them */
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /* One row per usable input row, in one shape, across every source. Costs on
     estimated sources are filled in at the rate aggregate() itself reports for
     that model, so the column adds up to the report's totals and the file can be
     re-loaded anywhere — including back into the free dashboard. The cost_basis
     column keeps the estimate honest once the row leaves this zip. */
  function mergedCsv(data, rules) {
    var lines = ["source,date,model,input_tokens,output_tokens,cost_usd,cost_basis,tag"];
    data.per.forEach(function (p) {
      var s = p.src, mp = s.map, est = p.agg.estimated, rates = {};
      for (var r = 0; r < s.rows.length; r++) {
        var row = s.rows[r];
        var name = mp.model >= 0 ? String(cell(row, mp.model)).trim() : "";
        var inT = num(cell(row, mp["in"])); if (isNaN(inT)) inT = 0;
        var outT = num(cell(row, mp.out)); if (isNaN(outT)) outT = 0;
        var costRaw = mp.cost >= 0 ? num(cell(row, mp.cost)) : NaN;
        var hasData = (name !== "") || inT > 0 || outT > 0 || (mp.cost >= 0 && !isNaN(costRaw));
        if (!hasData) continue;
        if (name === "") name = "(unlabeled)";

        var cost;
        if (est) {
          var rate = rates[name] || (rates[name] = rateFor(name, data.prices));
          cost = (inT / 1e6) * rate["in"] + (outT / 1e6) * rate.out;
        } else {
          cost = isNaN(costRaw) ? 0 : costRaw;
        }

        var raw = mp.date >= 0 ? String(cell(row, mp.date)).trim() : "";
        lines.push([
          s.name,
          dayKey(raw) || raw,
          name,
          Math.round(inT),
          Math.round(outT),
          cost.toFixed(6),
          est ? "estimated from tokens" : "from file",
          tagFor(name, rules) || "untagged"
        ].map(csvCell).join(","));
      }
    });
    return lines.join("\r\n") + "\r\n";
  }

  /* ---------- README ---------- */

  function readmeTxt(data, rules, budget, offlineNote) {
    var lines = [
      "Token Ledger — Pro",
      "Built " + new Date().toLocaleString() + " in your browser, from your own files.",
      "",
      "  monthly-report.html        Open in a browser. Print it for a PDF.",
      "  merged.csv                 Every source, normalised into one file.",
      offlineNote ? null : "  token-ledger-offline.html  The whole Token Ledger in one file. Double-click it; no internet needed.",
      "  README.txt                 This file.",
      "",
      "SOURCES IN THIS BUILD"
    ].filter(function (l) { return l !== null; });

    data.per.forEach(function (p) {
      lines.push("  - " + p.src.name + " — " + fmtInt(p.agg.usedRows) + " rows, " +
        (p.agg.estimated ? "spend estimated from tokens" : "spend read from the file"));
    });

    lines.push("");
    lines.push("TOTAL: " + fmtUSD(data.totalCost) +
      (data.estCount && data.actualCount ? " (part read from file, part estimated)"
        : data.estCount ? " (estimated from token counts)" : " (read from your files)"));
    if (data.undatedCost > 0) {
      lines.push(fmtUSD(data.undatedCost) + " of that has no readable date and is not in any month.");
    }
    if (data.sampleCount) {
      lines.push("");
      lines.push("WARNING: one source is the dashboard's built-in example data, not your account.");
    }
    if (data.truncCount) {
      lines.push("");
      lines.push("NOTE: a file was longer than " + fmtInt(MAX_ROWS) + " rows and was read up to that cap only.");
    }

    lines.push("");
    lines.push("BUDGET");
    lines.push(budget > 0
      ? "  " + fmtUSD(budget) + " per calendar month. Months over it are flagged in the report and drawn in red."
      : "  None entered. Add one in the Pro panel and build again to get the budget line.");

    lines.push("");
    lines.push("TAG RULES");
    if (!rules.length) {
      lines.push("  None entered. One rule per line, in the form:  sonnet | Acme retainer");
    } else {
      rules.forEach(function (r) { lines.push("  " + r.match + "  ->  " + r.label); });
      lines.push("  Anything a rule did not match is counted as untagged, never invented.");
    }

    lines.push("");
    lines.push("ABOUT merged.csv");
    lines.push("  One row per usable input row: source, date, model, tokens, cost, cost basis, tag.");
    lines.push("  Dates are normalised to YYYY-MM-DD where they could be read.");
    lines.push("  cost_usd is the provider's own figure where the file had one, and an estimate priced");
    lines.push("  from your editable rate table where it did not. cost_basis says which, per row —");
    lines.push("  keep that column if you move this file somewhere else, or the estimates stop being");
    lines.push("  identifiable as estimates.");

    if (offlineNote) {
      lines.push("");
      lines.push("OFFLINE COPY");
      lines.push("  " + offlineNote);
    }

    lines.push("");
    lines.push("Nothing here was uploaded. Every file in this zip was written on your machine.");
    lines.push("Questions: contact@nymrel.com");
    lines.push("");
    return lines.join("\n");
  }

  /* ---------- the Pro panel controls ---------- */

  function controlsHtml() {
    var srcs = sources();
    var listed = srcs.length
      ? '<ul style="margin:.35rem 0 .9rem;padding-left:1.1rem;font-size:.86rem">' + srcs.map(function (s, i) {
          var idx = extra.indexOf(s);
          return "<li>" + esc(s.name) + " — " + fmtInt(s.rows.length) + " row" + (s.rows.length === 1 ? "" : "s") +
            (s.truncated ? " (capped at " + fmtInt(MAX_ROWS) + ")" : "") +
            (idx >= 0 ? ' <button type="button" class="linkbtn" data-pro-drop="' + idx + '">remove</button>' : "") +
            "</li>";
        }).join("") + "</ul>"
      : '<p style="margin:.35rem 0 .9rem;font-size:.86rem">Nothing loaded yet — load a CSV in the dashboard above, ' +
        "or add files here.</p>";

    return '<label for="proMergeFiles">Merge more exports (' + srcs.length + " loaded)</label>" +
      listed +
      '<input id="proMergeFiles" type="file" accept=".csv,text/csv" multiple>' +
      (mergeNote ? '<p style="margin:.5rem 0 0;font-size:.82rem;color:var(--warn,#e0a458)">' + esc(mergeNote) + "</p>" : "") +
      '<p style="margin:.5rem 0 1.2rem;font-size:.8rem;color:var(--ink-faint,#86827a)">Each file is read and ' +
      "column-matched on its own, so exports from different providers can be combined. Up to " + MAX_FILES +
      " files, " + fmtInt(MAX_ROWS) + " rows each.</p>" +

      '<label for="proTagRules">Project &amp; client tags — one rule per line</label>' +
      '<textarea id="proTagRules" rows="4" spellcheck="false" placeholder="sonnet | Acme retainer&#10;gpt-4o | Internal tooling&#10;embedding | Search index">' +
      esc(tagText) + "</textarea>" +
      '<p style="margin:.5rem 0 1.2rem;font-size:.8rem;color:var(--ink-faint,#86827a)">Left of the bar is text to ' +
      "look for in the model name; right of the bar is the label. First matching rule wins. Anything unmatched " +
      "is reported as untagged.</p>" +

      '<label for="proBudget">Monthly budget (USD)</label>' +
      '<input id="proBudget" type="number" min="0" step="1" placeholder="e.g. 500" value="' + esc(budgetText) + '">' +
      '<p style="margin:.5rem 0 0;font-size:.8rem;color:var(--ink-faint,#86827a)">Drawn as a line across the ' +
      "report's month chart. Months above it are flagged. Leave blank for no budget.</p>";
  }

  /* ---------- keeping the panel in step with the free tool ---------- */

  var def;
  var lastSig = "";

  function signature() {
    var t = api();
    if (!t) return "none";
    var st = t.state;
    return [
      st.rawRows ? st.rawRows.length : 0,
      st.map ? [st.map.date, st.map.model, st.map["in"], st.map.out, st.map.cost].join(",") : "",
      st.isSample ? "sample" : "",
      st.agg ? st.agg.totalCost.toFixed(4) : "",
      extra.length,
      mergeNote
    ].join("|");
  }

  function repaint() {
    readControls();
    lastSig = signature();
    def.extraHtml = controlsHtml();
    JB.pro.refresh();
  }

  function readControls() {
    var t = document.getElementById("proTagRules");
    var b = document.getElementById("proBudget");
    if (t) tagText = t.value;
    if (b) budgetText = b.value;
  }

  var syncTimer = null, slowTimer = null;
  function check() {
    if (signature() !== lastSig) repaint();
  }
  function syncSoon() {
    clearTimeout(syncTimer);
    clearTimeout(slowTimer);
    syncTimer = setTimeout(check, 400);
    slowTimer = setTimeout(check, 1500);   // file reads and drops finish late
  }
  ["input", "change", "click", "drop", "paste"].forEach(function (ev) {
    document.addEventListener(ev, function (e) {
      var t = e.target;
      if (t && t.closest && t.closest("#pro-delivery")) return;   // our own controls repaint themselves
      syncSoon();
    }, true);
  });

  function addFiles(fileList) {
    var t = api();
    if (!t) return;
    var list = Array.prototype.slice.call(fileList || []);
    if (!list.length) return;
    mergeNote = "";

    var room = MAX_FILES - extra.length;
    if (room <= 0) {
      mergeNote = "That is already " + MAX_FILES + " merged files — remove one before adding another.";
      repaint();
      return;
    }
    if (list.length > room) {
      mergeNote = "Only the first " + room + " file" + (room === 1 ? "" : "s") + " were added — " + MAX_FILES + " is the limit.";
      list = list.slice(0, room);
    }

    var pending = list.length;
    list.forEach(function (f) {
      var reader = new FileReader();
      reader.onload = function () {
        var parsed = t.parseCSV(String(reader.result || ""), MAX_ROWS);
        var rows = parsed.rows;
        if (rows.length < 2) {
          mergeNote = "Could not read any rows from " + f.name + " — it needs a header line and comma-separated values.";
        } else {
          var already = extra.filter(function (s) { return s.name === f.name && s.rows.length === rows.length - 1; }).length;
          if (already) {
            mergeNote = f.name + " is already in the list — it was not added twice.";
          } else {
            var headers = rows[0];
            extra.push({
              name: f.name,
              headers: headers,
              rows: rows.slice(1),
              map: t.detectAll(headers),
              truncated: parsed.truncated
            });
          }
        }
        if (--pending === 0) repaint();
      };
      reader.onerror = function () {
        mergeNote = "Could not read " + f.name + ".";
        if (--pending === 0) repaint();
      };
      reader.readAsText(f);
    });
  }

  /* ---------- registration ---------- */

  def = {
    label: "Token Ledger Pro",
    filenameLabel: "your Pro files",
    summary: "Your sources merged, tagged, held against a budget, and written up — built here, from the files you loaded.",
    contents: [
      "monthly-report.html — spend by month with your budget line, by model, by tag, and a plain statement of where every figure came from",
      "merged.csv — every source normalised into one file: source, date, model, tokens, cost, cost basis, tag",
      "token-ledger-offline.html — this whole tool, Pro included, in one file that works with no internet",
      "README.txt — what each file holds and how the numbers were reached"
    ],
    extraHtml: controlsHtml(),

    onRender: function (el) {
      var fileEl = el.querySelector("#proMergeFiles");
      if (fileEl) {
        fileEl.addEventListener("change", function () {
          addFiles(fileEl.files);
          fileEl.value = "";
        });
      }
      var tagEl = el.querySelector("#proTagRules");
      if (tagEl) tagEl.addEventListener("input", function () { tagText = tagEl.value; });
      var budgetEl = el.querySelector("#proBudget");
      if (budgetEl) budgetEl.addEventListener("input", function () { budgetText = budgetEl.value; });

      /* The runtime keeps one panel element and rewrites its innards, so the
         delegated handler is attached once and never stacked up. */
      if (!el.getAttribute("data-tokens-pro-wired")) {
        el.setAttribute("data-tokens-pro-wired", "1");
        el.addEventListener("click", function (e) {
          var i = e.target && e.target.getAttribute && e.target.getAttribute("data-pro-drop");
          if (i == null) return;
          extra.splice(parseInt(i, 10), 1);
          mergeNote = "";
          repaint();
        });
      }

      lastSig = signature();
    },

    ready: function () {
      if (!api()) {
        return "This page's dashboard has not finished loading — reload the page, then try again.";
      }
      if (!sources().length) {
        return "Load a usage CSV into the dashboard above, or add files below — the report is built from your own data.";
      }
      return "";
    },

    build: function () {
      readControls();
      var data = analyze();
      var rules = parseTagRules(tagText);
      var budgetNum = num(budgetText);
      var budget = isFinite(budgetNum) && budgetNum > 0 ? budgetNum : 0;

      var offlineNote = "";
      var offline;
      if (window.JB_PRO_OFFLINE) {
        offlineNote = "Not rebuilt — you are already working inside the offline copy. Keep the file you opened; it is the offline copy.";
        offline = Promise.resolve(null);
      } else {
        offline = JB.pro.buildOfflineApp({
          filename: "token-ledger-offline.html",
          title: "Token Ledger — offline copy",
          module: "tokens-pro",
          note: "Offline copy — Token Ledger Pro. Works with no internet connection."
        }).catch(function () {
          offlineNote = "Could not be rebuilt this time — the browser could not re-read the page's own files. " +
            "Reload the page and build again; the rest of this zip is unaffected.";
          return null;
        });
      }

      return offline.then(function (html) {
        var files = [
          { name: "monthly-report.html", text: reportDoc(data, rules, budget) },
          { name: "merged.csv", text: mergedCsv(data, rules) }
        ];
        if (html) files.push({ name: "token-ledger-offline.html", text: html });
        files.push({ name: "README.txt", text: readmeTxt(data, rules, budget, offlineNote) });

        return {
          filename: "token-ledger-pro.zip",
          toast: "Pro files downloaded — start with monthly-report.html",
          files: files
        };
      });
    }
  };

  JB.pro.register("tokens-pro", def);
})();
