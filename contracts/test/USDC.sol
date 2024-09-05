// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IUSDC } from "../interfaces/IUSDC.sol";

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ERC20Permit } from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import { IERC20Permit } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";

contract USDC is IUSDC, ERC20Permit {
    constructor() ERC20("USDC", "USDC") ERC20Permit("USDC") {}

    function nonces(address owner) public view virtual override(IERC20Permit, ERC20Permit) returns (uint256) {
        return super.nonces(owner);
    }

    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        bytes memory signature
    ) external override {
        require(signature.length == 65, "ECRecover: invalid signature length");

        bytes32 r;
        bytes32 s;
        uint8 v;

        assembly {
            r := mload(add(signature, 0x20))
            s := mload(add(signature, 0x40))
            v := byte(0, mload(add(signature, 0x60)))
        }

        permit(owner, spender, value, deadline, v, r, s);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
