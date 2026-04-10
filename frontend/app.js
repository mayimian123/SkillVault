// CONFIGURATION
const CONFIG = {
  SKILL_VAULT_ADDRESS: "0x8175615f8181b3342A090a158c9D736D98f669Ac",
  VAULT_TOKEN_ADDRESS: "0x3B9CE1Fcf3765abE7b8160C55DbFD6091D8eeF40",
  PINATA_JWT:          "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySW5mb3JtYXRpb24iOnsiaWQiOiJkYzNkM2UxMi1iOTdhLTQxMGYtYmZjZi1hMGFlMDQwM2JmMjQiLCJlbWFpbCI6IjIyOTAyMzM3MDBAcXEuY29tIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsInBpbl9wb2xpY3kiOnsicmVnaW9ucyI6W3siZGVzaXJlZFJlcGxpY2F0aW9uQ291bnQiOjEsImlkIjoiRlJBMSJ9LHsiZGVzaXJlZFJlcGxpY2F0aW9uQ291bnQiOjEsImlkIjoiTllDMSJ9XSwidmVyc2lvbiI6MX0sIm1mYV9lbmFibGVkIjpmYWxzZSwic3RhdHVzIjoiQUNUSVZFIn0sImF1dGhlbnRpY2F0aW9uVHlwZSI6InNjb3BlZEtleSIsInNjb3BlZEtleUtleSI6Ijg3YmJjYzdmZWE4ZWY3NGJmNzFiIiwic2NvcGVkS2V5U2VjcmV0IjoiNGMyNTVmZjQyYjdhYzcyZjAzNjJiNjlkZTFhMjBmMTI1ODI4YzA2NmY5ZjdlM2FkZGMxN2U5YzA3MjU3ODNhNiIsImV4cCI6MTgwNTk2NTQzMH0.D0fzt2TearSUip1bcgxAxyEGGTa20N9sKSatZaB7Mz0",            // https://app.pinata.cloud/keys
  CHAIN_ID:            11155111,
  CHAIN_HEX:           "0xaa36a7",
};

// ABIs
const VAULT_ABI = [
  "function submitSkill(string cid, string name) payable",
  "function challenge(uint256 skillId, string reason)",
  "function finalizeSkill(uint256 skillId)",
  "function skills(uint256) view returns (address submitter, string cid, string name, uint8 status, uint256 ethStake, uint256 submittedAt, uint256 reviewedAt, uint256 challengedAt, address challenger)",
  "function skillCount() view returns (uint256)",
  "event SkillSubmitted(uint256 indexed id, address indexed submitter, string cid, string name)",
  "event SkillReviewed(uint256 indexed id, bool safe)",
  "event SkillChallenged(uint256 indexed id, address indexed challenger, string reason)",
  "event SkillPublished(uint256 indexed id)",
  "event SkillRejected(uint256 indexed id)",
  "event SkillRevoked(uint256 indexed id)",
];

const TOKEN_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function claimFaucet()",
];

// Status enum: 0=Submitted, 1=Approved, 2=Challenged, 3=Published, 4=Rejected, 5=Revoked
const STATUS_LABELS = ["Submitted","Approved","Challenged","Published","Rejected","Revoked"];
const STATUS_BADGE  = ["b-submit","b-pending","b-challenged","b-safe","b-danger","b-danger"];

// STATE
let provider, signer, account, vaultContract, tokenContract;
let allSkills = [];
let selectedFile = null;
let activeFilter = "all";
let searchQuery = "";
let submitMode = "upload";
let walletListenersBound = false;
let skillEventMeta = new Map();
let challengeReasonDrafts = new Map();
let challengeReasonCache = new Map();
let activeChallengeView = "open";
let activeDetailSkillId = null;
let boundVaultContract = null;
let vaultEventHandlers = null;
let refreshTimers = new Map();
let detailTrackingTimer = null;

function getBrowseRefreshButton() {
  return document.querySelector("#tab-browse .section-header .btn.btn-ghost");
}

function updateBrowseRefreshButton() {
  const btn = getBrowseRefreshButton();
  if (!btn) return;
  btn.textContent = activeDetailSkillId !== null ? "Refresh Skill" : "Refresh";
  btn.onclick = refreshBrowseView;
}

async function refreshBrowseView() {
  await loadAllSkills();
}

function shouldAutoTrackSkill(skill) {
  return [0, 1, 2].includes(Number(skill?.status));
}

function isDetailViewOpen() {
  const detail = document.getElementById("browseDetailView");
  return !!detail && detail.style.display !== "none";
}

function stopDetailTracking() {
  if (detailTrackingTimer) {
    clearTimeout(detailTrackingTimer);
    detailTrackingTimer = null;
  }
}

function startDetailTracking(skill) {
  stopDetailTracking();
  if (!skill || !shouldAutoTrackSkill(skill)) return;
  const intervalMs = getDetailTrackingInterval(skill);
  if (!intervalMs) return;

  detailTrackingTimer = setTimeout(async () => {
    if (activeDetailSkillId !== skill.id || !isDetailViewOpen()) {
      stopDetailTracking();
      return;
    }
    await refreshSkillById(skill.id, "detail-poll");
  }, intervalMs);
}

function getDetailTrackingInterval(skill) {
  if (!skill || !shouldAutoTrackSkill(skill)) return 0;
  if (skill.status === 0 || skill.status === 2) return 2500;
  if (skill.status === 1 && skill.reviewedAt) return 60000;
  return 0;
}

async function legacyConnectWallet() {

  if (!window.ethereum) {
    toast("MetaMask not found. Please install it.", "error"); return;
  }
  try {
    provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);

    const net = await provider.getNetwork();
    if (Number(net.chainId) !== CONFIG.CHAIN_ID) {
      toast("Switching to Sepolia...", "info");
      try {
        await window.ethereum.request({ method:"wallet_switchEthereumChain", params:[{chainId:CONFIG.CHAIN_HEX}] });
        provider = new ethers.BrowserProvider(window.ethereum);
      } catch(e) { toast("Please switch to Sepolia manually.", "error"); return; }
    }

    signer  = await provider.getSigner();
    account = await signer.getAddress();

    if (CONFIG.SKILL_VAULT_ADDRESS !== "YOUR_SKILL_VAULT_ADDRESS") {
      vaultContract = new ethers.Contract(CONFIG.SKILL_VAULT_ADDRESS, VAULT_ABI, signer);
      tokenContract = new ethers.Contract(CONFIG.VAULT_TOKEN_ADDRESS, TOKEN_ABI, signer);
    }

    updateWalletUI();
    updateBalances();
    bindVaultEventListeners();
    loadAllSkills();

    window.ethereum.on("accountsChanged", (accs) => {
      if (!accs.length) { disconnectWallet(); return; }
      account = accs[0]; updateWalletUI(); updateBalances();
    });

    toast("Connected: " + fmt(account), "success");
  } catch(e) {
    console.error(e);
    toast("Connect failed: " + (e.message || e), "error");
  }
}

async function initWalletConnection(requestAccess = false) {
  if (!window.ethereum) {
    toast("MetaMask not found. Please install it.", "error");
    return false;
  }
  try {
    provider = new ethers.BrowserProvider(window.ethereum);
    const method = requestAccess ? "eth_requestAccounts" : "eth_accounts";
    const accounts = await provider.send(method, []);
    if (!accounts.length) {
      disconnectWallet();
      return false;
    }

    const net = await provider.getNetwork();
    if (Number(net.chainId) !== CONFIG.CHAIN_ID) {
      if (!requestAccess) {
        disconnectWallet();
        return false;
      }
      toast("Switching to Sepolia...", "info");
      try {
        await window.ethereum.request({ method:"wallet_switchEthereumChain", params:[{chainId:CONFIG.CHAIN_HEX}] });
        provider = new ethers.BrowserProvider(window.ethereum);
      } catch (e) {
        toast("Please switch to Sepolia manually.", "error");
        return false;
      }
    }

    signer = await provider.getSigner();
    account = await signer.getAddress();

    if (CONFIG.SKILL_VAULT_ADDRESS !== "YOUR_SKILL_VAULT_ADDRESS") {
      vaultContract = new ethers.Contract(CONFIG.SKILL_VAULT_ADDRESS, VAULT_ABI, signer);
      tokenContract = new ethers.Contract(CONFIG.VAULT_TOKEN_ADDRESS, TOKEN_ABI, signer);
    }

    updateWalletUI();
    updateBalances();
    bindVaultEventListeners();
    loadAllSkills();

    if (!walletListenersBound) {
      window.ethereum.on("accountsChanged", (accs) => {
        if (!accs.length) {
          disconnectWallet();
          return;
        }
        initWalletConnection(false);
      });

      window.ethereum.on("chainChanged", () => {
        initWalletConnection(false);
      });

      walletListenersBound = true;
    }

    if (requestAccess) toast("Connected: " + fmt(account), "success");
    return true;
  } catch (e) {
    console.error(e);
    if (requestAccess) toast("Connect failed: " + (e.message || e), "error");
    return false;
  }
}

