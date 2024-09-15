// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

struct Escrow {
    uint256 amount;
    address creator;
    uint48 allowPlatformResolutionTimestamp;
    uint16 wormholeChainId;
    bytes32 beneficiary;
}

struct Signature {
    bytes32 r;
    bytes32 s;
    uint8 v;
    uint48 deadline;
}

struct RelayRequest {
    Signature signature;
    bytes data;
}

struct Permit {
    bytes signature;
    uint256 deadline;
}
