// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

import { IUSDC } from "./interfaces/IUSDC.sol";
import { IWormholeRelayer } from "./interfaces/IWormholeRelayer.sol";
import { Escrow, Amounts, Signature } from "./lib/Structs.sol";

/**
 * @title CrossChainEscrow
 * @author @builtbyfrancis
 * @notice A cross chain escrow contract that allows for the creation of USDC escrows on one chain and the release on another chain.
 * Makes use of the wormhole protocol which in turn uses CCTP for cross chain communication.
 */
contract CrossChainEscrow is Ownable {
    error WormholeNotRegistered();
    error EscrowDoesNotExist();
    error UnauthorizedSender();
    error InvalidResolution();
    error InvalidSignature();
    error CannotResolveYet();
    error AlreadyStarted();
    error InvalidAddress();

    // #######################################################################################

    event EscrowCreated(
        uint256 indexed escrow_id,
        bytes32 indexed escrow_reference,
        address indexed creator,
        uint16 wormhole_chain_id,
        bytes32 benificiary,
        uint256 amount,
        uint256 serviceFee
    );

    event EscrowIncreased(uint256 indexed escrow_id, uint256 amount, uint256 serviceFee);

    event EscrowReleased(uint256 indexed escrow_id, uint256 amount, uint64 wormholeMessageSequence);
    event EscrowRefunded(uint256 indexed escrow_id, uint256 amount);

    event SignerElected(bytes32 indexed nonEvmSigner, address electedSigner);
    event BridgeFeePaid(uint256 indexed escrow_id, uint256 amount);

    event DisputeStarted(uint256 indexed escrow_id, uint48 resolution_timestamp);
    event DisputeResolved(uint256 indexed escrow_id, uint256 creatorAmount, uint256 benificiaryAmount);

    // #######################################################################################

    /// @notice The typehash for the EIP712 domain struct.
    bytes32 public constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    /// @notice The typehash for the create escrow struct.
    bytes32 public constant CREATE_TYPEHASH =
        keccak256(
            "CreateEscrow(bytes32 escrowReference,address creator,uint16 wormholeChainId,bytes32 beneficiary,uint256 amount,uint256 serviceFee,uint256 nonce)"
        );

    /// @notice The typehash for the increase escrow struct.
    bytes32 public constant INCREASE_TYPEHASH =
        keccak256("IncreaseEscrow(uint256 escrowId,uint256 amount,uint256 serviceFee,uint256 nonce)");

    /// @notice The typehash for the release escrow struct.
    bytes32 public constant RELEASE_TYPEHASH =
        keccak256("ReleaseEscrow(uint256 escrowId,uint256 amount,uint256 nonce)");

    /// @notice The typehash for the elected signer struct.
    bytes32 public constant ELECTED_SIGNER_TYPEHASH =
        keccak256("ElectedSigner(bytes32 nonEvmSigner,address electedSigner,uint256 nonce)");

    /// @notice The typehash for the resolve amicably struct.
    bytes32 public constant RESOLVE_AMICABLY_TYPEHASH = keccak256("ResolveAmicably(uint256 escrowId,uint256 amount)");

    /// @notice The typehash for the start dispute struct.
    bytes32 public constant START_DISPUTE_TYPEHASH = keccak256("StartDispute(uint256 escrowId,uint256 nonce)");

    /// @notice The typehash for the resolve dispute struct.
    bytes32 public constant RESOLVE_DISPUTE_TYPEHASH =
        keccak256("ResolveDispute(uint256 escrowId,uint256 creatorAmount,uint256 benificiaryAmount,uint256 nonce)");

    /// @notice The domain separator for the contract.
    bytes32 public immutable DOMAIN_SEPARATOR;

    /// @notice The usdc address on this chain
    IUSDC public immutable USDC;

    /// @notice The wormhole relayer address on this chain
    IWormholeRelayer public immutable WORMHOLE;

    /// @notice The wormhole issued chain id for this chain.
    uint16 public immutable WORMHOLE_CHAIN_ID;

    // #######################################################################################

    /// @notice The next escrow id.
    uint256 public nextEscrowId;

    /// @notice The platform owned signer address.
    address public signer;

    /// @notice The platform owned treasury address.
    address public treasury;

    /// @notice The duration in seconds after which a dispute can be resolved by the platform.
    uint48 public platformResolutionTimeout;

    /// @notice A mapping between the address and the signature nonce for the address. Used by the platform relayers.
    mapping(address => uint256) private _nonces;

    /// @notice A mapping between the escrow id and escrow data.
    mapping(uint256 => Escrow) private _escrow;

    /// @notice A mapping between the escrow id and the elected signer address for non evm support.
    mapping(bytes32 => address) private _electedSigners;

    // #######################################################################################

    constructor(IUSDC _usdc, address _signer, address _treasury) Ownable(msg.sender) {
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(DOMAIN_TYPEHASH, keccak256("Escrow"), keccak256("1"), block.chainid, address(this))
        );

        USDC = _usdc;

        signer = _signer;
        treasury = _treasury;
        platformResolutionTimeout = 3 days;
    }

    // #######################################################################################

    modifier onlySigner(address _sender) {
        if (signer != _sender) revert UnauthorizedSender();
        _;
    }

    modifier onlyCreator(uint256 _escrowId, address _sender) {
        if (_escrow[_escrowId].creator != _sender) revert UnauthorizedSender();
        _;
    }

    modifier onlyExists(uint256 _escrowId) {
        if (_escrow[_escrowId].creator == address(0)) revert EscrowDoesNotExist();
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
        bytes memory _signature,
        uint256 _deadline
    )
        external
        onlySigner(
            _noncedRecoverSigner(
                _platformSignature,
                keccak256(
                    abi.encode(
                        CREATE_TYPEHASH,
                        _escrowReference,
                        _creator,
                        _wormholeChainId,
                        _beneficiary,
                        _amounts.escrow,
                        _amounts.serviceFee,
                        _nonces[msg.sender]
                    )
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
            benificiary: _beneficiary
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
        bytes memory _signature,
        uint256 _deadline
    )
        external
        onlyExists(_escrowId)
        onlySigner(
            _noncedRecoverSigner(
                _platformSignature,
                keccak256(
                    abi.encode(INCREASE_TYPEHASH, _escrowId, _amounts.escrow, _amounts.serviceFee, _nonces[msg.sender])
                )
            )
        )
    {
        _escrow[_escrowId].amount += _amounts.escrow;
        _custodyUSDC(_amounts, _signature, _escrow[_escrowId].creator, _deadline);

        emit EscrowIncreased(_escrowId, _amounts.escrow, _amounts.serviceFee);
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
        onlyCreator(
            _escrowId,
            _noncedRecoverSigner(
                _creatorSignature,
                keccak256(abi.encode(RELEASE_TYPEHASH, _escrowId, _amount, _nonces[msg.sender]))
            )
        )
    {
        _releaseEscrow(_escrowId, _amount);
    }

    /// @notice Elects a signer for a non evm supported chain.
    /// @param _platformSignature The platform signature.
    /// @param _nonEvmSigner The non evm signer address.
    /// @param _electedSigner The elected signer address.
    function setElectedSigner(
        Signature calldata _platformSignature,
        bytes32 _nonEvmSigner,
        address _electedSigner
    )
        external
        onlySigner(
            _noncedRecoverSigner(
                _platformSignature,
                keccak256(abi.encode(ELECTED_SIGNER_TYPEHASH, _nonEvmSigner, _electedSigner, _nonces[msg.sender]))
            )
        )
    {
        _electedSigners[_nonEvmSigner] = _electedSigner;
        emit SignerElected(_nonEvmSigner, _electedSigner);
    }

    /// @notice Resolves a dispute amicably. Can be called by anyone but must satisfy two conditions. 1) Both the creator and benificiary must sign the resolution. 2) The amounts must add up to the escrow amount.
    /// @param _creatorSignature The creator signature.
    /// @param _benificiarySignature The benificiary signature.
    /// @param _escrowId The escrow id.
    /// @param _creatorAmount The creator amount.
    /// @param _benificiaryAmount The benificiary amount.
    function amicableResolution(
        Signature calldata _creatorSignature,
        Signature calldata _benificiarySignature,
        uint256 _escrowId,
        uint256 _creatorAmount,
        uint256 _benificiaryAmount
    ) external onlyExists(_escrowId) {
        if (
            _escrow[_escrowId].creator !=
            _recoverSigner(_creatorSignature, _getResolveAmicablyDigest(_escrowId, _creatorAmount))
        ) revert InvalidSignature();

        address _benificiary = _getBenificiaryAddress(_escrow[_escrowId].benificiary);
        if (
            _benificiary !=
            _recoverSigner(_benificiarySignature, _getResolveAmicablyDigest(_escrowId, _benificiaryAmount))
        ) revert InvalidSignature();

        _resolveDispute(_escrowId, _creatorAmount, _benificiaryAmount);
    }

    /// @notice Starts a dispute. Can only be called by the platform.
    /// @param _platformSignature The platform signature.
    /// @param _escrowId The escrow id.
    function startDispute(
        Signature calldata _platformSignature,
        uint256 _escrowId
    )
        external
        onlyExists(_escrowId)
        onlySigner(
            _noncedRecoverSigner(
                _platformSignature,
                keccak256(abi.encode(START_DISPUTE_TYPEHASH, _escrowId, _nonces[msg.sender]))
            )
        )
    {
        if (_escrow[_escrowId].allowPlatformResolutionTimestamp != 0) revert AlreadyStarted();

        _escrow[_escrowId].allowPlatformResolutionTimestamp = uint48(block.timestamp) + platformResolutionTimeout;

        emit DisputeStarted(_escrowId, _escrow[_escrowId].allowPlatformResolutionTimestamp);
    }

    /// @notice Resolves a dispute. Can only be called by the platform. Note, the platform can only resolve a dispute after the platformResolutionTimeout has passed, and they must account for the entire amount. In future this should be replaced by a dao vote.
    /// @param _platformSignature The platform signature.
    /// @param _escrowId The escrow id.
    /// @param _creatorAmount The creator amount.
    /// @param _benificiaryAmount The benificiary amount.
    function resolveDispute(
        Signature calldata _platformSignature,
        uint256 _escrowId,
        uint256 _creatorAmount,
        uint256 _benificiaryAmount
    )
        external
        onlyExists(_escrowId)
        onlySigner(
            _noncedRecoverSigner(
                _platformSignature,
                keccak256(
                    abi.encode(
                        RESOLVE_DISPUTE_TYPEHASH,
                        _escrowId,
                        _creatorAmount,
                        _benificiaryAmount,
                        _nonces[msg.sender]
                    )
                )
            )
        )
    {
        if (
            _escrow[_escrowId].allowPlatformResolutionTimestamp == 0 ||
            _escrow[_escrowId].allowPlatformResolutionTimestamp > block.timestamp
        ) revert CannotResolveYet();

        _resolveDispute(_escrowId, _creatorAmount, _benificiaryAmount);
    }

    // #######################################################################################

    /// @notice Gets the nonce for a given address.
    /// @param _for The address to get the nonce for.
    function getNonce(address _for) external view returns (uint256) {
        return _nonces[_for];
    }

    /// @notice Gets the elected signer for a non evm supported chain address.
    function getElectedSigner(bytes32 _nonEvmSigner) external view returns (address) {
        return _electedSigners[_nonEvmSigner];
    }

    function getEscrow(uint256 _escrowId) external view returns (Escrow memory) {
        return _escrow[_escrowId];
    }

    // #######################################################################################

    function setSigner(address _signer) external onlyOwner {
        signer = _signer;
    }

    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
    }

    function setResolutionTimeoutDuration(uint48 _duration) external onlyOwner {
        platformResolutionTimeout = _duration;
    }

    // #######################################################################################

    function _custodyUSDC(
        Amounts calldata _amounts,
        bytes memory _signature,
        address _from,
        uint256 _deadline
    ) private {
        uint256 _amount = _amounts.escrow + _amounts.serviceFee;

        USDC.permit(_from, address(this), _amount, _deadline, _signature);
        USDC.transferFrom(_from, address(this), _amounts.escrow);
        USDC.transferFrom(_from, treasury, _amounts.serviceFee);
    }

    function _resolveDispute(uint256 _escrowId, uint256 _creatorAmount, uint256 _benificiaryAmount) private {
        if (_creatorAmount + _benificiaryAmount != _escrow[_escrowId].amount) revert InvalidResolution();

        _escrow[_escrowId].amount = 0;

        if (_creatorAmount > 0) _transferToCreator(_escrowId, _creatorAmount);
        if (_benificiaryAmount > 0) _transferToBenificiary(_escrowId, _benificiaryAmount);

        emit DisputeResolved(_escrowId, _creatorAmount, _benificiaryAmount);
    }

    function _releaseEscrow(uint256 _escrowId, uint256 _amount) private {
        _escrow[_escrowId].amount -= _amount;
        _transferToBenificiary(_escrowId, _amount);
    }

    function _transferToCreator(uint256 _escrowId, uint256 _amount) private {
        USDC.transfer(_escrow[_escrowId].creator, _amount);

        emit EscrowRefunded(_escrowId, _amount);
    }

    function _transferToBenificiary(uint256 _escrowId, uint256 _amount) private {
        uint64 messageSequence = 0;

        if (_escrow[_escrowId].wormholeChainId == WORMHOLE_CHAIN_ID) {
            USDC.transfer(_bytes32ToAddress(_escrow[_escrowId].benificiary), _amount);
        } else {
            uint256 fee = WORMHOLE.relayerFee(_escrow[_escrowId].wormholeChainId, address(USDC));

            if (fee > 0) {
                USDC.transferFrom(treasury, address(this), fee);
                USDC.approve(address(WORMHOLE), _amount + fee);

                emit BridgeFeePaid(_escrowId, fee);
            }

            messageSequence = WORMHOLE.transferTokensWithRelay(
                address(USDC),
                _amount + fee,
                _amount,
                _escrow[_escrowId].wormholeChainId,
                _escrow[_escrowId].benificiary
            );
        }

        emit EscrowReleased(_escrowId, _amount, messageSequence);
    }

    function _getBenificiaryAddress(bytes32 _benificiary) private view returns (address) {
        return
            _electedSigners[_benificiary] == address(0)
                ? _bytes32ToAddress(_benificiary)
                : _electedSigners[_benificiary];
    }

    function _noncedRecoverSigner(Signature calldata _signature, bytes32 _digest) private returns (address) {
        unchecked {
            _nonces[msg.sender]++;
        }

        return ecrecover(_digest, _signature.v, _signature.r, _signature.s);
    }

    function _recoverSigner(Signature calldata _signature, bytes32 _digest) private pure returns (address) {
        return ecrecover(_digest, _signature.v, _signature.r, _signature.s);
    }

    function _getResolveAmicablyDigest(uint256 _escrowId, uint256 _amount) private pure returns (bytes32) {
        return keccak256(abi.encode(RESOLVE_AMICABLY_TYPEHASH, _escrowId, _amount));
    }

    function _bytes32ToAddress(bytes32 _input) private pure returns (address) {
        for (uint8 i = 0; i < 12; i++) {
            if (_input[i] != 0) revert InvalidAddress();
        }

        return address(uint160(uint256(_input)));
    }
}