async function connectWallet() {
  return initWalletConnection(true);
}

function disconnectWallet() {
  if (boundVaultContract && vaultEventHandlers) {
    for (const [eventName, handler] of Object.entries(vaultEventHandlers)) {
      boundVaultContract.off(eventName, handler);
    }
  }
  boundVaultContract = null;
  vaultEventHandlers = null;
  provider = signer = account = vaultContract = tokenContract = null;
  allSkills = [];
  updateWalletUI();
}

function updateWalletUI() {
  const on = !!account;
  document.getElementById("wDot").className   = "w-dot" + (on ? " on" : "");
  document.getElementById("netDot").className = "net-dot" + (on ? " on" : "");
  document.getElementById("wLabel").textContent  = on ? fmt(account) : "Connect Wallet";
  document.getElementById("netName").textContent = on ? "Sepolia" : "Not connected";
  document.getElementById("balanceBar").style.display = on ? "flex" : "none";
}

async function updateBalances() {
  if (!account || !provider) return;
  try {
    const e = await provider.getBalance(account);
    document.getElementById("ethBal").textContent = parseFloat(ethers.formatEther(e)).toFixed(4);
  } catch(_) {}
  try {
    if (tokenContract) {
      const v = await tokenContract.balanceOf(account);
      document.getElementById("vaultBal").textContent = parseFloat(ethers.formatUnits(v,18)).toFixed(0);
    }
  } catch(_) {}
}

// LOAD SKILLS
async function loadAllSkills() {
  if (!vaultContract) {
    noWalletBrowse(); noWalletChallenge(); return;
  }
  showSkeleton();
  try {
    skillEventMeta = await loadSkillEventMeta();
    const cnt = Number(await vaultContract.skillCount());
    allSkills = [];
    for (let i = 0; i < cnt; i++) {
      try {
        const s = await vaultContract.skills(i);
        const eventMeta = skillEventMeta.get(i) || { timeline: [], challengeReason: "", challengeReasonRef: "" };
        allSkills.push({
          id:           i,
          submitter:    s[0],
          skillCID:     s[1],
          skillName:    s[2] || `Skill #${i}`,
          status:       Number(s[3]),
          ethStaked:    s[4],
          submittedAt:  Number(s[5]),
          reviewedAt:   Number(s[6]),
          challengedAt: Number(s[7]),
          challenger:   s[8],
          challengeReason: eventMeta.challengeReason || "",
          challengeReasonRef: eventMeta.challengeReasonRef || "",
          timeline: eventMeta.timeline || [],
        });
      } catch(e) { console.warn("skill "+i, e); }
    }
    renderBrowse(allSkills);
    renderChallenge(allSkills);
    updateBrowseRefreshButton();
    if (activeDetailSkillId !== null) openSkillDetail(activeDetailSkillId);
  } catch(e) {
    console.error(e);
    toast("Load failed: " + (e.reason || e.message), "error");
    document.getElementById("browseContent").innerHTML =
      `<div class="empty"><div class="empty-icon">!</div><p>Failed to load. Check console.</p></div>`;
  }
}

function bindVaultEventListeners() {
  if (!vaultContract) return;
  if (boundVaultContract === vaultContract) return;

  if (boundVaultContract && vaultEventHandlers) {
    for (const [eventName, handler] of Object.entries(vaultEventHandlers)) {
      boundVaultContract.off(eventName, handler);
    }
  }

  vaultEventHandlers = {
    SkillSubmitted: (id) => scheduleSkillRefresh(Number(id), "submitted"),
    SkillReviewed: (id) => scheduleSkillRefresh(Number(id), "reviewed"),
    SkillChallenged: (id) => scheduleSkillRefresh(Number(id), "challenged"),
    SkillPublished: (id) => scheduleSkillRefresh(Number(id), "published"),
    SkillRejected: (id) => scheduleSkillRefresh(Number(id), "rejected"),
    SkillRevoked: (id) => scheduleSkillRefresh(Number(id), "revoked"),
  };

  for (const [eventName, handler] of Object.entries(vaultEventHandlers)) {
    vaultContract.on(eventName, handler);
  }
  boundVaultContract = vaultContract;
}

function scheduleSkillRefresh(id, source = "event") {
  if (!Number.isFinite(id)) return;
  if (activeDetailSkillId !== id || !isDetailViewOpen()) return;
  if (refreshTimers.has(id)) clearTimeout(refreshTimers.get(id));

  const timer = setTimeout(async () => {
    refreshTimers.delete(id);
    await refreshSkillById(id, source);
  }, 450);

  refreshTimers.set(id, timer);
}

async function refreshSkillById(id, source = "event") {
  if (!vaultContract) return;

  try {
    const s = await vaultContract.skills(id);
    const eventMeta = await loadSkillEventMetaForId(id);
    const nextSkill = {
      id,
      submitter: s[0],
      skillCID: s[1],
      skillName: s[2] || `Skill #${id}`,
      status: Number(s[3]),
      ethStaked: s[4],
      submittedAt: Number(s[5]),
      reviewedAt: Number(s[6]),
      challengedAt: Number(s[7]),
      challenger: s[8],
      challengeReason: eventMeta.challengeReason || "",
      challengeReasonRef: eventMeta.challengeReasonRef || "",
      timeline: eventMeta.timeline || [],
      updatedAt: Date.now(),
      updateSource: source,
    };

    const idx = allSkills.findIndex(skill => skill.id === id);
    if (idx >= 0) allSkills[idx] = nextSkill;
    else allSkills.unshift(nextSkill);

    renderBrowse(allSkills);
    renderChallenge(allSkills);
    updateBrowseRefreshButton();

    if (activeDetailSkillId === id) {
      openSkillDetail(id);
      startDetailTracking(nextSkill);
      pulseDetailView();
    }

    if (!shouldAutoTrackSkill(nextSkill)) stopDetailTracking();

    animateUpdatedSkill(id);
  } catch (e) {
    console.warn(`Failed to refresh skill #${id}`, e);
  }
}

function submittedTimelineDetail(submitter) {
  return `Skill code submitted by ${fmt(submitter)}`;
}

