// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
interface ISettlementTarget {
    function processPayment(address payable merchant, bytes32 proofHash, string calldata track) external payable returns (uint256);
}
contract ReentrantMerchant {
    ISettlementTarget private immutable target;
    bytes32 private immutable proof;
    bool public attempted;
    bool public blocked;
    constructor(address engine, bytes32 approvedProof) { target = ISettlementTarget(engine); proof = approvedProof; }
    receive() external payable {
        if (!attempted) {
            attempted = true;
            try target.processPayment{value: 1}(payable(address(this)), proof, "PayFi") {} catch { blocked = true; }
        }
    }
}
