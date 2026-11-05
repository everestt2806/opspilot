const { app, BrowserWindow } = require("electron");
const { createRequire } = require("node:module");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");
const { mkdirSync, rmSync, writeFileSync } = require("node:fs");

const root = resolve(__dirname, "../../..");
const appRequire = createRequire(join(root, "app/package.json"));
const Database = appRequire("better-sqlite3");
const profile = join(tmpdir(), `opspilot-p1f3-fixture-${process.pid}`);
const output = __dirname;
const evidence = {
  fixture: true,
  liveVpsOrHttpsEvidence: false,
  screenshots: [],
  overflow: [],
  errors: [],
};
mkdirSync(profile, { recursive: true });
app.setName("OpsPilot");
app.setPath("userData", profile);

function seedFixture() {
  const database = new Database(join(profile, "opspilot.db"));
  database.pragma("foreign_keys = ON");
  database.exec(
    require("node:fs").readFileSync(
      join(root, "docs/contracts/schema.sql"),
      "utf8",
    ),
  );
  database
    .prepare(
      "INSERT INTO schema_version(version) VALUES " +
        Array.from({ length: 15 }, (_, i) => `(${i + 1})`).join(","),
    )
    .run();
  database
    .prepare(
      `INSERT INTO vps(id,name,host,port,host_fingerprint,username,auth_type,encrypted_secret,last_status)
    VALUES (1,'Fixture VPS','192.0.2.10',22,NULL,'fixture','password',X'00','unknown')`,
    )
    .run();
  database
    .prepare(
      `INSERT INTO app(id,vps_id,name,framework,source_type,host_port,container_port,healthcheck_path,healthcheck_response_type,needs_db,current_deployment_id)
    VALUES (1,1,'fixture-store','nextjs','local',30000,3000,'/','status_2xx',0,1)`,
    )
    .run();
  database
    .prepare(
      `INSERT INTO deployment(id,app_id,version,image_tag,status,started_at,origin)
    VALUES (1,1,1,'fixture-store:v1','running',NULL,'opspilot')`,
    )
    .run();
  database
    .prepare(
      `INSERT INTO domain_binding(app_id,hostname,mode,record_type,record_name,target,ownership_key,status,dns_status,route_status,certificate_status,https_probe_status,ingress_reason_code)
    VALUES (1,'shop.fixture.invalid','shared_ingress','A','shop','192.0.2.10','fixture-dns-owner','failed','pending','failed','failed','failed','INGRESS_RELOAD_FAILED')`,
    )
    .run();
  database.close();
}

const delay = (ms) =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
async function until(win, expression, label) {
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    if (await win.webContents.executeJavaScript(expression)) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}
async function selectDomainTab(win) {
  await until(
    win,
    `Boolean(document.querySelector('.apps-page'))`,
    "Apps page",
  );
  await until(
    win,
    `Boolean([...document.querySelectorAll('[role="tab"]')].find(e => e.textContent.includes('Tên miền & HTTPS')))`,
    "domain tab",
  );
  await win.webContents.executeJavaScript(
    `([...document.querySelectorAll('[role="tab"]')].find(e => e.textContent.includes('Tên miền & HTTPS'))).click()`,
  );
  await until(
    win,
    `Boolean(document.querySelector('.ant-card') && document.body.innerText.includes('shop.fixture.invalid'))`,
    "fixture binding",
  );
  await win.webContents.executeJavaScript("new Promise(requestAnimationFrame)");
  await delay(250);
}

app.setAppUserModelId("vn.opspilot.desktop");
seedFixture();
process.env.OPSPILOT_C01_DEPLOY_ONLY = "1";
let finished = false;
const captureWatchdog = setTimeout(() => {
  evidence.errors.push("Capture watchdog expired.");
  evidence.windows = BrowserWindow.getAllWindows().map((win) => ({
    title: win.getTitle(),
    url: win.webContents.getURL(),
    loading: win.webContents.isLoading(),
  }));
  finish(1);
}, 45000);
function finish(code) {
  if (finished) return;
  finished = true;
  clearTimeout(captureWatchdog);
  evidence.exitCode = code;
  writeFileSync(
    join(output, "capture-report.json"),
    JSON.stringify(evidence, null, 2),
  );
  app.quit();
}
app.on("will-quit", () => rmSync(profile, { recursive: true, force: true }));
app.once("browser-window-created", (_event, win) => {
  win.webContents.once("did-finish-load", async () => {
    try {
      await win.webContents.executeJavaScript(
        `localStorage.setItem('opspilot-ui-session', JSON.stringify({ state: { theme: 'dark', locale: 'vi', activePage: 'apps', selectedAppId: 1, activePanelTab: 'overview', selectedVpsId: 1 }, version: 0 }))`,
      );
      await win.webContents.reload();
      await until(win, `document.readyState === 'complete'`, "renderer reload");
      for (const [width, height] of [
        [1280, 800],
        [1366, 768],
      ]) {
        for (const theme of ["light", "dark"]) {
          await win.webContents.executeJavaScript(
            `(() => { const s = JSON.parse(localStorage.getItem('opspilot-ui-session')); s.state.theme = '${theme}'; localStorage.setItem('opspilot-ui-session', JSON.stringify(s)); })()`,
          );
          await win.webContents.reload();
          await until(
            win,
            `document.readyState === 'complete'`,
            "theme reload",
          );
          await selectDomainTab(win);
          win.setContentSize(width, height);
          await delay(200);
          const metrics = await win.webContents.executeJavaScript(`({
            viewport: [innerWidth, innerHeight],
            document: [document.documentElement.scrollWidth, document.documentElement.clientWidth],
            body: [document.body.scrollWidth, document.body.clientWidth],
            cards: [...document.querySelectorAll('.ant-card')].map(e => [e.scrollWidth, e.clientWidth]),
            horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth || document.body.scrollWidth > document.body.clientWidth || [...document.querySelectorAll('.ant-card')].some(e => e.scrollWidth > e.clientWidth),
            theme: document.documentElement.getAttribute('data-theme')
          })`);
          const base = `${width}x${height}-${theme}`;
          evidence.overflow.push({ file: `${base}.png`, ...metrics });
          writeFileSync(
            join(output, `${base}.png`),
            (await win.webContents.capturePage()).toPNG(),
          );
          evidence.screenshots.push(`${base}.png`);
        }
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
