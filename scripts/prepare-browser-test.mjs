import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  destination = path.join(root, "audit-output/browser-e2e");
if (process.env.NODE_ENV === "production")
  throw Error("Automated wallet fixtures cannot be prepared in production.");
const fixture = JSON.parse(
  await fs.readFile(
    path.join(root, "audit-output/browser-fixture.json"),
    "utf8",
  ),
);
if (
  fixture.origin !== "http://127.0.0.1:3007" ||
  fixture.apiUrl !== "http://127.0.0.1:4007"
)
  throw Error("Unexpected browser fixture origin.");
const filter = (filename) =>
  !["node_modules", ".next", "dist"].includes(path.basename(filename)) &&
  !path.basename(filename).startsWith(".env");
await fs.mkdir(destination, { recursive: true });
await fs.copyFile(
  path.join(root, "tsconfig.base.json"),
  path.join(destination, "tsconfig.base.json"),
);
await fs.cp(path.join(root, "apps/web"), path.join(destination, "apps/web"), {
  recursive: true,
  filter,
});
await fs.cp(
  path.join(root, "packages/shared"),
  path.join(destination, "packages/shared"),
  { recursive: true, filter },
);
const providerPath = path.join(
  destination,
  "apps/web/components/providers/SolanaProvider.tsx",
);
let provider = await fs.readFile(providerPath, "utf8");
const adapters = "[new PhantomWalletAdapter(), new SolflareWalletAdapter()]";
if (!provider.includes(adapters))
  throw Error(
    "Wallet provider changed; update the browser fixture explicitly.",
  );
provider = provider.replace(
  '"use client";',
  '"use client";\nimport { TestWalletAdapter } from "./TestWalletAdapter";',
);
provider = provider.replace(
  adapters,
  '[new TestWalletAdapter("Merchant test wallet"), new TestWalletAdapter("Customer test wallet")]',
);
provider = provider.replace(
  "<WalletProvider wallets={wallets} autoConnect>",
  "<WalletProvider wallets={wallets} autoConnect={false}>",
);
provider = provider.replace(
  "<WalletModalProvider>{children}</WalletModalProvider>",
  '<WalletModalProvider><div role="status" className="bg-amber-100 p-3 text-center text-sm text-slate-950">Automated test environment · simulated chain, real PostgreSQL · no real funds</div>{children}</WalletModalProvider>',
);
await fs.writeFile(providerPath, provider);
await fs.copyFile(
  path.join(root, "tests/fixtures/browser-wallet.tsx"),
  path.join(destination, "apps/web/components/providers/TestWalletAdapter.tsx"),
);
await fs.writeFile(
  path.join(destination, "apps/web/.env.local"),
  `API_URL=${fixture.apiUrl}\nAPI_PROXY_SECRET=${fixture.proxySecret}\n`,
);
console.log(
  "Prepared isolated browser fixture. Start Next.js from audit-output/browser-e2e/apps/web on 127.0.0.1:3007.",
);
