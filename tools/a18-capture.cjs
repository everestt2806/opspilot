const { createRequire } = require("node:module");
const { resolve, join } = require("node:path");
const { mkdirSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");

const root = resolve(__dirname, "..");
const appRequire = createRequire(join(root, "app/package.json"));
const { app } = appRequire("electron");
const output = join(root, "docs/evidence/tk-a18/review-02/after");
const pages = [
  "vps",
  "apps",
  "deploy",
  "dashboard",
  "migrate",
  "history",
  "settings",
];
const evidence = {
  viewport: "1366x768",
  dpr: null,
  pages: [],
  errors: [],
  mica: "MICA_FALLBACK",
};
mkdirSync(output, { recursive: true });
const tempProfile = join(tmpdir(), `opspilot-a18-review-02-${process.pid}`);
app.setName("OpsPilot");
app.setPath("userData", tempProfile);
app.setAppPath(join(root, "app"));
process.env.OPSPILOT_C01_DEPLOY_ONLY = "1";

const delay = (ms) =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
async function waitForRoute(win, page) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const state = await win.webContents.executeJavaScript(`(() => {
      const selected = document.querySelector('.app-navigation .ant-menu-item-selected');
      const content = document.querySelector('[data-page-key]');
      return { selected: selected?.getAttribute('data-menu-id') ?? '', page: content?.getAttribute('data-page-key') ?? '' };
    })()`);
    if (state.page === page && state.selected.endsWith(`-${page}`)) return;
    await delay(50);
  }
  throw new Error(`Route assertion failed for ${page}`);
}
const scrub = (win) =>
  win.webContents.executeJavaScript(`(() => {
  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        child.textContent = child.textContent
          .replace(/\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b/g, 'host.local')
          .replace(/221\\.121\\.1\\.(?:79|80)/g, 'host.local')
      } else walk(child)
    }
  }
  walk(document.body)
})()`);
let done = false;
function finish(code) {
  if (done) return;
  done = true;
  evidence.exitCode = code;
  writeFileSync(
    join(output, "capture.json"),
    JSON.stringify(evidence, null, 2),
  );
  app.quit();
}

app.on("will-quit", () => {
  rmSync(tempProfile, { recursive: true, force: true });
});

app.once("browser-window-created", (_event, win) => {
  win.webContents.once("did-finish-load", async () => {
    try {
      win.setContentSize(1366, 768);
      evidence.dpr = await win.webContents.executeJavaScript(
        "window.devicePixelRatio",
      );
      await delay(800);
      for (const page of pages) {
        if (page !== "vps") {
          await win.webContents.executeJavaScript(
            `document.querySelector('.app-navigation .ant-menu-item[data-menu-id$="-${page}"]')?.click()`,
          );
        }
        await waitForRoute(win, page);
        await win.webContents.executeJavaScript(
          "new Promise(requestAnimationFrame)",
        );
        await scrub(win);
        await delay(100);
        const image = await win.webContents.capturePage();
        const filename = `${page}-1366x768.png`;
        writeFileSync(join(output, filename), image.toPNG());
        evidence.pages.push(filename);
      }
      for (const page of ["deploy", "migrate"]) {
        win.setContentSize(1920, 1080);
        await win.webContents.executeJavaScript(
          `document.querySelector('.app-navigation .ant-menu-item[data-menu-id$="-${page}"]')?.click()`,
        );
        await waitForRoute(win, page);
        await win.webContents.executeJavaScript(
          "new Promise(requestAnimationFrame)",
        );
        await scrub(win);
        await delay(100);
        const filename = `${page}-1920x1080.png`;
        writeFileSync(
          join(output, filename),
          (await win.webContents.capturePage()).toPNG(),
        );
        evidence.pages.push(filename);
      }
      finish(0);
    } catch (error) {
      evidence.errors.push(
        error instanceof Error ? error.message : String(error),
      );
      finish(1);
    }
  });
});
require(join(root, "app/out/main/index.js"));
