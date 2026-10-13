import { realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

// These scanners inspect resource references, never rewrite or sanitize source.
export function htmlAssetReferences(html) {
  const references = [];
  const tags = /<!--(?:-?>|[\s\S]*?(?:--!?>|$))|<![^>]*>|<([a-z][\w:-]*)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi;
  let tag;
  while ((tag = tags.exec(html))) {
    if (!tag[1]) continue;
    const name = tag[1].toLowerCase();
    const attributes = new Map();
    for (const match of tag[2].matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      const key = match[1].toLowerCase();
      if (!attributes.has(key)) attributes.set(key, match[2] ?? match[3] ?? match[4] ?? "");
    }
    if (name === "base" && attributes.has("href")) {
      throw new Error("base href is unsupported by local asset verification; use explicit resource paths");
    }
    const attribute = name === "script" ? "src" : name === "link" ? "href" : null;
    if (attribute && attributes.has(attribute)) {
      references.push(decodeHtmlAttribute(attributes.get(attribute)));
    }
    // Script examples and style content are not HTML elements.
    if (["script", "style", "textarea", "title"].includes(name)) {
      const close = new RegExp(`</${name}(?=[\\s/>])(?:"[^"]*"|'[^']*'|[^'">])*>`, "gi");
      close.lastIndex = tags.lastIndex;
      const end = close.exec(html);
      tags.lastIndex = end ? close.lastIndex : html.length;
    }
  }
  return references;
}

function decodeHtmlAttribute(value) {
  return value.replace(/&(#x[\da-f]+;?|#\d+;?|[a-z]+;)/gi, (entity, encoded) => {
    const name = encoded.replace(/;$/, "");
    if (name[0] === "#") {
      const code = name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      if (code > 0 && code <= 0x10ffff) return String.fromCodePoint(code);
    }
    const known = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" };
    if (Object.hasOwn(known, name)) return known[name];
    throw new Error(`unsupported character reference in asset URL: ${entity}`);
  });
}

function decodeCss(value) {
  return value.replace(/\\(?:([\da-f]{1,6})\s?|\r\n|[\n\r\f]|([^\n\r\f]))/gi, (_match, hex, character) => {
    if (!hex) return character ?? "";
    const code = parseInt(hex, 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "\ufffd";
  });
}

export function cssAssetReferences(css) {
  const references = [];
  // Consume comments and strings first so documentation and data URLs cannot
  // introduce fake nested url() references. Quoted @imports are resources too.
  const escape = String.raw`\\(?:[\da-f]{1,6}\s?|[^\r\n\f])`;
  const identifier = `(?:[\\w-]|${escape})+`;
  const quoted = String.raw`"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'`;
  const tokens = new RegExp(
    String.raw`\/\*[\s\S]*?(?:\*\/|$)|${quoted}|@(${identifier})(?:\s|\/\*[\s\S]*?\*\/)*(${quoted})|(?<![\w-])(${identifier})\(`,
    "gi",
  );
  let token;
  while ((token = tokens.exec(css))) {
    if (token[1]) {
      if (decodeCss(token[1]).toLowerCase() === "import") {
        references.push(decodeCss(token[2].slice(1, -1)));
      }
      continue;
    }
    if (!token[3] || decodeCss(token[3]).toLowerCase() !== "url") continue;
    const rest = css.slice(tokens.lastIndex);
    const url = /^\s*(?:"((?:\\[\s\S]|[^"\\])*)"|'((?:\\[\s\S]|[^'\\])*)'|((?:\\(?:[\da-f]{1,6}\s?|[\s\S])|[^\s)"'\\])*))\s*\)/i.exec(rest);
    if (!url) throw new Error("malformed CSS url() reference");
    references.push(decodeCss(url[1] ?? url[2] ?? url[3]));
    tokens.lastIndex += url[0].length;
  }
  return references;
}

function isWithin(root, target) {
  const path = relative(root, target);
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

export function verifyLocalAssets(root, sourcePath, references, { hostedPaths = [] } = {}) {
  const failures = [];
  const absoluteRoot = realpathSync(root);
  for (const raw of references) {
    const reference = raw.trim();
    if (/^(?:https?:|data:|\/\/|#)/i.test(reference)) continue;
    try {
      if (!reference) throw new Error("empty asset URL");
      if (/^[a-z][\w+.-]*:/i.test(reference)) throw new Error("unsupported asset URL scheme");
      const pathname = decodeURIComponent(reference.split(/[?#]/, 1)[0]);
      if (pathname.includes("\\") || pathname.includes("\0")) throw new Error("invalid asset path");
      const target = pathname.startsWith("/")
        ? resolve(absoluteRoot, `.${pathname}`)
        : resolve(absoluteRoot, dirname(sourcePath), pathname);
      if (!isWithin(absoluteRoot, target)) throw new Error("asset escapes repository root");
      // Exceptions apply to the exact hosted URL, never a prefix or relative alias.
      if (hostedPaths.includes(reference)) continue;
      const realTarget = realpathSync(target);
      if (!isWithin(absoluteRoot, realTarget)) throw new Error("asset symlink escapes repository root");
      if (!statSync(realTarget).isFile()) throw new Error("asset is not a regular file");
    } catch (error) {
      const reason = error.code === "ENOENT" || error.code === "ENOTDIR" ? "missing local asset" : error.message;
      failures.push(`${reason} referenced by ${sourcePath}: ${reference}`);
    }
  }
  return failures;
}
