const hre = require("hardhat");

async function main() {
  const proxyAddress = process.env.SKILL_VAULT_PROXY_ADDRESS;
  if (!proxyAddress) {
    throw new Error("SKILL_VAULT_PROXY_ADDRESS is required");
  }

  const SkillVaultV2 = await hre.ethers.getContractFactory("SkillVaultV2");
  const upgraded = await hre.upgrades.upgradeProxy(proxyAddress, SkillVaultV2, {
    kind: "uups",
  });
  await upgraded.waitForDeployment();

  const implementationAddress = await hre.upgrades.erc1967.getImplementationAddress(
    proxyAddress
  );

  console.log(`SkillVault proxy upgraded at: ${proxyAddress}`);
  console.log(`New implementation: ${implementationAddress}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
