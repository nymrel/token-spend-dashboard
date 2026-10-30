import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const types = {
  ".css": "text/css; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

function inside(root, path) {
  const child = relative(root, path);
  return child !== ".." && !child.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(child);
}

/** A loopback-only test server; never starts during module import. */
export async function createTestServer(directory) {
  const root = await realpath(directory);
  return createServer(async (request, response) => {
    const finish = (status) => {
      response.writeHead(status, { "Cache-Control": "no-store" });
      response.end();
    };
    if (!["GET", "HEAD"].includes(request.method)) {
      response.setHeader("Allow", "GET, HEAD");
      finish(405);
      return;
    }
    let path;
    try {
      path = decodeURIComponent((request.url ?? "").split("?", 1)[0]);
    } catch {
      finish(400);
      return;
    }
    if (!path.startsWith("/") || /[\\\0]/.test(path) || path.split("/").includes("..")) {
      finish(400);
      return;
    }
    try {
      let file = await realpath(resolve(root, `.${path}`));
      if (!inside(root, file)) { finish(404); return; }
      let info = await stat(file);
      if (info.isDirectory()) {
        file = await realpath(join(file, "index.html"));
        if (!inside(root, file)) { finish(404); return; }
        info = await stat(file);
      }
      if (!info.isFile()) { finish(404); return; }
      response.writeHead(200, {
        "Content-Type": types[extname(file)] ?? "application/octet-stream",
        "Content-Length": info.size,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      if (request.method === "HEAD") response.end();
      else createReadStream(file).on("error", () => response.destroy()).pipe(response);
    } catch (error) {
      finish(["ENOENT", "ENOTDIR", "EACCES"].includes(error.code) ? 404 : 500);
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const server = await createTestServer(root);
  server.listen(4173, "127.0.0.1", () => console.log("Test server: http://127.0.0.1:4173"));
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close());
}
