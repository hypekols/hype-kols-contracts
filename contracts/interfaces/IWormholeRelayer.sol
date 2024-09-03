// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IWormholeRelayer {
    function relayerFee(uint16 chainId_, address token) external view returns (uint256);

    function getRegisteredContract(uint16 emitterChainId) external view returns (bytes32);

    function transferTokensWithRelay(
        address token,
        uint256 amount,
        uint256 toNativeTokenAmount,
        uint16 targetChain,
        bytes32 targetRecipientWallet
    ) external returns (uint64);
}
