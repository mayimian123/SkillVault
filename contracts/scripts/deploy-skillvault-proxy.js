const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  const vaultTokenAddress = process.env.EXISTING_VAULT_TOKEN_ADDRESS;
  if (!vaultTokenAddress) {
    throw new Error("EXISTING_VAULT_TOKEN_ADDRESS is required");
  }

  const code = await hre.ethers.provider.getCode(vaultTokenAddress);
  if (code === "0x") {
    throw new Error(`No contract found at EXISTING_VAULT_TOKEN_ADDRESS: ${vaultTokenAddress}`);
  }

  const oracleAddress = process.env.ORACLE_ADDRESS || deployer.address;
  const feeRecipientAddress = process.env.FEE_RECIPIENT_ADDRESS || deployer.address;

  console.log(`Deploying with account: ${deployer.address}`);
  console.log(`Using existing VaultToken: ${vaultTokenAddress}`);
  console.log(`Oracle address: ${oracleAddress}`);
  console.log(`Fee recipient: ${feeRecipientAddress}`);

  const SkillVault = await hre.ethers.getContractFactory("SkillVault");
  const skillVault = await hre.upgrades.deployProxy(
    SkillVault,
    [vaultTokenAddress, oracleAddress, feeRecipientAddress, deployer.address],
    {
      initializer: "initialize",
      kind: "uups",
    }
  );
  await skillVault.waitForDeployment();

  const skillVaultProxyAddress = await skillVault.getAddress();
  const implementationAddress = await hre.upgrades.erc1967.getImplementationAddress(
    skillVaultProxyAddress
  );

  console.log(`SkillVault proxy deployed to: ${skillVaultProxyAddress}`);
  console.log(`SkillVault implementation deployed to: ${implementationAddress}`);
  console.log("Deployment complete.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
