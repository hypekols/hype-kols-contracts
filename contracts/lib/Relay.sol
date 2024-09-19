// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Nonces } from "@openzeppelin/contracts/utils/Nonces.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

import { RelayRequest, Signature } from "../lib/Structs.sol";

/// @title Relay
/// @author @builtbyfrancis
/// @notice An alternative to ERC2771 that relays calls within the contract itself.
abstract contract Relay is Ownable, Nonces, EIP712 {
    bytes32 private constant TYPE_HASH =
        keccak256("RelayRequest(bytes data,address relayer,uint256 nonce,uint48 deadline)");

    error ExpiredSignature();

    // #######################################################################################

    /// @notice Calls another function on this contract, overwriting the `msg.sender` to be the signer.
    /// @param _request The signed relay request.
    function callAsSigner(RelayRequest calldata _request) external {
        _callAsSigner(_request, _useNonce(msg.sender));
    }

    /// @notice Calls functions on this contract, overwriting the `msg.sender` to be the signer. Note: Reverts if any call fails.
    /// @param _requests The signed relay requests.
    function multiCallAsSigner(RelayRequest[] calldata _requests) external {
        uint256 nonce = _useNonce(msg.sender);
        for (uint256 i = 0; i < _requests.length; i++) {
            _callAsSigner(_requests[i], nonce);
        }
    }

    // #######################################################################################

    function _msgSender() internal view virtual override returns (address) {
        if (msg.sender == address(this)) {
            return address(bytes20(msg.data[msg.data.length - 20:]));
        } else {
            return super._msgSender();
        }
    }

    function _msgData() internal view virtual override returns (bytes calldata) {
        if (msg.sender == address(this)) {
            return msg.data[:msg.data.length - 20];
        } else {
            return super._msgData();
        }
    }

    function _recoverSigner(Signature calldata _signature, bytes32 _digest) internal view returns (address) {
        if (block.timestamp > _signature.deadline) revert ExpiredSignature();
        return ECDSA.recover(_hashTypedDataV4(_digest), _signature.v, _signature.r, _signature.s);
    }

    // #######################################################################################

    function _callAsSigner(RelayRequest calldata _request, uint256 _nonce) private {
        Signature calldata signature = _request.signature;
        bytes calldata requestData = _request.data;

        address signer = _recoverSigner(
            signature,
            keccak256(abi.encode(TYPE_HASH, keccak256(requestData), msg.sender, _nonce, signature.deadline))
        );

        bytes memory data = abi.encodePacked(requestData, signer);

        bool success;
        uint256 returnDataSize;
        bytes memory returnData;
        assembly {
            // Perform the call
            success := call(gas(), address(), 0, add(data, 0x20), mload(data), 0, 0)

            // Check if the call failed
            if iszero(success) {
                // Get the size of the returned error data
                returnDataSize := returndatasize()

                // Allocate memory for the return data
                returnData := mload(0x40) // Load free memory pointer
                mstore(0x40, add(returnData, add(returnDataSize, 0x20))) // Update free memory pointer

                // Copy the returned error data to memory
                returndatacopy(returnData, 0, returnDataSize)

                // Revert with the returned error data
                revert(returnData, returnDataSize)
            }
        }
    }
}
