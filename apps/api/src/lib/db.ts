import fs from "node:fs/promises";
import path from "node:path";

export type UserRecord = {
  walletAddress: string;
  hasNexaId: boolean;
  holdsRwa: boolean;
  loyaltyPoints: number;
  lastProofHash?: string;
  updatedAt: string;
};

export type TransactionRecord = {
  walletAddress: string;
  merchant: string;
  amount: string;
  track: string;
  txHash: string;
  status: "pending" | "success" | "failed";
  createdAt: string;
};

const dataDir = path.resolve(process.cwd(), "data");
const usersFile = path.join(dataDir, "users.json");
const transactionsFile = path.join(dataDir, "transactions.json");

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonFile<T>(filePath: string, value: T) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2));
}

export async function getUsers() {
  return readJsonFile<UserRecord[]>(usersFile, []);
}

export async function getUserByWallet(walletAddress: string) {
  const normalized = walletAddress.toLowerCase();
  const users = await getUsers();
  return users.find((user) => user.walletAddress.toLowerCase() === normalized);
}

export async function upsertUser(walletAddress: string, patch: Partial<UserRecord>) {
  const users = await getUsers();
  const index = users.findIndex((user) => user.walletAddress.toLowerCase() === walletAddress.toLowerCase());

  const baseRecord: UserRecord = users[index] ?? {
    walletAddress,
    hasNexaId: false,
    holdsRwa: false,
    loyaltyPoints: 0,
    updatedAt: new Date().toISOString()
  };

  const nextRecord: UserRecord = {
    ...baseRecord,
    ...patch,
    walletAddress,
    updatedAt: new Date().toISOString()
  };

  if (index === -1) {
    users.push(nextRecord);
  } else {
    users[index] = nextRecord;
  }

  await writeJsonFile(usersFile, users);
  return nextRecord;
}

export async function getTransactions() {
  return readJsonFile<TransactionRecord[]>(transactionsFile, []);
}

export async function recordTransaction(transaction: TransactionRecord) {
  const transactions = await getTransactions();
  transactions.unshift(transaction);
  await writeJsonFile(transactionsFile, transactions.slice(0, 50));
  return transaction;
}
