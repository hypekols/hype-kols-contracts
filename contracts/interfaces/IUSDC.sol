// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { IERC20Permit } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";

interface IUSDC is IERC20Metadata, IERC20Permit {
    function permit(address owner, address spender, uint256 value, uint256 deadline, bytes memory signature) external;
}
