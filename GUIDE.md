# SkillVault 使用指南

**前端地址：** https://skill-vault-eta.vercel.app

---

## 第一次使用前的准备（只需做一次）

### 第一步：安装 MetaMask

1. 打开 https://metamask.io/download → 安装浏览器插件
2. 创建钱包，**务必保存好助记词**

### 第二步：切换到 Sepolia 测试网

1. 打开 MetaMask → 点顶部网络名称
2. 找到 **Sepolia** 并切换（如果没有，点「Add network」→ 搜索 Sepolia）

### 第三步：领取测试 ETH

提交 Skill 需要 0.01 ETH 作为押金，免费领取：

- 打开 https://cloud.google.com/application/web3/faucet/ethereum/sepolia
- 粘贴你的钱包地址 → 点 Request → 等几秒

### 第四步：领取 VAULT 代币（用于 Challenge）

打开前端 → 点 **CHALLENGE** tab → 点 **「Get 500 VAULT」** → MetaMask 确认

---

## 功能使用

### 提交 Skill

1. 打开 https://skill-vault-eta.vercel.app
2. 点右上角 **Connect Wallet** 连接 MetaMask
3. 点 **SUBMIT** tab
4. 把你的 Skill 文件拖进去（或点击上传）
5. 填写 Skill 名称
6. 点 **Submit Skill** → MetaMask 确认（花费 0.01 ETH）
7. 等待 AI Oracle 审核（约 1 分钟）→ 状态变为 **Approved** 或 **Rejected**


### Challenge（质疑某个 Skill）

1. 点 **CHALLENGE** tab，可以看到所有处于 48 小时窗口期的 Skill
2. 在输入框里填写你认为该 Skill 有问题的原因（可选，但有助于 Oracle 重新审核）
3. 点击 **Challenge · 100 VAULT** 按钮
4. MetaMask 确认（花费 100 VAULT）
5. AI Oracle 会结合你的理由重新审核，判定质疑是否成立

### 查看所有 Skill

点 **BROWSE** tab → 可按状态筛选（Published / Approved / Rejected 等）

---

## 状态说明

| 状态 | 含义 |
|------|------|
| Submitted | 刚提交，等待 Oracle 审核 |
| Approved | Oracle 审核通过，48 小时质疑窗口期中 |
| Challenged | 有人质疑，Oracle 重新审核中 |
| Published | 最终通过，正式上线 |
| Rejected | 被 Oracle 判定为恶意内容 |
| Revoked | 质疑成立，已撤销 |

---

## 合约地址（Sepolia）

| 合约 | 地址 |
|------|------|
| SkillVault (Proxy)| `0x8175615f8181b3342A090a158c9D736D98f669Ac` |
| SkillVault (Implementation)| `0x53A5CA8DDfcC257D13214B146Ea196AFE0C10eB5` |

Use the `SkillVault` proxy address for the frontend and oracle when the contract is deployed with upgradeability.
| VaultToken | `0x3B9CE1Fcf3765abE7b8160C55DbFD6091D8eeF40` |

在 Sepolia Etherscan 查看：https://sepolia.etherscan.io
