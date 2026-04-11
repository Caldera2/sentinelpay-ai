export const sentinelPayAbi = [
  {
    type: "function",
    name: "processPayment",
    stateMutability: "payable",
    inputs: [
      { name: "merchant", type: "address" },
      { name: "proofHash", type: "bytes32" },
      { name: "track", type: "string" }
    ],
    outputs: [{ name: "requestId", type: "uint256" }]
  },
  {
    type: "function",
    name: "requestPayment",
    stateMutability: "nonpayable",
    inputs: [
      { name: "merchant", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "track", type: "string" },
      { name: "proofHash", type: "bytes32" }
    ],
    outputs: [{ name: "requestId", type: "uint256" }]
  },
  {
    type: "function",
    name: "settleWithRWA",
    stateMutability: "payable",
    inputs: [
      { name: "requestId", type: "uint256" },
      { name: "hspReference", type: "bytes32" }
    ],
    outputs: []
  },
  {
    type: "event",
    name: "PaymentSettled",
    anonymous: false,
    inputs: [
      { indexed: true, name: "merchant", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
      { indexed: false, name: "track", type: "string" }
    ]
  }
] as const;

