// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { IUSDC } from "./interfaces/IUSDC.sol";
import { IWormholeRelayer } from "./interfaces/IWormholeRelayer.sol";

import { Digests } from "./lib/Digests.sol";
import { Escrow, Amounts, Signature } from "./lib/Structs.sol";

/**
 * @title CrossChainEscrow
 * @author @builtbyfrancis
 * @notice A cross chain escrow contract that allows for the creation of USDC escrows on one chain and the release on another chain.
 * Makes use of the wormhole protocol which in turn uses CCTP for cross chain communication.
 */
contract CrossChainEscrow is Digests, Ownable, EIP712 {
    error WormholeNotRegistered();
    error UnauthorizedSender();
    error InvalidResolution();
    error InvalidSignature();
    error CannotResolveYet();
    error AlreadyStarted();
    error InvalidAddress();
    error EscrowNotFound();

    // #######################################################################################

    event EscrowCreated(
        uint256 indexed escrow_id,
        bytes32 indexed escrow_reference,
        address indexed creator,
        uint16 wormhole_chain_id,
        bytes32 beneficiary,
        uint256 amount,
        uint256 serviceFee
    );

    event EscrowIncreased(uint256 indexed escrow_id, uint256 amount, uint256 serviceFee);

    event EscrowReleased(uint256 indexed escrow_id, uint256 amount, uint64 wormholeMessageSequence);
    event EscrowRefunded(uint256 indexed escrow_id, uint256 amount);

    event BeneficiaryUpdated(uint256 indexed escrow_id, uint16 wormhole_chain_id, bytes32 beneficiary);
    event EvmAddressElected(bytes32 indexed nonEvmAddress, address electedAddress);
    event BridgeFeePaid(uint256 indexed escrow_id, uint256 amount);

    event DisputeStarted(uint256 indexed escrow_id, uint48 resolution_timestamp);
    event DisputeResolved(uint256 indexed escrow_id, uint256 creatorAmount, uint256 beneficiaryAmount);

    // #######################################################################################

    /// @notice The domain separator for the contract.
    function DOMAIN_SEPARATOR() external view virtual returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @notice The usdc address on this chain
    IUSDC public immutable USDC;

    /// @notice The wormhole relayer address on this chain
    IWormholeRelayer public immutable WORMHOLE;

    /// @notice The wormhole issued chain id for this chain.
    uint16 public immutable WORMHOLE_CHAIN_ID;

    // #######################################################################################

    /// @notice The next escrow id.
    uint256 public nextEscrowId;

    /// @notice The platform owned treasury address.
    address public treasury;

    /// @notice The platform owned signer address.
    address public platformSigner;

    /// @notice The duration in seconds after which a dispute can be resolved by the platform.
    uint48 public platformResolutionTimeout;

    mapping(uint256 => Escrow) private _escrow;
    mapping(bytes32 => address) private _electedAddresses;

    // #######################################################################################

    constructor(
        IUSDC _usdc,
        IWormholeRelayer _wormholeRelayer,
        uint16 _wormholeChaidId,
        address _signer,
        address _treasury
    ) Ownable(msg.sender) EIP712("CrossChainEscrow", "1") {
        USDC = _usdc;
        WORMHOLE = _wormholeRelayer;
        WORMHOLE_CHAIN_ID = _wormholeChaidId;

        platformSigner = _signer;
        treasury = _treasury;
        platformResolutionTimeout = 3 days;
    }

    // #######################################################################################

    modifier onlySigner(address _sender) {
        if (platformSigner != _sender) revert UnauthorizedSender();
        _;
    }

    modifier onlyCreator(uint256 _escrowId, address _sender) {
        if (_escrow[_escrowId].creator != _sender) revert UnauthorizedSender();
        _;
    }

    modifier onlyBeneficiary(uint256 _escrowId, address _sender) {
        if (_getBeneficiaryAddress(_escrow[_escrowId].beneficiary) != _sender) revert UnauthorizedSender();
        _;
    }

    modifier onlyExists(uint256 _escrowId) {
        if (_escrow[_escrowId].creator == address(0)) revert EscrowNotFound();
        _;
    }

    // #######################################################################################

    /// @notice Creates a new escrow. Can only be called with platform permission. Makes use of USDC's Permit for single call approve+transfer.
    /// @param _platformSignature The platform signature.
    /// @param _escrowReference The escrow reference to link to the platform db.
    /// @param _creator The creator of the escrow.
    /// @param _wormholeChainId The wormhole chain id.
    /// @param _beneficiary The beneficiary of the escrow.
    /// @param _amounts The escrow and service fee amounts.
    /// @param _signature The USDC permit signature.
    /// @param _deadline The USDC permit deadline.
    function createEscrow(
        Signature calldata _platformSignature,
        bytes32 _escrowReference,
        address _creator,
        uint16 _wormholeChainId,
        bytes32 _beneficiary,
        Amounts calldata _amounts,
        bytes calldata _signature,
        uint256 _deadline
    )
        external
        onlySigner(
            _recoverSigner(
                _platformSignature,
                _createEscrowDigest(
                    _escrowReference,
                    _creator,
                    _wormholeChainId,
                    _beneficiary,
                    _amounts.escrow,
                    _amounts.serviceFee
                )
            )
        )
    {
        if (_wormholeChainId != WORMHOLE_CHAIN_ID && WORMHOLE.getRegisteredContract(_wormholeChainId) == bytes32(0))
            revert WormholeNotRegistered();

        _escrow[nextEscrowId] = Escrow({
            amount: _amounts.escrow,
            creator: _creator,
            allowPlatformResolutionTimestamp: 0,
            wormholeChainId: _wormholeChainId,
            beneficiary: _beneficiary
        });

        _custodyUSDC(_amounts, _signature, _creator, _deadline);

        emit EscrowCreated(
            nextEscrowId,
            _escrowReference,
            _creator,
            _wormholeChainId,
            _beneficiary,
            _amounts.escrow,
            _amounts.serviceFee
        );

        unchecked {
            nextEscrowId++;
        }
    }

    /// @notice Increases an existing escrow. Can only be called with platform permission. Makes use of USDC's Permit for single call approve+transfer.
    /// @param _platformSignature The platform signature.
    /// @param _escrowId The escrow id.
    /// @param _amounts The escrow and service fee amounts.
    /// @param _signature The USDC permit signature.
    /// @param _deadline The USDC permit deadline.
    function increaseEscrow(
        Signature calldata _platformSignature,
        uint256 _escrowId,
        Amounts calldata _amounts,
        bytes calldata _signature,
        uint256 _deadline
    )
        external
        onlyExists(_escrowId)
        onlySigner(
            _recoverSigner(_platformSignature, _increaseEscrowDigest(_escrowId, _amounts.escrow, _amounts.serviceFee))
        )
    {
        _escrow[_escrowId].amount += _amounts.escrow;
        _custodyUSDC(_amounts, _signature, _escrow[_escrowId].creator, _deadline);

        emit EscrowIncreased(_escrowId, _amounts.escrow, _amounts.serviceFee);
    }

    /// @notice Updates the beneficiary of an existing escrow. Can only be called by the beneficiary.
    /// @param _escrowId The escrow id.
    /// @param _wormholeChainId The wormhole chain id.
    /// @param _beneficiary The new beneficiary.
    function updateBeneficiary(
        uint256 _escrowId,
        uint16 _wormholeChainId,
        bytes32 _beneficiary
    ) external onlyExists(_escrowId) onlyBeneficiary(_escrowId, msg.sender) {
        _updateBeneficiary(_escrowId, _wormholeChainId, _beneficiary);
    }

    /// @notice Relays the update of the beneficiary of an existing escrow. Can only be called with beneficiary permission.
    /// @param _beneficiarySignature The beneficiary signature.
    /// @param _escrowId The escrow id.
    /// @param _wormholeChainId The wormhole chain id.
    /// @param _beneficiary The new beneficiary.
    function relayedUpdateBeneficiary(
        Signature calldata _beneficiarySignature,
        uint256 _escrowId,
        uint16 _wormholeChainId,
        bytes32 _beneficiary
    )
        external
        onlyExists(_escrowId)
        onlyBeneficiary(
            _escrowId,
            _recoverSigner(_beneficiarySignature, _updateBeneficiaryDigest(_escrowId, _wormholeChainId, _beneficiary))
        )
    {
        _updateBeneficiary(_escrowId, _wormholeChainId, _beneficiary);
    }

    /// @notice Releases an existing escrow. Can only be called by the creator.
    /// @param _escrowId The escrow id.
    /// @param _amount The amount to release.
    function releaseEscrow(
        uint256 _escrowId,
        uint256 _amount
    ) external onlyExists(_escrowId) onlyCreator(_escrowId, msg.sender) {
        _releaseEscrow(_escrowId, _amount);
    }

    /// @notice Relays the release of an existing escrow. Can only be called with creator permission.
    /// @param _creatorSignature The creator signature.
    /// @param _escrowId The escrow id.
    /// @param _amount The amount to release.
    function relayedReleaseEscrow(
        Signature calldata _creatorSignature,
        uint256 _escrowId,
        uint256 _amount
    )
        external
        onlyExists(_escrowId)
        onlyCreator(_escrowId, _recoverSigner(_creatorSignature, _releaseEscrowDigest(_escrowId, _amount)))
    {
        _releaseEscrow(_escrowId, _amount);
    }

    /// @notice Elects an address for a non evm supported chain.
    /// @param _platformSignature The platform signature.
    /// @param _nonEvmAddress The non EVM address.
    /// @param _electedAddress The elected EVM address.
    function setElectedEvmAddress(
        Signature calldata _platformSignature,
        bytes32 _nonEvmAddress,
        address _electedAddress
    )
        external
        onlySigner(_recoverSigner(_platformSignature, _setElectedAddressDigest(_nonEvmAddress, _electedAddress)))
    {
        _electedAddresses[_nonEvmAddress] = _electedAddress;
        emit EvmAddressElected(_nonEvmAddress, _electedAddress);
    }

    /// @notice Resolves a dispute amicably. Can be called by anyone but must satisfy two conditions. 1) Both the creator and beneficiary must sign the resolution. 2) The amounts must add up to the escrow amount.
    /// @param _creatorSignature The creator signature.
    /// @param _beneficiarySignature The beneficiary signature.
    /// @param _escrowId The escrow id.
    /// @param _creatorAmount The creator amount.
    /// @param _beneficiaryAmount The beneficiary amount.
    function amicableResolution(
        Signature calldata _creatorSignature,
        Signature calldata _beneficiarySignature,
        uint256 _escrowId,
        uint256 _creatorAmount,
        uint256 _beneficiaryAmount
    ) external onlyExists(_escrowId) {
        if (
            _escrow[_escrowId].creator !=
            _recoverSigner(
                _creatorSignature,
                _amicableResolutionDigest(_escrowId, _creatorAmount, _escrow[_escrowId].creator)
            )
        ) revert InvalidSignature();

        address beneficiary = _getBeneficiaryAddress(_escrow[_escrowId].beneficiary);
        if (
            beneficiary !=
            _recoverSigner(_beneficiarySignature, _amicableResolutionDigest(_escrowId, _beneficiaryAmount, beneficiary))
        ) revert InvalidSignature();

        _resolveDispute(_escrowId, _creatorAmount, _beneficiaryAmount);
    }

    /// @notice Starts a dispute. Can only be called by the platform.
    /// @param _platformSignature The platform signature.
    /// @param _escrowId The escrow id.
    function startDispute(
        Signature calldata _platformSignature,
        uint256 _escrowId
    ) external onlyExists(_escrowId) onlySigner(_recoverSigner(_platformSignature, _startDisputeDigest(_escrowId))) {
        if (_escrow[_escrowId].allowPlatformResolutionTimestamp != 0) revert AlreadyStarted();

        _escrow[_escrowId].allowPlatformResolutionTimestamp = uint48(block.timestamp) + platformResolutionTimeout;

        emit DisputeStarted(_escrowId, _escrow[_escrowId].allowPlatformResolutionTimestamp);
    }

    /// @notice Resolves a dispute. Can only be called by the platform. Note, the platform can only resolve a dispute after the platformResolutionTimeout has passed, and they must account for the entire amount. In future this should be replaced by a dao vote.
    /// @param _platformSignature The platform signature.
    /// @param _escrowId The escrow id.
    /// @param _creatorAmount The creator amount.
    /// @param _beneficiaryAmount The beneficiary amount.
    function resolveDispute(
        Signature calldata _platformSignature,
        uint256 _escrowId,
        uint256 _creatorAmount,
        uint256 _beneficiaryAmount
    )
        external
        onlyExists(_escrowId)
        onlySigner(
            _recoverSigner(_platformSignature, _resolveDisputeDigest(_escrowId, _creatorAmount, _beneficiaryAmount))
        )
    {
        if (
            _escrow[_escrowId].allowPlatformResolutionTimestamp == 0 ||
            _escrow[_escrowId].allowPlatformResolutionTimestamp > block.timestamp
        ) revert CannotResolveYet();

        _resolveDispute(_escrowId, _creatorAmount, _beneficiaryAmount);
    }

    // #######################################################################################

    /// @notice Gets the elected wallet for a non EVM supported chain address.
    function getElectedAddress(bytes32 _nonEvmAddress) external view returns (address) {
        return _electedAddresses[_nonEvmAddress];
    }

    /// @notice Gets the escrow data for a given escrow id.
    function getEscrow(uint256 _escrowId) external view returns (Escrow memory) {
        return _escrow[_escrowId];
    }

    // #######################################################################################

    /// @notice Sets the treasury. Note, this can only be called by the owner.
    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
    }

    /// @notice Sets the signer. Note, this can only be called by the owner.
    function setPlatformSigner(address _signer) external onlyOwner {
        platformSigner = _signer;
    }

    /// @notice Sets the platform resolution timeout. Note, this can only be called by the owner.
    function setPlatformResolutionTimeout(uint48 _duration) external onlyOwner {
        platformResolutionTimeout = _duration;
    }

    // #######################################################################################

    function _custodyUSDC(
        Amounts calldata _amounts,
        bytes calldata _signature,
        address _from,
        uint256 _deadline
    ) private {
        uint256 _amount = _amounts.escrow + _amounts.serviceFee;

        USDC.permit(_from, address(this), _amount, _deadline, _signature);
        SafeERC20.safeTransferFrom(USDC, _from, address(this), _amounts.escrow);
        SafeERC20.safeTransferFrom(USDC, _from, treasury, _amounts.serviceFee);
    }

    function _resolveDispute(uint256 _escrowId, uint256 _creatorAmount, uint256 _beneficiaryAmount) private {
        if (_creatorAmount + _beneficiaryAmount != _escrow[_escrowId].amount) revert InvalidResolution();

        _escrow[_escrowId].amount = 0;

        if (_creatorAmount > 0) _transferToCreator(_escrowId, _creatorAmount);
        if (_beneficiaryAmount > 0) _transferToBeneficiary(_escrowId, _beneficiaryAmount);

        emit DisputeResolved(_escrowId, _creatorAmount, _beneficiaryAmount);
    }

    function _releaseEscrow(uint256 _escrowId, uint256 _amount) private {
        _escrow[_escrowId].amount -= _amount;
        _transferToBeneficiary(_escrowId, _amount);
    }

    function _transferToCreator(uint256 _escrowId, uint256 _amount) private {
        SafeERC20.safeTransfer(USDC, _escrow[_escrowId].creator, _amount);

        emit EscrowRefunded(_escrowId, _amount);
    }

    function _transferToBeneficiary(uint256 _escrowId, uint256 _amount) private {
        uint64 messageSequence = 0;

        if (_escrow[_escrowId].wormholeChainId == WORMHOLE_CHAIN_ID) {
            SafeERC20.safeTransfer(USDC, _bytes32ToAddress(_escrow[_escrowId].beneficiary), _amount);
        } else {
            uint256 fee = WORMHOLE.relayerFee(_escrow[_escrowId].wormholeChainId, address(USDC));

            if (fee > 0) {
                SafeERC20.safeTransferFrom(USDC, treasury, address(this), fee);
                emit BridgeFeePaid(_escrowId, fee);
            }

            USDC.approve(address(WORMHOLE), _amount + fee);
            messageSequence = WORMHOLE.transferTokensWithRelay(
                USDC,
                _amount + fee,
                0,
                _escrow[_escrowId].wormholeChainId,
                _escrow[_escrowId].beneficiary
            );
        }

        emit EscrowReleased(_escrowId, _amount, messageSequence);
    }

    function _updateBeneficiary(uint256 _escrowId, uint16 _wormholeChainId, bytes32 _beneficiary) private {
        if (_wormholeChainId != WORMHOLE_CHAIN_ID && WORMHOLE.getRegisteredContract(_wormholeChainId) == bytes32(0))
            revert WormholeNotRegistered();

        _escrow[_escrowId].wormholeChainId = _wormholeChainId;
        _escrow[_escrowId].beneficiary = _beneficiary;

        emit BeneficiaryUpdated(_escrowId, _wormholeChainId, _beneficiary);
    }

    function _getBeneficiaryAddress(bytes32 _beneficiary) private view returns (address) {
        return
            _electedAddresses[_beneficiary] == address(0)
                ? _bytes32ToAddress(_beneficiary)
                : _electedAddresses[_beneficiary];
    }

    function _recoverSigner(Signature calldata _signature, bytes32 _digest) private view returns (address) {
        return ECDSA.recover(_hashTypedDataV4(_digest), _signature.v, _signature.r, _signature.s);
    }

    function _bytes32ToAddress(bytes32 _input) private pure returns (address) {
        for (uint8 i = 0; i < 12; i++) {
            if (_input[i] != 0) revert InvalidAddress();
        }

        return address(uint160(uint256(_input)));
    }
}
