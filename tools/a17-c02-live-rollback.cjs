const { app } = require("electron");
const { join, resolve } = require("node:path");

const root = resolve(__dirname, "..");
const appName = "OpsPilot";
const appId = 1;
process.env.OPSPILOT_C01_DEPLOY_ONLY = "1";

function invoke(win, channel, ...args) {
  return win.webContents
    .executeJavaScript(
      `window.api.invoke(${JSON.stringify(channel)}, ...${JSON.stringify(args)})`,
    )
    .then((result) => {
      if (!result.ok)
        throw new Error(`${channel}: ${result.error?.message ?? "IPC failed"}`);
      return result.data;
    });
}

async function main() {
  app.setName(appName);
  app.setAppPath(join(root, "app"));
  const appRequire = require("node:module").createRequire(
    join(root, "app/package.json"),
  );
  appRequire(join(root, "app/out/main/index.js"));
  const win = await new Promise((resolveWindow) => {
    app.once("browser-window-created", (_event, browserWindow) =>
      resolveWindow(browserWindow),
    );
  });
  await new Promise((resolveLoad) =>
    win.webContents.once("did-finish-load", resolveLoad),
  );
  await win.webContents.executeJavaScript(
    'window.__c02Events = []; void window.api.on("deploy:event", (event) => window.__c02Events.push(event)); true',
  );
  const versionsBefore = await invoke(win, "app:versions", appId);
  const currentBefore = versionsBefore.find(
    (item) =>
      item.status === "running" &&
      item.id === Math.max(...versionsBefore.map((version) => version.id)),
  );
  const target = versionsBefore
    .filter(
      (item) => item.status === "running" && item.id !== currentBefore?.id,
    )
    .sort((left, right) => right.version - left.version)[0];
  if (!target)
    throw new Error(
      `no previous running deployment: ${JSON.stringify(versionsBefore)}`,
    );
  const started = await invoke(win, "app:rollback", appId, target.id);
  const deadline = Date.now() + 30 * 60_000;
  let finished;
  while (Date.now() < deadline) {
    const versions = await invoke(win, "app:versions", appId);
    finished = versions.find((item) => item.id === started.deployment_id);
    if (
      finished &&
      ["running", "failed", "rolled_back"].includes(finished.status)
    )
      break;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
  if (!finished || finished.status !== "running")
    throw new Error(`rollback failed: ${JSON.stringify(finished)}`);
  const apps = await invoke(win, "app:list", 2);
  const current = apps.find((item) => item.id === appId);
  const versions = await invoke(win, "app:versions", appId);
  console.log(JSON.stringify({ started, finished, current, versions }));
  app.quit();
}

main().catch((error) => {
  console.error(`C02_ROLLBACK_FAIL ${error.stack || error.message}`);
  app.exit(1);
});
