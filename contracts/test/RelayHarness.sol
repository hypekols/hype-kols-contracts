// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

import { Relay } from "../lib/Relay.sol";

contract RelayHarness is Relay {
    error TestError();

    event Sender(address sender);
    event Data(bytes data);

    mapping(address => uint256) testSetter;

    constructor() Ownable(msg.sender) EIP712("RelayHarness", "1") {}

    function getValue(address _account) external view returns (uint256) {
        return testSetter[_account];
    }

    function setValue(uint256 _value) external {
        testSetter[_msgSender()] = _value;
    }

    function addValue(uint256 _value) external {
        testSetter[_msgSender()] += _value;
    }

    function emitSender() external {
        emit Sender(_msgSender());
    }

    function emitData() external {
        emit Data(_msgData());
    }

    function revertWithError() external pure {
        revert TestError();
    }

    function offsetNonce(address _account, uint256 _amount) external {
        for (uint256 i = 0; i < _amount; i++) {
            _useNonce(_account);
        }
    }
}
