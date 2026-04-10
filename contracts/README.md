# SkillVault Contracts

This folder contains the Solidity contracts, deployment script, upgrade script, and Hardhat tests for SkillVault.

## Contracts

- `contracts/VaultToken.sol`
  - ERC20 token used for staking and challenge collateral.
  - Includes a one-time faucet of `500 VAULT` per address.

- `contracts/SkillVault.sol`
  - Core state machine for skill submission, oracle review, challenge, publication, and revocation.
  - Uses OpenZeppelin UUPS upgradeability. Interact with the proxy address, not the implementation address.

- `contracts/mocks/SkillVaultV2.sol`
  - Minimal upgrade target used in tests and example upgrades.

## Setup

```bash
npm install
```

## Compile

```bash
npx hardhat compile
```

## Test

```bash
npx hardhat test
```

## Deploy

```bash
npx hardhat run scripts/deploy.js --network sepolia
```

The deploy script prints:

- `VaultToken` address
- `SkillVault` proxy address
- `SkillVault` implementation address

Use the `SkillVault` proxy address in the frontend and oracle.

## Upgrade

```bash
SKILL_VAULT_PROXY_ADDRESS=<proxy-address> npx hardhat run scripts/upgrade.js --network sepolia
```
