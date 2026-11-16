const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Legacy settlement security", function () {
  async function fixture() {
    const [admin, payer, merchant, vault, replacement, outsider] =
      await ethers.getSigners();
    const engine = await (
      await ethers.getContractFactory("SentinelPaySettlementEngine")
    ).deploy(admin.address, vault.address, 1500);
    const proof = ethers.keccak256(ethers.toUtf8Bytes("approved credential"));
    await engine.registerProof(payer.address, proof);
    return {
      admin,
      payer,
      merchant,
      vault,
      replacement,
      outsider,
      engine,
      proof,
    };
  }
  it("rejects the formerly forgeable deterministic identity hash", async function () {
    const { engine, payer, merchant } = await fixture();
    const forged = ethers.solidityPackedKeccak256(
      ["string", "address"],
      ["NEXAID_VERIFIED", payer.address],
    );
    await expect(
      engine
        .connect(payer)
        .processPayment(merchant.address, forged, "PayFi", { value: 10000 }),
    ).to.be.revertedWith("SentinelPay: invalid NexaID proof");
  });
  it("settles an approved payer and distributes exactly the configured amount", async function () {
    const { engine, payer, merchant, vault, proof } = await fixture();
    await expect(
      engine
        .connect(payer)
        .processPayment(merchant.address, proof, "PayFi", { value: 10000 }),
    ).to.changeEtherBalances([merchant, vault], [8500, 1500]);
    expect((await engine.paymentRequests(0)).settled).to.equal(true);
  });
  it("revoked proofs and paused payments are refused", async function () {
    const { engine, payer, merchant, proof } = await fixture();
    await engine.revokeProof(payer.address, proof);
    await expect(
      engine
        .connect(payer)
        .processPayment(merchant.address, proof, "PayFi", { value: 100 }),
    ).to.be.reverted;
    await engine.registerProof(payer.address, proof);
    await engine.pause();
    await expect(
      engine
        .connect(payer)
        .processPayment(merchant.address, proof, "PayFi", { value: 100 }),
    ).to.be.reverted;
  });
  it("requires settlement authority and snapshots the recipient at request creation", async function () {
    const { engine, payer, merchant, vault, replacement, outsider, proof } =
      await fixture();
    await engine
      .connect(payer)
      .requestPayment(merchant.address, 10000, "PayFi", proof);
    await engine.setRwaVault(replacement.address);
    await expect(
      engine
        .connect(outsider)
        .settleWithRWA(0, ethers.ZeroHash, { value: 10000 }),
    ).to.be.reverted;
    await expect(
      engine.settleWithRWA(0, ethers.ZeroHash, { value: 10000 }),
    ).to.changeEtherBalances([merchant, vault, replacement], [8500, 1500, 0]);
    await expect(
      engine.settleWithRWA(0, ethers.ZeroHash, { value: 10000 }),
    ).to.be.revertedWith("SentinelPay: already settled");
  });
  it("blocks a merchant callback from reentering payment settlement even with an approved proof", async function () {
    const { engine, payer, proof } = await fixture();
    const malicious = await (
      await ethers.getContractFactory("ReentrantMerchant")
    ).deploy(await engine.getAddress(), proof);
    await engine.registerProof(await malicious.getAddress(), proof);
    await engine
      .connect(payer)
      .processPayment(await malicious.getAddress(), proof, "PayFi", {
        value: 10000,
      });
    expect(await malicious.attempted()).to.equal(true);
    expect(await malicious.blocked()).to.equal(true);
    expect(await engine.nextRequestId()).to.equal(1);
  });
});
