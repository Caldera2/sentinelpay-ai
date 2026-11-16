import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
const npm =
  process.env.npm_execpath ||
  path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
const shared = spawnSync(
  process.execPath,
  [npm, "run", "build", "--workspace", "@sentinelpay/shared"],
  { stdio: "inherit" },
);
if (shared.status !== 0) process.exit(shared.status || 1);
const children = ["dev:api", "dev:web"].map((task) =>
  spawn(process.execPath, [npm, "run", task], {
    stdio: "inherit",
    windowsHide: true,
  }),
);
let shuttingDown = false;
function stop() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill();
}
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
for (const child of children)
  child.on("exit", (code) => {
    if (!shuttingDown) {
      stop();
      process.exitCode = code || 0;
    }
  });
