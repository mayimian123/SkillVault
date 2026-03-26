# SkillVault Contracts

This folder contains the Solidity contracts, deployment script, and Hardhat tests for SkillVault.

## Contracts

- `contracts/VaultToken.sol`
  - ERC20 token used for staking and challenge collateral.
  - Includes a one-time faucet of `500 VAULT` per address.

- `contracts/SkillVault.sol`
  - Core state machine for skill submission, oracle review, challenge, publication, and revocation.
  - Requires an oracle address and a fee recipient address at deployment time.

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

## Deploy(TODO)
