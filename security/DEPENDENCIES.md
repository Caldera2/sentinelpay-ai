# Dependency review

Live scan on 16 November 2026: the full production tree has **zero vulnerabilities**. The full development tree reports **six high-severity affected packages from one upstream advisory**, with zero critical, moderate, or low findings. Full evidence is saved in ignored `audit-output/final-production-audit.json` and `audit-output/dependency-audit.json`.

The active application uses patched Zod 4.6.7. The private integer codec replaces the abandoned native bigint-buffer implementation, rather than hiding its package advisory. Compatible updates and explicit overrides patch the remaining active dependency tree.

One upstream advisory remains in **legacy development tooling**: [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) affects Zod 3.25.76 and is counted again against dependent Hardhat packages. The maintained Hardhat 3.22.0 runtime and its ethers/Mocha plugins still require Zod 3 for their configuration schemas. The published patch is Zod 4.6.6; forcing that major version breaks the toolchain's Zod 3 APIs. This finding is not claimed as fixed.

The affected copies validate local legacy tool configuration and are absent from the API/web production dependency graph. Legacy tests run only trusted repository configuration on an isolated local EVM. Remote legacy deployment remains explicitly disabled unless configured by the operator. Do not pass untrusted configuration or oversized collections into this tooling.

The CI check, `npm run security:audit`, queries the complete dependency tree. It reports the actual npm totals and writes the full advisory JSON under ignored `audit-output/dependency-audit.json`. Its exception matches only this advisory, version 3.25.76, the three specific Hardhat-owned Zod paths, and dependent Hardhat package chains. Application Zod, other advisories, unexpected paths/versions, and unrelated dependencies fail the check. Remove the exception as soon as a compatible upstream fix is available. Raw `npm audit` intentionally continues to report the remaining findings.
