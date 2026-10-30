import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createTestServer } from "./test-server.mjs";

test("loopback static server preserves assets and confines all request paths", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "token-test-server-"));
  const root = join(directory, "site");
  await mkdir(join(root, "tool"), { recursive: true });
  await writeFile(join(root, "tool", "index.html"), "<h1>Fixture</h1>");
  await writeFile(join(root, "fixture.js"), "window.example = true;");
  await writeFile(join(root, "font.woff2"), Buffer.from([0, 1, 2]));
  await writeFile(join(directory, "outside.txt"), "must not be served");
  const server = await createTestServer(root);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  const port = server.address().port;
  const get = (path, method = "GET") => new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on("error", reject);
    req.end();
  });
  const html = await get("/tool/?a=1");
  assert.equal(html.status, 200);
  assert.equal(html.body, "<h1>Fixture</h1>");
  assert.match(html.headers["content-type"], /^text\/html/);
  assert.equal(html.headers["cache-control"], "no-store");
  assert.equal(html.headers["x-content-type-options"], "nosniff");
  const script = await get("/fixture.js");
  assert.match(script.headers["content-type"], /^text\/javascript/);
  assert.equal(script.body, "window.example = true;");
  const head = await get("/font.woff2", "HEAD");
  assert.equal(head.status, 200);
  assert.equal(head.headers["content-type"], "font/woff2");
  assert.equal(head.headers["content-length"], "3");
  assert.equal(head.body, "");
  assert.equal((await get("/missing")).status, 404);
  assert.equal((await get("/")).status, 404);
  assert.equal((await get("/tool/", "POST")).status, 405);
  for (const path of ["/../outside.txt", "/%2e%2e/outside.txt", "/%5c..%5coutside.txt", "/%00", "/%zz"]) {
    const result = await get(path);
    assert.equal(result.status, 400, path);
    assert.ok(!result.body.includes("must not be served"));
  }
  try {
    await symlink(join(directory, "outside.txt"), join(root, "external.txt"));
    assert.equal((await get("/external.txt")).status, 404);
  } catch (error) {
    if (error.code !== "EPERM") throw error;
    t.diagnostic("Host does not permit creating a test symlink; other confinement checks ran.");
  }
});
