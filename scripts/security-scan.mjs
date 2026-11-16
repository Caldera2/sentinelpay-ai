import { execFileSync } from "node:child_process";
import fs from "node:fs";
const inventoryFile =
  process.argv[2] === "--inventory-file" ? process.argv[3] : undefined;
const files = (
  inventoryFile
    ? fs.readFileSync(inventoryFile, "utf8").split(/\r?\n/)
    : execFileSync(
        "git",
        ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        { encoding: "utf8" },
      ).split("\0")
).filter(Boolean);
const issues = [];
for (const file of new Set(files)) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
  if (/(?:^|\/)[^/]*\.env(?:\.|$)/.test(file) && !file.endsWith(".env.example"))
    issues.push(`${file}: environment export must not be tracked`);
  if (/(?:-keypair\.json|\.pem|\.key)$/.test(file))
    issues.push(`${file}: signing material must not be tracked`);
  if (
    fs.statSync(file).size > 1_000_000 ||
    /package-lock\.json|Cargo\.lock/.test(file)
  )
    continue;
  const content = fs.readFileSync(file, "utf8");
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content))
    issues.push(`${file}: private key detected`);
  if (
    /eyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/.test(
      content,
    )
  )
    issues.push(`${file}: embedded bearer credential detected`);
  if (
    /NEXT_PUBLIC_[A-Z_]*(?:SECRET|PRIVATE_KEY|DATABASE_URL|OIDC_TOKEN)/.test(
      content,
    )
  )
    issues.push(`${file}: private configuration uses a public prefix`);
}
if (issues.length) {
  console.error(issues.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    "Source secret scan passed. Historical commits require a separate rotation and history review.",
  );
