// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {Counters} from "@openzeppelin/contracts/utils/Counters.sol";

import {IKnowledgeLayerID} from "./interfaces/IKnowledgeLayerID.sol";
import {IKnowledgeLayerCourse} from "./interfaces/IKnowledgeLayerCourse.sol";

contract KnowledgeLayerEscrow is Context {
    using Counters for Counters.Counter;

    /**
     * @notice Transaction struct
     * @param id Id of the transaction
     * @param sender The party paying the escrow amount
     * @param receiver The intended receiver of the escrow amount
     * @param amount The amount of the transaction EXCLUDING FEES
     * @param courseId The ID of the associated course
     */
    struct Transaction {
        uint256 id;
        address sender;
        address receiver;
        uint256 amount;
        uint256 courseId;
        // protocolFee;
        // originFee;
        // buyFee;
    }

    // Transaction id to transaction
    mapping(uint256 => Transaction) private transactions;

    // Transaction id counter
    Counters.Counter nextTransactionId;

    // KnowledgeLayerID contract
    IKnowledgeLayerID private knowledgeLayerId;

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
    event TransactionCreated(uint256 id, address sender, address receiver, uint256 amount, uint256 courseId);

    // =========================== Constructor ==============================

    /**
     * @param _knowledgeLayerIdAddress Address of the KnowledgeLayerID contract
     */
    constructor(address _knowledgeLayerIdAddress, address _knowledgeLayerCourseAddress) {
        knowledgeLayerId = IKnowledgeLayerID(_knowledgeLayerIdAddress);
        knowledgeLayerCourse = IKnowledgeLayerCourse(_knowledgeLayerCourseAddress);
        nextTransactionId.increment();
    }

    // =========================== User functions ==============================

    function createTransaction(uint256 _profileId, uint256 _courseId) external payable returns (uint256) {
        IKnowledgeLayerCourse.Course memory course = knowledgeLayerCourse.getCourse(_courseId);
        (address sender, address receiver) = knowledgeLayerId.ownersOf(_profileId, course.ownerId);

        require(sender == _msgSender(), "Not the owner");
        require(msg.value == course.price, "Not enough ETH sent");

        uint256 id = nextTransactionId.current();
        nextTransactionId.increment();
        transactions[id] = Transaction({
            id: id,
            sender: sender,
            receiver: receiver,
            amount: course.price,
            courseId: _courseId
        });

        knowledgeLayerCourse.buyCourse(_profileId, _courseId);

        emit TransactionCreated(id, sender, receiver, course.price, _courseId);

        return id;
    }
}