async function loadSkillEventMetaForId(id) {
  if (!vaultContract) return { challengeReason: "", challengeReasonRef: "", timeline: [] };
  try {
    const [submittedLogs, reviewedLogs, challengedLogs, publishedLogs, rejectedLogs, revokedLogs] = await Promise.all([
      vaultContract.queryFilter(vaultContract.filters.SkillSubmitted(id)),
      vaultContract.queryFilter(vaultContract.filters.SkillReviewed(id)),
      vaultContract.queryFilter(vaultContract.filters.SkillChallenged(id)),
      vaultContract.queryFilter(vaultContract.filters.SkillPublished(id)),
      vaultContract.queryFilter(vaultContract.filters.SkillRejected(id)),
      vaultContract.queryFilter(vaultContract.filters.SkillRevoked(id)),
    ]);

    const timeline = [];
    let challengeReason = "";
    let challengeReasonRef = "";

    for (const log of submittedLogs) {
      timeline.push({ key: `submitted-${log.transactionHash}`, order: log.blockNumber, type: "Submitted", detail: submittedTimelineDetail(log.args.submitter) });
    }
    for (const log of reviewedLogs) {
      const safe = !!log.args.safe;
      timeline.push({
        key: `reviewed-${log.transactionHash}`,
        order: log.blockNumber,
        type: safe ? "Approved" : "Reviewed",
        detail: safe
          ? "Oracle reviewed and approved this skill"
          : "Oracle reviewed and rejected this skill"
      });
    }
    for (const log of challengedLogs) {
      const reasonRef = (log.args.reason || "").trim();
      const reason = await resolveChallengeReason(reasonRef);
      challengeReason = reason;
      challengeReasonRef = reasonRef;
      timeline.push({
        key: `challenged-${log.transactionHash}`,
        order: log.blockNumber,
        type: "Challenged",
        detail: `Oracle reviewed result challenged by ${fmt(log.args.challenger)}`,
        reason,
        reasonRef,
      });
    }
    for (const log of publishedLogs) {
      timeline.push({ key: `published-${log.transactionHash}`, order: log.blockNumber, type: "Published", detail: "Skill code is reviewed as benign and published after challenge" });
    }
    for (const log of rejectedLogs) {
      timeline.push({ key: `rejected-${log.transactionHash}`, order: log.blockNumber, type: "Rejected", detail: "Skill code is reviewed as malicious and rejected" });
    }
    for (const log of revokedLogs) {
      timeline.push({ key: `revoked-${log.transactionHash}`, order: log.blockNumber, type: "Revoked", detail: "Skill code is reviewed as malicious and revoked after challenge" });
    }

    timeline.sort((a, b) => a.order - b.order);
    return { challengeReason, challengeReasonRef, timeline };
  } catch (_) {
    return { challengeReason: "", challengeReasonRef: "", timeline: [] };
  }
}

function animateUpdatedSkill(id) {
  requestAnimationFrame(() => {
    document.querySelectorAll(`[data-skill-id="${id}"]`).forEach((el) => {
      el.classList.remove("live-update");
      void el.offsetWidth;
      el.classList.add("live-update");
      setTimeout(() => el.classList.remove("live-update"), 1800);
    });
  });
}

function pulseDetailView() {
  const detail = document.getElementById("browseDetailView");
  if (!detail || detail.style.display === "none") return;
  detail.classList.remove("detail-live-update");
  void detail.offsetWidth;
  detail.classList.add("detail-live-update");
  setTimeout(() => detail.classList.remove("detail-live-update"), 1800);
}

// RENDER BROWSE
function renderBrowse(skills) {
  const el = document.getElementById("browseContent");
  const ct = document.getElementById("browseCount");
  const filtered = filterSkills(skills, activeFilter);
  const visible = searchSkills(filtered, searchQuery);
  const isDetailOpen = activeDetailSkillId !== null;
  ct.textContent = `${visible.length} skill${visible.length!==1?"s":""} shown | ${skills.length} total`;
  if (isDetailOpen) ct.textContent = `Viewing skill #${activeDetailSkillId}`;
  if (!visible.length) {
    el.innerHTML = `<div class="empty"><div class="empty-icon">0</div><p>No skills match your current filter or search.</p></div>`;
    return;
  }
  el.innerHTML = `<div class="skills-grid">${visible.map(skillCard).join("")}</div>`;
}

function skillCard(s) {
  const lbl  = STATUS_LABELS[s.status] || "Unknown";
  const bcls = STATUS_BADGE[s.status]  || "b-submit";
  const date = new Date(s.submittedAt*1000).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});
  const cid  = s.skillCID || "";
  const ipfs = getSkillIpfsUrl(s);
  let leftAction = "";
  const detailButton = `<button type="button" class="btn btn-ghost" style="font-size:11px" onclick="openSkillDetail(${s.id})">Details</button>`;
  if (s.status === 1) {
    const now = Math.floor(Date.now()/1000);
    const end = s.reviewedAt + 48*3600;
    leftAction = (
      now >= end
        ? `<button class="btn btn-ghost" style="font-size:11px" onclick="finalizeSkill(${s.id})">Finalize</button>`
        : `<span style="font-size:11px;color:var(--c-pending)">⏳ ${countdown(end-now)} left</span>`
    );
  }
  const actions = `
    <div class="card-actions">
      <div class="card-actions-left">${leftAction}</div>
      <div class="card-actions-right">${detailButton}</div>
    </div>
  `;

  return `
  <div class="skill-card ${shouldAutoTrackSkill(s) ? "skill-card-live" : ""}" data-status="${s.status}" data-skill-id="${s.id}">
    <div class="card-top">
      <div class="badge ${bcls}"><div class="bdot"></div>${lbl}</div>
      <button type="button" class="skill-id-btn" title="Click to copy skill ID" onclick='copy(String(${s.id}), "Copied", event)'>Skill ID: ${s.id}</button>
    </div>
    <div class="skill-name cp" title="Click to copy skill name" onclick='copy(${JSON.stringify(s.skillName || "")}, "Copied", event)'>${esc(s.skillName)}</div>
    <div class="skill-meta">
      <div class="meta-row">
        <span class="ml">Submitter</span>
        <span class="mv cp" title="${s.submitter}" onclick='copy(${JSON.stringify(s.submitter)}, "Copied", event)'>${fmt(s.submitter)}</span>
      </div>
      <div class="meta-row">
        <span class="ml">Submitted</span>
        <span class="mv">${date}</span>
      </div>
      ${cid ? `<div class="meta-row">
        <span class="ml">IPFS CID</span>
        <span class="mv cp" title="Click to copy CID" onclick='copy(${JSON.stringify(cid)}, "Copied", event)'>${cid.slice(0,18)}...</span>
      </div>` : ""}
      ${s.challenger && s.challenger !== ethers.ZeroAddress ? `<div class="meta-row">
        <span class="ml">Challenger</span>
        <span class="mv cp" title="${s.challenger}" onclick='copy(${JSON.stringify(s.challenger)}, "Copied", event)'>${fmt(s.challenger)}</span>
      </div>` : ""}
    </div>
    ${actions}
  </div>`;
}

// RENDER CHALLENGE
function renderChallenge(skills) {
  const el  = document.getElementById("challengeContent");
  const now = Math.floor(Date.now()/1000);
  const ch  = skills.filter(s => s.status===1 && now < s.reviewedAt+48*3600);
  const mine = account
    ? skills.filter(s => (s.challenger || "").toLowerCase() === account.toLowerCase())
    : [];
  const tabs = [
    { id: "open", label: "Open Challenge Window", meta: `${ch.length} available` },
    { id: "mine", label: "My Challenges", meta: `${mine.length} tracked` },
    { id: "claim", label: "Claim VAULT", meta: "" },
  ];
  if (!tabs.some(tab => tab.id === activeChallengeView)) activeChallengeView = "open";

  let panelTitle = "My Challenges";
  let panelSub = `${mine.length} tracked`;
  let panelBody = "";

  if (activeChallengeView === "mine") {
    panelBody = mine.length
      ? `<div class="challenge-list">${mine.map(s => challengeCard(s, now, true)).join("")}</div>`
      : `<div class="empty challenge-panel-empty"><div class="empty-icon">!</div><p>You have not challenged any skills yet.<br>Once you submit a challenge, it will appear here.</p></div>`;
  } else if (activeChallengeView === "open") {
    panelTitle = "Open Challenge Window";
    panelSub = `${ch.length} available`;
    panelBody = ch.length
      ? `<div class="challenge-list">${ch.map(s => challengeCard(s, now, false)).join("")}</div>`
      : `<div class="empty challenge-panel-empty"><div class="empty-icon">!</div><p>No skills are in their challenge window right now.<br>They will show up here after oracle approval.</p></div>`;
  } else {
    panelTitle = "Claim VAULT";
    panelSub = "Demo faucet";
    panelBody = renderChallengeFaucetPanel();
  }

  const panelContent = activeChallengeView === "claim"
    ? `<div class="challenge-panel-body challenge-panel-body-plain">${panelBody}</div>`
    : `<div class="challenge-panel-shell">
        <div class="challenge-panel-header">
          <div>
            <div class="challenge-panel-title">${panelTitle}</div>
            <div class="challenge-panel-sub">${panelSub}</div>
          </div>
        </div>
        <div class="challenge-panel-body">
          ${panelBody}
        </div>
      </div>`;

  el.innerHTML = `
    <div class="challenge-layout">
      <aside class="challenge-side-nav">
        <div class="challenge-side-tabs">
          ${tabs.map(tab => `
            <button
              type="button"
              class="challenge-side-tab ${activeChallengeView === tab.id ? "active" : ""}"
              onclick="setChallengeViewTab('${tab.id}')"
            >
              <span class="challenge-side-tab-label">${tab.label}</span>
              <span class="challenge-side-tab-meta">${tab.meta}</span>
            </button>
          `).join("")}
        </div>
      </aside>
      ${panelContent}
    </div>
  `;
}

