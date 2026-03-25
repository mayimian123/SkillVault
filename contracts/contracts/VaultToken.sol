// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract VaultToken is ERC20 {
    uint256 public constant TOTAL_SUPPLY = 1_000_000 ether;
    uint256 public constant FAUCET_AMOUNT = 500 ether;

    mapping(address => bool) public faucetClaimed;

    constructor() ERC20("VaultToken", "VAULT") {
        _mint(address(this), TOTAL_SUPPLY);
    }

    function claimFaucet() external {
        require(!faucetClaimed[msg.sender], "Faucet already claimed");
        faucetClaimed[msg.sender] = true;
        _transfer(address(this), msg.sender, FAUCET_AMOUNT);
    }
}
