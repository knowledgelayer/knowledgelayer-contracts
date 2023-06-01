// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {Counters} from "@openzeppelin/contracts/utils/Counters.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";

import {IKnowledgeLayerID} from "./interfaces/IKnowledgeLayerID.sol";

contract KnowledgeLayerCourse is ERC1155, AccessControl {
    using Counters for Counters.Counter;

    /**
     * @dev Course struct
     * @param ownerId KnowledgeLayer ID of the teacher
     * @param platformId Platform ID where the course was created
     * @param price Price of the course
     * @param dataUri URI of the course data
     */
    struct Course {
        uint256 ownerId;
        uint256 platformId;
        uint256 price;
        address token;
        string dataUri;
    }

    // Role granting Escrow permission
    bytes32 public constant ESCROW_ROLE = keccak256("ESCROW_ROLE");

    // Course id to course
    mapping(uint256 => Course) public courses;

    // Course id counter
    Counters.Counter nextCourseId;

    // KnowledgeLayerID contract
    IKnowledgeLayerID private knowledgeLayerId;

    // =========================== Events ==============================

    /**
     * @dev Emitted when a new course is created
     */
    event CourseCreated(
        uint256 indexed courseId,
        uint256 ownerId,
        uint256 platformId,
        uint256 price,
        address token,
        string dataUri
    );

    /**
     * @dev Emitted when the price of a course is updated
     */
    event CourseUpdated(uint256 indexed courseId, uint256 price, address token, string dataUri);

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
    constructor(address _knowledgeLayerIdAddress) ERC1155("") {
        _setupRole(DEFAULT_ADMIN_ROLE, _msgSender());
        knowledgeLayerId = IKnowledgeLayerID(_knowledgeLayerIdAddress);
        nextCourseId.increment();
    }

    // =========================== View functions ==============================

    /**
     * @notice Returns the course information
     * @param _courseId Course id
     */
    function getCourse(uint256 _courseId) external view returns (Course memory) {
        require(_courseId < nextCourseId.current(), "Invalid course ID");
        return courses[_courseId];
    }

    // =========================== User functions ==============================

    /**
     * @dev Creates a new course
     * @param _profileId The KnowledgeLayer ID of the user owner of the course
     * @param _price Price of the course
     * @param _token Address of the token used to pay the course
     * @param _dataUri URI of the course data
     */
    function createCourse(
        uint256 _profileId,
        uint256 _platformId,
        uint256 _price,
        address _token,
        string memory _dataUri
    ) public onlyOwnerOrDelegate(_profileId) {
        uint256 id = nextCourseId.current();
        courses[id] = Course({
            ownerId: _profileId,
            platformId: _platformId,
            price: _price,
            dataUri: _dataUri,
            token: _token
        });
        nextCourseId.increment();

        emit CourseCreated(id, _profileId, _platformId, _price, _token, _dataUri);
    }

    /**
     * @dev Updates a course
     * @param _profileId The KnowledgeLayer ID of the user owner of the course
     * @param _courseId Id of the course
     * @param _price Price of the course
     * @param _token Address of the token used to pay the course
     * @param _dataUri URI of the course data
     */
    function updateCourse(
        uint256 _profileId,
        uint256 _courseId,
        uint256 _price,
        address _token,
        string memory _dataUri
    ) public onlyOwnerOrDelegate(_profileId) {
        Course storage course = courses[_courseId];
        require(course.ownerId == _profileId, "Not the owner");
        course.price = _price;
        course.token = _token;
        course.dataUri = _dataUri;

        emit CourseUpdated(_courseId, _price, _token, _dataUri);
    }

    // =========================== Escrow functions ==============================

    /**
     * @dev Buys the course by paying the price
     * @param _courseId Id of the course
     */
    function buyCourse(uint256 _profileId, uint256 _courseId) public onlyRole(ESCROW_ROLE) {
        address user = knowledgeLayerId.ownerOf(_profileId);
        _mint(user, _courseId, 1, "");
    }

    // =========================== Overrides ==============================

    /**
     * @dev Blocks token transfers
     */
    function safeTransferFrom(address, address, uint256, uint256, bytes memory) public virtual override {
        revert("Token transfer is not allowed");
    }

    /**
     * @dev Blocks token transfers
     */
    function safeBatchTransferFrom(
        address,
        address,
        uint256[] memory,
        uint256[] memory,
        bytes memory
    ) public virtual override {
        revert("Token transfer is not allowed");
    }

    /**
     * @dev See {IERC165-supportsInterface}.
     */
    function supportsInterface(bytes4 interfaceId) public view virtual override(ERC1155, AccessControl) returns (bool) {
        return ERC1155.supportsInterface(interfaceId) || AccessControl.supportsInterface(interfaceId);
    }
}
