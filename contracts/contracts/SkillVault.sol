// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "./VaultToken.sol";


contract SkillVault is Initializable, OwnableUpgradeable, UUPSUpgradeable {     // UUPS upgradeable contract
    VaultToken public vault;
    address public oracle;
    address public feeRecipient;

    /**
     * @dev Represents a skill
     */
    struct Skill {
        address submitter;
        string cid; // CID of the skill metadata stored on IPFS
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

    /**
     * @dev Represents the status of a skill.
     * Submitted: The skill has been submitted and is awaiting review.
     * Approved: The skill has been reviewed and approved by the oracle, and is awaiting finalization after the challenge window expires.
     * Challenged: The skill has been challenged by a challenger and is awaiting resolution by the oracle.
     * Published: The skill has been published and is available in the vault.
     * Rejected: The skill has been rejected by the oracle during the initial review.
     * Revoked: The skill has been revoked by the oracle after a successful challenge.
     */
    enum Status {
        Submitted,
        Approved,
        Challenged,
        Published,
        Rejected,
        Revoked
    }

    uint256 public constant ETH_STAKE = 0.01 ether;
    uint256 public constant CHALLENGE_STAKE = 100 ether;
    uint256 public constant CHALLENGE_WINDOW = 48 hours;
    // 5% fee on stakes for the platform
    uint256 public constant FEE_BPS = 500;  
    uint256 public constant BPS_DENOMINATOR = 10_000;

    event SkillSubmitted(uint256 indexed id, address indexed submitter, string cid, string name);
    event SkillReviewed(uint256 indexed id, bool safe);
    event SkillChallenged(uint256 indexed id, address indexed challenger, string reason);
    event SkillPublished(uint256 indexed id);
    event SkillRejected(uint256 indexed id);
    event SkillRevoked(uint256 indexed id);

    event OracleUpdated(address indexed previousOracle, address indexed newOracle);
    event FeeRecipientUpdated(address indexed previousFeeRecipient, address indexed newFeeRecipient);

    /**
        * @dev Modifier to restrict functions to the oracle only
     */
    modifier onlyOracle() {
        require(msg.sender == oracle, "Caller is not the oracle");
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
        * @dev Initializes the contract
        * @param _vault The address of the vault token
        * @param _oracle The address of the oracle
        * @param _feeRecipient The address of the fee recipient
        * @param initialOwner The address of the initial owner
     */
    function initialize(address _vault, address _oracle, address _feeRecipient, address initialOwner) public initializer {
        require(_vault != address(0), "Vault token required");
        require(_oracle != address(0), "Oracle required");
        require(_feeRecipient != address(0), "Fee recipient required");
        require(initialOwner != address(0), "Owner required");

        __Ownable_init(initialOwner);
        vault = VaultToken(_vault);
        oracle = _oracle;
        feeRecipient = _feeRecipient;
    }

    /**
        * @dev Sets the oracle address
        * @param newOracle The address of the new oracle
     */
    function setOracle(address newOracle) external onlyOwner {
        require(newOracle != address(0), "Oracle required");
        emit OracleUpdated(oracle, newOracle);
        oracle = newOracle;
    }

    /**
        * @dev Sets the fee recipient address
        * @param newFeeRecipient The address of the new fee recipient
     */
    function setFeeRecipient(address newFeeRecipient) external onlyOwner {
        require(newFeeRecipient != address(0), "Fee recipient required");
        emit FeeRecipientUpdated(feeRecipient, newFeeRecipient);
        feeRecipient = newFeeRecipient;
    }

    /**
        * @dev Submits a new skill
        * @param cid The CID of the skill
        * @param name The name of the skill
        * @return id The ID of the submitted skill
     */
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
        * @dev The first review of a submitted skill. Can only be called by the oracle.
        * @param id The ID of the skill
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
        * @dev Challenge an approved skill within the challenge window
        * @param id The ID of the skill
        * @param reason The reason for the challenge
     */
    function challenge(uint256 id, string calldata reason) external {
        Skill storage skill = _getSkill(id);

        require(skill.status == Status.Approved, "Not challengeable");
        require(block.timestamp <= skill.reviewedAt + CHALLENGE_WINDOW, "Challenge window closed");

        vault.transferFrom(msg.sender, address(this), CHALLENGE_STAKE);

        skill.status = Status.Challenged;
        skill.challenger = msg.sender;
        skill.challengedAt = block.timestamp;

        emit SkillChallenged(id, msg.sender, reason);
    }

    /**
        * @dev Finalizes a skill. Can only be called after the challenge window has expired without a successful challenge.
        * @param id The ID of the skill
     */
    function finalizeSkill(uint256 id) external {
        Skill storage skill = _getSkill(id);
        require(skill.status == Status.Approved, "Not finalizable");
        require(block.timestamp > skill.reviewedAt + CHALLENGE_WINDOW, "Challenge window still open");

        skill.status = Status.Published;
        _sendEth(skill.submitter, skill.ethStake);
        emit SkillPublished(id);
    }

    /**
        * @dev Resolves a challenge to a submitted skill. Can only be called by the oracle. If the challenge is successful, the skill is revoked and the challenger receives the staked ETH. If the challenge is failed, the skill is published and the submitter receives their staked ETH back. Commission fees are sent to the fee recipient in both cases.
        * @param id The ID of the skill
        * @param malicious Whether the challenge was malicious
     */
    function resolveChallenge(uint256 id, bool malicious) external onlyOracle {
        Skill storage skill = _getSkill(id);
        require(skill.status == Status.Challenged, "Not challenged");

        if (malicious) {
            skill.status = Status.Revoked;
            _sendEth(skill.challenger, _netAmount(skill.ethStake));
            _sendEth(feeRecipient, _platformFeeAmount(skill.ethStake));
            vault.transfer(skill.challenger, CHALLENGE_STAKE);
            emit SkillRevoked(id);
            return;
        }

        skill.status = Status.Published;
        _sendEth(skill.submitter, skill.ethStake);
        vault.transfer(skill.submitter, _netAmount(CHALLENGE_STAKE));
        vault.transfer(feeRecipient, _platformFeeAmount(CHALLENGE_STAKE));
        emit SkillPublished(id);
    }

    /**
        * @dev Authorizes an upgrade to a new implementation. Can only be called by the owner.
        * @param newImplementation The address of the new implementation
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    /**
        * @dev Retrieves a skill by its ID. The named return variable is implicitly returned.
        * @param id The ID of the skill
        * @return skill The skill storage pointer
     */
    function _getSkill(uint256 id) internal view returns (Skill storage skill) {
        skill = skills[id];
        require(skill.submitter != address(0), "Skill does not exist");
    }

    /**
        * @dev Retrieves a submitted skill by its ID
        * @param id The ID of the skill
        * @return skill The skill storage pointer
     */
    function _getSubmittedSkill(uint256 id) internal view returns (Skill storage skill) {
        skill = _getSkill(id);
        require(skill.status == Status.Submitted, "Invalid state");
    }

    /**
        * @dev Sends ETH to a specified address
        * @param to The address to send ETH to
        * @param amount The amount of ETH to send
     */
    function _sendEth(address to, uint256 amount) internal {
        (bool success, ) = payable(to).call{value: amount}("");
        require(success, "ETH transfer failed");
    }

    /**
        * @dev Calculates the platform fee amount
        * @param amount The amount to calculate the fee for
        * @return amount The platform fee amount
     */
    function _platformFeeAmount(uint256 amount) internal pure returns (uint256) {
        return (amount * FEE_BPS) / BPS_DENOMINATOR;
    }

    /**
        * @dev Calculates the net amount after deducting the platform fee
        * @param amount The amount to calculate the net amount for
        * @return amount The net amount
     */
    function _netAmount(uint256 amount) internal pure returns (uint256) {
        return amount - _platformFeeAmount(amount);
    }
}
