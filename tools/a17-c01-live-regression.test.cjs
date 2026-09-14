const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join, resolve } = require("node:path");

const root = resolve(__dirname, "..");
const helper = readFileSync(join(root, "tools", "a17-c01-live.cjs"), "utf8");
const main = readFileSync(join(root, "app", "src", "main", "index.ts"), "utf8");

assert.match(helper, /process\.env\.OPSPILOT_C01_DEPLOY_ONLY = ["']1["']/);
assert.match(main, /if \(process\.env\.OPSPILOT_C01_DEPLOY_ONLY !== '1'\)/g);
assert.equal((main.match(/OPSPILOT_C01_DEPLOY_ONLY/g) ?? []).length >= 2, true);
console.log(
  "C01-R1-05 regression PASS: live helper disables scheduler and ML side effects",
);
