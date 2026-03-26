const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  const oracleAddress = process.env.ORACLE_ADDRESS || deployer.address;
  const feeRecipientAddress = process.env.FEE_RECIPIENT_ADDRESS || deployer.address;

  console.log(`Deploying with account: ${deployer.address}`);
  console.log(`Oracle address: ${oracleAddress}`);
  console.log(`Fee recipient: ${feeRecipientAddress}`);

  const VaultToken = await hre.ethers.getContractFactory("VaultToken");
  const vaultToken = await VaultToken.deploy();
  await vaultToken.waitForDeployment();

  const vaultTokenAddress = await vaultToken.getAddress();
  console.log(`VaultToken deployed to: ${vaultTokenAddress}`);

  const SkillVault = await hre.ethers.getContractFactory("SkillVault");
  const skillVault = await SkillVault.deploy(
    vaultTokenAddress,
    oracleAddress,
    feeRecipientAddress
  );
  await skillVault.waitForDeployment();

  const skillVaultAddress = await skillVault.getAddress();
  console.log(`SkillVault deployed to: ${skillVaultAddress}`);

  console.log("Deployment complete.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
