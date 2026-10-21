import { expect, test } from "@playwright/test";

const csv = "date,model,input_tokens,output_tokens,cost_usd\n2026-10-06,local-flow-fixture,100,20,4";
test.beforeEach(async ({ page }) => {
  await page.goto("/tools/token-spend-dashboard/", { waitUntil: "domcontentloaded" });
});

test("keyboard file import has a direct action and optional column settings", async ({ page }) => {
  await page.locator("#csvInput").focus();
  await page.keyboard.press("Tab");
  await expect(page.locator("#chooseFileBtn")).toBeFocused();
  const chooserPromise = page.waitForEvent("filechooser");
  await page.locator("#chooseFileBtn").press("Space");
  await (await chooserPromise).setFiles({name: "usage.csv", mimeType: "text/csv", buffer: Buffer.from(csv)});
  await expect(page.locator("#statGrid")).toContainText("$4.00");
  await expect(page.locator("#columnDetails")).not.toHaveAttribute("open", "");
});

test("failed import preserves a valid ledger and labels its download", async ({ page }) => {
  await page.locator("#csvInput").fill(csv);
  await expect(page.locator("#statGrid")).toContainText("$4.00");
  await page.locator("#csvInput").fill("date,model,input_tokens,output_tokens,cost_usd");
  await expect(page.locator("#csvInput")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#csvMsg")).toContainText("Your previous ledger is still shown");
  await expect(page.locator("#statGrid")).toContainText("$4.00");
  await expect(page.locator("#exportBtn")).toContainText("previous");
  await page.locator("#csvInput").fill(csv.replace(",20,4", ",20,3"));
  await expect(page.locator("#statGrid")).toContainText("$3.00");
  await expect(page.locator("#csvInput")).toHaveAttribute("aria-invalid", "false");
  await expect(page.locator("#exportBtn")).toHaveText("Export summary CSV");
});

test("agent analysis is explicit, repeatable and preserves the current human ledger", async ({ page }) => {
  await page.locator("#csvInput").fill(csv);
  await expect(page.locator("#statGrid")).toContainText("$4.00");
  const result = await page.evaluate(() => {
    const before = JSON.stringify(window.JBTokens.state);
    const request = {csv: "model,input_tokens,output_tokens\npriced,1000000,1000000\nunrated,100,100", prices: [{match: "priced", in: 2, out: 10}]};
    const first = window.JBTokens.analyzeCSV(request);
    return {first, repeated: JSON.stringify(first) === JSON.stringify(window.JBTokens.analyzeCSV(request)), preserved: before === JSON.stringify(window.JBTokens.state)};
  });
  expect(result.first.status).toBe("partial");
  expect(result.first.result.total_cost_usd).toBeNull();
  expect(result.first.result.known_cost_usd).toBe(12);
  expect(result.first.result.models.find(m => m.model === "unrated").cost_usd).toBeNull();
  expect(result.repeated && result.preserved).toBe(true);
});

test("agent errors locate invalid values instead of coercing them to zero", async ({ page }) => {
  const result = await page.evaluate(() => window.JBTokens.analyzeCSV({csv: "model,cost_usd\nfine,1\nbad,2oops"}));
  expect(result.status).toBe("error");
  expect(result.result).toBeNull();
  expect(result.errors[0]).toMatchObject({code: "INVALID_NUMBER", record: 2, column: 1});
});

test("column correction preserves the previous ledger and its export until mapping is complete", async ({ page }) => {
  await page.locator("#csvInput").fill(csv);
  await expect(page.locator("#statGrid")).toContainText("$4.00");
  await page.locator("#csvInput").fill("service,billed\nreplacement,3");
  await expect(page.locator("#columnDetails")).toHaveAttribute("open", "");
  await expect(page.locator("#dash")).toBeVisible();
  await expect(page.locator("#statGrid")).toContainText("$4.00");
  await expect(page.locator("#csvMsg")).toContainText("Your previous ledger is still shown");
  await expect(page.locator("#exportBtn")).toContainText("previous");
  const retainedSource = await page.evaluate(() => {
    const t = window.JBTokens, s = t.state;
    return {rawText:s.rawText, total:t.aggregate(s.rawRows, s.map, s.prices).totalCost};
  });
  expect(retainedSource).toEqual({rawText:csv, total:4});
  const downloadEvent = page.waitForEvent("download");
  await page.locator("#exportBtn").click();
  const download = await downloadEvent;
  const { readFile } = await import("node:fs/promises");
  expect(await readFile(await download.path(), "utf8")).toContain("local-flow-fixture,1,100,20,4.0000,observed");
  await page.locator('select[data-role="model"]').selectOption("0");
  await expect(page.locator("#exportBtn")).toContainText("previous");
  await page.locator('select[data-role="cost"]').selectOption("1");
  await expect(page.locator("#statGrid")).toContainText("$3.00");
  await expect(page.locator("#exportBtn")).toHaveText("Export summary CSV");
  await expect(page.locator("#csvInput")).toHaveAttribute("aria-invalid", "false");
  await page.locator('select[data-role="model"]').selectOption("-1");
  await expect(page.locator("#statGrid")).toContainText("$3.00");
  await expect(page.locator("#exportBtn")).toContainText("previous");
  await expect(page.locator("#csvInput")).toHaveAttribute("aria-invalid", "true");
  await page.locator('select[data-role="model"]').selectOption("0");
  await expect(page.locator("#csvInput")).toHaveAttribute("aria-invalid", "false");
  expect(await page.evaluate(() => {
    const t = window.JBTokens, s = t.state;
    return t.aggregate(s.rawRows, s.map, s.prices).totalCost;
  })).toBe(3);
});

test("import and export actions retain phone touch targets at narrow widths", async ({ page }) => {
  await page.locator("#csvInput").fill(csv);
  await expect(page.locator("#dash")).toBeVisible();
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({width, height: 900});
    for (const id of ["chooseFileBtn", "exportBtn", "exportTop", "exportBtnMobile"]) {
      const control = page.locator(`#${id}`);
      if (await control.isVisible()) {
        const bounds = await control.boundingBox();
        expect(bounds.height, `${id} at ${width}px`).toBeGreaterThanOrEqual(44);
        expect(bounds.width, `${id} at ${width}px`).toBeGreaterThanOrEqual(44);
      }
    }
  }
});

test("cancelled global costs cannot hide model or daily numeric overflow", async ({ page }) => {
  const overflowCSV = "date,model,cost_usd\n2026-10-01,a,1e308\n2026-10-02,b,-1e308\n2026-10-01,a,1e308\n2026-10-02,b,-1e308";
  for (const input of [
    overflowCSV,
    // Separate dates keep daily totals finite while model totals overflow.
    overflowCSV.replace("2026-10-01,a,1e308\n2026-10-02,b,-1e308", "2026-10-03,a,1e308\n2026-10-04,b,-1e308"),
    // Separate models keep model totals finite while daily totals overflow.
    overflowCSV.replace("a,1e308", "c,1e308").replace("b,-1e308", "d,-1e308"),
  ]) {
    const result = await page.evaluate(csv => window.JBTokens.analyzeCSV({csv}), input);
    expect(result.status).toBe("error");
    expect(result.result).toBeNull();
    expect(result.errors[0].code).toBe("NUMERIC_OVERFLOW");
  }
  await page.locator("#csvInput").fill(csv);
  await expect(page.locator("#statGrid")).toContainText("$4.00");
  await page.locator("#csvInput").fill(overflowCSV);
  await expect(page.locator("#csvInput")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#statGrid")).toContainText("$4.00");
  await expect(page.locator("#exportBtn")).toContainText("previous");
});
