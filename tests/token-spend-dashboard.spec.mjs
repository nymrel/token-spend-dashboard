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
