import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let ready = false;
for (let attempt = 0; attempt < 120; attempt++) {
  try {
    ready = (
      await fetch("http://127.0.0.1:4007/health", {
        signal: AbortSignal.timeout(1000),
      })
    ).ok;
  } catch {}
  if (ready) break;
  await setTimeout(250);
}
if (!ready) throw Error("The local browser-test API did not become healthy.");
await import("./prepare-browser-test.mjs");
const fixture = JSON.parse(
  await fs.readFile(
    path.join(root, "audit-output/browser-fixture.json"),
    "utf8",
  ),
);
process.env.API_URL = fixture.apiUrl;
process.env.API_PROXY_SECRET = fixture.proxySecret;
const child = spawn(
  process.execPath,
  [
    path.join(root, "node_modules/next/dist/bin/next"),
    "dev",
    "--webpack",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3007",
  ],
  {
    cwd: path.join(root, "audit-output/browser-e2e/apps/web"),
    stdio: "inherit",
    windowsHide: true,
  },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => child.kill(signal));
child.once("exit", (code) => {
  process.exitCode = code || 0;
});
