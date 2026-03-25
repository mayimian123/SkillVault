const { expect } = require("chai");
const { ethers, network } = require("hardhat");

describe("SkillVault System", function () {
  let vault, skill;
  let owner, user, challenger, feeRecipient;

  let ethStake;
  let challengeStake;
  let faucetAmount;
  let feeBps;
  let bpsDenominator;

  async function increaseTime(seconds) {
    await network.provider.send("evm_increaseTime", [seconds]);
    await network.provider.send("evm_mine");
  }

  function randomBool() {
    return Math.random() < 0.5;
  }

  function platformFee(amount) {
    return (amount * feeBps) / bpsDenominator;
  }

  function netAmount(amount) {
    return amount - platformFee(amount);
  }

  async function mockInitialReview(id) {
    const safe = randomBool();
    await skill.connect(owner).resolveInitialReview(id, safe);
    return safe;
  }

  async function mockChallengeReview(id) {
    const malicious = randomBool();
    await skill.connect(owner).resolveChallenge(id, malicious);
    return malicious;
  }

  beforeEach(async () => {
    [owner, user, challenger, feeRecipient] = await ethers.getSigners();

    const Vault = await ethers.getContractFactory("VaultToken");
    vault = await Vault.deploy();
    await vault.waitForDeployment();

    const Skill = await ethers.getContractFactory("SkillVault");
    skill = await Skill.deploy(
      await vault.getAddress(),
      owner.address,
      feeRecipient.address
    );
    await skill.waitForDeployment();

    ethStake = await skill.ETH_STAKE();
    challengeStake = await skill.CHALLENGE_STAKE();
    faucetAmount = await vault.FAUCET_AMOUNT();
    feeBps = await skill.FEE_BPS();
    bpsDenominator = await skill.BPS_DENOMINATOR();

    await vault.connect(user).claimFaucet();
    await vault.connect(challenger).claimFaucet();
  });

  it("stores skill metadata on submission", async () => {
    await skill.connect(user).submitSkill("ipfs://cid-1", "Safe Skill", {
      value: ethStake,
    });

    const stored = await skill.skills(0);

    expect(stored.submitter).to.equal(user.address);
    expect(stored.cid).to.equal("ipfs://cid-1");
    expect(stored.name).to.equal("Safe Skill");
    expect(stored.status).to.equal(0);
    expect(stored.ethStake).to.equal(ethStake);
  });

  it("handles a random initial oracle review outcome", async () => {
    await skill.connect(user).submitSkill("ipfs://bad", "Bad Skill", {
      value: ethStake,
    });

    const safe = await mockInitialReview(0);

    const stored = await skill.skills(0);
    expect(stored.status).to.equal(safe ? 1 : 4);
  });

  it("publishes a safe skill after the challenge window", async () => {
    await skill.connect(user).submitSkill("ipfs://safe", "Safe Skill", {
      value: ethStake,
    });

    await skill.connect(owner).resolveInitialReview(0, true);

    const contractBefore = await ethers.provider.getBalance(await skill.getAddress());
    expect(contractBefore).to.equal(ethStake);

    await increaseTime(48 * 60 * 60 + 1);

    await skill.connect(user).finalizeSkill(0);

    const stored = await skill.skills(0);
    const contractAfter = await ethers.provider.getBalance(await skill.getAddress());

    expect(stored.status).to.equal(3); // Published
    expect(contractAfter).to.equal(0n);
  });

  it("resolves a challenge with a random oracle outcome", async () => {
    await skill.connect(user).submitSkill("ipfs://challenge", "Challenge Skill", {
      value: ethStake,
    });

    await skill.connect(owner).resolveInitialReview(0, true);

    await vault.connect(challenger).approve(await skill.getAddress(), challengeStake);
    await skill.connect(challenger).challenge(0);

    const malicious = await mockChallengeReview(0);

    const stored = await skill.skills(0);
    if (malicious) {
      const challengerBalance = await vault.balanceOf(challenger.address);
      expect(stored.status).to.equal(5); // Revoked
      expect(challengerBalance).to.equal(faucetAmount);
      return;
    }

    const submitterBalance = await vault.balanceOf(user.address);
    const challengerBalance = await vault.balanceOf(challenger.address);
    const feeBalance = await vault.balanceOf(feeRecipient.address);

    expect(stored.status).to.equal(3); // Published
    expect(submitterBalance).to.equal(faucetAmount + netAmount(challengeStake));
    expect(challengerBalance).to.equal(faucetAmount - challengeStake);
    expect(feeBalance).to.equal(platformFee(challengeStake));
  });
});
