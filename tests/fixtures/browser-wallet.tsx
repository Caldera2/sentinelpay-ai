// Copied only into the ignored browser-test application. Never imported by production code.
import {
  BaseMessageSignerWalletAdapter,
  WalletReadyState,
  type WalletName,
} from "@solana/wallet-adapter-base";
import { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { Buffer } from "buffer";

export class TestWalletAdapter extends BaseMessageSignerWalletAdapter {
  name: WalletName;
  url = "http://127.0.0.1:3007";
  icon =
    "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCI+PHJlY3Qgd2lkdGg9IjI0IiBoZWlnaHQ9IjI0IiBmaWxsPSIjMjJkM2VlIi8+PC9zdmc+" as const;
  supportedTransactionVersions = new Set<"legacy" | 0>(["legacy", 0]);
  private pair: CryptoKeyPair | null = null;
  private address: PublicKey | null = null;
  private busy = false;
  constructor(name: string) {
    super();
    this.name = name as WalletName;
  }
  get publicKey() {
    return this.address;
  }
  get connecting() {
    return this.busy;
  }
  get readyState() {
    return WalletReadyState.Installed;
  }
  async connect() {
    if (this.address || this.busy) return;
    this.busy = true;
    try {
      const storageKey = "sentinelpay.automated-test-key." + this.name,
        stored = sessionStorage.getItem(storageKey);
      if (stored) {
        const jwks = JSON.parse(stored);
        this.pair = {
          publicKey: await crypto.subtle.importKey(
            "jwk",
            jwks.publicKey,
            { name: "Ed25519" },
            true,
            ["verify"],
          ),
          privateKey: await crypto.subtle.importKey(
            "jwk",
            jwks.privateKey,
            { name: "Ed25519" },
            true,
            ["sign"],
          ),
        };
      } else {
        this.pair = (await crypto.subtle.generateKey(
          { name: "Ed25519" },
          true,
          ["sign", "verify"],
        )) as CryptoKeyPair;
        sessionStorage.setItem(
          storageKey,
          JSON.stringify({
            publicKey: await crypto.subtle.exportKey(
              "jwk",
              this.pair.publicKey,
            ),
            privateKey: await crypto.subtle.exportKey(
              "jwk",
              this.pair.privateKey,
            ),
          }),
        );
      }
      this.address = new PublicKey(
        new Uint8Array(
          await crypto.subtle.exportKey("raw", this.pair.publicKey),
        ),
      );
      this.emit("connect", this.address);
    } finally {
      this.busy = false;
    }
  }
  async disconnect() {
    this.address = null;
    this.pair = null;
    this.emit("disconnect");
  }
  async signMessage(message: Uint8Array) {
    if (!this.pair) throw new Error("Connect the automated wallet first.");
    return new Uint8Array(
      await crypto.subtle.sign(
        "Ed25519",
        this.pair.privateKey,
        new Uint8Array(message),
      ),
    );
  }
  async signTransaction<T extends Transaction | VersionedTransaction>(
    transaction: T,
  ): Promise<T> {
    if (!this.address) throw new Error("Connect the automated wallet first.");
    const message =
      transaction instanceof VersionedTransaction
        ? transaction.message.serialize()
        : transaction.serializeMessage();
    transaction.addSignature(
      this.address,
      Buffer.from(await this.signMessage(message)),
    );
    return transaction;
  }
}
