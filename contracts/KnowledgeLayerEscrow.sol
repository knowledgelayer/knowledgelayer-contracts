// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import {Counters} from "@openzeppelin/contracts/utils/Counters.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IKnowledgeLayerID} from "./interfaces/IKnowledgeLayerID.sol";
import {IKnowledgeLayerPlatformID} from "./interfaces/IKnowledgeLayerPlatformID.sol";
import {IKnowledgeLayerCourse} from "./interfaces/IKnowledgeLayerCourse.sol";

contract KnowledgeLayerEscrow is Ownable {
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
     * @notice Transaction struct
     * @param id Id of the transaction
     * @param sender The party paying the escrow amount
     * @param receiver The intended receiver of the escrow amount
     * @param token The token used for the transaction
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
        address token;
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

    // Platform id to balance accumulated for fees for each token
    mapping(uint256 => mapping(address => uint256)) public platformBalance;

    // Address which will receive the protocol fees
    address payable public protocolTreasuryAddress;

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
    event Payment(uint256 transactionId, PaymentType paymentType);

    /**
     * @dev Emitted when an origin fee is released to a platform's balance
     */
    event OriginFeeReleased(uint256 platformId, uint256 courseId, address token, uint256 amount);

    /**
     * @dev Emitted when a buy fee is released to a platform's balance
     */
    event BuyFeeReleased(uint256 platformId, uint256 courseId, address token, uint256 amount);

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

        nextTransactionId.increment();
        transactions[id] = Transaction({
            id: id,
            sender: sender,
            receiver: receiver,
            token: course.token,
            amount: course.price,
            courseId: _courseId,
            buyPlatformId: _platformId,
            protocolFee: protocolFee,
            originFee: originPlatform.originFee,
            buyFee: buyPlatform.buyFee
        });

        if (course.token != address(0)) {
            IERC20(course.token).safeTransferFrom(sender, address(this), totalAmount);
        }

        knowledgeLayerCourse.buyCourse(_profileId, _courseId);

        emit TransactionCreated(
            id,
            _profileId,
            course.ownerId,
            course.token,
            course.price,
            _courseId,
            _platformId,
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

        _transferBalance(transaction.receiver, transaction.token, transaction.amount);

        emit Payment(_transactionId, PaymentType.Release);
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