function renderChallengeFaucetPanel() {
  return `
    <div class="challenge-faucet-card">
      <div class="challenge-faucet-copy">
        <div class="challenge-faucet-kicker">Community Support</div>
        <div class="challenge-faucet-title">Claim 500 VAULT for challenges</div>
        <div class="challenge-faucet-text">Use the faucet to fund challenge collateral before disputing suspicious skills.</div>
      </div>
      <div class="challenge-faucet-actions">
        <button class="btn btn-ghost" onclick="claimFaucet()" style="font-size:11px">Get 500 VAULT</button>
      </div>
    </div>
  `;
}

function challengeCard(s, now, isMine) {
  const end = s.reviewedAt + 48 * 3600;
  const left = countdown(end - now);
  const ipfs = getSkillIpfsUrl(s);
  const statusMeta = getDisplayStatusMeta(s);
  const result = getChallengeResult(s, isMine);
  const draftReason = challengeReasonDrafts.get(s.id) || "";

  return `
    <div class="challenge-card" data-skill-id="${s.id}">
      <div class="challenge-main">
        <div class="challenge-info">
        <div class="challenge-head">
          <div class="ch-name cp" style="margin-bottom:0" title="Click to copy skill name" onclick='copy(${JSON.stringify(s.skillName || "")}, "Copied", event)'>${esc(s.skillName)}</div>
          ${result ? `<div class="challenge-result ${result.className}">${result.label}</div>` : ""}
        </div>
        <div class="ch-meta">
          <span class="cp" title="Click to copy skill ID" onclick='copy(String(${s.id}), "Copied", event)'>Skill ID: ${s.id}</span>
          <span class="cp" title="${s.submitter}" onclick='copy(${JSON.stringify(s.submitter)}, "Copied", event)'>Submitter: ${fmt(s.submitter)}</span>
          ${s.skillCID ? `<span class="cp" title="Click to copy CID" onclick='copy(${JSON.stringify(s.skillCID)}, "Copied", event)'>IPFS CID: ${s.skillCID.slice(0,14)}...</span>` : ""}
        </div>
        </div>
        ${!isMine && s.status === 1 ? `<div class="challenge-message-wrap"><textarea id="reason-${s.id}" class="challenge-reason-input" placeholder="Why do you think this skill is malicious? (optional)" oninput="setChallengeReasonDraft(${s.id}, this.value)">${esc(draftReason)}</textarea></div>` : ""}
        ${s.challengeReason ? `<div class="challenge-reason"><span>Challenge Reason</span>${esc(s.challengeReason)}</div>` : ""}
      </div>
      <div class="ch-actions">
        ${s.status === 1
          ? `<div class="countdown">
              <div class="cd-time">${left}</div>
              <div>remaining</div>
            </div>`
          : `<div class="challenge-latest-status ${statusMeta.className}">Latest status: ${statusMeta.label}</div>`
        }
        <div class="challenge-action-stack">
          <div class="challenge-action-row">
            ${isMine
              ? `<button type="button" class="btn btn-ghost" style="font-size:11px" onclick="openChallengeSkillDetail(${s.id})">Details</button>`
              : s.skillCID ? `<a href="${ipfs}" target="_blank" class="btn btn-ghost" style="font-size:11px">View</a>` : ""}
            ${isMine ? "" : `<button class="btn btn-danger" style="font-size:11px" onclick="challengeSkill(${s.id})">
              Challenge | 100 VAULT
            </button>`}
          </div>
        </div>
      </div>
    </div>
  `;
}

function setChallengeViewTab(tab) {
  activeChallengeView = tab;
  renderChallenge(allSkills);
}

window.setChallengeViewTab = setChallengeViewTab;

function openChallengeSkillDetail(id) {
  const browseTab = document.querySelector(".nav-tab");
  switchTab("browse", browseTab);
  openSkillDetail(id);
}

window.openChallengeSkillDetail = openChallengeSkillDetail;

// FILTER
function filterSkills(skills, f) {
  if (f === "all") return skills;
  const nums = f.split(",").map(Number);
  return skills.filter(s => nums.includes(s.status));
}

function searchSkills(skills, query) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return skills;
  return skills.filter(s => {
    const id = String(s.id || "");
    const name = (s.skillName || "").toLowerCase();
    const cid = (s.skillCID || "").toLowerCase();
    return id.includes(q) || name.includes(q) || cid.includes(q);
  });
}

function applyFilter(f, btn) {
  activeFilter = f;
  document.querySelectorAll("#tab-browse .chip").forEach(c => c.classList.remove("active"));
  btn.classList.add("active");
  renderBrowse(allSkills);
}

function applySearch(value) {
  searchQuery = value.trim();
  renderBrowse(allSkills);
}

function clearSearch() {
  searchQuery = "";
  const input = document.getElementById("skillSearch");
  if (input) input.value = "";
  renderBrowse(allSkills);
}

function setSubmitMode(mode) {
  submitMode = mode;

  const uploadBtn = document.getElementById("submitModeUploadBtn");
  const ipfsBtn = document.getElementById("submitModeIpfsBtn");
  const uploadGroup = document.getElementById("uploadGroup");
  const ipfsGroup = document.getElementById("ipfsGroup");
  const hashGroup = document.getElementById("hashGroup");

  uploadBtn.classList.toggle("active", mode === "upload");
  ipfsBtn.classList.toggle("active", mode === "ipfs");
  uploadGroup.style.display = mode === "upload" ? "block" : "none";
  ipfsGroup.style.display = mode === "ipfs" ? "block" : "none";
  hashGroup.style.display = mode === "upload" && selectedFile ? "block" : "none";

  if (mode === "ipfs") {
    document.getElementById("fileInput").value = "";
    document.getElementById("filePrev").className = "file-prev";
    selectedFile = null;
  }
}

// FILE SELECT
function handleFileSelect(e) {
  const f = e.target.files[0];
  if (f) setFile(f);
}
function setFile(f) {
  setSubmitMode("upload");
  selectedFile = f;
  document.getElementById("filePrev").className = "file-prev vis";
  document.getElementById("prevName").textContent = f.name;
  document.getElementById("prevSize").textContent = fmtBytes(f.size);
  // Auto-fill name
  if (!document.getElementById("skillName").value)
    document.getElementById("skillName").value = f.name.replace(/\.md$/i,"").replace(/[-_]/g," ");
  // Hash preview
  f.text().then(txt => {
    const h = ethers.keccak256(ethers.toUtf8Bytes(txt));
    document.getElementById("hashVal").value = h;
    document.getElementById("hashGroup").style.display = "block";
  });
}
// Drag & drop
const dz = document.getElementById("dropzone");
dz.addEventListener("dragover", e => { e.preventDefault(); dz.classList.add("over"); });
dz.addEventListener("dragleave", () => dz.classList.remove("over"));
dz.addEventListener("drop", e => {
  e.preventDefault(); dz.classList.remove("over");
  const f = e.dataTransfer.files[0];
  if (f && (f.name.endsWith(".md") || f.type.includes("markdown") || f.type === "text/plain"))
    setFile(f);
  else toast("Please drop a .md file", "error");
});

