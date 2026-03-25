# SkillVault Frontend

A single-file dApp frontend — no build step, no Node.js needed.
Just open `index.html` in a browser with MetaMask installed.

---

## Setup (2 steps before it works)

### Step 1 — Fill in the contract addresses

Open `index.html` and find the `CONFIG` block near the top of the `<script>` section:

```javascript
const CONFIG = {
  SKILL_VAULT_ADDRESS: "YOUR_SKILL_VAULT_ADDRESS",   // ← paste here
  VAULT_TOKEN_ADDRESS: "YOUR_VAULT_TOKEN_ADDRESS",   // ← paste here
  PINATA_JWT:          "YOUR_PINATA_JWT",             // ← paste here
  ...
};
```

Replace `YOUR_SKILL_VAULT_ADDRESS` and `YOUR_VAULT_TOKEN_ADDRESS` with the deployed contract addresses on Sepolia.

### Step 2 — Get a Pinata API key (for IPFS upload)

1. Go to [https://app.pinata.cloud](https://app.pinata.cloud) and sign up (free)
2. Navigate to **API Keys** → **New Key**
3. Enable **pinFileToIPFS** permission
4. Copy the **JWT** token
5. Paste it into `CONFIG.PINATA_JWT` in `index.html`

---

## How to open

Just double-click `index.html` — or serve it locally to avoid CORS issues:

```bash
# Option 1: Python (if installed)
cd frontend
python3 -m http.server 8080
# then open http://localhost:8080

# Option 2: VS Code Live Server extension
# Right-click index.html → "Open with Live Server"
```

> **Tip:** Opening directly as `file://` usually works for MetaMask interaction, but a local server is safer.

---

## Features

| Tab | What it does |
|-----|-------------|
| **Browse** | Shows all skills on-chain with status badges. Filter by status. Click an address to copy it. |
| **Submit** | Drag & drop a `.md` file → auto-computes keccak256 hash → uploads to IPFS → calls `submitSkill()` with 0.01 ETH stake |
| **Challenge** | Shows all skills in their 48h challenge window. One click to stake 100 VAULT and challenge. |

**Other interactions:**
- Connect MetaMask (auto-detects Sepolia, prompts to switch if wrong network)
- Live ETH + VAULT balance display
- "Get 500 VAULT" faucet button (calls `faucet()` on VaultToken)
- "Finalize" button appears on approved skills once the 48h window expires
- Click any wallet address to copy it

---

## Interface for the Oracle developer

The Oracle reads the `SkillSubmitted` and `SkillChallenged` events from the contract.
The `skillCID` field in each event is the IPFS CID — fetch the skill content via:

```
GET https://ipfs.io/ipfs/{CID}
```

Then compute `keccak256(content)` and compare with `skills[id].contentHash` on-chain to verify integrity.

---

## Network

Sepolia testnet (Chain ID: 11155111).
Get Sepolia ETH from [https://sepoliafaucet.com](https://sepoliafaucet.com).
