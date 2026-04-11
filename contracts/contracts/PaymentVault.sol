// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract PaymentVault is AccessControl, Pausable, ReentrancyGuard {
    using Address for address payable;

    bytes32 public constant SETTLEMENT_ROLE = keccak256("SETTLEMENT_ROLE");
    uint256 public constant BPS_DENOMINATOR = 10_000;

    struct PaymentRequest {
        address payer;
        address payable merchant;
        uint256 amount;
        uint256 rwaAllocation;
        string track;
        bytes32 proofHash;
        bytes32 hspReference;
        bool settled;
        uint64 createdAt;
    }

    uint256 public nextRequestId;
    uint256 public rwaBasisPoints;
    address payable public rwaVault;

    mapping(uint256 => PaymentRequest) public paymentRequests;
    mapping(address => mapping(bytes32 => bool)) public approvedProofs;

    event PaymentRequested(
        uint256 indexed requestId,
        address indexed payer,
        address indexed merchant,
        uint256 amount,
        string track
    );
    event PaymentSettled(address indexed merchant, uint256 amount, string track);
    event RwaAllocationTransferred(uint256 indexed requestId, address indexed vault, uint256 amount);
    event HspSettlementRecorded(uint256 indexed requestId, bytes32 indexed hspReference);
    event MockProofRegistered(address indexed payer, bytes32 indexed proofHash);

    constructor(address admin, address payable vault, uint256 rwaBps) {
        require(admin != address(0), "SentinelPay: invalid admin");
        require(vault != address(0), "SentinelPay: invalid vault");
        require(rwaBps <= 3_000, "SentinelPay: rwa bps too high");

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(SETTLEMENT_ROLE, admin);

        rwaVault = vault;
        rwaBasisPoints = rwaBps;
    }

    function registerMockProof(address payer, bytes32 proofHash) external onlyRole(SETTLEMENT_ROLE) {
        require(payer != address(0), "SentinelPay: invalid payer");
        require(proofHash != bytes32(0), "SentinelPay: empty proof");

        approvedProofs[payer][proofHash] = true;
        emit MockProofRegistered(payer, proofHash);
    }

    function requestPayment(
        address payable merchant,
        uint256 amount,
        string calldata track,
        bytes32 proofHash
    ) public whenNotPaused returns (uint256 requestId) {
        require(merchant != address(0), "SentinelPay: invalid merchant");
        require(amount > 0, "SentinelPay: amount required");
        _requireValidProof(msg.sender, proofHash);

        requestId = nextRequestId++;
        uint256 rwaAllocation = (amount * rwaBasisPoints) / BPS_DENOMINATOR;

        paymentRequests[requestId] = PaymentRequest({
            payer: msg.sender,
            merchant: merchant,
            amount: amount,
            rwaAllocation: rwaAllocation,
            track: track,
            proofHash: proofHash,
            hspReference: bytes32(0),
            settled: false,
            createdAt: uint64(block.timestamp)
        });

        emit PaymentRequested(requestId, msg.sender, merchant, amount, track);
    }

    function settleWithRWA(uint256 requestId, bytes32 hspReference) public payable nonReentrant whenNotPaused {
        _settleRecordedRequest(requestId, hspReference, msg.value);
    }

    function _settleRecordedRequest(uint256 requestId, bytes32 hspReference, uint256 paymentAmount) internal {
        PaymentRequest storage request = paymentRequests[requestId];

        require(request.amount > 0, "SentinelPay: request not found");
        require(!request.settled, "SentinelPay: already settled");
        require(paymentAmount == request.amount, "SentinelPay: incorrect HSK amount");

        request.settled = true;
        request.hspReference = hspReference;

        _distributeFunds(requestId, request.merchant, paymentAmount, request.rwaAllocation, request.track);

        emit HspSettlementRecorded(requestId, hspReference);
        emit PaymentSettled(request.merchant, paymentAmount, request.track);
    }

    function setRwaVault(address payable newVault) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newVault != address(0), "SentinelPay: invalid vault");
        rwaVault = newVault;
    }

    function setRwaBasisPoints(uint256 newBasisPoints) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newBasisPoints <= 3_000, "SentinelPay: rwa bps too high");
        rwaBasisPoints = newBasisPoints;
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function _distributeFunds(
        uint256 requestId,
        address payable merchant,
        uint256 grossAmount,
        uint256 rwaAllocation,
        string memory track
    ) internal {
        uint256 merchantAmount = grossAmount - rwaAllocation;

        if (merchantAmount > 0) {
            merchant.sendValue(merchantAmount);
        }

        if (rwaAllocation > 0) {
            rwaVault.sendValue(rwaAllocation);
            emit RwaAllocationTransferred(requestId, rwaVault, rwaAllocation);
        }

        if (bytes(track).length == 0) {
            revert("SentinelPay: track required");
        }
    }

    function _requireValidProof(address payer, bytes32 proofHash) internal view {
        require(_isProofValid(payer, proofHash), "SentinelPay: invalid NexaID proof");
    }

    function _isProofValid(address payer, bytes32 proofHash) internal view returns (bool) {
        if (proofHash == bytes32(0)) {
            return false;
        }

        bytes32 deterministicProof = keccak256(abi.encodePacked("NEXAID_VERIFIED", payer));
        return approvedProofs[payer][proofHash] || proofHash == deterministicProof;
    }
}
