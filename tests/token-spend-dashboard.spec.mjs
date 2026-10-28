import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const toolPath = "/tools/token-spend-dashboard/";
const sentinel = "nymrel-local-only-model-8675309";
const csv = [
  "date,model,input_tokens,output_tokens,cost_usd",
  `2026-08-01,${sentinel},1000,250,1.25`,
  "2026-08-02,example-second-model,1500,250,2.75",
].join("\n");

test.beforeEach(async ({ page }) => {
  await page.goto(toolPath, { waitUntil: "domcontentloaded" });
});

test("parses a usage file locally without persisting or transmitting its rows", async ({ page }) => {
  const leakedRequests = [];
  page.on("request", (request) => {
    const requestText = `${request.url()}\n${request.postData() ?? ""}`.toLowerCase();
    if (requestText.includes(sentinel)) {
      leakedRequests.push({ method: request.method(), url: request.url() });
    }
  });

  await page.locator("#csvFile").setInputFiles({
    name: "local-usage.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });

  await expect(page.locator("#dash")).toBeVisible();
  await expect(page.locator("#statGrid")).toContainText("$4.00");
  await expect(page.locator("#modelBars")).toContainText(sentinel);
  await expect(page.locator("#modeChip")).toContainText("Costs read from your file");
  expect(leakedRequests).toEqual([]);

  const storage = await page.evaluate(() => ({
    local: { ...localStorage },
    session: { ...sessionStorage },
  }));
  expect(JSON.stringify(storage)).not.toContain(sentinel);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("#csvInput")).toHaveValue("");
  await expect(page.locator("#emptyState")).toBeVisible();
});

test("clears imported data and returns to the empty state", async ({ page }) => {
  await page.locator("#csvInput").fill(csv);
  await expect(page.locator("#dash")).toBeVisible();
  await page.locator("#clearBtn").click();
  await expect(page.locator("#csvInput")).toHaveValue("");
  await expect(page.locator("#dash")).toBeHidden();
  await expect(page.locator("#emptyState")).toBeVisible();
  await expect(page.locator("#exportBtn")).toBeDisabled();
});

test("has no serious accessibility violations after rendering a ledger", async ({ page }) => {
  await page.locator("#csvInput").fill(csv);
  await expect(page.locator("#dash")).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter((violation) =>
    ["serious", "critical"].includes(violation.impact ?? ""),
  );
  expect(blocking).toEqual([]);
});

test("keeps the rendered ledger operable without horizontal overflow", async ({ page }) => {
  await page.locator("#csvInput").fill(csv);
  await expect(page.locator("#chartsSection")).toBeVisible();
  const hasOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  expect(hasOverflow).toBe(false);
});


test("keeps missing model prices unknown in the screen and exported summary", async ({ page }) => {
  await page.evaluate(() => { window.JBTokens.state.prices = [{ match: "known-fixture", in: 2, out: 10 }]; });
  await page.locator("#csvInput").fill([
    "date,model,input_tokens,output_tokens",
    "2026-10-05,known-fixture,1000000,1000000",
    "2026-10-05,unpriced-fixture,1000000,1000000",
  ].join("\n"));
  await expect(page.locator("#statGrid")).toContainText("Known spend (partial)");
  await expect(page.locator("#modeChip")).toContainText("Partial estimate");
  const unknownRow = page.locator("#dataTable tbody tr").filter({ hasText: "unpriced-fixture" });
  await expect(unknownRow).toContainText("No price set");
  await expect(unknownRow).not.toContainText("$0.00");
  const downloadEvent = page.waitForEvent("download");
  await page.locator("#exportBtn").click();
  const download = await downloadEvent;
  const { readFile } = await import("node:fs/promises");
  const exported = await readFile(await download.path(), "utf8");
  expect(exported).toContain("cost_status");
  expect(exported).toContain("unpriced-fixture,1,1000000,1000000,,missing_price");
  expect(exported).toContain("TOTAL,2,2000000,2000000,,partial");
  expect(exported).toContain("known-fixture,1,1000000,1000000,12.0000,estimated");
});

test("preserves a valid observed zero cost", async ({ page }) => {
  await page.locator("#csvInput").fill("date,model,input_tokens,output_tokens,cost_usd\n2026-10-05,zero-fixture,100,100,0");
  await expect(page.locator("#statGrid")).toContainText("Total spend");
  await expect(page.locator("#statGrid")).toContainText("$0.00");
  await expect(page.locator("#dataTable")).not.toContainText("No price set");
});


test("keeps narrow-screen stat cards and price inputs inside their panels", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 1000 });
  await page.locator("#csvInput").fill(csv);
  await expect(page.locator("#dash")).toBeVisible();
  const fits = await page.locator("#statGrid").evaluate(node => {
    const bounds = node.getBoundingClientRect();
    return [...node.children].every(card => card.getBoundingClientRect().right <= bounds.right + 1);
  });
  expect(fits).toBe(true);
  await page.locator("#priceEditor summary").click();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  expect(overflow).toBe(false);
  const height = await page.locator("#priceRows input").first().evaluate(node => node.getBoundingClientRect().height);
  expect(height).toBeGreaterThanOrEqual(40);
});
