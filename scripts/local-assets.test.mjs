import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { cssAssetReferences, htmlAssetReferences, verifyLocalAssets } from "./local-assets.mjs";

function fixture(t) {
  const parent = mkdtempSync(join(tmpdir(), "nymrel-assets-"));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, "site");
  mkdirSync(join(root, "assets"), { recursive: true });
  mkdirSync(join(root, "tools", "example"), { recursive: true });
  writeFileSync(join(root, "assets", "app.js"), "void 0;");
  writeFileSync(join(root, "assets", "font face.woff2"), "fixture");
  return { root, parent };
}

test("HTML resources resolve quote variants, attributes, and document-relative paths", (t) => {
  const { root } = fixture(t);
  const html = `<!-- <script src='/missing-comment.js'></script> -->
    <SCRIPT defer SRC = '/assets/app.js?v=1&amp;x=2'></SCRIPT>
    <script src="../../assets/app.js#module"></script >
    <link href=../../assets/font%20face.woff2 rel=preload>
    <script>const example = "<link href='/missing-example.css'>";</script data-example="<link href='/missing-end-tag.css'>">
    <textarea><script src='/missing-textarea.js'></script></textarea>`;
  const references = htmlAssetReferences(html);
  assert.equal(references.length, 3);
  assert.deepEqual(verifyLocalAssets(root, "tools/example/index.html", references), []);
  for (const entity of ["&#46", "&#x2e"]) {
    const encoded = htmlAssetReferences(`<script src='/assets/app${entity}js'></script>`);
    assert.deepEqual(verifyLocalAssets(root, "tools/example/index.html", encoded), []);
  }
  rmSync(join(root, "assets", "app.js"));
  assert.equal(verifyLocalAssets(root, "tools/example/index.html", references).length, 2);
  assert.throws(() => htmlAssetReferences('<base href="/other/"><script src="app.js"></script>'), /base href is unsupported/);
  for (const comment of ["<!-- x --!>", "<!-->", "<!--->"]) {
    const afterComment = htmlAssetReferences(`${comment}<script src='./missing.js'></script>`);
    assert.equal(verifyLocalAssets(root, "tools/example/index.html", afterComment).length, 1);
  }
});

test("CSS resolves local quoted, escaped, root, relative and imported resources", (t) => {
  const { root } = fixture(t);
  const css = String.raw`
    /* url('/missing-comment.woff2') */
    .example::before { content: "url('/missing-string.woff2')"; }
    @\69mport/**/'./app.js';
    @font-face { src: url( '/assets/font%20face.woff2?v=1#face' ); }
    .a { background: URL("./font face.woff2"); }
    .b { background: u\72l(./font\20 face.woff2); }
    .c { background: url(data:image/svg+xml;base64,PHN2Zy8+); }
    .d { filter: url(#filter); }
  `;
  const references = cssAssetReferences(css);
  assert.equal(references.length, 6);
  assert.deepEqual(verifyLocalAssets(root, "assets/site.css", references), []);
  rmSync(join(root, "assets", "font face.woff2"));
  assert.equal(verifyLocalAssets(root, "assets/site.css", references).length, 3);
});

test("remote resources and only the exact hosted exception stay outside local checks", (t) => {
  const { root } = fixture(t);
  const references = ["https://example.invalid/a.js", "//example.invalid/font.woff2", "data:image/png;base64,AA==", "#filter", "/_vercel/insights/script.js"];
  assert.deepEqual(verifyLocalAssets(root, "tools/example/index.html", references, {
    hostedPaths: ["/_vercel/insights/script.js"],
  }), []);
  assert.equal(verifyLocalAssets(root, "tools/example/index.html", ["/_vercel/insights/script.js.extra"], {
    hostedPaths: ["/_vercel/insights/script.js"],
  }).length, 1);
});

test("missing, malformed, directory and sibling-prefix escape paths cannot pass", (t) => {
  const { root, parent } = fixture(t);
  mkdirSync(join(parent, "site-sibling"));
  writeFileSync(join(parent, "site-sibling", "outside.js"), "void 0;");
  const bad = ["./missing.js", "../../../site-sibling/outside.js", "/../site-sibling/outside.js", "/%2e%2e/site-sibling/outside.js", "/assets", "/broken%zz", "", "file:///tmp/outside", "/assets\\app.js"];
  const failures = verifyLocalAssets(root, "tools/example/index.html", bad);
  assert.equal(failures.length, bad.length);
  assert.equal(failures.filter((failure) => failure.includes("escapes repository root")).length, 3);
  assert.throws(() => cssAssetReferences(".x { background: url('missing'; }"), /malformed CSS/);
});

test("existing symlinks outside the root cannot satisfy a local resource", (t) => {
  const { root, parent } = fixture(t);
  const outside = join(parent, "outside");
  mkdirSync(outside);
  writeFileSync(join(outside, "app.js"), "void 0;");
  symlinkSync(outside, join(root, "linked"), "junction");
  const failures = verifyLocalAssets(root, "tools/example/index.html", ["/linked/app.js"]);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /symlink escapes repository root/);
});

// Exercise the actual repository gate in an isolated copy. These mutations prove
// the helper is wired into verification, and never alter the working source.
test("the source gate accepts valid assets and rejects broken HTML and CSS mutations", (t) => {
  const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const parent = mkdtempSync(join(tmpdir(), "nymrel-gate-"));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, "source");
  cpSync(sourceRoot, root, {
    recursive: true,
    filter: (path) => ![".git", "node_modules", "playwright-report", "test-results"].some((name) => path === join(sourceRoot, name)),
  });
  // Only ai-visibility-scorecard imports parse5; use the installed dependency
  // graph without copying it or downloading anything in this offline test.
  symlinkSync(join(sourceRoot, "node_modules"), join(root, "node_modules"), "junction");
  const verifierPath = join(root, "scripts", "verify-static-tool.mjs");
  const verifier = readFileSync(verifierPath, "utf8");
  const toolPath = verifier.match(/const toolPath = "([^"]+)";/)?.[1];
  assert.ok(toolPath, "repository verifier declares its HTML entrypoint");
  const htmlPath = join(root, toolPath);
  const originalHtml = readFileSync(htmlPath, "utf8");
  const cssPath = join(root, "assets", "site.css");
  const originalCss = readFileSync(cssPath, "utf8");
  const asset = join(root, "assets", "verification-probe.js");
  const run = () => spawnSync(process.execPath, [verifierPath], { cwd: root, encoding: "utf8", timeout: 30_000 });
  const passed = (result) => assert.equal(result.status, 0, result.stderr || result.error?.message);
  const rejected = (result) => {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /missing local asset.*verification-probe/);
  };
  passed(run());
  for (const reference of ["'/assets/verification-probe.js'", '"../../assets/verification-probe.js"', "../../assets/verification-probe.js"]) {
    writeFileSync(asset, "void 0;\n");
    writeFileSync(htmlPath, originalHtml.replace("</head>", `<script src=${reference}></script></head>`));
    passed(run());
    rmSync(asset);
    rejected(run());
  }
  writeFileSync(htmlPath, originalHtml);
  for (const reference of ["'/assets/verification-probe.js'", '"./verification-probe.js"', "./verification-probe.js"]) {
    writeFileSync(asset, "void 0;\n");
    writeFileSync(cssPath, `${originalCss}\n.asset-probe { background: url(${reference}); }\n`);
    passed(run());
    rmSync(asset);
    rejected(run());
  }
});
