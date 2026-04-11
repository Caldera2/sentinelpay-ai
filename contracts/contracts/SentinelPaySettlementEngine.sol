// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PaymentVault} from "./PaymentVault.sol";

contract SentinelPaySettlementEngine is PaymentVault {
    constructor(address admin, address payable vault, uint256 rwaBps) PaymentVault(admin, vault, rwaBps) {}

    function processPayment(
        address payable merchant,
        bytes32 proofHash,
        string calldata track
    ) external payable returns (uint256 requestId) {
        require(msg.value > 0, "SentinelPay: HSK payment required");
        require(bytes(track).length > 0, "SentinelPay: track required");

        requestId = requestPayment(merchant, msg.value, track, proofHash);
        _settleRecordedRequest(requestId, keccak256(abi.encodePacked(block.chainid, requestId, msg.sender)), msg.value);
    }
}
