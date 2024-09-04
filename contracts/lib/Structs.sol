// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

struct Escrow {
    uint256 amount;
    address creator;
    uint48 allowPlatformResolutionTimestamp;
    uint16 wormholeChainId;
    bytes32 benificiary;
}

struct Amounts {
    uint256 escrow;
    uint256 serviceFee;
}

struct Signature {
    bytes32 r;
    bytes32 s;
    uint8 v;
}
