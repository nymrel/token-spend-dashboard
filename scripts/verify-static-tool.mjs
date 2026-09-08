import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const toolPath = "tools/token-spend-dashboard/index.html";
const canonical = "https://nymrel.com/tools/token-spend-dashboard";
const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

function filesUnder(path) {
  const absolute = join(root, path);
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const child = join(absolute, entry.name);
    if (entry.isDirectory()) return filesUnder(relative(root, child));
    return [relative(root, child).replaceAll("\\", "/")];
  });
}

const requiredFiles = [
  "favicon.svg",
  "LICENSE",
  "README.md",
  "assets/checkout-config.js",
  "assets/site.css",
  "assets/site.js",
  "assets/fonts/fonts.css",
  "assets/pro/pro-runtime.js",
  "assets/pro/tokens-pro.js",
  toolPath,
];
for (const path of requiredFiles) {
  check(existsSync(join(root, path)), `missing required file: ${path}`);
}

const html = read(toolPath);
const readme = read("README.md");
const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? "";
check(/<html\b[^>]*\blang="en"/i.test(html), "document must declare lang=en");
check(head.length > 0, "document must contain a head element");
check((head.match(/<title\b/gi) ?? []).length === 1, "document head must contain exactly one title");
check((html.match(/<h1\b/gi) ?? []).length === 1, "document must contain exactly one h1");
check((html.match(/<main\b/gi) ?? []).length === 1, "document must contain exactly one main landmark");
check(/<meta\s+name="description"\s+content="[^"]+"/i.test(html), "meta description is required");
check(
  new RegExp(`<link\\s+rel="canonical"\\s+href="${canonical}"`, "i").test(html),
  `canonical must be ${canonical}`,
);
check(/Vercel Web Analytics/i.test(html), "page privacy copy must disclose hosted Vercel Web Analytics");
check(/Vercel Web Analytics/i.test(readme), "README privacy copy must disclose hosted Vercel Web Analytics");
check(!/the tool makes no server calls/i.test(`${html}\n${readme}`), "privacy copy must not deny all server requests");

const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
check(duplicateIds.length === 0, `duplicate element ids: ${duplicateIds.join(", ")}`);

const jsonLdBlocks = [
  ...html.matchAll(/<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/gi),
];
check(jsonLdBlocks.length >= 1, "at least one JSON-LD block is required");
for (const [index, block] of jsonLdBlocks.entries()) {
  try {
    JSON.parse(block[1]);
  } catch (error) {
    failures.push(`JSON-LD block ${index + 1} is invalid: ${error.message}`);
  }
}

const inlineScripts = [
  ...html.matchAll(
    /<script(?![^>]*\bsrc=)(?![^>]*application\/ld\+json)[^>]*>([\s\S]*?)<\/script>/gi,
  ),
];
for (const [index, script] of inlineScripts.entries()) {
  try {
    new vm.Script(script[1], { filename: `${toolPath}:inline-${index + 1}` });
  } catch (error) {
    failures.push(`inline script ${index + 1} has invalid syntax: ${error.message}`);
  }
}

const javascriptFiles = filesUnder("assets").filter((path) => path.endsWith(".js"));
for (const path of javascriptFiles) {
  try {
    new vm.Script(read(path), { filename: path });
  } catch (error) {
    failures.push(`${path} has invalid syntax: ${error.message}`);
  }
}

const assetReferences = [
  ...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="(\/[^"]+)"[^>]*>/gi),
].map((match) => match[1].split(/[?#]/, 1)[0]);
for (const reference of assetReferences) {
  if (reference === "/_vercel/insights/script.js") continue;
  const localPath = reference.replace(/^\//, "");
  check(existsSync(join(root, localPath)), `missing local asset referenced by HTML: ${reference}`);
}

for (const path of filesUnder("assets").filter((candidate) => candidate.endsWith(".css"))) {
  const css = read(path);
  for (const match of css.matchAll(/url\(["']?(\/[^)"']+)["']?\)/gi)) {
    const localPath = match[1].split(/[?#]/, 1)[0].replace(/^\//, "");
    check(existsSync(join(root, localPath)), `missing local asset referenced by ${path}: ${match[1]}`);
  }
}

const checkoutTemplate = read("assets/checkout-config.js");
check(
  !/buy\.stripe\.com/i.test(checkoutTemplate),
  "public source checkout template must not embed live payment links",
);

const textFiles = [
  toolPath,
  "README.md",
  ...javascriptFiles,
  ...filesUnder("assets").filter((path) => path.endsWith(".css")),
];
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
];
for (const path of textFiles) {
  const content = read(path);
  for (const pattern of secretPatterns) {
    check(!pattern.test(content), `possible secret in ${path}: ${pattern}`);
  }
}

for (const path of requiredFiles) {
  const absolute = join(root, path);
  check(
    !existsSync(absolute) || statSync(absolute).isFile(),
    `required path is not a regular file: ${path}`,
  );
}

if (failures.length > 0) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      tool: "token-spend-dashboard",
      canonical,
      required_files: requiredFiles.length,
      javascript_files: javascriptFiles.length,
      inline_scripts: inlineScripts.length,
      json_ld_blocks: jsonLdBlocks.length,
      asset_references: assetReferences.length,
      html_sha256: createHash("sha256").update(html).digest("hex"),
    },
    null,
    2,
  ),
);
