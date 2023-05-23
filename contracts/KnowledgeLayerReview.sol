// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import {IKnowledgeLayerID} from "./interfaces/IKnowledgeLayerID.sol";
import {IKnowledgeLayerCourse} from "./interfaces/IKnowledgeLayerCourse.sol";
import {IKnowledgeLayerPlatformID} from "./interfaces/IKnowledgeLayerPlatformID.sol";

import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Counters} from "@openzeppelin/contracts/utils/Counters.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title KnowledgeLayerReview Contract
 */
contract KnowledgeLayerReview is ERC721 {
    using Address for address;
    using Strings for uint256;
    using Counters for Counters.Counter;

    /**
     * @dev Review information struct
     * @param id Id of the review
     * @param ownerId KnowledgeLayer ID of the teacher
     * @param dataUri URI of the review data
     * @param courseId ID of the associated course
     * @param rating Rating of the review
     */
    struct Review {
        uint256 id;
        uint256 ownerId;
        string dataUri;
        uint256 courseId;
        uint256 rating;
    }

    // Review id counter
    Counters.Counter nextReviewId;

    // Review id to review
    mapping(uint256 => Review) public reviews;

    // Whether the teacher has been reviewed for a course by a student (course id -> student id -> book)
    mapping(uint256 => mapping(uint256 => bool)) public hasBeenReviewed;

    // KnowledgeLayerID contract
    IKnowledgeLayerID private knowledgeLayerId;

    // KnowledgeLayerCourse contract
    IKnowledgeLayerCourse private knowledgeLayerCourse;

    // =========================== Events ==============================

    /**
     * @dev Emitted when a new review is minted
     * @param id ID of the review
     * @param courseId ID of the associated course
     * @param toId KnowledgeLayer Id of the receiver of the review
     * @param fromId KnowledgeLayer Id of the reviewer
     * @param rating Rating of the review
     * @param dataUri URI of the review data
     */
    event Mint(
        uint256 indexed id,
        uint256 indexed courseId,
        uint256 indexed toId,
        uint256 fromId,
        uint256 rating,
        string dataUri
    );

    // =========================== Modifiers ==============================

    /**
     * @notice Check if the given address is either the owner of the delegate of the given user
     * @param _profileId The KnowledgeLayer ID of the user
     */
    modifier onlyOwnerOrDelegate(uint256 _profileId) {
        require(knowledgeLayerId.isOwnerOrDelegate(_profileId, _msgSender()), "Not owner or delegate");
        _;
    }

    // =========================== Constructor ==============================

    constructor(
        address _knowledgeLayerIdAddress,
        address _knowledgeLayerCourseAddress
    ) ERC721("KnowledgeLayerReview", "KLR") {
        knowledgeLayerId = IKnowledgeLayerID(_knowledgeLayerIdAddress);
        knowledgeLayerCourse = IKnowledgeLayerCourse(_knowledgeLayerCourseAddress);
        nextReviewId.increment();
    }

    // =========================== View functions ==============================

    /**
     * @notice Returns the review information
     * @param _reviewId Review Id
     */
    function getReview(uint256 _reviewId) public view returns (Review memory) {
        require(_reviewId < nextReviewId.current(), "Invalid review ID");
        return reviews[_reviewId];
    }

    /**
     * @dev Returns the total number of tokens in existence.
     */
    function totalSupply() public view returns (uint256) {
        return nextReviewId.current() - 1;
    }

    // =========================== User functions ==============================

    /**
     * @notice Called to mint a review for a completed course
     * @dev Only one review can be minted per course per user
     * @param _profileId KnowledgeLayer ID of the user
     * @param _courseId ID of the course
     * @param _dataUri URI of the review data
     * @param _rating Rating of the review
     */
    function mint(
        uint256 _profileId,
        uint256 _courseId,
        string calldata _dataUri,
        uint256 _rating
    ) public onlyOwnerOrDelegate(_profileId) returns (uint256) {
        IKnowledgeLayerCourse.Course memory course = knowledgeLayerCourse.getCourse(_courseId);
        address user = knowledgeLayerId.ownerOf(_profileId);

        require(_rating <= 5, "Invalid rating");
        require(!hasBeenReviewed[_courseId][_profileId], "Already minted review");
        require(knowledgeLayerCourse.balanceOf(user, _courseId) > 0, "Not a buyer of the course");

        hasBeenReviewed[_courseId][_profileId] = true;

        address seller = knowledgeLayerId.ownerOf(course.ownerId);
        uint256 id = nextReviewId.current();
        _safeMint(seller, id);

        reviews[id] = Review({
            id: id,
            ownerId: course.ownerId,
            dataUri: _dataUri,
            courseId: _courseId,
            rating: _rating
        });
        nextReviewId.increment();

        emit Mint(id, _courseId, course.ownerId, _profileId, _rating, _dataUri);

        return id;
    }

    // =========================== Overrides ===================================

    /**
     * @dev Override to prevent token transfer.
     */
    function _transfer(address, address, uint256) internal virtual override(ERC721) {
        revert("Token transfer is not allowed");
    }

    /**
     * @dev Blocks the burn function
     * @param _tokenId The ID of the token
     */
    function _burn(uint256 _tokenId) internal virtual override(ERC721) {}

    /**
     * @notice Implementation of the {IERC721Metadata-tokenURI} function.
     */
    function tokenURI(uint256) public view virtual override(ERC721) returns (string memory) {
        return _buildTokenURI();
    }

    /**
     * @notice Builds the token URI
     */
    function _buildTokenURI() internal pure returns (string memory) {
        bytes memory image = abi.encodePacked(
            "data:image/svg+xml;base64,",
            Base64.encode(
                bytes(
                    '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="720"><rect width="100%" height="100%"/><svg xmlns="http://www.w3.org/2000/svg" width="150" height="150" version="1.2" viewBox="-200 -50 1000 1000"><path fill="#FFFFFF" d="M264.5 190.5c0-13.8 11.2-25 25-25H568c13.8 0 25 11.2 25 25v490c0 13.8-11.2 25-25 25H289.5c-13.8 0-25-11.2-25-25z"/><path fill="#FFFFFF" d="M265 624c0-13.8 11.2-25 25-25h543c13.8 0 25 11.2 25 25v56.5c0 13.8-11.2 25-25 25H290c-13.8 0-25-11.2-25-25z"/><path fill="#FFFFFF" d="M0 190.5c0-13.8 11.2-25 25-25h543c13.8 0 25 11.2 25 25V247c0 13.8-11.2 25-25 25H25c-13.8 0-25-11.2-25-25z"/></svg><text x="30" y="670" style="font:60px sans-serif;fill:#fff">review</text></svg>'
                )
            )
        );
        return
            string(
                abi.encodePacked(
                    "data:application/json;base64,",
                    Base64.encode(
                        bytes(abi.encodePacked('{"name":"KnowledgeLayer Review"', ', "image":"', image, unicode'"}'))
                    )
                )
            );
    }
}
