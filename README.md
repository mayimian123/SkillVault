# SkillVault

**Decentralized Safety Vetting & Publishing Platform for AI Agent Skills**

> A stake-based arbitration system on Ethereum that vets AI Skills for malicious content before publishing, using economic incentives and an AI Safety Oracle.

**IS4302 — Ethereum DApp Group Project**

---

## Overview

AI Agent Skills (`.md` files that extend Claude Code's behaviour) gain indirect access to a user's filesystem, network, and shell. There is currently no trustworthy safety vetting mechanism — anyone can publish Skills containing Prompt Injection, data exfiltration instructions, or permission abuse.

SkillVault solves this with a decentralized, stake-based arbitration system:
- **Submitters** stake 0.01 ETH to publish a Skill
- An **AI Safety Oracle** (Node.js + DeepSeek API, 3-source majority vote) automatically reviews the Skill
- **Community challengers** can stake 100 VAULT tokens to dispute a passing review
- Economic incentives ensure honest behavior from all parties

**Live demo:** https://skill-vault-eta.vercel.app
**Network:** Sepolia testnet

---

## Architecture

### Smart Contracts

| Contract | Standard | Description |
|---|---|---|
| `VaultToken.sol` | ERC20 (OpenZeppelin) | Governance/staking token (VAULT). Includes a one-time faucet (500 VAULT per address). |
| `SkillVault.sol` | Custom | Core logic: skill submission, Oracle review, 48h challenge window, fund escrow and distribution. |

### Deployed Addresses (Sepolia)

| Contract | Address |
|---|---|
| VaultToken | `0xc4B145bA488De9B365c63e12341e4542C585A366` |
| SkillVault | `0xA34D55f3604dE23450a18209903565730202226A` |

### Skill Status State Machine

```
[Submitted] ──Oracle review──► Rejected   (submitter loses ETH stake)
                             └► Approved  ──48h window──► Published (submitter gets ETH back)
                                           │ challenged
                                           ▼
                                      [Challenged] ──Oracle re-review──► Revoked   (submitter slashed, challenger rewarded)
                                                                       └► Published (challenger slashed, submitter rewarded)
```

### AI Safety Oracle

An off-chain Node.js service that:
1. Listens for `SkillSubmitted` / `SkillChallenged` events on-chain
2. Fetches the Skill content from IPFS via the stored CID
3. Calls DeepSeek API with 3 independent sources (V3 × 2 + R1 × 1) in parallel
4. Takes an internal majority vote (2/3) across the 3 sources
5. Writes the result back on-chain via `resolveInitialReview()` or `resolveChallenge()`

**5 safety check categories:** Data Exfiltration (A), Prompt Injection (B), Permission Abuse (C), Social Engineering (D), Obfuscation (E)

---

## Project Structure

```
SkillVault/
├── contracts/
│   ├── contracts/
│   │   ├── VaultToken.sol       # ERC20 staking token with faucet
│   │   └── SkillVault.sol       # Core dApp state machine
│   ├── scripts/
│   │   └── deploy.js            # Hardhat deploy script
│   ├── test/
│   │   └── test.js              # Contract tests
│   └── hardhat.config.js
├── oracle/
│   ├── index.js                 # Oracle: event listener + DeepSeek AI integration
│   └── .env.example
├── frontend/
│   ├── index.html               # Single-file dApp (ethers.js v6 + Pinata IPFS)
│   └── README.md
├── GUIDE.md                     # Step-by-step user testing guide
└── README.md
```

---

## Setup & Deployment

### Prerequisites

- Node.js >= 18
- MetaMask wallet with Sepolia ETH ([Google faucet](https://cloud.google.com/application/web3/faucet/ethereum/sepolia))
- Alchemy RPC key ([alchemy.com](https://alchemy.com))
- DeepSeek API key ([platform.deepseek.com](https://platform.deepseek.com))

### 1. Deploy Contracts

```bash
cd contracts
cp .env.example .env
# Fill in: RPC_URL, PRIVATE_KEY, ORACLE_ADDRESS
npm install
npx hardhat run scripts/deploy.js --network sepolia
```

Constructor parameters set automatically via environment variables:
- `_vault`: deployed VaultToken address (auto-set by script)
- `_oracle`: `ORACLE_ADDRESS` from `.env`
- `_feeRecipient`: deployer wallet (default)

### 2. Run the Oracle

```bash
cd oracle
cp .env.example .env
# Fill in: RPC_URL, ORACLE_PRIVATE_KEY, SKILL_VAULT_ADDRESS, DEEPSEEK_API_KEY
npm install
node index.js
```

### 3. Open the Frontend

Fill in contract addresses in `frontend/index.html` (CONFIG block), then:

```bash
cd frontend
python3 -m http.server 8080
# open http://localhost:8080
```

Or use the live deployment: https://skill-vault-eta.vercel.app

---

## Economic Incentives

| Participant | Incentive for honest behaviour | Penalty for abuse |
|---|---|---|
| Skill submitter | Recovers 0.01 ETH stake after passing review + skill published | Loses 0.01 ETH if skill is malicious |
| Challenger | Wins ~0.0095 ETH for catching a malicious skill | Loses 100 VAULT for a failed challenge |
| Platform | 5% fee on all forfeited stakes | — |
| Oracle | Designated `immutable` address; no economic interest | Cannot be replaced or bribed |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Smart Contracts | Solidity 0.8.24 + OpenZeppelin ERC20 |
| Contract Tooling | Hardhat + Sepolia testnet |
| AI Safety Oracle | Node.js + ethers.js v6 + DeepSeek API (V3 × 2, R1 × 1) |
| Content Storage | IPFS via Pinata |
| Frontend | Vanilla JS + ethers.js v6 (CDN), deployed on Vercel |

---

## Environment Variables

See `.env.example` files in `oracle/` and `contracts/`. **Never commit `.env` files.**

Oracle (`oracle/.env`):
```
RPC_URL=           # Sepolia RPC endpoint (Alchemy/Infura)
ORACLE_PRIVATE_KEY= # Private key of the designated oracle wallet
SKILL_VAULT_ADDRESS= # Deployed SkillVault contract address
DEEPSEEK_API_KEY=   # DeepSeek API key
```

---

## Course Info

- **Module:** IS4302 Blockchain and Distributed Ledger Technologies
- **Submission deadline:** Week 12, Friday 11pm
- **Presentation:** Week 13 (in-class)
