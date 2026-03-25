# SkillVault

**Decentralized Safety Vetting & Publishing Platform for AI Agent Skills**

> A stake-based arbitration system on Ethereum that vets AI Skills for safety before publishing, using economic incentives and an AI Safety Oracle.

**IS4302 — Ethereum DApp Group Project**

---

## Overview

AI Agent Skills (like those used in Claude Code) are prompt instruction files (`.md`) that, once installed, gain indirect control over a user's filesystem, network, and shell. Currently, there is no trustworthy safety vetting mechanism — anyone can publish Skills containing malicious Prompt Injection, data exfiltration instructions, or permission abuse.

SkillVault solves this with a decentralized, stake-based arbitration system:
- **Submitters** stake 0.01 ETH to publish a Skill
- An **AI Safety Oracle** (Node.js + Claude API) automatically reviews the Skill
- **Community challengers** can stake 100 VAULT tokens to dispute a passing review
- Economic incentives ensure honest behavior from all parties

---

## Architecture

### Smart Contracts

| Contract | Standard | Description |
|---|---|---|
| `VaultToken.sol` | ERC20 (OpenZeppelin) | Governance/staking token (VAULT). Includes a demo faucet (`500 VAULT` per address). |
| `SkillVault.sol` | Custom | Core logic: skill submission, Oracle review, challenge mechanism, fund escrow. |

### Skill Status State Machine

```
[Submitted] ──Oracle Initial Review──► Rejected  (submitter loses ETH)
                                    └► Approved  ──48h window──► Published (submitter gets ETH back)
                                                  │ challenged
                                                  ▼
                                             [Challenged] ──Oracle Re-review──► Revoked   (submitter loses ETH, challenger rewarded)
                                                                              └► Published (challenger loses VAULT, submitter rewarded)
```

### AI Safety Oracle

An off-chain Node.js service that:
1. Listens for `SkillSubmitted` / `SkillChallenged` events
2. Fetches the Skill content from the backend and verifies its `keccak256` hash against the on-chain `contentHash`
3. Calls Claude API 3 times (majority vote 2/3) for safety analysis
4. Writes the result back on-chain via `resolveInitialReview()` or `resolveChallenge()`

**5 safety check categories:** Data Exfiltration, Prompt Injection, Permission Abuse, Social Engineering, Obfuscation

---

## Project Structure

```
SkillVault/
├── contracts/
│   ├── VaultToken.sol       # ERC20 token
│   └── SkillVault.sol       # Core dApp logic
├── oracle/
│   ├── index.js             # Oracle event listener + Claude API integration
│   └── .env.example
├── backend/
│   ├── index.js             # Express server for off-chain Skill content storage
│   └── .env.example
├── test/
│   └── SkillVault.test.js   # Contract tests
└── README.md
```

---

## Setup & Deployment

### Prerequisites

- Node.js >= 18
- [Remix IDE](https://remix.ethereum.org) or Hardhat
- MetaMask wallet with Sepolia ETH ([faucet](https://sepoliafaucet.com))
- Anthropic API key

### 1. Deploy Contracts (Remix)

1. Open `contracts/VaultToken.sol` and `contracts/SkillVault.sol` in Remix
2. Compile with Solidity `0.8.x`
3. Deploy `VaultToken.sol` first — note the deployed address
4. Deploy `SkillVault.sol` with constructor args:
   - `_token`: VaultToken address
   - `_oracle`: your Oracle wallet address
   - `_feeRecipient`: fee recipient address

### 2. Run the Backend (Skill Content Storage)

```bash
cd backend
cp .env.example .env
# Fill in: PORT
npm install
node index.js
```

### 3. Run the Oracle

```bash
cd oracle
cp .env.example .env
# Fill in: RPC_URL, ORACLE_PRIVATE_KEY, CONTRACT_ADDRESS, ANTHROPIC_API_KEY, BACKEND_URL
npm install
node index.js
```

### 4. Interact via Remix

Use Remix's deployed contract UI to call:
- `submitSkill(bytes32 hash, string cid, string name)` — attach 0.01 ETH
- `challenge(uint256 id)` — requires 100 VAULT approved first
- `finalizeSkill(uint256 id)` — after 48h challenge window

---

## Economic Incentives

| Participant | Honest incentive | Penalty for abuse |
|---|---|---|
| Skill submitter | Get 0.01 ETH back after safe review + platform listing | Lose 0.01 ETH if malicious |
| Challenger | Win 0.0095 ETH for catching a malicious Skill | Lose 100 VAULT for incorrect challenge |
| Platform | 5% fee on forfeited stakes | — |
| Oracle | No economic interest; address is `immutable` | Cannot be replaced or bribed |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Smart Contracts | Solidity 0.8.x + OpenZeppelin ERC20 |
| Dev / Demo | Remix IDE + Sepolia testnet |
| AI Safety Oracle | Node.js + ethers.js + Anthropic Claude API (`claude-sonnet-4-6`) |
| Content Storage | Node.js + Express |
| Frontend | Static mockups (Figma / PPT) |

---

## Environment Variables

See `.env.example` files in `oracle/` and `backend/`. **Never commit `.env` files.**

Key variables for the Oracle:
```
RPC_URL=           # Sepolia RPC endpoint (e.g. Alchemy/Infura)
ORACLE_PRIVATE_KEY= # Wallet private key for the Oracle signer
CONTRACT_ADDRESS=  # Deployed SkillVault contract address
ANTHROPIC_API_KEY= # Claude API key
BACKEND_URL=       # URL of the Express backend
```

---

## Course Info

- **Module:** IS4302 Blockchain and Distributed Ledger Technologies
- **Submission deadline:** Week 12, Friday 11pm
- **Presentation:** Week 13 (in-class)
