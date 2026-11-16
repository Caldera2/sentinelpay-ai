const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const solc = require(
  require.resolve("solc", { paths: [path.join(root, "contracts")] }),
);
const sources = Object.fromEntries(
  [
    "PaymentVault.sol",
    "SentinelPaySettlementEngine.sol",
    "test/ReentrantMerchant.sol",
  ].map((name) => [
    `contracts/${name}`,
    {
      content: fs.readFileSync(
        path.join(root, "contracts/contracts", name),
        "utf8",
      ),
    },
  ]),
);
const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: {
      "*": { "*": ["abi", "evm.bytecode", "evm.deployedBytecode"] },
    },
  },
};
const output = JSON.parse(
  solc.compile(JSON.stringify(input), {
    import(name) {
      try {
        return {
          contents: fs.readFileSync(
            require.resolve(name, {
              paths: [path.join(root, "contracts"), root],
            }),
            "utf8",
          ),
        };
      } catch {
        return { error: `Import unavailable: ${name}` };
      }
    },
  }),
);
const errors = (output.errors || []).filter(
  (error) => error.severity === "error",
);
if (errors.length) {
  for (const error of errors) console.error(error.formattedMessage);
  process.exit(1);
}
for (const [source, contracts] of Object.entries(output.contracts || {}))
  for (const [name, result] of Object.entries(contracts)) {
    const directory = path.join(root, "contracts/artifacts", source);
    fs.mkdirSync(directory, { recursive: true });
    const artifact = {
      _format: "hh-sol-artifact-1",
      contractName: name,
      sourceName: source,
      abi: result.abi,
      bytecode: "0x" + result.evm.bytecode.object,
      deployedBytecode: "0x" + result.evm.deployedBytecode.object,
      linkReferences: result.evm.bytecode.linkReferences,
      deployedLinkReferences: result.evm.deployedBytecode.linkReferences,
    };
    fs.writeFileSync(
      path.join(directory, `${name}.json`),
      JSON.stringify(artifact, null, 2),
    );
  }
console.log(
  `Legacy contracts compiled using local Solidity ${solc.version()}; no network deployment performed.`,
);
