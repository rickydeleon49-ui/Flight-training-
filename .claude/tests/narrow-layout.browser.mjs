// Durable geometry/keyboard regression against a loopback browser-mode server.
// Start `npm run dev` separately, then run this through the receipt runner:
// node --test .claude/tests/narrow-layout.browser.mjs
// Uses the existing global Playwright, like the run skill; never installs it.
// All records are synthetic in fresh browser contexts. No native calls or AI.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";

const base = new URL(process.env.HFD_NARROW_URL || "http://127.0.0.1:1420");
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(base.hostname), "loopback only");
const require = createRequire(join(execFileSync("npm", ["root", "-g"]).toString().trim(), "_"));
const { chromium } = require("playwright");
let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

async function geometry(page) {
  const problems = await page.evaluate(() => {
    const problems = [];
    const width = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > width + 1) problems.push("page overflow");
    for (const element of [document.body, document.documentElement]) {
      if (["hidden", "clip"].includes(getComputedStyle(element).overflowX)) problems.push("page overflow masked");
    }
    for (const element of document.querySelectorAll("main button, main input, main select, main textarea, dialog[open] button, dialog[open] input, dialog[open] select")) {
      if (!element.getClientRects().length) continue;
      const rect = element.getBoundingClientRect();
      if (rect.left < -1 || rect.right > width + 1) problems.push(`control outside viewport: ${element.textContent || element.getAttribute("aria-label") || element.tagName}`);
      const container = element.closest("dialog, .card");
      if (container) {
        const bounds = container.getBoundingClientRect();
        if (rect.left < bounds.left - 1 || rect.right > bounds.right + 1) problems.push("control outside its card/dialog");
      }
    }
    for (const grid of document.querySelectorAll(".deck, .detail")) {
      const columns = [...grid.children].filter((column) => column.getClientRects().length);
      for (let i = 1; i < columns.length; i++) {
        const previous = columns[i - 1].getBoundingClientRect();
        const current = columns[i].getBoundingClientRect();
        if (Math.abs(current.left - previous.left) > 1 || current.top < previous.bottom) problems.push("content columns do not stack");
      }
    }
    // Measure actual field placement, rather than matching CSS declarations.
    for (const grid of document.querySelectorAll(".form-grid")) {
      if (!grid.getClientRects().length) continue;
      const fields = [...grid.children].filter((field) => field.getClientRects().length);
      for (const field of fields) {
        if (Math.abs(field.getBoundingClientRect().left - grid.getBoundingClientRect().left) > 1) problems.push("form has multiple columns");
      }
    }
    return problems;
  });
  assert.deepEqual(problems, []);
}

const routes = [
  ["Flight Deck", "/"], ["Flight Path", "/flight-path"], ["Study Library", "/study"],
  ["Schedule", "/schedule"], ["Flight Log", "/journal"], ["Questions", "/questions"],
  ["Notes", "/notes"], ["Finances", "/finances"], ["Pilot Toolkit", "/toolkit"], ["Settings", "/settings"],
];
for (const width of [644, 900]) {
  test(`keyboard, reachability, single-column content and dialogs at ${width}px`, async () => {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    // Do not permit a test to contact a provider, analytics or external fonts.
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      return url.origin === base.origin ? route.continue() : route.abort();
    });
    try {
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(base.href);
      await page.locator("main.content").waitFor();
      const menu = page.getByRole("button", { name: "Menu", exact: true });
      assert.equal(await menu.getAttribute("aria-expanded"), "false");
      await menu.focus();
      // Closed links/Search must not receive Tab focus.
      await page.keyboard.press("Tab");
      assert.equal(await page.evaluate(() => !!document.activeElement?.closest("#app-navigation")), false);
      await menu.focus();
      await page.keyboard.press("Enter");
      assert.equal(await menu.getAttribute("aria-expanded"), "true");
      await page.keyboard.press("Tab");
      assert.match(await page.evaluate(() => document.activeElement?.textContent || ""), /Search/);
      await page.keyboard.press("Enter");
      await page.getByRole("textbox", { name: "Search everything" }).waitFor();
      await page.keyboard.press("Escape");
      await menu.focus();
      await page.keyboard.press("Space");
      assert.equal(await menu.getAttribute("aria-expanded"), "false");
      for (const [name, path] of routes) {
        await menu.press("Space");
        const link = page.locator("aside").getByRole("link", { name, exact: true });
        await link.focus();
        await page.keyboard.press("Enter");
        await page.waitForURL((url) => url.hash === `#${path}` || (path === "/" && !url.hash));
        await page.waitForFunction((routePath) => {
          const current = document.querySelector('aside a[aria-current="page"]');
          return current?.getAttribute("href") === `#${routePath}` ||
            (routePath === "/" && current?.getAttribute("href") === "#/");
        }, path);
        assert.equal(await menu.getAttribute("aria-expanded"), "false");
        assert.equal(await menu.evaluate((element) => element === document.activeElement), true);
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await page.locator("main h1").waitFor();
        await geometry(page);
      }
      // Two UI-created notes make library grid geometry observable.
      await page.goto(new URL("/#/study", base).href);
      for (const title of ["NARROW synthetic weather note", "NARROW synthetic navigation note"]) {
        await page.getByRole("button", { name: "Add material", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "Add to your library" });
        await dialog.getByLabel("Title", { exact: true }).fill(title);
        await geometry(page);
        await dialog.getByRole("button", { name: "Add material", exact: true }).click();
        await dialog.waitFor({ state: "hidden" });
      }
      const cards = page.locator(".material-grid > .material-card");
      const boxes = await cards.evaluateAll((elements) => elements.map((element) => {
        const { left, top, bottom } = element.getBoundingClientRect();
        return { left, top, bottom };
      }));
      assert.ok(boxes.length >= 2);
      for (let i = 1; i < boxes.length; i++) {
        assert.ok(Math.abs(boxes[i].left - boxes[0].left) < 1 && boxes[i].top >= boxes[i - 1].bottom, "library cards must stack");
      }
      await cards.filter({ hasText: "NARROW synthetic weather note" }).click();
      await page.getByRole("heading", { name: "NARROW synthetic weather note", exact: true }).waitFor();
      await geometry(page);
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await page.getByRole("dialog", { name: "Edit material" }).waitFor();
      await geometry(page);
      await page.keyboard.press("Escape");
      await page.goto(new URL("/#/journal/new", base).href);
      await page.locator("main .form-grid").first().waitFor();
      await geometry(page);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
}

test("desktop keeps navigation visible without opening Menu", async () => {
  const context = await browser.newContext({ viewport: { width: 1320, height: 900 } });
  try {
    const page = await context.newPage();
    await page.goto(base.href);
    await page.locator("main.content").waitFor();
    assert.equal(await page.getByRole("button", { name: "Menu", exact: true }).count(), 0);
    for (const [name] of routes) assert.equal(await page.locator("aside").getByRole("link", { name, exact: true }).isVisible(), true);
  } finally { await context.close(); }
});
