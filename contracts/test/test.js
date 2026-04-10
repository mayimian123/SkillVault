const { expect } = require("chai");
const { ethers, network, upgrades } = require("hardhat");

describe("SkillVault System", function () {
  let vault, skill;
  let owner, user, challenger, feeRecipient;

  let ethStake;
  let challengeStake;
  let challengeWindow;
  let faucetAmount;
  let feeBps;
  let bpsDenominator;

  async function increaseTime(seconds) {
    await network.provider.send("evm_increaseTime", [seconds]);
    await network.provider.send("evm_mine");
  }

  async function setNextTimestamp(ts) {
    await network.provider.send("evm_setNextBlockTimestamp", [Number(ts)]);
  }

  function platformFee(amount) {
    return (amount * feeBps) / bpsDenominator;
  }

  function netAmount(amount) {
    return amount - platformFee(amount);
  }

  beforeEach(async () => {
    [owner, user, challenger, feeRecipient] = await ethers.getSigners();

    const Vault = await ethers.getContractFactory("VaultToken");
    vault = await Vault.deploy();
    await vault.waitForDeployment();

    const Skill = await ethers.getContractFactory("SkillVault");
    skill = await upgrades.deployProxy(
      Skill,
      [await vault.getAddress(), owner.address, feeRecipient.address, owner.address],
      {
        initializer: "initialize",
        kind: "uups",
      }
    );
    await skill.waitForDeployment();

    ethStake = await skill.ETH_STAKE();
    challengeStake = await skill.CHALLENGE_STAKE();
    challengeWindow = await skill.CHALLENGE_WINDOW();
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

  it("rejects submission when ETH stake is below minimum", async () => {
    await expect(
      skill.connect(user).submitSkill("ipfs://cid-low", "Low Stake", {
        value: ethStake - 1n,
      })
    ).to.be.revertedWith("Need more ETH stake");
  });

  it("allows only oracle to resolve initial review", async () => {
    await skill.connect(user).submitSkill("ipfs://safe", "Safe Skill", {
      value: ethStake,
    });

    await expect(
      skill.connect(user).resolveInitialReview(0, true)
    ).to.be.revertedWith("Caller is not the oracle");
  });

  it("prevents resolving initial review twice", async () => {
    await skill.connect(user).submitSkill("ipfs://safe", "Safe Skill", {
      value: ethStake,
    });

    await skill.connect(owner).resolveInitialReview(0, true);
    await expect(
      skill.connect(owner).resolveInitialReview(0, true)
    ).to.be.revertedWith("Invalid state");
  });

  it("marks malicious skill as rejected and transfers ETH stake to fee recipient", async () => {
    await skill.connect(user).submitSkill("ipfs://bad", "Bad Skill", {
      value: ethStake,
    });

    const feeBefore = await ethers.provider.getBalance(feeRecipient.address);
    await skill.connect(owner).resolveInitialReview(0, false);
    const feeAfter = await ethers.provider.getBalance(feeRecipient.address);

    const stored = await skill.skills(0);
    expect(stored.status).to.equal(4); // Rejected
    expect(feeAfter - feeBefore).to.equal(ethStake);
  });

  it("allows challenge exactly at the 48h boundary", async () => {
    await skill.connect(user).submitSkill("ipfs://safe", "Safe Skill", {
      value: ethStake,
    });
    await skill.connect(owner).resolveInitialReview(0, true);

    await vault.connect(challenger).approve(await skill.getAddress(), challengeStake);
    const reviewedAt = (await skill.skills(0)).reviewedAt;
    await setNextTimestamp(reviewedAt + challengeWindow);
    await expect(
      skill.connect(challenger).challenge(0, "boundary challenge")
    ).to.not.be.reverted;

    const stored = await skill.skills(0);
    expect(stored.status).to.equal(2); // Challenged
    expect(stored.challenger).to.equal(challenger.address);
  });

  it("rejects challenge after the 48h window", async () => {
    await skill.connect(user).submitSkill("ipfs://safe", "Safe Skill", {
      value: ethStake,
    });
    await skill.connect(owner).resolveInitialReview(0, true);

    await increaseTime(48 * 60 * 60 + 1);
    await vault.connect(challenger).approve(await skill.getAddress(), challengeStake);
    await expect(
      skill.connect(challenger).challenge(0, "late challenge")
    ).to.be.revertedWith("Challenge window closed");
  });

  it("rejects finalize exactly at the 48h boundary and allows it after", async () => {
    await skill.connect(user).submitSkill("ipfs://safe", "Safe Skill", {
      value: ethStake,
    });

    await skill.connect(owner).resolveInitialReview(0, true);

    const reviewedAt = (await skill.skills(0)).reviewedAt;
    await setNextTimestamp(reviewedAt + challengeWindow);
    await expect(skill.connect(user).finalizeSkill(0)).to.be.revertedWith(
      "Challenge window still open"
    );

    await setNextTimestamp(reviewedAt + challengeWindow + 1n);
    await expect(skill.connect(user).finalizeSkill(0)).to.not.be.reverted;

    const stored = await skill.skills(0);
    expect(stored.status).to.equal(3); // Published
  });

  it("rejects challenge when allowance is missing or insufficient", async () => {
    await skill.connect(user).submitSkill("ipfs://safe", "Safe Skill", {
      value: ethStake,
    });
    await skill.connect(owner).resolveInitialReview(0, true);

    await expect(
      skill.connect(challenger).challenge(0, "no allowance")
    ).to.be.reverted;

    await vault
      .connect(challenger)
      .approve(await skill.getAddress(), challengeStake - 1n);
    await expect(
      skill.connect(challenger).challenge(0, "insufficient allowance")
    ).to.be.reverted;
  });

  it("rejects repeat challenge attempts", async () => {
    await skill.connect(user).submitSkill("ipfs://safe", "Safe Skill", {
      value: ethStake,
    });
    await skill.connect(owner).resolveInitialReview(0, true);

    await vault.connect(challenger).approve(await skill.getAddress(), challengeStake);
    await skill.connect(challenger).challenge(0, "first challenge");

    await expect(
      skill.connect(challenger).challenge(0, "second challenge")
    ).to.be.revertedWith("Not challengeable");
  });

  it("retrieves the challenge reason from the SkillChallenged event log", async () => {
    await skill.connect(user).submitSkill("ipfs://safe", "Safe Skill", {
      value: ethStake,
    });
    await skill.connect(owner).resolveInitialReview(0, true);

    const reason = "contains suspicious hidden payload";
    await vault.connect(challenger).approve(await skill.getAddress(), challengeStake);
    const tx = await skill.connect(challenger).challenge(0, reason);
    const receipt = await tx.wait();

    const stored = await skill.skills(0);
    expect(stored.challenger).to.equal(challenger.address);
    expect(stored.reason).to.equal(undefined);

    const challengeEvent = receipt.logs
      .map((log) => {
        try {
          return skill.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((parsed) => parsed && parsed.name === "SkillChallenged");

    expect(challengeEvent.args.id).to.equal(0n);
    expect(challengeEvent.args.challenger).to.equal(challenger.address);
    expect(challengeEvent.args.reason).to.equal(reason);
  });

  it("resolveChallenge only works in challenged state", async () => {
    await skill.connect(user).submitSkill("ipfs://safe", "Safe Skill", {
      value: ethStake,
    });

    await expect(
      skill.connect(owner).resolveChallenge(0, true)
    ).to.be.revertedWith("Not challenged");
  });

  it("only oracle can resolve challenge", async () => {
    await skill.connect(user).submitSkill("ipfs://safe", "Safe Skill", {
      value: ethStake,
    });
    await skill.connect(owner).resolveInitialReview(0, true);
    await vault.connect(challenger).approve(await skill.getAddress(), challengeStake);
    await skill.connect(challenger).challenge(0, "security concern");

    await expect(
      skill.connect(user).resolveChallenge(0, true)
    ).to.be.revertedWith("Caller is not the oracle");
  });

  it("resolves malicious challenge by revoking and rewarding challenger", async () => {
    await skill.connect(user).submitSkill("ipfs://challenge", "Challenge Skill", {
      value: ethStake,
    });

    await skill.connect(owner).resolveInitialReview(0, true);

    await vault.connect(challenger).approve(await skill.getAddress(), challengeStake);
    await skill.connect(challenger).challenge(0, "contains hidden exfil");

    await skill.connect(owner).resolveChallenge(0, true);

    const stored = await skill.skills(0);
    const challengerBalance = await vault.balanceOf(challenger.address);
    const feeBalance = await ethers.provider.getBalance(feeRecipient.address);

    expect(stored.status).to.equal(5); // Revoked
    expect(challengerBalance).to.equal(faucetAmount);
    expect(feeBalance).to.be.greaterThan(0n);
  });

  it("resolves failed challenge by publishing and slashing challenger", async () => {
    await skill.connect(user).submitSkill("ipfs://challenge", "Challenge Skill", {
      value: ethStake,
    });
    await skill.connect(owner).resolveInitialReview(0, true);
    await vault.connect(challenger).approve(await skill.getAddress(), challengeStake);
    await skill.connect(challenger).challenge(0, "false positive");
    await skill.connect(owner).resolveChallenge(0, false);

    const stored = await skill.skills(0);
    const submitterBalance = await vault.balanceOf(user.address);
    const challengerBalance = await vault.balanceOf(challenger.address);
    const feeBalance = await vault.balanceOf(feeRecipient.address);

    expect(stored.status).to.equal(3); // Published
    expect(submitterBalance).to.equal(faucetAmount + netAmount(challengeStake));
    expect(challengerBalance).to.equal(faucetAmount - challengeStake);
    expect(feeBalance).to.equal(platformFee(challengeStake));
  });

  it("preserves state after upgrading the proxy implementation", async () => {
    await skill.connect(user).submitSkill("ipfs://cid-upgrade", "Upgradeable Skill", {
      value: ethStake,
    });

    const proxyAddress = await skill.getAddress();
    const SkillV2 = await ethers.getContractFactory("SkillVaultV2");
    const upgraded = await upgrades.upgradeProxy(proxyAddress, SkillV2, {
      kind: "uups",
    });

    const stored = await upgraded.skills(0);
    expect(stored.submitter).to.equal(user.address);
    expect(stored.cid).to.equal("ipfs://cid-upgrade");
    expect(await upgraded.version()).to.equal("v2");
  });
});
