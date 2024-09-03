// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

import { IUSDC } from "./interfaces/IUSDC.sol";
import { IWormholeRelayer } from "./interfaces/IWormholeRelayer.sol";
import { Escrow, Amounts, Signature } from "./lib/Structs.sol";

/**
 * @title CrossChainEscrow
 * @author @builtbyfrancis
 */
contract CrossChainEscrow is Ownable {
    error WormholeNotRegistered();
    error EscrowDoesNotExist();
    error UnauthorizedSender();
    error InvalidResolution();
    error InvalidSignature();
    error CannotResolveYet();
    error TransferFailed();
    error AlreadyStarted();
    error EscrowIdTaken();

    // #######################################################################################

    event EscrowCreated(
        bytes32 indexed escrow_id,
        address indexed creator,
        uint16 wormhole_chain_id,
        bytes32 benificiary,
        uint256 amount,
        uint256 serviceFee
    );

    event EscrowIncreased(bytes32 indexed escrow_id, uint256 amount, uint256 serviceFee);

    event EscrowReleased(bytes32 indexed escrow_id, uint256 amount, uint64 wormholeMessageSequence);
    event EscrowRefunded(bytes32 indexed escrow_id, uint256 amount);

    event BridgeFeePaid(bytes32 indexed escrow_id, uint256 amount);

    event DisputeStarted(bytes32 indexed escrow_id, uint48 resolution_timestamp);
    event DisputeResolved(bytes32 indexed escrow_id, uint256 creatorAmount, uint256 benificiaryAmount);

    // #######################################################################################

    /// @notice The typehash for the EIP712 domain struct.
    bytes32 public constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    /// @notice The typehash for a release amount.
    bytes32 public constant RELEASE_AMOUNT_TYPEHASH =
        keccak256("ReleaseAmount(bytes32 escrow_id,uint256 amount,uint256 nonce)");

    /// @notice The typehash for a release amount.
    bytes32 public constant RESOLVE_AMOUNT_TYPEHASH = keccak256("ResolveAmount(bytes32 escrow_id,uint256 amount)");

    /// @notice The domain separator for the contract.
    bytes32 public immutable DOMAIN_SEPARATOR;

    /// @notice The usdc address on this chain
    IUSDC public immutable USDC;

    /// @notice The wormhole relayer address on this chain
    IWormholeRelayer public immutable WORMHOLE;

    /// @notice The wormhole issued chain id.
    uint16 public immutable WORMHOLE_CHAIN_ID;

    // #######################################################################################

    /// @notice The platform owned relayer address.
    address public relayer;

    /// @notice The platform owned treausry address.
    address public treasury;

    /// @notice The duration in seconds after which a dispute can be resolved by the platform.
    uint48 public resolution_timeout_duration;

    /// @notice A mapping between the address and the signature nonce for the address.
    mapping(address => uint256) private _nonces;

    /// @notice A mapping between the escrow id and common escrow data.
    mapping(bytes32 => Escrow) internal _escrow;

    // #######################################################################################

    constructor(IUSDC _usdc, address _relayer, address _treasury) Ownable(msg.sender) {
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(DOMAIN_TYPEHASH, keccak256("Escrow"), keccak256("1"), block.chainid, address(this))
        );

        USDC = _usdc;

        relayer = _relayer;
        treasury = _treasury;
        resolution_timeout_duration = 3 days;
    }

    // #######################################################################################

    modifier onlyRelayer() {
        if (relayer != msg.sender) revert UnauthorizedSender();
        _;
    }

    modifier onlyCreator(bytes32 _escrow_id, address _sender) {
        if (_escrow[_escrow_id].creator != _sender) revert UnauthorizedSender();
        _;
    }

    modifier onlyExists(bytes32 _escrow_id) {
        if (_escrow[_escrow_id].creator == address(0)) revert EscrowDoesNotExist();
        _;
    }

    // #######################################################################################

    function createEscrow(
        bytes32 _escrow_id,
        address _creator,
        uint16 _wormhole_chain_id,
        bytes32 _beneficiary,
        Amounts calldata _amounts,
        bytes memory _signature,
        uint256 _deadline
    ) external onlyRelayer {
        if (_escrow[_escrow_id].creator != address(0)) revert EscrowIdTaken();
        if (_wormhole_chain_id != WORMHOLE_CHAIN_ID && WORMHOLE.getRegisteredContract(_wormhole_chain_id) == bytes32(0))
            revert WormholeNotRegistered();

        _escrow[_escrow_id] = Escrow({
            amount: _amounts.escrow,
            creator: _creator,
            resolution_timestamp: 0,
            wormhole_chain_id: _wormhole_chain_id,
            benificiary: _beneficiary
        });

        _custodyUSDC(_amounts, _signature, _creator, _deadline);

        emit EscrowCreated(
            _escrow_id,
            _creator,
            _wormhole_chain_id,
            _beneficiary,
            _amounts.escrow,
            _amounts.serviceFee
        );
    }

    function increaseEscrow(
        bytes32 _escrow_id,
        Amounts calldata _amounts,
        bytes memory _signature,
        uint256 _deadline
    ) external onlyRelayer {
        _escrow[_escrow_id].amount += _amounts.escrow;
        _custodyUSDC(_amounts, _signature, _escrow[_escrow_id].creator, _deadline);

        emit EscrowIncreased(_escrow_id, _amounts.escrow, _amounts.serviceFee);
    }

    function releaseEscrow(
        bytes32 _escrow_id,
        uint256 _amount
    ) external onlyExists(_escrow_id) onlyCreator(_escrow_id, msg.sender) {
        _releaseEscrow(_escrow_id, _amount);
    }

    function relayedReleaseEscrow(
        Signature calldata _signature,
        bytes32 _escrow_id,
        uint256 _amount
    )
        external
        onlyRelayer
        onlyExists(_escrow_id)
        onlyCreator(_escrow_id, _getReleaseSigner(_signature, _escrow_id, _amount))
    {
        _releaseEscrow(_escrow_id, _amount);
    }

    function amicableResolution(
        bytes32 _escrow_id,
        Signature calldata _creatorSignature,
        Signature calldata _benificiarySignature,
        uint256 _creatorAmount,
        uint256 _benificiaryAmount
    ) external onlyExists(_escrow_id) {
        if (_escrow[_escrow_id].creator != _getResolveSigner(_creatorSignature, _escrow_id, _creatorAmount))
            revert InvalidSignature();

        address _benificiary = _bytes32ToAddress(_escrow[_escrow_id].benificiary);
        if (_benificiary != _getResolveSigner(_benificiarySignature, _escrow_id, _benificiaryAmount))
            revert InvalidSignature();

        _resolveEscrow(_escrow_id, _creatorAmount, _benificiaryAmount);
    }

    function startDispute(bytes32 _escrow_id) external onlyExists(_escrow_id) onlyRelayer {
        if (_escrow[_escrow_id].resolution_timestamp != 0) revert AlreadyStarted();

        _escrow[_escrow_id].resolution_timestamp = uint48(block.timestamp);

        emit DisputeStarted(_escrow_id, _escrow[_escrow_id].resolution_timestamp);
    }

    function resolveDispute(
        bytes32 _escrow_id,
        uint256 _creatorAmount,
        uint256 _benificiaryAmount
    ) external onlyExists(_escrow_id) onlyRelayer {
        if (_escrow[_escrow_id].resolution_timestamp == 0 || _escrow[_escrow_id].resolution_timestamp > block.timestamp)
            revert CannotResolveYet();

        _resolveEscrow(_escrow_id, _creatorAmount, _benificiaryAmount);

        emit DisputeResolved(_escrow_id, _creatorAmount, _benificiaryAmount);
    }

    // #######################################################################################

    function releaseAmountDigest(bytes32 _escrow_id, uint256 _amount) external view returns (bytes32) {
        return _releaseAmountDigest(_escrow_id, _amount);
    }

    function resolveAmountDigest(bytes32 _escrow_id, uint256 _amount) external pure returns (bytes32) {
        return _resolveAmountDigest(_escrow_id, _amount);
    }

    // #######################################################################################

    function setRelayer(address _relayer) external onlyOwner {
        relayer = _relayer;
    }

    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
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

    function _resolveEscrow(bytes32 _escrow_id, uint256 _creatorAmount, uint256 _benificiaryAmount) private {
        if (_creatorAmount + _benificiaryAmount != _escrow[_escrow_id].amount) revert InvalidResolution();

        _escrow[_escrow_id].amount = 0;

        if (_creatorAmount > 0) _transferToCreator(_escrow_id, _creatorAmount);
        if (_benificiaryAmount > 0) _transferToBenificiary(_escrow_id, _benificiaryAmount);
    }

    function _releaseEscrow(bytes32 _escrow_id, uint256 _amount) private {
        _escrow[_escrow_id].amount -= _amount;
        _transferToBenificiary(_escrow_id, _amount);
    }

    function _transferToCreator(bytes32 _escrow_id, uint256 _amount) private {
        USDC.transfer(_escrow[_escrow_id].creator, _amount);

        emit EscrowRefunded(_escrow_id, _amount);
    }

    function _transferToBenificiary(bytes32 _escrow_id, uint256 _amount) private {
        uint64 messageSequence = 0;

        if (_escrow[_escrow_id].wormhole_chain_id == WORMHOLE_CHAIN_ID) {
            USDC.transfer(_bytes32ToAddress(_escrow[_escrow_id].benificiary), _amount);
        } else {
            uint256 fee = WORMHOLE.relayerFee(_escrow[_escrow_id].wormhole_chain_id, address(USDC));

            if (fee > 0) {
                USDC.transferFrom(treasury, address(this), fee);
                USDC.approve(address(WORMHOLE), _amount + fee);

                emit BridgeFeePaid(_escrow_id, fee);
            }

            messageSequence = WORMHOLE.transferTokensWithRelay(
                address(USDC),
                _amount + fee,
                _amount,
                _escrow[_escrow_id].wormhole_chain_id,
                _escrow[_escrow_id].benificiary
            );
        }

        emit EscrowReleased(_escrow_id, _amount, messageSequence);
    }

    function _getReleaseSigner(
        Signature calldata _signature,
        bytes32 _escrow_id,
        uint256 _amount
    ) private returns (address signer) {
        signer = ecrecover(
            keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, _releaseAmountDigest(_escrow_id, _amount))),
            _signature.v,
            _signature.r,
            _signature.s
        );

        unchecked {
            _nonces[signer]++;
        }
    }

    function _getResolveSigner(
        Signature calldata _signature,
        bytes32 _escrow_id,
        uint256 _amount
    ) private view returns (address) {
        return
            ecrecover(
                keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, _resolveAmountDigest(_escrow_id, _amount))),
                _signature.v,
                _signature.r,
                _signature.s
            );
    }

    function _releaseAmountDigest(bytes32 _escrow_id, uint256 _amount) private view returns (bytes32) {
        return
            keccak256(abi.encode(RELEASE_AMOUNT_TYPEHASH, _escrow_id, _amount, _nonces[_escrow[_escrow_id].creator]));
    }

    function _resolveAmountDigest(bytes32 _escrow_id, uint256 _amount) private pure returns (bytes32) {
        return keccak256(abi.encode(RESOLVE_AMOUNT_TYPEHASH, _escrow_id, _amount));
    }

    function _bytes32ToAddress(bytes32 _input) private pure returns (address) {
        return address(uint160(uint256(_input)));
    }
}
