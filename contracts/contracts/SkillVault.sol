// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./VaultToken.sol";

// todo: 48h window challenge, how to enable automatic finalization after challenge window expires? Chainlink keepers? 
contract SkillVault {

    VaultToken public immutable vault;
    address public immutable oracle;

    struct Skill {
        address submitter;
        string cid;
        string name;
        Status status;
        uint256 ethStake;
        uint256 submittedAt;
        uint256 reviewedAt;
        uint256 challengedAt;
        address challenger;
    }

    uint256 public skillCount;
    mapping(uint256 => Skill) public skills;

    enum Status {
        Submitted,
        Approved,
        Challenged,
        Published,
        Rejected,
        Revoked
    }

    address public immutable feeRecipient;
    uint256 public constant ETH_STAKE = 0.01 ether;         // todo: adjust this
    uint256 public constant CHALLENGE_STAKE = 100 ether;    // 100 VAULT tokens
    uint256 public constant CHALLENGE_WINDOW = 48 hours;
    uint256 public constant FEE_BPS = 500;     // Platform commission fee in basis points (eg: 10% = 1000 bps)
    uint256 public constant BPS_DENOMINATOR = 10_000;

    event SkillSubmitted(uint256 indexed id, address indexed submitter, string cid, string name);
    event SkillReviewed(uint256 indexed id, bool safe);
    event SkillChallenged(uint256 indexed id, address indexed challenger);
    event SkillPublished(uint256 indexed id);
    event SkillRejected(uint256 indexed id);
    event SkillRevoked(uint256 indexed id);

    modifier onlyOracle() {
        require(msg.sender == oracle, "Caller is not the oracle");
        _;
    }

    constructor(address _vault, address _oracle, address _feeRecipient) {
        require(_vault != address(0), "Vault token required");
        require(_oracle != address(0), "Oracle required");
        require(_feeRecipient != address(0), "Fee recipient required");

        vault = VaultToken(_vault);
        oracle = _oracle;
        feeRecipient = _feeRecipient;
    }

    function submitSkill(string calldata cid, string calldata name) external payable returns (uint256 id) {
        require(msg.value >= ETH_STAKE, "Need more ETH stake");

        id = skillCount++;
        skills[id] = Skill({
            submitter: msg.sender,
            cid: cid,
            name: name,
            status: Status.Submitted,
            ethStake: msg.value,
            submittedAt: block.timestamp,
            reviewedAt: 0,
            challengedAt: 0,
            challenger: address(0)
        });

        emit SkillSubmitted(id, msg.sender, cid, name);
    }

    /**
     * @dev Resolves the initial review of a submitted skill by the oracle.
     * @param id The ID of the skill to review
     * @param safe Whether the skill is safe
     */
    function resolveInitialReview(uint256 id, bool safe) external onlyOracle {
        Skill storage skill = _getSubmittedSkill(id);

        skill.reviewedAt = block.timestamp;

        if (safe) {
            skill.status = Status.Approved;
            emit SkillReviewed(id, true);
            return;
        }

        skill.status = Status.Rejected;
        _sendEth(feeRecipient, skill.ethStake);
        emit SkillReviewed(id, false);
        emit SkillRejected(id);
    }

    /**
     * @dev Challenges an approved skill.
     * @param id The ID of the skill to challenge
     */
    function challenge(uint256 id) external {
        Skill storage skill = _getSkill(id);
    
        require(skill.status == Status.Approved, "Not challengeable");
        require(
            block.timestamp <= skill.reviewedAt + CHALLENGE_WINDOW,
            "Challenge window closed"
        );

        vault.transferFrom(msg.sender, address(this), CHALLENGE_STAKE);

        skill.status = Status.Challenged;
        skill.challenger = msg.sender;
        skill.challengedAt = block.timestamp;

        emit SkillChallenged(id, msg.sender);
    }
    
    /**
     * @dev Finalizes a skill, making it publicly available.
     * @param id The ID of the skill to finalize
     */
    function finalizeSkill(uint256 id) external {
        Skill storage skill = _getSkill(id);
        require(skill.status == Status.Approved, "Not finalizable");
        require(
            block.timestamp > skill.reviewedAt + CHALLENGE_WINDOW,
            "Challenge window still open"
        );

        skill.status = Status.Published;
        _sendEth(skill.submitter, skill.ethStake);
        emit SkillPublished(id);
    }

    /**
     * @dev Resolves a challenge on a skill.
     * @param id The ID of the skill to resolve
     * @param malicious Whether the challenge was malicious
     */
    function resolveChallenge(uint256 id, bool malicious) external onlyOracle {
        Skill storage skill = _getSkill(id);
        require(skill.status == Status.Challenged, "Not challenged");

        // successful challenge - skill is revoked, challenger gets the stakes, submitter slashed
        if (malicious) {
            skill.status = Status.Revoked;
            // Send the original stake minus fee to the challenger, and the challenge stake to the challenger as well.
            _sendEth(skill.challenger, _netAmount(skill.ethStake));
            _sendEth(feeRecipient, _platformFeeAmount(skill.ethStake));
            vault.transfer(skill.challenger, CHALLENGE_STAKE);
            emit SkillRevoked(id);
            return;
        } 
        // failed challenge - skill is published, challenger gets slashed, submitter gets back their stake
        skill.status = Status.Published;
        _sendEth(skill.submitter, skill.ethStake);
        vault.transfer(skill.submitter, _netAmount(CHALLENGE_STAKE));
        vault.transfer(feeRecipient, _platformFeeAmount(CHALLENGE_STAKE));
        emit SkillPublished(id);
    }

    function _getSkill(uint256 id) internal view returns (Skill storage skill) {
        skill = skills[id];
        require(skill.submitter != address(0), "Skill does not exist");
    }

    function _getSubmittedSkill(uint256 id)
        internal
        view
        returns (Skill storage skill)
    {
        skill = _getSkill(id);
        require(skill.status == Status.Submitted, "Invalid state");
    }

    function _sendEth(address to, uint256 amount) internal {
        (bool success, ) = payable(to).call{value: amount}("");
        require(success, "ETH transfer failed");
    }

    function _platformFeeAmount(uint256 amount) internal pure returns (uint256) {
        return (amount * FEE_BPS) / BPS_DENOMINATOR;
    }

    function _netAmount(uint256 amount) internal pure returns (uint256) {
        return amount - _platformFeeAmount(amount);
    }
}