// IPFS UPLOAD (Pinata)
async function uploadIPFS(file) {
  if (CONFIG.PINATA_JWT === "YOUR_PINATA_JWT")
    throw new Error("Set CONFIG.PINATA_JWT to your Pinata API key first.");
  const fd = new FormData();
  fd.append("file", file);
  fd.append("pinataMetadata", JSON.stringify({ name: file.name }));
  const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST",
    headers: { Authorization: `Bearer ${CONFIG.PINATA_JWT}` },
    body: fd,
  });
  if (!res.ok) throw new Error("Pinata upload failed: " + await res.text());
  return (await res.json()).IpfsHash;
}

async function uploadJsonToIPFS(data, filename = "payload.json") {
  if (CONFIG.PINATA_JWT === "YOUR_PINATA_JWT")
    throw new Error("Set CONFIG.PINATA_JWT to your Pinata API key first.");
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const file = new File([blob], filename, { type: "application/json" });
  return uploadIPFS(file);
}

function normalizeIpfsCid(value) {
  const raw = value.trim();
  if (!raw) return "";

  if (/^ipfs:\/\//i.test(raw)) {
    return raw.replace(/^ipfs:\/\//i, "").replace(/^ipfs\//i, "").replace(/^\/+|\/+$/g, "");
  }

  try {
    const url = new URL(raw);
    const parts = url.pathname.split("/").filter(Boolean);
    const ipfsIndex = parts.findIndex(p => p.toLowerCase() === "ipfs");
    if (ipfsIndex >= 0 && parts[ipfsIndex + 1]) return parts[ipfsIndex + 1];
  } catch (_) {
    // Treat non-URL input as a raw CID.
  }

  return raw.replace(/^\/+|\/+$/g, "");
}

function isLikelyIpfsReference(value) {
  if (!value) return false;
  const normalized = normalizeIpfsCid(String(value));
  return /^[A-Za-z0-9]+$/.test(normalized) && normalized.length >= 32;
}

function gatewayUrlsForCid(cid) {
  return [
    `https://ipfs.io/ipfs/${cid}`,
    `https://cloudflare-ipfs.com/ipfs/${cid}`,
    `https://gateway.pinata.cloud/ipfs/${cid}`,
  ];
}

function getIpfsUrlFromReasonReference(value) {
  if (!isLikelyIpfsReference(value)) return "";
  const cid = normalizeIpfsCid(String(value));
  return gatewayUrlsForCid(cid)[0] || "";
}

function getChallengeReasonReference(skill) {
  return skill?.challengeReasonRef || "";
}

async function fetchTextFromIPFS(cid) {
  for (const url of gatewayUrlsForCid(cid)) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.text();
    } catch (_) {
      // try next gateway
    }
  }
  throw new Error(`Failed to fetch IPFS content for ${cid}`);
}

async function resolveChallengeReason(rawReason) {
  const raw = (rawReason || "").trim();
  if (!raw) return "";
  if (challengeReasonCache.has(raw)) return challengeReasonCache.get(raw);
  if (!isLikelyIpfsReference(raw)) {
    challengeReasonCache.set(raw, raw);
    return raw;
  }

  const cid = normalizeIpfsCid(raw);
  try {
    const text = await fetchTextFromIPFS(cid);
    let resolved = raw;
    try {
      const parsed = JSON.parse(text);
      resolved = (parsed.reason || parsed.challengeReason || parsed.text || raw).trim() || raw;
    } catch (_) {
      resolved = text.trim() || raw;
    }
    challengeReasonCache.set(raw, resolved);
    return resolved;
  } catch (_) {
    challengeReasonCache.set(raw, raw);
    return raw;
  }
}

// SUBMIT SKILL
async function handleSubmit() {
  if (!account)        { toast("Connect wallet first", "error"); return; }
  if (!document.getElementById("skillName").value.trim())
    { toast("Enter a skill name", "error"); return; }
  if (!vaultContract)  { toast("Contract address not set in CONFIG", "error"); return; }

  const btn = document.getElementById("submitBtn");
  btn.disabled = true;
  try {
    const name = document.getElementById("skillName").value.trim();
    let cid = "";

    if (submitMode === "upload") {
      if (!selectedFile) { toast("Select a .md file first", "error"); return; }
      toast("Uploading to IPFS via Pinata...", "info");
      cid = await uploadIPFS(selectedFile);
      toast("Uploaded: " + cid.slice(0,18) + "...", "success");
    } else {
      cid = normalizeIpfsCid(document.getElementById("manualIpfsInput").value);
      if (!cid) { toast("Enter a valid IPFS CID or URL", "error"); return; }
      toast("Using existing IPFS content: " + cid.slice(0,18) + "...", "info");
    }

    toast("Confirm transaction in MetaMask...", "info");
    const tx = await vaultContract.submitSkill(cid, name, {
      value: ethers.parseEther("0.01")
    });
    toast("Waiting for confirmation...", "info");
    await tx.wait();
    toast("Skill submitted! Oracle will review shortly.", "success");

    // Reset form
    selectedFile = null;
    document.getElementById("fileInput").value = "";
    document.getElementById("manualIpfsInput").value = "";
    document.getElementById("skillName").value = "";
    document.getElementById("filePrev").className = "file-prev";
    document.getElementById("hashGroup").style.display = "none";

    await loadAllSkills();
    await updateBalances();
    switchTab("browse", document.querySelector(".nav-tab"));
  } catch(e) {
    console.error(e);
    const submitError = String(e?.reason || e?.shortMessage || e?.info?.error?.message || e?.message || "");
    if (String(e?.code || "") === "INSUFFICIENT_FUNDS" || submitError.toLowerCase().includes("insufficient funds")) {
      toast("Insufficient ETH. You need at least 0.01 ETH to submit.", "error");
    } else {
      toast("Error: " + (e.reason || e.message || "Transaction failed"), "error");
    }
  } finally {
    btn.disabled = false;
  }
}

// CHALLENGE SKILL
async function challengeSkill(id) {
  if (!account)       { toast("Connect wallet first","error"); return; }
  if (!vaultContract) { toast("Contract not configured","error"); return; }
  try {
    const reasonInput = document.getElementById(`reason-${id}`);
    const reason = ((reasonInput ? reasonInput.value : challengeReasonDrafts.get(id)) || "").trim();
    challengeReasonDrafts.set(id, reason);

    let challengeReasonRef = reason;
    if (reason) {
      toast("Uploading challenge reason to IPFS...", "info");
      challengeReasonRef = await uploadJsonToIPFS({
        reason,
        skillId: id,
      }, `challenge-reason-${id}.json`);
      toast("Challenge reason uploaded to IPFS", "success");
    }

    const stake = ethers.parseUnits("100", 18);
    const allow = await tokenContract.allowance(account, CONFIG.SKILL_VAULT_ADDRESS);
    if (allow < stake) {
      toast("Approving 100 VAULT...", "info");
      const tx = await tokenContract.approve(CONFIG.SKILL_VAULT_ADDRESS, stake);
      await tx.wait();
      toast("Approval confirmed", "success");
    }
    toast("Confirm challenge in MetaMask...", "info");
    const tx = await vaultContract.challenge(id, challengeReasonRef);
    await tx.wait();
    challengeReasonDrafts.delete(id);
    toast("Challenge submitted! Oracle will re-review.", "success");
    await loadAllSkills();
    await updateBalances();
  } catch(e) {
    console.error(e);
    toast("Error: " + (e.reason || e.message), "error");
  }
}

// FINALIZE SKILL
async function finalizeSkill(id) {
  if (!account) { toast("Connect wallet first","error"); return; }
  try {
    toast("Finalizing...", "info");
    const tx = await vaultContract.finalizeSkill(id);
    await tx.wait();
    toast("Skill published!", "success");
    await loadAllSkills();
  } catch(e) {
    toast("Error: " + (e.reason || e.message),"error");
  }
}

