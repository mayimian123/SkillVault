// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../SkillVault.sol";

contract SkillVaultV2 is SkillVault {
    function version() external pure returns (string memory) {
        return "v2";
    }
}
