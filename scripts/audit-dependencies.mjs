import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = process.env.npm_execpath;
if (!cli) throw Error("Run this check with npm run security:audit.");
const result = spawnSync(process.execPath, [cli, "audit", "--json"], {
  cwd: root,
  encoding: "utf8",
  windowsHide: true,
  maxBuffer: 10_000_000,
});
let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  throw Error("npm did not return a valid advisory report.");
}
if (
  result.error ||
  report.error ||
  !report.metadata ||
  ![0, 1].includes(result.status)
)
  throw Error("The live dependency advisory check did not complete.");
await fs.mkdir(path.join(root, "audit-output"), { recursive: true });
await fs.writeFile(
  path.join(root, "audit-output/dependency-audit.json"),
  JSON.stringify(report, null, 2) + "\n",
);
const lock = JSON.parse(
  await fs.readFile(path.join(root, "package-lock.json"), "utf8"),
);
const legacyPackages = new Set([
  "hardhat",
  "@nomicfoundation/hardhat-ethers",
  "@nomicfoundation/hardhat-mocha",
  "@nomicfoundation/hardhat-ethers-chai-matchers",
  "@nomicfoundation/hardhat-zod-utils",
]);
const advisory = "https://github.com/advisories/GHSA-mrhx-c7xc-m3w5";
const legacyZodPaths = new Set([
  "node_modules/hardhat/node_modules/zod",
  "node_modules/@nomicfoundation/hardhat-ethers/node_modules/zod",
  "node_modules/@nomicfoundation/hardhat-mocha/node_modules/zod",
]);
const blocked = [];
let reviewed = 0;
const zodFinding = report.vulnerabilities?.zod;
const legacyZod =
  zodFinding &&
  zodFinding.nodes.length > 0 &&
  zodFinding.nodes.every(
    (node) =>
      legacyZodPaths.has(node) &&
      lock.packages[node]?.version === "3.25.76" &&
      lock.packages[node]?.dev === true,
  ) &&
  zodFinding.via.length > 0 &&
  zodFinding.via.every(
    (item) => typeof item === "object" && item.url === advisory,
  );
for (const [name, finding] of Object.entries(report.vulnerabilities || {})) {
  const legacyDependent =
    legacyZod &&
    legacyPackages.has(name) &&
    finding.nodes.length > 0 &&
    finding.nodes.every(
      (node) =>
        (node === `node_modules/${name}` ||
          node.endsWith(`/node_modules/${name}`)) &&
        lock.packages[node]?.dev === true,
    ) &&
    finding.via.length > 0 &&
    finding.via.every(
      (item) =>
        typeof item === "string" &&
        (item === "zod" || legacyPackages.has(item)),
    );
  if ((name === "zod" && legacyZod) || legacyDependent) reviewed++;
  else blocked.push(`${name}: ${finding.severity}`);
}
console.log("Full npm audit:", JSON.stringify(report.metadata.vulnerabilities));
if (reviewed)
  console.warn(
    `Reviewed legacy exception: ${advisory} (${reviewed} affected packages). See security/DEPENDENCIES.md. These findings are not reported as fixed.`,
  );
if (blocked.length) {
  console.error("Unreviewed dependency findings:", blocked.join(", "));
  process.exitCode = 1;
}