// FAUCET
async function claimFaucet() {
  if (!account)       { toast("Connect wallet first","error"); connectWallet(); return; }
  if (!tokenContract) { toast("Contract not configured","error"); return; }
  try {
    toast("Claiming 500 VAULT...", "info");
    const tx = await tokenContract.claimFaucet();
    await tx.wait();
    toast("500 VAULT received!", "success");
    await updateBalances();
  } catch(e) {
    toast("Error: " + (e.reason || e.message),"error");
  }
}

// TAB SWITCHING
function switchTab(name, btn) {
  document.querySelectorAll(".section").forEach(s => s.classList.remove("active"));
  document.querySelectorAll(".nav-tab").forEach(t => t.classList.remove("active"));
  document.getElementById("tab-"+name).classList.add("active");
  if (btn) btn.classList.add("active");
}

// HELPERS
function fmt(addr)   { return addr ? addr.slice(0,6)+"..."+addr.slice(-4) : "--"; }
function esc(s)      { const d=document.createElement("div"); d.appendChild(document.createTextNode(s||"")); return d.innerHTML; }
function fmtBytes(b) { return b<1024 ? b+" B" : b<1048576 ? (b/1024).toFixed(1)+" KB" : (b/1048576).toFixed(1)+" MB"; }
function getSkillIpfsUrl(skill) {
  const cid = (skill?.skillCID || "").trim();
  return cid ? `https://ipfs.io/ipfs/${cid}` : "";
}
function countdown(s) {
  if (s<=0) return "Expired";
  const h=Math.floor(s/3600), m=Math.floor((s%3600)/60);
  return h>0 ? `${h}h ${m}m` : `${m}m`;
}
function getChallengeResult(skill, isMine) {
  if (!isMine) return null;
  if (skill.status === 2) return { label: "Challenge Pending", className: "challenge-pending" };
  if (skill.status === 4 || skill.status === 5) return { label: "Challenge Success", className: "challenge-success" };
  if (skill.status === 3) return { label: "Challenge Failed", className: "challenge-fail" };
  return null;
}

function latestStatusClass(status) {
  if (status === 3) return "status-published";
  if (status === 2 || status === 1) return "status-pending";
  if (status === 4 || status === 5) return "status-danger";
  return "";
}

async function loadSkillEventMeta() {
  if (!vaultContract) return new Map();

  const [submittedLogs, reviewedLogs, challengedLogs, publishedLogs, rejectedLogs, revokedLogs] = await Promise.all([
    vaultContract.queryFilter(vaultContract.filters.SkillSubmitted()),
    vaultContract.queryFilter(vaultContract.filters.SkillReviewed()),
    vaultContract.queryFilter(vaultContract.filters.SkillChallenged()),
    vaultContract.queryFilter(vaultContract.filters.SkillPublished()),
    vaultContract.queryFilter(vaultContract.filters.SkillRejected()),
    vaultContract.queryFilter(vaultContract.filters.SkillRevoked()),
  ]);

  const meta = new Map();
  const ensure = (id) => {
    if (!meta.has(id)) meta.set(id, { challengeReason: "", challengeReasonRef: "", timeline: [] });
    return meta.get(id);
  };
  const push = (id, item) => ensure(id).timeline.push(item);

  for (const log of submittedLogs) {
    const id = Number(log.args.id);
    push(id, { key: `submitted-${log.transactionHash}`, order: log.blockNumber, type: "Submitted", detail: submittedTimelineDetail(log.args.submitter) });
  }
  for (const log of reviewedLogs) {
    const id = Number(log.args.id);
    const safe = !!log.args.safe;
    push(id, {
      key: `reviewed-${log.transactionHash}`,
      order: log.blockNumber,
      type: safe ? "Approved" : "Reviewed",
      detail: safe
        ? "Oracle reviewed and approved this skill"
        : "Oracle reviewed and rejected this skill"
    });
  }
  for (const log of challengedLogs) {
    const id = Number(log.args.id);
    const reasonRef = (log.args.reason || "").trim();
    const reason = await resolveChallengeReason(reasonRef);
    ensure(id).challengeReason = reason;
    ensure(id).challengeReasonRef = reasonRef;
    push(id, {
      key: `challenged-${log.transactionHash}`,
      order: log.blockNumber,
      type: "Challenged",
      detail: `Challenged by ${fmt(log.args.challenger)}`,
      reason,
      reasonRef,
    });
  }
  for (const log of publishedLogs) {
    const id = Number(log.args.id);
    push(id, { key: `published-${log.transactionHash}`, order: log.blockNumber, type: "Published", detail: "Skill is published" });
  }
  for (const log of rejectedLogs) {
    const id = Number(log.args.id);
    push(id, { key: `rejected-${log.transactionHash}`, order: log.blockNumber, type: "Rejected", detail: "Skill was rejected" });
  }
  for (const log of revokedLogs) {
    const id = Number(log.args.id);
    push(id, { key: `revoked-${log.transactionHash}`, order: log.blockNumber, type: "Revoked", detail: "Skill was revoked after challenge" });
  }

  for (const [, item] of meta) item.timeline.sort((a, b) => a.order - b.order);
  return meta;
}

function openSkillDetail(id) {
  const skill = allSkills.find(s => s.id === id);
  if (!skill) return;
  const wasSameDetailOpen = activeDetailSkillId === id && isDetailViewOpen();
  const previousTimelineKeys = wasSameDetailOpen
    ? new Set(Array.from(document.querySelectorAll("#detailTimeline .timeline-item")).map((el) => el.dataset.timelineKey))
    : new Set();
  activeDetailSkillId = id;

  document.getElementById("detailSkillTitle").textContent = skill.skillName || `Skill #${id}`;
  document.getElementById("detailOverview").innerHTML = renderSkillOverview(skill);
  document.getElementById("detailTimeline").innerHTML = renderSkillTimeline(skill);
  document.getElementById("browseListView").style.display = "none";
  document.getElementById("browseDetailView").style.display = "block";
  document.querySelector("#tab-browse .filter-bar").style.display = "none";
  document.querySelector("#tab-browse .browse-tools").style.display = "none";
  document.getElementById("browseCount").textContent = `Viewing skill #${id}`;
  updateBrowseRefreshButton();
  if (wasSameDetailOpen) animateNewTimelineItems(previousTimelineKeys);
  startDetailTracking(skill);
  document.getElementById("browseDetailView").scrollIntoView({ block: "start", behavior: "smooth" });
}

function closeSkillDetail(evt) {
  if (evt && evt.target && evt.currentTarget && evt.target !== evt.currentTarget) return;
  activeDetailSkillId = null;
  stopDetailTracking();
  document.getElementById("browseDetailView").style.display = "none";
  document.getElementById("browseListView").style.display = "block";
  document.querySelector("#tab-browse .filter-bar").style.display = "flex";
  document.querySelector("#tab-browse .browse-tools").style.display = "flex";
  updateBrowseRefreshButton();
  renderBrowse(allSkills);
  document.getElementById("tab-browse").scrollIntoView({ block: "start", behavior: "smooth" });
}

window.openSkillDetail = openSkillDetail;
window.closeSkillDetail = closeSkillDetail;

function getDisplayStatusMeta(skill) {
  if (!skill) return { label: "Unknown", className: latestStatusClass(-1) };
  const status = Number(skill.status);
  if (status !== 1) {
    return {
      label: STATUS_LABELS[status] || "Unknown",
      className: latestStatusClass(status),
    };
  }

  if (skill.reviewedAt) {
    const now = Math.floor(Date.now() / 1000);
    if (now < skill.reviewedAt + 48 * 3600) {
      return { label: "Challenge Window Open", className: "status-pending" };
    }
    return { label: "Challenge Window Closed", className: "status-published" };
  }
  return {
    label: STATUS_LABELS[status] || "Unknown",
    className: latestStatusClass(status),
  };
}

function getDisplayStatus(skill) {
  return getDisplayStatusMeta(skill).label;
}

