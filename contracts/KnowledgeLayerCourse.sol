// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Base64.sol";

contract KnowledgeLayerCourse is ERC1155, Ownable {
    using Counters for Counters.Counter;

    /**
     * @dev Course struct
     * @param seller Address of the seller
     * @param title Title of the course
     * @param slug Slug of the course
     * @param description Description of the course
     * @param price Price of the course
     * @param image Image of the course
     */
    struct Course {
        address seller;
        string title;
        string slug;
        string description;
        uint256 price;
        string image;
        string videoPlaybackId;
    }

    // Course id to course
    mapping(uint256 => Course) public courses;

    // Mapping from slug to course id
    mapping(string => uint256) public slugToId;

    // Course id counter
    Counters.Counter nextCourseId;

    // Protocol fee per sale (percentage per 10,000, upgradable)
    uint16 public protocolFee;

    // Divider used for fees
    uint16 private constant FEE_DIVIDER = 10000;

    // =========================== Events ==============================

    /**
     * @dev Emitted when a new course is created
     */
    event CourseCreated(
        uint256 indexed courseId,
        address indexed seller,
        string title,
        string slug,
        string description,
        uint256 price,
        string image,
        string videoPlaybackId
    );

    /**
     * @dev Emitted when a course is bought
     */
    event CourseBought(uint256 indexed courseId, address indexed buyer, uint256 price, uint256 fee);

    /**
     * @dev Emitted when the price of a course is updated
     */
    event CoursePriceUpdated(uint256 indexed courseId, uint256 price);

    /**
     * @dev Emitted when the protocol fee is updated
     */
    event ProtocolFeeUpdated(uint256 fee);

    // =========================== Constructor ==============================

    constructor() ERC1155("") {
        setProtocolFee(500);
        nextCourseId.increment();
    }

    // =========================== User functions ==============================

    /**
     * @dev Creates a new course
     * @param _title Title of the course
     * @param _slug Slug of the course
     * @param _description Description of the course
     * @param _price Price of the course in EURe tokens
     * @param _image Image of the course
     */
    function createCourse(
        string memory _title,
        string memory _slug,
        string memory _description,
        uint256 _price,
        string memory _image,
        string memory _videoPlaybackId
    ) public {
        uint256 id = nextCourseId.current();
        Course memory course = Course(msg.sender, _title, _slug, _description, _price, _image, _videoPlaybackId);
        courses[id] = course;
        slugToId[_slug] = id;
        nextCourseId.increment();

        emit CourseCreated(id, msg.sender, _title, _slug, _description, _price, _image, _videoPlaybackId);
    }

    /**
     * @dev Updates the price of the course
     * @param _courseId Id of the course
     * @param _price New price of the course
     */
    function updateCoursePrice(uint256 _courseId, uint256 _price) public {
        Course storage course = courses[_courseId];
        require(course.seller == msg.sender, "Only seller can update price");
        course.price = _price;

        emit CoursePriceUpdated(_courseId, _price);
    }

    /**
     * @dev Buys the course by paying the price
     * @param _courseId Id of the course
     */
    function buyCourse(uint256 _courseId) public payable {
        Course memory course = courses[_courseId];
        require(msg.value == course.price, "Not enough ETH sent");

        _mint(msg.sender, _courseId, 1, "");

        uint256 fee = (protocolFee * msg.value) / FEE_DIVIDER;

        (bool sentSeller, ) = payable(course.seller).call{value: msg.value - fee}("");
        require(sentSeller, "Failed to send Ether to seller");

        (bool sentOwner, ) = payable(owner()).call{value: fee}("");
        require(sentOwner, "Failed to send Ether to owner");

        emit CourseBought(_courseId, msg.sender, msg.value, fee);
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
     * @dev See {IERC1155MetadataURI-uri}.
     * @param _id The ID of the course
     */
    function uri(uint256 _id) public view virtual override returns (string memory) {
        Course memory course = courses[_id];

        return
            string(
                abi.encodePacked(
                    "data:application/json;base64,",
                    Base64.encode(
                        bytes(
                            abi.encodePacked(
                                '{"title":"',
                                course.title,
                                '", "image":"',
                                course.image,
                                unicode'", "description": "KnowledgeLayer Course"}'
                            )
                        )
                    )
                )
            );
    }
}
