// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IWormholeRelayer } from "../interfaces/IWormholeRelayer.sol";

import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

contract WormholeRelayer is IWormholeRelayer {
    event TransferTokensWithRelayCalled(
        IERC20Metadata token,
        uint256 amount,
        uint256 toNativeTokenAmount,
        uint16 targetChain,
        bytes32 targetRecipientWallet
    );

    function relayerFee(uint16 chainId_, address token) public view returns (uint256) {
        return _relayerFee[chainId_][token];
    }

    function getRegisteredContract(uint16 emitterChainId) public view returns (bytes32) {
        return _registeredContracts[emitterChainId];
    }

    function transferTokensWithRelay(
        IERC20Metadata token,
        uint256 amount,
        uint256 toNativeTokenAmount,
        uint16 targetChain,
        bytes32 targetRecipientWallet
    ) external returns (uint64) {
        // sanity check input values
        require(amount > 0, "amount must be > 0");
        require(targetRecipientWallet != bytes32(0), "invalid target recipient");
        require(address(token) != address(0), "token cannot equal address(0)");

        // cache the target contract address
        bytes32 targetContract = getRegisteredContract(targetChain);
        require(targetContract != bytes32(0), "CIRCLE-RELAYER: target not registered");

        // transfer the tokens to this contract
        uint256 amountReceived = custodyTokens(token, amount);
        uint256 targetRelayerFee = relayerFee(targetChain, address(token));
        require(amountReceived > targetRelayerFee + toNativeTokenAmount, "insufficient amountReceived");

        emit TransferTokensWithRelayCalled(token, amount, toNativeTokenAmount, targetChain, targetRecipientWallet);

        return _messageSequenceMock;
    }

    function custodyTokens(IERC20Metadata token, uint256 amount) internal returns (uint256) {
        // query own token balance before transfer
        uint256 balanceBefore = token.balanceOf(address(this));

        // deposit USDC
        SafeERC20.safeTransferFrom(token, msg.sender, address(this), amount);

        // query own token balance after transfer
        uint256 balanceAfter = token.balanceOf(address(this));

        // this check is necessary since Circle's token contracts are upgradeable
        return balanceAfter - balanceBefore;
    }

    // #######################################################################################

    uint64 private _messageSequenceMock;

    mapping(uint16 => mapping(address => uint256)) private _relayerFee;
    mapping(uint16 => bytes32) private _registeredContracts;

    function mockMessageSequence(uint64 sequence) external {
        _messageSequenceMock = sequence;
    }

    function mockRelayerFee(uint16 chainId_, address token, uint256 fee) external {
        _relayerFee[chainId_][token] = fee;
    }

    function mockContractRegistered(uint16 emitterChainId, bytes32 contractHash) external {
        _registeredContracts[emitterChainId] = contractHash;
    }
}
