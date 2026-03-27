// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title VaultToken
/// @notice ERC20 governance and staking token used in the SkillVault platform.
///         Challengers must stake VAULT tokens to dispute an approved Skill.
///         Includes a one-time faucet so demo participants can obtain tokens freely.
contract VaultToken is ERC20 {
    uint256 public constant TOTAL_SUPPLY = 1_000_000 ether; // 1 million VAULT minted at deploy
    uint256 public constant FAUCET_AMOUNT = 500 ether;      // 500 VAULT per faucet claim

    /// @notice Tracks which addresses have already claimed from the faucet
    mapping(address => bool) public faucetClaimed;

    /// @notice Mints the entire supply to this contract so it can distribute via faucet
    constructor() ERC20("VaultToken", "VAULT") {
        _mint(address(this), TOTAL_SUPPLY);
    }

    /// @notice Allows any address to claim 500 VAULT once, for testing and demo purposes
    function claimFaucet() external {
        require(!faucetClaimed[msg.sender], "Faucet already claimed");
        faucetClaimed[msg.sender] = true;
        _transfer(address(this), msg.sender, FAUCET_AMOUNT);
    }
}
