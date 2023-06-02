// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import {Counters} from "@openzeppelin/contracts/utils/Counters.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IKnowledgeLayerID} from "./interfaces/IKnowledgeLayerID.sol";
import {IKnowledgeLayerPlatformID} from "./interfaces/IKnowledgeLayerPlatformID.sol";
import {IKnowledgeLayerCourse} from "./interfaces/IKnowledgeLayerCourse.sol";
import {IArbitrable} from "./interfaces/IArbitrable.sol";
import {Arbitrator} from "./Arbitrator.sol";

contract KnowledgeLayerEscrow is Ownable, IArbitrable {
    using Counters for Counters.Counter;
    using SafeERC20 for IERC20;

    /**
     * @notice Payment type
     */
    enum PaymentType {
        Release,
        Reimburse
    }

    /**
     * @notice Arbitration fee payment type
     */
    enum ArbitrationFeePaymentType {
        Pay,
        Reimburse
    }

    /**
     * @notice Transation party type
     */
    enum Party {
        Sender,
        Receiver
    }

    /**
     * @notice Transaction status
     */
    enum TransactionStatus {
        NoDispute, // No dispute has arisen about the transaction
        WaitingSender, // Receiver has paid arbitration fee, while sender still has to do it
        WaitingReceiver, // Sender has paid arbitration fee, while receiver still has to do it
        DisputeCreated, // Both parties have paid the arbitration fee and a dispute has been created
        Resolved // The dispute has been resolved
    }

    /**
     * @notice Transaction struct
     * @param id Id of the transaction
     * @param sender The party paying the escrow amount
     * @param receiver The intended receiver of the escrow amount
     * @param token The token used for the transaction
     * @param amount The amount of the transaction EXCLUDING FEES
     * @param courseId The ID of the associated course
     * @param buyPlatformId The ID of the platform where the course is being bought
     * @param releasableAt The timestamp when the funds can be released to the receiver
     * @param protocolFee The % fee (per ten thousands) to be paid to the protocol
     * @param originFee The % fee (per ten thousands) to be paid to the platform where the course was created
     * @param buyFee The % fee (per ten thousands) to be paid to the platform where the course is being bought
     * @param status The status of the transaction
     * @param arbitrator The arbitrator of the transaction (address that can rule on disputes)
     * @param arbitratorExtraData Extra data to set up the arbitration.
     * @param arbitrationFeeTimeout Timeout for parties to pay the arbitration fee
     * @param disputeId The ID of the dispute, if it exists
     * @param senderFee Total fees paid by the sender for the dispute.
     * @param receiverFee Total fees paid by the receiver for the dispute.
     * @param lastInteraction Timestamp of last interaction for the dispute.
     */
    struct Transaction {
        uint256 id;
        address sender;
        address receiver;
        address token;
        uint256 amount;
        uint256 courseId;
        uint256 buyPlatformId;
        uint256 releasableAt;
        uint16 protocolFee;
        uint16 originFee;
        uint16 buyFee;
        TransactionStatus status;
        Arbitrator arbitrator;
        bytes arbitratorExtraData;
        uint256 arbitrationFeeTimeout;
        uint256 disputeId;
        uint256 senderFee;
        uint256 receiverFee;
        uint256 lastInteraction;
    }

    // Divider used for fees
    uint16 private constant FEE_DIVIDER = 10000;

    // Index used to represent protocol where platform id is used
    uint8 private constant PROTOCOL_INDEX = 0;

    // Amount of choices available for ruling the disputes
    uint8 constant AMOUNT_OF_CHOICES = 2;

    // Ruling id for sender winning the dispute
    uint8 constant SENDER_WINS = 1;

    // Ruling id for receiver winning the dispute
    uint8 constant RECEIVER_WINS = 2;

    // Transaction id to transaction
    mapping(uint256 => Transaction) private transactions;

    // Transaction id counter
    Counters.Counter nextTransactionId;

    // Protocol fee per sale (percentage per 10,000, upgradable)
    uint16 public protocolFee;

    // Platform id to balance accumulated for fees for each token
    mapping(uint256 => mapping(address => uint256)) public platformBalance;

    // Address which will receive the protocol fees
    address payable public protocolTreasuryAddress;

    // One-to-one relationship between the dispute and the transaction.
    mapping(uint256 => uint256) public disputeIDtoTransactionID;

    // KnowledgeLayerID contract
    IKnowledgeLayerID private knowledgeLayerId;

    // KnowledgeLayerPlatformID contract
    IKnowledgeLayerPlatformID private knowledgeLayerPlatformId;

    // KnowledgeLayerCourse contract
    IKnowledgeLayerCourse private knowledgeLayerCourse;

    // =========================== Events ==============================

    /**
     * @dev Emitted when a transaction is created
     */
    event TransactionCreated(
        uint256 id,
        uint256 senderId,
        uint256 receiverId,
        address token,
        uint256 amount,
        uint256 courseId,
        uint256 buyPlatformId,
        uint256 releasableAt,
        uint16 protocolFee,
        uint16 originFee,
        uint16 buyFee
    );

    /**
     * @dev Emitted when the protocol fee is updated
     */
    event ProtocolFeeUpdated(uint16 fee);

    /**
     * @dev Emitted when a payment is made for a transaction
     */
    event Payment(uint256 transactionId, PaymentType paymentType, uint256 amount);

    /**
     * @dev Emitted when an origin fee is released to a platform's balance
     */
    event OriginFeeReleased(uint256 platformId, uint256 courseId, address token, uint256 amount);

    /**
     * @dev Emitted when a buy fee is released to a platform's balance
     */
    event BuyFeeReleased(uint256 platformId, uint256 courseId, address token, uint256 amount);

    /**
     * @dev Emitted when a party has to pay a fee for the dispute or would otherwise be considered as losing.
     * @param _transactionId The id of the transaction.
     * @param _party The party who has to pay.
     */
    event HasToPayFee(uint256 indexed _transactionId, Party _party);

    /**
     * @dev Emitted when a ruling is executed.
     * @param _transactionId The id of the transaction.
     * @param _ruling The given ruling.
     */
    event RulingExecuted(uint256 indexed _transactionId, uint256 _ruling);

    /**
     * @dev Emitted when a party either pays the arbitration fee or gets it reimbursed.
     * @param _transactionId The id of the transaction.
     * @param _paymentType Whether the party paid or got reimbursed.
     * @param _party The party who has paid/got reimbursed the fee.
     * @param _amount The amount paid/reimbursed
     */
    event ArbitrationFeePayment(
        uint256 indexed _transactionId,
        ArbitrationFeePaymentType _paymentType,
        Party _party,
        uint256 _amount
    );

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
     * @param _knowledgeLayerPlatformIdAddress Address of the KnowledgeLayerPlatformID contract
     * @param _knowledgeLayerCourseAddress Address of the KnowledgeLayerCourse contract
     * @param _protocolTreasuryAddress Address which will receive the protocol fees
     */
    constructor(
        address _knowledgeLayerIdAddress,
        address _knowledgeLayerPlatformIdAddress,
        address _knowledgeLayerCourseAddress,
        address _protocolTreasuryAddress
    ) {
        knowledgeLayerId = IKnowledgeLayerID(_knowledgeLayerIdAddress);
        knowledgeLayerPlatformId = IKnowledgeLayerPlatformID(_knowledgeLayerPlatformIdAddress);
        knowledgeLayerCourse = IKnowledgeLayerCourse(_knowledgeLayerCourseAddress);
        nextTransactionId.increment();
        protocolTreasuryAddress = payable(_protocolTreasuryAddress);

        setProtocolFee(100);
    }

    // =========================== View functions ==============================

    /**
     * @dev Returns the details of a transaction. Only the transaction sender or receiver can call this function
     * @param _transactionId Id of the transaction
     */
    function getTransaction(uint256 _transactionId) external view returns (Transaction memory) {
        require(_transactionId < nextTransactionId.current(), "Invalid transaction id");
        Transaction memory transaction = transactions[_transactionId];

        address sender = _msgSender();
        require(
            sender == transaction.sender || sender == transaction.receiver,
            "You are not related to this transaction"
        );
        return transaction;
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

        if (course.token == address(0)) {
            require(msg.value == totalAmount, "Non-matching funds");
        } else {
            require(msg.value == 0, "Non-matching funds");
        }

        uint256 id = nextTransactionId.current();
        uint256 releasableAt = block.timestamp + course.disputePeriod;

        nextTransactionId.increment();
        transactions[id] = Transaction({
            id: id,
            sender: sender,
            receiver: receiver,
            token: course.token,
            amount: course.price,
            courseId: _courseId,
            buyPlatformId: _platformId,
            releasableAt: releasableAt,
            protocolFee: protocolFee,
            originFee: originPlatform.originFee,
            buyFee: buyPlatform.buyFee,
            status: TransactionStatus.NoDispute,
            arbitrator: originPlatform.arbitrator,
            arbitratorExtraData: originPlatform.arbitratorExtraData,
            arbitrationFeeTimeout: originPlatform.arbitrationFeeTimeout,
            disputeId: 0,
            senderFee: 0,
            receiverFee: 0,
            lastInteraction: block.timestamp
        });

        if (course.token != address(0)) {
            IERC20(course.token).safeTransferFrom(sender, address(this), totalAmount);
        }

        knowledgeLayerCourse.buyCourse(_profileId, _courseId);

        _afterCreateTransaction(id, _profileId, course.ownerId);

        return id;
    }

    /**
     * @notice Allows the receiver to release the transaction value locked in the escrow.
     * @param _profileId The KnowledgeLayer ID of the user
     * @param _transactionId Id of the transaction.
     */
    function release(uint256 _profileId, uint256 _transactionId) public onlyOwnerOrDelegate(_profileId) {
        require(_transactionId < nextTransactionId.current(), "Invalid transaction id");
        Transaction memory transaction = transactions[_transactionId];

        require(transaction.receiver == knowledgeLayerId.ownerOf(_profileId), "Not the receiver");
        require(transaction.status == TransactionStatus.NoDispute, "Transaction is in dispute");
        require(block.timestamp >= transaction.releasableAt, "Not yet releasable");

        _release(_transactionId, transaction.amount);
    }

    /**
     * @notice Allows the sender of the transaction to pay the arbitration fee to raise a dispute.
     * @param _transactionId Id of the transaction.
     */
    function payArbitrationFeeBySender(uint256 _transactionId) public payable {
        Transaction storage transaction = transactions[_transactionId];

        require(address(transaction.arbitrator) != address(0), "Arbitrator not set");
        require(transaction.status <= TransactionStatus.DisputeCreated, "Dispute already created");
        require(_msgSender() == transaction.sender, "The caller must be the sender");

        uint256 arbitrationCost = transaction.arbitrator.arbitrationCost(transaction.arbitratorExtraData);
        transaction.senderFee += msg.value;
        // The total fees paid by the sender should be the arbitration cost.
        require(transaction.senderFee == arbitrationCost, "The sender fee must be equal to the arbitration cost");

        transaction.lastInteraction = block.timestamp;

        emit ArbitrationFeePayment(_transactionId, ArbitrationFeePaymentType.Pay, Party.Sender, msg.value);

        // The receiver still has to pay. This can also happen if he has paid, but arbitrationCost has increased.
        if (transaction.receiverFee < arbitrationCost) {
            transaction.status = TransactionStatus.WaitingReceiver;
            emit HasToPayFee(_transactionId, Party.Receiver);
        } else {
            // The receiver has also paid the fee. Create the dispute.
            _raiseDispute(_transactionId, arbitrationCost);
        }
    }

    /**
     * @notice Allows the receiver of the transaction to pay the arbitration fee to accept the dispute.
     * @param _transactionId Id of the transaction.
     */
    function payArbitrationFeeByReceiver(uint256 _transactionId) public payable {
        Transaction storage transaction = transactions[_transactionId];

        require(address(transaction.arbitrator) != address(0), "Arbitrator not set");
        require(
            transaction.status == TransactionStatus.WaitingSender ||
                transaction.status == TransactionStatus.WaitingReceiver,
            "Receiver does not have to pay"
        );
        require(_msgSender() == transaction.receiver, "The caller must be the receiver");

        uint256 arbitrationCost = transaction.arbitrator.arbitrationCost(transaction.arbitratorExtraData);
        transaction.receiverFee += msg.value;
        // The total fees paid by the receiver should be the arbitration cost.
        require(transaction.receiverFee == arbitrationCost, "The receiver fee must be equal to the arbitration cost");

        transaction.lastInteraction = block.timestamp;

        emit ArbitrationFeePayment(_transactionId, ArbitrationFeePaymentType.Pay, Party.Receiver, msg.value);

        // The sender still has to pay. This can also happen if he has paid, but arbitrationCost has increased.
        if (transaction.senderFee < arbitrationCost) {
            transaction.status = TransactionStatus.WaitingSender;
            emit HasToPayFee(_transactionId, Party.Sender);
        } else {
            // The sender has also paid the fee. Create the dispute.
            _raiseDispute(_transactionId, arbitrationCost);
        }
    }

    /**
     * @notice If one party fails to pay the arbitration fee in time, the other can call this function and will win the case
     * @param _transactionId Id of the transaction.
     */
    function arbitrationFeeTimeout(uint256 _transactionId) public {
        Transaction storage transaction = transactions[_transactionId];

        require(
            block.timestamp - transaction.lastInteraction >= transaction.arbitrationFeeTimeout,
            "Timeout time has not passed yet"
        );

        if (transaction.status == TransactionStatus.WaitingSender) {
            if (transaction.senderFee != 0) {
                uint256 senderFee = transaction.senderFee;
                transaction.senderFee = 0;
                payable(transaction.sender).call{value: senderFee}("");
            }
            _executeRuling(_transactionId, RECEIVER_WINS);
        } else if (transaction.status == TransactionStatus.WaitingReceiver) {
            if (transaction.receiverFee != 0) {
                uint256 receiverFee = transaction.receiverFee;
                transaction.receiverFee = 0;
                payable(transaction.receiver).call{value: receiverFee}("");
            }
            _executeRuling(_transactionId, SENDER_WINS);
        }
    }

    // =========================== Platform functions ==============================

    /**
     * @dev Allows a platform owner to claim its balances accumulated from fees, for a specific token.
     * @param _platformId The ID of the platform.
     * @param _tokenAddress The address of the token to claim.
     */
    function claim(uint256 _platformId, address _tokenAddress) external {
        address payable recipient;

        if (owner() == _msgSender()) {
            require(_platformId == PROTOCOL_INDEX, "Access denied");
            recipient = protocolTreasuryAddress;
        } else {
            knowledgeLayerPlatformId.isValid(_platformId);
            recipient = payable(knowledgeLayerPlatformId.ownerOf(_platformId));
        }

        uint256 amount = platformBalance[_platformId][_tokenAddress];
        require(amount > 0, "Nothing to claim");
        platformBalance[_platformId][_tokenAddress] = 0;

        _transferBalance(recipient, _tokenAddress, amount);
    }

    // =========================== Arbitrator functions ==============================

    /**
     * @notice Allows the arbitrator to give a ruling for a dispute.
     * @param _disputeID The ID of the dispute in the Arbitrator contract.
     * @param _ruling Ruling given by the arbitrator. Note that 0 is reserved for "Not able/wanting to make a decision".
     */
    function rule(uint256 _disputeID, uint256 _ruling) public {}

    // =========================== Owner functions ==============================

    /**
     * @dev Sets the protocol fee per sale
     * @param _protocolFee Protocol fee per sale (percentage per 10,000)
     */
    function setProtocolFee(uint16 _protocolFee) public onlyOwner {
        protocolFee = _protocolFee;

        emit ProtocolFeeUpdated(_protocolFee);
    }

    /**
     * @dev Sets the address which will receive the protocol fees
     * @param _protocolTreasuryAddress The address
     */
    function setProtocolTreasuryAddress(address payable _protocolTreasuryAddress) external onlyOwner {
        protocolTreasuryAddress = _protocolTreasuryAddress;
    }

    // =========================== Internal functions ==============================

    /**
     * @notice Creates a dispute, paying the arbitration fee to the arbitrator. Parties are refund if
     *         they overpaid for the arbitration fee.
     * @param _transactionId Id of the transaction.
     * @param _arbitrationCost Amount to pay the arbitrator.
     */
    function _raiseDispute(uint256 _transactionId, uint256 _arbitrationCost) internal {
        Transaction storage transaction = transactions[_transactionId];
        transaction.status = TransactionStatus.DisputeCreated;
        Arbitrator arbitrator = transaction.arbitrator;

        transaction.disputeId = arbitrator.createDispute{value: _arbitrationCost}(
            AMOUNT_OF_CHOICES,
            transaction.arbitratorExtraData
        );
        disputeIDtoTransactionID[transaction.disputeId] = _transactionId;
        emit Dispute(arbitrator, transaction.disputeId, _transactionId, _transactionId);

        // Refund sender if it overpaid.
        if (transaction.senderFee > _arbitrationCost) {
            uint256 extraFeeSender = transaction.senderFee - _arbitrationCost;
            transaction.senderFee = _arbitrationCost;
            payable(transaction.sender).call{value: extraFeeSender}("");
            emit ArbitrationFeePayment(_transactionId, ArbitrationFeePaymentType.Reimburse, Party.Sender, msg.value);
        }

        // Refund receiver if it overpaid.
        if (transaction.receiverFee > _arbitrationCost) {
            uint256 extraFeeReceiver = transaction.receiverFee - _arbitrationCost;
            transaction.receiverFee = _arbitrationCost;
            payable(transaction.receiver).call{value: extraFeeReceiver}("");
            emit ArbitrationFeePayment(_transactionId, ArbitrationFeePaymentType.Reimburse, Party.Receiver, msg.value);
        }
    }

    /**
     * @notice Executes a ruling of a dispute. Sends the funds and reimburses the arbitration fee to the winning party.
     * @param _transactionId Id of the transaction.
     * @param _ruling Ruling given by the arbitrator.
     *                0: Refused to rule, split amount equally between sender and receiver.
     *                1: Reimburse the sender
     *                2: Pay the receiver
     */
    function _executeRuling(uint256 _transactionId, uint256 _ruling) internal {
        Transaction storage transaction = transactions[_transactionId];
        require(_ruling <= AMOUNT_OF_CHOICES, "Invalid ruling");

        address payable sender = payable(transaction.sender);
        address payable receiver = payable(transaction.receiver);
        uint256 amount = transaction.amount;
        uint256 senderFee = transaction.senderFee;
        uint256 receiverFee = transaction.receiverFee;

        transaction.amount = 0;
        transaction.senderFee = 0;
        transaction.receiverFee = 0;
        transaction.status = TransactionStatus.Resolved;

        // Send the funds to the winner and reimburse the arbitration fee.
        if (_ruling == SENDER_WINS) {
            sender.call{value: senderFee}("");
            _reimburse(_transactionId, amount);
        } else if (_ruling == RECEIVER_WINS) {
            receiver.call{value: receiverFee}("");
            _release(_transactionId, amount);
        } else {
            // If no ruling is given split funds in half
            uint256 splitFeeAmount = senderFee / 2;
            uint256 splitTransactionAmount = amount / 2;

            _reimburse(_transactionId, splitTransactionAmount);
            _release(_transactionId, splitTransactionAmount);

            sender.call{value: splitFeeAmount}("");
            receiver.call{value: splitFeeAmount}("");
        }

        emit RulingExecuted(_transactionId, _ruling);
    }

    // =========================== Private functions ==============================

    function _afterCreateTransaction(uint256 _transactionId, uint256 _senderId, uint256 _receiverId) internal {
        Transaction storage transaction = transactions[_transactionId];

        emit TransactionCreated(
            _transactionId,
            _senderId,
            _receiverId,
            transaction.token,
            transaction.amount,
            transaction.courseId,
            transaction.buyPlatformId,
            transaction.releasableAt,
            transaction.protocolFee,
            transaction.originFee,
            transaction.buyFee
        );
    }

    /**
     * @notice Used to release part of the transaction amount to the receiver.
     * @dev The release of an amount will also trigger the release of the fees to the platform's balances & the protocol fees.
     * @param _transactionId The transaction id
     * @param _amount The amount to release
     */
    function _release(uint256 _transactionId, uint256 _amount) private {
        _distributeFees(_transactionId, _amount);

        Transaction storage transaction = transactions[_transactionId];
        _transferBalance(transaction.receiver, transaction.token, _amount);

        emit Payment(_transactionId, PaymentType.Release, _amount);
    }

    /**
     * @notice Used to reimburse part of the transaction amount to the sender.
     * @dev Fees linked to the amount reimbursed will be automatically calculated and sent back to the sender in the same transfer
     * @param _transactionId The transaction id
     * @param _amount The amount to reimburse without fees
     */
    function _reimburse(uint256 _transactionId, uint256 _amount) private {
        Transaction storage transaction = transactions[_transactionId];
        uint256 totalReimburseAmount = _getAmountWithFees(_amount, transaction.originFee, transaction.buyFee);
        _transferBalance(transaction.sender, transaction.token, totalReimburseAmount);

        emit Payment(_transactionId, PaymentType.Reimburse, _amount);
    }

    function _getAmountWithFees(
        uint256 _amount,
        uint16 _originFee,
        uint16 _buyFee
    ) private view returns (uint256 totalEscrowAmount) {
        return _amount + ((_amount * (protocolFee + _originFee + _buyFee)) / FEE_DIVIDER);
    }

    function _distributeFees(uint256 _transactionId, uint256 _releasedAmount) private {
        Transaction storage transaction = transactions[_transactionId];
        IKnowledgeLayerCourse.Course memory course = knowledgeLayerCourse.getCourse(transaction.courseId);

        uint256 protocolFeeAmount = (transaction.protocolFee * _releasedAmount) / FEE_DIVIDER;
        uint256 originFeeAmount = (transaction.originFee * _releasedAmount) / FEE_DIVIDER;
        uint256 buyFeeAmount = (transaction.buyFee * _releasedAmount) / FEE_DIVIDER;

        platformBalance[PROTOCOL_INDEX][transaction.token] += protocolFeeAmount;
        platformBalance[course.platformId][transaction.token] += originFeeAmount;
        platformBalance[transaction.buyPlatformId][transaction.token] += buyFeeAmount;

        emit OriginFeeReleased(course.platformId, transaction.courseId, transaction.token, originFeeAmount);
        emit BuyFeeReleased(transaction.buyPlatformId, transaction.courseId, transaction.token, buyFeeAmount);
    }

    /**
     * @notice Transfers a token or ETH balance from the escrow to a recipient's address.
     * @param _recipient The address to transfer the balance to
     * @param _tokenAddress The token address, or zero address for ETH
     * @param _amount The amount to transfer
     */
    function _transferBalance(address _recipient, address _tokenAddress, uint256 _amount) private {
        if (address(0) == _tokenAddress) {
            payable(_recipient).call{value: _amount}("");
        } else {
            IERC20(_tokenAddress).transfer(_recipient, _amount);
        }
    }
}