function renderSkillOverview(skill) {
  const challengeReasonRef = getChallengeReasonReference(skill);
  const challengeReasonCid = challengeReasonRef ? normalizeIpfsCid(challengeReasonRef) : "";
  const rows = [
    ["Skill ID", `#${skill.id}`],
    ["Status", getDisplayStatus(skill)],
    ["Submitter", esc(skill.submitter || "")],
  ];

  if (skill.skillCID) rows.push(["Skill IPFS CID", esc(skill.skillCID)]);
  if (skill.skillCID) rows.push(["Skill Source Code", `<a href="${getSkillIpfsUrl(skill)}" target="_blank" class="detail-link">View skill on IPFS</a>`]);
  if (skill.challenger && skill.challenger !== ethers.ZeroAddress) rows.push(["Challenger", esc(skill.challenger)]);
  if (challengeReasonCid) rows.push(["Challenge Reason IPFS CID", esc(challengeReasonCid)]);

  return rows.map(([label, value]) => `
    <div class="detail-row">
      <div class="detail-label">${label}</div>
      <div class="detail-value">${value}</div>
    </div>
  `).join("");
}

function renderSkillTimeline(skill) {
  const timelineItems = dedupeTimeline(buildDisplayTimeline(skill));
  const timeline = timelineItems
    .map((item, index) => {
      const challengeReasonUrl = getIpfsUrlFromReasonReference(item.reasonRef || "");
      return `
      <div class="timeline-item timeline-${timelineTypeClass(item.type)}" data-timeline-key="${esc(getTimelineItemKey(skill, item, index))}">
        <div class="timeline-dot"></div>
        <div class="timeline-content">
          <div class="timeline-top">
            <span class="timeline-title"><span class="timeline-badge timeline-badge-${timelineTypeClass(item.type)}">${item.type}</span></span>
            <span class="timeline-time">${timelineTime(skill, item)}</span>
          </div>
          <div class="timeline-text">${esc(item.detail || "")}</div>
          ${challengeReasonUrl ? `<div class="timeline-reason">Challenge reason: <a href="${challengeReasonUrl}" target="_blank" rel="noopener noreferrer" class="detail-link">View reason on IPFS</a></div>` : ""}
        </div>
      </div>
    `;
    }).join("");

  return timeline || `<div class="timeline-empty">No timeline data available.</div>`;
}

function getTimelineItemKey(skill, item, index = 0) {
  return item.key || [
    skill.id,
    item.type || "item",
    getTimelineDisplayTimestamp(skill, item) || 0,
    item.detail || "",
    item.reason || "",
    index
  ].join("|");
}

function animateNewTimelineItems(previousKeys) {
  if (!previousKeys || !previousKeys.size) return;
  document.querySelectorAll("#detailTimeline .timeline-item").forEach((el) => {
    const key = el.dataset.timelineKey;
    if (!key || previousKeys.has(key)) return;
    el.classList.remove("timeline-item-enter");
    void el.offsetWidth;
    el.classList.add("timeline-item-enter");
    setTimeout(() => el.classList.remove("timeline-item-enter"), 1800);
  });
}

function buildDisplayTimeline(skill) {
  const items = skill.timeline && skill.timeline.length
    ? [...skill.timeline]
    : buildFallbackTimeline(skill);
  const hasType = (type) => items.some((item) => item.type === type);
  const challengeWindowEnd = skill.reviewedAt ? skill.reviewedAt + 48 * 3600 : 0;
  const now = Math.floor(Date.now() / 1000);
  const challengeWindowOpen = !!(skill.reviewedAt && now < challengeWindowEnd);

  if (skill.reviewedAt && !hasType("Approved") && !hasType("Reviewed") && !hasType("Rejected")) {
    items.push({
      key: `review-derived-${skill.id}`,
      type: skill.status === 4 ? "Rejected" : "Approved",
      time: skill.reviewedAt,
      order: skill.reviewedAt,
      detail: skill.status === 4
        ? "Oracle reviewed and rejected this skill"
        : "Oracle reviewed and approved this skill",
    });
  }

  if (skill.reviewedAt && (skill.status === 1 || skill.challengedAt) && !hasType("Challenge Window")) {
    const wasChallenged = !!skill.challengedAt;
    items.push({
      key: `challenge-window-${skill.id}`,
      type: "Challenge Window",
      time: skill.reviewedAt,
      order: skill.reviewedAt,
      detail: wasChallenged
        ? "48-hour challenge window opened"
        : challengeWindowOpen
        ? `48-hour challenge window is open, ${countdown(challengeWindowEnd - now)} remaining`
        : "48-hour challenge window opened",
    });
  }

  if (
    skill.reviewedAt &&
    skill.status === 1 &&
    !skill.challengedAt &&
    !challengeWindowOpen &&
    !hasType("Challenge Window Closed")
  ) {
    items.push({
      key: `challenge-window-closed-${skill.id}`,
      type: "Challenge Window Closed",
      time: challengeWindowEnd,
      order: challengeWindowEnd,
      detail: "48-hour challenge window closed with no challenge submitted",
    });
  }

  if (skill.challengedAt && !hasType("Challenged")) {
    items.push({
      key: `challenged-derived-${skill.id}`,
      type: "Challenged",
      time: skill.challengedAt,
      order: skill.challengedAt,
      detail: "A challenge is submitted",
      reason: skill.challengeReason,
      reasonRef: skill.challengeReasonRef || "",
    });
  }

  if (skill.status === 3 && !hasType("Published")) {
    items.push({
      key: `published-derived-${skill.id}`,
      type: "Published",
      time: skill.challengedAt || skill.reviewedAt,
      order: skill.challengedAt || skill.reviewedAt,
      detail: "Skill is reviewed as benign and published",
    });
  }

  if (skill.status === 5 && !hasType("Revoked")) {
    items.push({
      key: `revoked-derived-${skill.id}`,
      type: "Revoked",
      time: skill.challengedAt || skill.reviewedAt,
      order: skill.challengedAt || skill.reviewedAt,
      detail: "Skill is reviewed as malicious and revoked after challenge",
    });
  }

  return items.sort((a, b) => compareTimelineItems(skill, a, b));
}

function getTimelineDisplayTimestamp(skill, item) {
  if (item.time) return item.time;
  const type = String(item.type || "");
  if (type === "Submitted") return skill.submittedAt || 0;
  if (type === "Approved" || type === "Reviewed" || type === "Rejected" || type === "Challenge Window") return skill.reviewedAt || 0;
  if (type === "Challenge Window Closed") return skill.reviewedAt ? skill.reviewedAt + 48 * 3600 : 0;
  if (type === "Challenged") return skill.challengedAt || 0;
  if (type === "Published" || type === "Revoked") return skill.challengedAt || skill.reviewedAt || 0;
  return timelineTimeRaw(item);
}

function getTimelineTypeRank(type) {
  switch (String(type || "")) {
    case "Submitted": return 10;
    case "Approved":
    case "Reviewed":
    case "Rejected": return 20;
    case "Challenge Window": return 30;
    case "Challenge Window Closed": return 35;
    case "Challenged": return 40;
    case "Published":
    case "Revoked": return 50;
    default: return 99;
  }
}

function compareTimelineItems(skill, a, b) {
  const timeDiff = getTimelineDisplayTimestamp(skill, a) - getTimelineDisplayTimestamp(skill, b);
  if (timeDiff !== 0) return timeDiff;

  const rankDiff = getTimelineTypeRank(a.type) - getTimelineTypeRank(b.type);
  if (rankDiff !== 0) return rankDiff;

  return timelineTimeRaw(a) - timelineTimeRaw(b);
}

function timelineTypeClass(type) {
  return String(type || "").trim().toLowerCase().replace(/\s+/g, "-");
}

