// Screenshots the browser-mode app (`npm run dev`, SQLite in WebAssembly).
// Usage: node .claude/skills/run/screenshot.mjs [route ...] [--out DIR] [--width N] [--dark]
// Starts Vite on :1420 if nothing is listening there, and stops it afterwards.
//
// Playwright is not a project dependency (the repository gates new packages),
// so this resolves the copy installed globally in the cloud container.
import { spawn, execSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  if (i === -1) return fallback;
  const value = args[i + 1];
  args.splice(i, 2);
  return value;
};
const dark = args.includes("--dark");
if (dark) args.splice(args.indexOf("--dark"), 1);
const outDir = resolve(flag("--out", "screenshots"));
const width = Number(flag("--width", "1280"));
const routes = args.length ? args : ["/"];

const require = createRequire(join(execSync("npm root -g").toString().trim(), "_"));
const { chromium } = require("playwright");

const BASE = "http://localhost:1420";
const isUp = () => fetch(BASE).then(() => true, () => false);

let vite;
if (!(await isUp())) {
  vite = spawn("npx", ["vite", "--port", "1420", "--strictPort"], {
    stdio: "ignore",
    detached: true,
  });
  for (let i = 0; i < 60 && !(await isUp()); i++) await new Promise((r) => setTimeout(r, 500));
  if (!(await isUp())) throw new Error("Vite did not start on :1420");
}

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width, height: 900 },
  colorScheme: dark ? "dark" : "light",
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

try {
  for (const route of routes) {
    await page.goto(BASE + route, { waitUntil: "networkidle" });
    await page.waitForTimeout(300);
    const name = (route.replace(/^\/|\/$/g, "").replace(/\//g, "_") || "home") +
      (dark ? "-dark" : "") + ".png";
    const file = join(outDir, name);
    await page.screenshot({ path: file, fullPage: true });
    console.log(file);
  }
} finally {
  await browser.close();
  if (vite) process.kill(-vite.pid);
}
if (errors.length) {
  console.error("Browser errors:\n" + errors.join("\n"));
  process.exitCode = 1;
}
