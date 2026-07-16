# SkillVault

[English](#english) · [中文](#中文)

<a id="english"></a>

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
| `SkillVault.sol` | UUPS (OpenZeppelin) | Core logic: skill submission, Oracle review, 48h challenge window, fund escrow and distribution. |

### Deployed Addresses (Sepolia)

| Contract | Address |
|---|---|
| VaultToken | `0x3B9CE1Fcf3765abE7b8160C55DbFD6091D8eeF40` |
| SkillVault (Proxy)| `0x8175615f8181b3342A090a158c9D736D98f669Ac` |
| SkillVault (Implementation)| `0x53A5CA8DDfcC257D13214B146Ea196AFE0C10eB5` |

### Skill Status State Machine

```
[Submitted] ──Oracle review──► Rejected   (submitter loses ETH stake)
                             └► Approved  ──48h window──► Published (submitter gets ETH back)
                                           │ challenge(id, reason)
                                           ▼
                                      [Challenged] ──Oracle re-review (with reason)──► Revoked   (submitter slashed, challenger rewarded)
                                                                                     └► Published (challenger slashed, submitter rewarded)
```

### AI Safety Oracle

An off-chain Node.js service that:
1. Listens for `SkillSubmitted` / `SkillChallenged` events on-chain
2. Fetches the Skill content from IPFS via the stored CID
3. Calls DeepSeek API with 3 independent sources (V3 × 2 + R1 × 1) in parallel
4. On re-review (challenge), injects the **challenger's reason** into each AI prompt as additional context
5. Takes an internal majority vote (2/3) across the 3 sources
6. Writes the result back on-chain via `resolveInitialReview()` or `resolveChallenge()`


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
├── frontend/                    # dApp (ethers.js v6 + Pinata IPFS)
│   ├── index.html
│   ├── app.js
│   ├── style.css
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

Fill in contract addresses in `frontend/app.js` (CONFIG block), then:

```bash
cd frontend
python3 -m http.server 8080
# open http://localhost:8080
```

Or use the live deployment: 
http://52.221.246.166:5000/


---

## Economic Incentives

| Participant | Incentive for honest behaviour | Penalty for abuse |
|---|---|---|
| Skill submitter | Recovers 0.01 ETH stake after passing review + skill published | Loses 0.01 ETH if skill is malicious |
| Challenger | Wins ~0.0095 ETH for catching a malicious skill | Loses 100 VAULT for a failed challenge |
| Platform | 5% fee on all forfeited stakes | — |
| Oracle | Designated address; no economic interest | Cannot be bribed |

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
SKILL_VAULT_ADDRESS= # Deployed SkillVault proxy address
DEEPSEEK_API_KEY=   # DeepSeek API key
```

---

## Course Info

- **Module:** IS4302 Blockchain and Distributed Ledger Technologies
- **Submission deadline:** Week 12, Friday 11pm
- **Presentation:** Week 13 (in-class)

---

<a id="中文"></a>

## 中文

**面向 AI 智能体 Skill 的去中心化安全审核与发布平台**

> 一个部署在 Ethereum 上、基于质押的仲裁系统：在 AI Skill 发布前检查其中的恶意内容，并通过经济激励和 AI Safety Oracle 保障审核质量。

**IS4302 — Ethereum DApp 小组项目**

---

## 概览

AI Agent Skill（扩展 Claude Code 行为的 `.md` 文件）能够间接访问用户的文件系统、网络和 shell。目前并不存在可信的安全审核机制——任何人都可以发布包含 Prompt Injection、数据外泄指令或权限滥用行为的 Skill。

SkillVault 通过去中心化、基于质押的仲裁系统解决这一问题：
- **提交者**质押 0.01 ETH 以发布 Skill
- **AI Safety Oracle**（Node.js + DeepSeek API，3 个来源多数表决）自动审核 Skill
- **社区挑战者**可以质押 100 枚 VAULT token，对通过的审核提出异议
- 经济激励促使所有参与者保持诚实

**在线演示：** https://skill-vault-eta.vercel.app
**网络：** Sepolia testnet

---

## 架构

### 智能合约

| 合约 | 标准 | 说明 |
|---|---|---|
| `VaultToken.sol` | ERC20 (OpenZeppelin) | 治理/质押 token（VAULT），包含每个地址限用一次的水龙头，可领取 500 VAULT。 |
| `SkillVault.sol` | UUPS (OpenZeppelin) | 核心逻辑：Skill 提交、Oracle 审核、48 小时挑战窗口、资金托管与分配。 |

### 已部署地址（Sepolia）

| 合约 | 地址 |
|---|---|
| VaultToken | `0x3B9CE1Fcf3765abE7b8160C55DbFD6091D8eeF40` |
| SkillVault (Proxy)| `0x8175615f8181b3342A090a158c9D736D98f669Ac` |
| SkillVault (Implementation)| `0x53A5CA8DDfcC257D13214B146Ea196AFE0C10eB5` |

### Skill 状态机

```
[Submitted] ──Oracle review──► Rejected   (submitter loses ETH stake)
                             └► Approved  ──48h window──► Published (submitter gets ETH back)
                                           │ challenge(id, reason)
                                           ▼
                                      [Challenged] ──Oracle re-review (with reason)──► Revoked   (submitter slashed, challenger rewarded)
                                                                                     └► Published (challenger slashed, submitter rewarded)
```

### AI Safety Oracle

一个链下 Node.js 服务，负责：
1. 监听链上的 `SkillSubmitted` / `SkillChallenged` 事件
2. 使用已存储的 CID 从 IPFS 获取 Skill 内容
3. 并行调用 DeepSeek API 的 3 个独立来源（V3 × 2 + R1 × 1）
4. 重新审核挑战时，将**挑战理由**注入每个 AI 提示词作为额外上下文
5. 对 3 个来源进行内部多数表决（2/3）
6. 通过 `resolveInitialReview()` 或 `resolveChallenge()` 将结果写回链上

**5 类安全检查：** 数据外泄（A）、Prompt Injection（B）、权限滥用（C）、社会工程（D）、混淆（E）

---

## 项目结构

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
├── frontend/                    # dApp (ethers.js v6 + Pinata IPFS)
│   ├── index.html
│   ├── app.js
│   ├── style.css
│   └── README.md
├── GUIDE.md                     # Step-by-step user testing guide
└── README.md
```

---

## 设置与部署

### 前置要求

- Node.js >= 18
- 拥有 Sepolia ETH 的 MetaMask 钱包（[Google faucet](https://cloud.google.com/application/web3/faucet/ethereum/sepolia)）
- Alchemy RPC key（[alchemy.com](https://alchemy.com)）
- DeepSeek API key（[platform.deepseek.com](https://platform.deepseek.com)）

### 1. 部署合约

```bash
cd contracts
cp .env.example .env
# Fill in: RPC_URL, PRIVATE_KEY, ORACLE_ADDRESS
npm install
npx hardhat run scripts/deploy.js --network sepolia
```

构造函数参数通过环境变量自动设置：
- `_vault`：已部署的 VaultToken 地址（由脚本自动设置）
- `_oracle`：来自 `.env` 的 `ORACLE_ADDRESS`
- `_feeRecipient`：部署者钱包（默认）

### 2. 运行 Oracle

```bash
cd oracle
cp .env.example .env
# Fill in: RPC_URL, ORACLE_PRIVATE_KEY, SKILL_VAULT_ADDRESS, DEEPSEEK_API_KEY
npm install
node index.js
```

### 3. 打开前端

在 `frontend/app.js` 的 CONFIG 区块中填写合约地址，然后运行：

```bash
cd frontend
python3 -m http.server 8080
# open http://localhost:8080
```

或使用在线部署：
http://52.221.246.166:5000/

---

## 经济激励

| 参与者 | 诚实行为的激励 | 滥用行为的惩罚 |
|---|---|---|
| Skill 提交者 | 通过审核后收回 0.01 ETH 质押，Skill 同时发布 | 如果 Skill 含有恶意内容，则损失 0.01 ETH |
| 挑战者 | 发现恶意 Skill 可赢得约 0.0095 ETH | 挑战失败会损失 100 VAULT |
| 平台 | 从所有被罚没的质押中收取 5% 费用 | — |
| Oracle | 指定地址；不享有经济利益 | 无法被收买 |

---

## 技术栈

| 层级 | 技术 |
|---|---|
| 智能合约 | Solidity 0.8.24 + OpenZeppelin ERC20 |
| 合约工具 | Hardhat + Sepolia testnet |
| AI Safety Oracle | Node.js + ethers.js v6 + DeepSeek API (V3 × 2, R1 × 1) |
| 内容存储 | 通过 Pinata 使用 IPFS |
| 前端 | Vanilla JS + ethers.js v6 (CDN)，部署于 Vercel |

---

## 环境变量

请参阅 `oracle/` 和 `contracts/` 中的 `.env.example` 文件。**绝不要提交 `.env` 文件。**

Oracle（`oracle/.env`）：
```
RPC_URL=           # Sepolia RPC endpoint (Alchemy/Infura)
ORACLE_PRIVATE_KEY= # Private key of the designated oracle wallet
SKILL_VAULT_ADDRESS= # Deployed SkillVault proxy address
DEEPSEEK_API_KEY=   # DeepSeek API key
```

---

## 课程信息

- **课程：** IS4302 Blockchain and Distributed Ledger Technologies
- **提交截止时间：** 第 12 周，星期五晚上 11 点
- **展示：** 第 13 周（课堂内）