function buildFallbackTimeline(skill) {
  const items = [];
  if (skill.submittedAt) items.push({ type: "Submitted", time: skill.submittedAt, detail: "Skill was submitted" });
  if (skill.reviewedAt) items.push({
    type: skill.status === 4 ? "Rejected" : "Approved",
    time: skill.reviewedAt,
    detail: skill.status === 4
      ? "Oracle reviewed and rejected this skill"
      : "Oracle reviewed and approved this skill"
  });
  if (skill.reviewedAt && (skill.status === 1 || skill.challengedAt)) {
    const now = Math.floor(Date.now() / 1000);
    const end = skill.reviewedAt + 48 * 3600;
    const isOpen = now < end;
    const wasChallenged = !!skill.challengedAt;
    items.push({
      type: "Challenge Window",
      time: skill.reviewedAt,
      detail: wasChallenged
        ? "48-hour challenge window opened after oracle approval."
        : isOpen
        ? `48-hour challenge window is open. ${countdown(end - now)} remaining`
        : "48-hour challenge window opened after oracle approval."
    });
  }
  if (skill.reviewedAt && skill.status === 1 && !skill.challengedAt) {
    const end = skill.reviewedAt + 48 * 3600;
    if (Math.floor(Date.now() / 1000) >= end) {
      items.push({
        type: "Challenge Window Closed",
        time: end,
        detail: "48-hour challenge window closed with no challenge submitted"
      });
    }
  }
  if (skill.challengedAt) items.push({ type: "Challenged", time: skill.challengedAt, detail: "A challenge is submitted", reason: skill.challengeReason, reasonRef: skill.challengeReasonRef || "" });
  if (skill.status === 3) items.push({ type: "Published", time: skill.challengedAt || skill.reviewedAt, detail: "Skill is reviewed as benign and published" });
  if (skill.status === 5) items.push({ type: "Revoked", time: skill.challengedAt, detail: "Skill is reviewed as malicious and revoked after challenge" });
  return items;
}

function dedupeTimeline(items) {
  const deduped = [];
  for (const item of items || []) {
    const prev = deduped[deduped.length - 1];
    const sameType = prev && prev.type === item.type;
    const sameDetail = prev && prev.detail === item.detail;
    const sameTime = prev && timelineTimeRaw(prev) === timelineTimeRaw(item);

    if (sameType && (sameDetail || sameTime)) continue;

    if (prev && prev.type === "Reviewed" && item.type === "Rejected" && sameTime) {
      deduped[deduped.length - 1] = { ...item, detail: prev.detail || item.detail };
      continue;
    }

    deduped.push(item);
  }
  return deduped;
}

function timelineTimeRaw(item) {
  return item.time || item.ts || item.order || 0;
}

function timelineTime(skill, item) {
  if (item.time) return fmtDateTime(item.time);
  const type = item.type;
  if (type === "Submitted" && skill.submittedAt) return fmtDateTime(skill.submittedAt);
  if ((type === "Approved" || type === "Rejected" || type === "Reviewed") && skill.reviewedAt) return fmtDateTime(skill.reviewedAt);
  if (type === "Challenge Window Closed" && skill.reviewedAt) return fmtDateTime(skill.reviewedAt + 48 * 3600);
  if (type === "Challenged" && skill.challengedAt) return fmtDateTime(skill.challengedAt);
  if ((type === "Published" || type === "Revoked") && (skill.challengedAt || skill.reviewedAt)) {
    return fmtDateTime(skill.challengedAt || skill.reviewedAt);
  }
  return "On-chain event";
}

function fmtDateTime(ts) {
  if (!ts) return "Unknown";
  return new Date(ts * 1000).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function showCopyTooltip(anchor, msg) {
  const el = anchor?.currentTarget || anchor?.target || anchor;
  if (!el || typeof tippy !== "function") {
    toast(msg, "success");
    return;
  }

  if (el._copyTippyTimeout) clearTimeout(el._copyTippyTimeout);
  if (el._copyTippy) {
    el._copyTippy.setContent(msg);
    el._copyTippy.show();
  } else {
    el._copyTippy = tippy(el, {
      content: msg,
      trigger: "manual",
      placement: "top",
      theme: "copied",
      animation: "shift-away",
      arrow: true,
      duration: [140, 120],
      offset: [0, 12],
      hideOnClick: false,
    });
    el._copyTippy.show();
  }

  el._copyTippyTimeout = setTimeout(() => {
    if (el._copyTippy) el._copyTippy.hide();
  }, 900);
}

async function copy(t, msg = "Copied", evt = null) {
  const text = String(t ?? "");
  const anchor = evt || window.event || null;

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      showCopyTooltip(anchor, msg);
      return;
    }
  } catch (_) {}

  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.top = "-9999px";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();

  try {
    const ok = document.execCommand("copy");
    if (ok) showCopyTooltip(anchor, msg);
    else toast("Copy failed", "error");
  } catch (_) {
    toast("Copy failed", "error");
  } finally {
    document.body.removeChild(ta);
  }
}

window.copy = copy;
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeSkillDetail();
});

function toast(msg, type="info") {
  const c = document.getElementById("toasts");
  if (!c) return;

  const existing = c.querySelectorAll(".toast");
  if (existing.length >= 4) {
    existing[0].remove();
  }

  const t = document.createElement("div");
  t.className = `toast t-${type}`;
  t.textContent = msg;
  c.appendChild(t);

  requestAnimationFrame(()=>requestAnimationFrame(()=>t.classList.add("show")));
  setTimeout(()=>{t.classList.remove("show"); setTimeout(()=>t.remove(),250);}, 3500);
}

function showSkeleton() {
  document.getElementById("browseContent").innerHTML =
    `<div class="sk-grid">${Array(4).fill(0).map(()=>`
      <div class="sk-card">
        <div class="sk-line" style="width:80px;height:18px;margin-bottom:16px"></div>
        <div class="sk-line" style="width:65%;height:20px;margin-bottom:8px"></div>
        <div class="sk-line" style="width:45%;height:13px"></div>
      </div>`).join("")}</div>`;
}

function noWalletBrowse() {
  document.getElementById("browseContent").innerHTML =
    `<div class="connect-prompt">
      <h3>Connect your wallet</h3>
      <p>Connect MetaMask to browse AI Skills</p>
      <button class="btn btn-primary" onclick="connectWallet()">Connect MetaMask</button>
    </div>`;
  document.getElementById("browseCount").textContent = "Connect wallet to load";
}

function noWalletChallenge() {
  document.getElementById("challengeContent").innerHTML =
    `<div class="challenge-layout">
      <aside class="challenge-side-nav">
        <div class="challenge-side-tabs">
          <button type="button" class="challenge-side-tab active">
            <span class="challenge-side-tab-label">My Challenges</span>
            <span class="challenge-side-tab-meta">Wallet required</span>
          </button>
          <button type="button" class="challenge-side-tab">
            <span class="challenge-side-tab-label">Open Challenge Window</span>
            <span class="challenge-side-tab-meta">Wallet required</span>
          </button>
          <button type="button" class="challenge-side-tab">
            <span class="challenge-side-tab-label">Claim VAULT</span>
            <span class="challenge-side-tab-meta">Demo faucet</span>
          </button>
        </div>
      </aside>
      <div class="challenge-panel-shell">
        <div class="challenge-panel-header">
          <div>
            <div class="challenge-panel-title">Challenge Center</div>
            <div class="challenge-panel-sub">Connect MetaMask to unlock the challenge workflow</div>
          </div>
        </div>
        <div class="challenge-panel-body">
          <div class="connect-prompt">
            <h3>Connect your wallet</h3>
            <p>Connect MetaMask to see your challenges, the live challenge window, and the VAULT faucet.</p>
            <button class="btn btn-primary" onclick="connectWallet()">Connect MetaMask</button>
          </div>
        </div>
      </div>
    </div>`;
}

function setChallengeReasonDraft(id, value) {
  challengeReasonDrafts.set(Number(id), value || "");
}

window.setChallengeReasonDraft = setChallengeReasonDraft;

// Auto-reconnect
window.addEventListener("load", () => {
  updateBrowseRefreshButton();
  initWalletConnection(false);
});

// Refresh challenge countdowns every 60s
setInterval(() => { if (allSkills.length) renderChallenge(allSkills); }, 60000);

