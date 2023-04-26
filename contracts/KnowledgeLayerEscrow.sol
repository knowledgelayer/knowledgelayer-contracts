// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import {Counters} from "@openzeppelin/contracts/utils/Counters.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {IKnowledgeLayerID} from "./interfaces/IKnowledgeLayerID.sol";
import {IKnowledgeLayerPlatformID} from "./interfaces/IKnowledgeLayerPlatformID.sol";
import {IKnowledgeLayerCourse} from "./interfaces/IKnowledgeLayerCourse.sol";

contract KnowledgeLayerEscrow is Ownable {
    using Counters for Counters.Counter;

    /**
     * @notice Transaction struct
     * @param id Id of the transaction
     * @param sender The party paying the escrow amount
     * @param receiver The intended receiver of the escrow amount
     * @param amount The amount of the transaction EXCLUDING FEES
     * @param courseId The ID of the associated course
     * @param buyPlatformId The ID of the platform where the course is being bought
     * @param protocolFee The % fee (per ten thousands) to be paid to the protocol
     * @param originFee The % fee (per ten thousands) to be paid to the platform where the course was created
     * @param buyFee The % fee (per ten thousands) to be paid to the platform where the course is being bought
     */
    struct Transaction {
        uint256 id;
        address sender;
        address receiver;
        uint256 amount;
        uint256 courseId;
        uint256 buyPlatformId;
        uint16 protocolFee;
        uint16 originFee;
        uint16 buyFee;
    }

    // Divider used for fees
    uint16 private constant FEE_DIVIDER = 10000;

    // Index used to represent protocol where platform id is used
    uint8 private constant PROTOCOL_INDEX = 0;

    // Transaction id to transaction
    mapping(uint256 => Transaction) private transactions;

    // Transaction id counter
    Counters.Counter nextTransactionId;

    // Protocol fee per sale (percentage per 10,000, upgradable)
    uint16 public protocolFee;

    // Platform id to balance accumulated for fees
    mapping(uint256 => uint256) public platformBalance;

    // KnowledgeLayerID contract
    IKnowledgeLayerID private knowledgeLayerId;

    // KnowledgeLayerPlatformID contract
    IKnowledgeLayerPlatformID private knowledgeLayerPlatformId;

    // KnowledgeLayerCourse contract
    IKnowledgeLayerCourse private knowledgeLayerCourse;

    // =========================== Events ==============================

    /**
     * @notice Emitted when a transaction is created
     * @param id Id of the transaction
     * @param sender The party paying the escrow amount
     * @param receiver The intended receiver of the escrow amount
     * @param amount The amount of the transaction EXCLUDING FEES
     * @param courseId The ID of the associated course
     */
    event TransactionCreated(
        uint256 id,
        address sender,
        address receiver,
        uint256 amount,
        uint256 courseId,
        uint16 protocolFee,
        uint16 originFee,
        uint16 buyFee
    );

    /**
     * @dev Emitted when the protocol fee is updated
     */
    event ProtocolFeeUpdated(uint256 fee);

    // =========================== Modifiers ==============================

    /**
     * @notice Check if the given address is either the owner of the delegate of the given user
     * @param _profileId The TalentLayer ID of the user
     */
    modifier onlyOwnerOrDelegate(uint256 _profileId) {
        require(knowledgeLayerId.isOwnerOrDelegate(_profileId, _msgSender()), "Not owner or delegate");
        _;
    }

    // =========================== Constructor ==============================

    /**
     * @param _knowledgeLayerIdAddress Address of the KnowledgeLayerID contract
     */
    constructor(
        address _knowledgeLayerIdAddress,
        address _knowledgeLayerPlatformIdAddress,
        address _knowledgeLayerCourseAddress
    ) {
        knowledgeLayerId = IKnowledgeLayerID(_knowledgeLayerIdAddress);
        knowledgeLayerPlatformId = IKnowledgeLayerPlatformID(_knowledgeLayerPlatformIdAddress);
        knowledgeLayerCourse = IKnowledgeLayerCourse(_knowledgeLayerCourseAddress);
        nextTransactionId.increment();

        setProtocolFee(100);
    }

    // =========================== User functions ==============================

    function createTransaction(
        uint256 _profileId,
        uint256 _courseId,
        uint256 _platformId
    ) external payable returns (uint256) {
        IKnowledgeLayerCourse.Course memory course = knowledgeLayerCourse.getCourse(_courseId);
        (address sender, address receiver) = knowledgeLayerId.ownersOf(_profileId, course.ownerId);

        require(sender == _msgSender(), "Not the owner");

        IKnowledgeLayerPlatformID.Platform memory originPlatform = knowledgeLayerPlatformId.getPlatform(
            course.platformId
        );
        IKnowledgeLayerPlatformID.Platform memory buyPlatform = course.platformId != _platformId
            ? knowledgeLayerPlatformId.getPlatform(_platformId)
            : originPlatform;
        uint256 totalAmount = _getAmountWithFees(course.price, originPlatform.originFee, buyPlatform.buyFee);

        require(msg.value == totalAmount, "Not enough ETH sent");

        uint256 id = nextTransactionId.current();

        nextTransactionId.increment();
        transactions[id] = Transaction({
            id: id,
            sender: sender,
            receiver: receiver,
            amount: course.price,
            courseId: _courseId,
            buyPlatformId: _platformId,
            protocolFee: protocolFee,
            originFee: originPlatform.originFee,
            buyFee: buyPlatform.buyFee
        });

        knowledgeLayerCourse.buyCourse(_profileId, _courseId);

        emit TransactionCreated(
            id,
            sender,
            receiver,
            course.price,
            _courseId,
            protocolFee,
            originPlatform.originFee,
            buyPlatform.buyFee
        );

        return id;
    }

    function release(uint256 _profileId, uint256 _transactionId) public onlyOwnerOrDelegate(_profileId) {
        require(_transactionId < nextTransactionId.current(), "Invalid transaction id");
        Transaction memory transaction = transactions[_transactionId];

        require(transaction.receiver == knowledgeLayerId.ownerOf(_profileId), "Not the receiver");

        _distributeFees(_transactionId);

        transaction.receiver.call{value: transaction.amount}("");
    }

    // =========================== Owner functions ==============================

    /**
     * @dev Sets the protocol fee per sale
     * @param _protocolFee Protocol fee per sale (percentage per 10,000)
     */
    function setProtocolFee(uint16 _protocolFee) public onlyOwner {
        protocolFee = _protocolFee;

        emit ProtocolFeeUpdated(_protocolFee);
    }

    // =========================== Private functions ==============================

    function _getAmountWithFees(
        uint256 _amount,
        uint16 _originFee,
        uint16 _buyFee
    ) private view returns (uint256 totalEscrowAmount) {
        return _amount + ((_amount * (protocolFee + _originFee + _buyFee)) / FEE_DIVIDER);
    }

    function _distributeFees(uint256 _transactionId) private {
        Transaction storage transaction = transactions[_transactionId];
        IKnowledgeLayerCourse.Course memory course = knowledgeLayerCourse.getCourse(transaction.courseId);

        uint256 protocolFeeAmount = (transaction.protocolFee * transaction.amount) / FEE_DIVIDER;
        uint256 originFeeAmount = (transaction.originFee * transaction.amount) / FEE_DIVIDER;
        uint256 buyFeeAmount = (transaction.buyFee * transaction.amount) / FEE_DIVIDER;

        platformBalance[PROTOCOL_INDEX] += protocolFeeAmount;
        platformBalance[course.platformId] += originFeeAmount;
        platformBalance[transaction.buyPlatformId] += buyFeeAmount;
    }
}
