// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

abstract contract Digests {
    bytes32 private constant CREATE_TYPEHASH =
        keccak256(
            "CreateEscrow(bytes32 escrowReference,address creator,uint16 wormholeChainId,bytes32 beneficiary,uint256 amount,uint256 serviceFee,uint256 nonce)"
        );

    bytes32 private constant INCREASE_TYPEHASH =
        keccak256("IncreaseEscrow(uint256 escrowId,uint256 amount,uint256 serviceFee,uint256 nonce)");

    bytes32 private constant RELEASE_TYPEHASH =
        keccak256("ReleaseEscrow(uint256 escrowId,uint256 amount,uint256 nonce)");

    bytes32 private constant ELECTED_SIGNER_TYPEHASH =
        keccak256("ElectedSigner(bytes32 nonEvmSigner,address electedSigner,uint256 nonce)");

    bytes32 private constant RESOLVE_AMICABLY_TYPEHASH =
        keccak256("ResolveAmicably(uint256 escrowId,uint256 amount,uint256 nonce)");

    bytes32 private constant START_DISPUTE_TYPEHASH = keccak256("StartDispute(uint256 escrowId,uint256 nonce)");

    bytes32 private constant RESOLVE_DISPUTE_TYPEHASH =
        keccak256("ResolveDispute(uint256 escrowId,uint256 creatorAmount,uint256 beneficiaryAmount,uint256 nonce)");

    // #######################################################################################

    mapping(uint256 => uint256) private _escrowNonces;
    mapping(address => uint256) private _addressNonces;

    // #######################################################################################

    /// @notice Returns the nonce of the escrow
    /// @param _escrowId The id of the escrow
    function getEscrowNonce(uint256 _escrowId) external view returns (uint256) {
        return _escrowNonces[_escrowId];
    }

    /// @notice Returns the nonce of the address
    /// @param _address The address
    function getAddressNonce(address _address) external view returns (uint256) {
        return _addressNonces[_address];
    }

    // #######################################################################################

    function _createEscrowDigest(
        bytes32 _escrowReference,
        address _creator,
        uint16 _wormholeChainId,
        bytes32 _beneficiary,
        uint256 _amount,
        uint256 _serviceFee
    ) internal returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    CREATE_TYPEHASH,
                    _escrowReference,
                    _creator,
                    _wormholeChainId,
                    _beneficiary,
                    _amount,
                    _serviceFee,
                    _useAddressNonce(_creator)
                )
            );
    }

    function _increaseEscrowDigest(uint256 _escrowId, uint256 _amount, uint256 _serviceFee) internal returns (bytes32) {
        return keccak256(abi.encode(INCREASE_TYPEHASH, _escrowId, _amount, _serviceFee, _useEscrowNonce(_escrowId)));
    }

    function _releaseEscrowDigest(uint256 _escrowId, uint256 _amount) internal returns (bytes32) {
        return keccak256(abi.encode(RELEASE_TYPEHASH, _escrowId, _amount, _useEscrowNonce(_escrowId)));
    }

    function _setElectedSignerDigest(bytes32 _nonEvmSigner, address _electedSigner) internal returns (bytes32) {
        return
            keccak256(
                abi.encode(ELECTED_SIGNER_TYPEHASH, _nonEvmSigner, _electedSigner, _useAddressNonce(_electedSigner))
            );
    }

    function _amicableResolutionDigest(
        uint256 _escrowId,
        uint256 _amount,
        address _resolver
    ) internal returns (bytes32) {
        return keccak256(abi.encode(RESOLVE_AMICABLY_TYPEHASH, _escrowId, _amount, _useAddressNonce(_resolver)));
    }

    function _startDisputeDigest(uint256 _escrowId) internal returns (bytes32) {
        return keccak256(abi.encode(START_DISPUTE_TYPEHASH, _escrowId, _useEscrowNonce(_escrowId)));
    }

    function _resolveDisputeDigest(
        uint256 _escrowId,
        uint256 _creatorAmount,
        uint256 _beneficiaryAmount
    ) internal returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    RESOLVE_DISPUTE_TYPEHASH,
                    _escrowId,
                    _creatorAmount,
                    _beneficiaryAmount,
                    _useEscrowNonce(_escrowId)
                )
            );
    }

    // #######################################################################################

    function _useEscrowNonce(uint256 _escrowId) private returns (uint256) {
        unchecked {
            return _escrowNonces[_escrowId]++;
        }
    }

    function _useAddressNonce(address _address) private returns (uint256) {
        unchecked {
            return _addressNonces[_address]++;
        }
    }
}
