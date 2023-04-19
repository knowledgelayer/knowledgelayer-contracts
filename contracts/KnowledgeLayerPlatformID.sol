// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Counters} from "@openzeppelin/contracts/utils/Counters.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract KnowledgeLayerPlatformID is ERC721, AccessControl {
    using Counters for Counters.Counter;

    uint8 constant MIN_HANDLE_LENGTH = 5;
    uint8 constant MAX_HANDLE_LENGTH = 31;

    /**
     * @notice Role granting Minting permission
     */
    bytes32 public constant MINT_ROLE = keccak256("MINT_ROLE");

    /**
     * @notice Enum for the mint status
     */
    enum MintStatus {
        ON_PAUSE,
        ONLY_WHITELIST,
        PUBLIC
    }

    /**
     * @notice KnowledgeLayer Platform information struct
     * @param id the KnowledgeLayer Platform Id
     * @param name the name of the platform
     * @param dataUri the IPFS URI of the Platform metadata
     * @param originFee the %fee (per ten thousands) asked by the platform for each course created on the platform
     * @param buyFee the %fee (per ten thousands) asked by the platform for each purchased course on the platform
     * @param postingFee the fee (flat) asked by the platform to post a course on the platform
     * @param signer address used to sign operations which need platform authorization
     */
    struct Platform {
        uint256 id;
        string name;
        string dataUri;
        uint16 originFee;
        uint16 buyFee;
        uint256 postingFee;
        address signer;
    }

    /**
     * @notice Taken Platform name
     */
    mapping(string => bool) public takenNames;

    /**
     * @notice Platform ID to Platform struct
     */
    mapping(uint256 => Platform) public platforms;

    /**
     * @notice Addresses which are allowed to mint a Platform ID
     */
    mapping(address => bool) public whitelist;

    /**
     * @notice Address to PlatformId
     */
    mapping(address => uint256) public ids;

    /**
     * @notice Price to mint a platform id (in wei, upgradable)
     */
    uint256 public mintFee;

    /**
     * @notice Platform Id counter
     */
    Counters.Counter private nextPlatformId;

    /**
     * @notice  The minting status
     */
    MintStatus public mintStatus;

    // =========================== Errors ==============================

    /**
     * @notice error thrown when input handle is 0 or more than 31 characters long.
     */
    error HandleLengthInvalid();

    /**
     * @notice error thrown when input handle contains restricted characters.
     */
    error HandleContainsInvalidCharacters();

    /**
     * @notice error thrown when input handle has an invalid first character.
     */
    error HandleFirstCharInvalid();

    // =========================== Events ==============================

    /**
     * @notice Emit when new Platform ID is minted.
     * @param platformOwnerAddress Address of the owner of the PlatformID
     * @param platformId The Platform ID
     * @param platformName Name of the platform
     * @param fee Fee paid to mint the Platform ID
     */
    event Mint(address indexed platformOwnerAddress, uint256 platformId, string platformName, uint256 fee);

    /**
     * @notice Emit when Cid is updated for a platform.
     * @param platformId The Platform ID
     * @param newCid New URI
     */
    event CidUpdated(uint256 indexed platformId, string newCid);

    /**
     * @notice Emit when mint fee is updated
     * @param mintFee The new mint fee
     */
    event MintFeeUpdated(uint256 mintFee);

    /**
     * @notice Emit when the fee is updated for a platform
     * @param platformId The Platform Id
     * @param originFee The new fee
     */
    event OriginFeeUpdated(uint256 platformId, uint16 originFee);

    /**
     * @notice Emit when the fee is updated for a platform
     * @param platformId The Platform Id
     * @param buyFee The new fee
     */
    event BuyFeeUpdated(uint256 platformId, uint16 buyFee);

    /**
     * @notice Emit when the service posting fee is updated for a platform
     * @param platformId The Platform Id
     * @param postingFee The new fee
     */
    event PostingFeeUpdated(uint256 platformId, uint256 postingFee);

    /**
     * @notice Emit when the signer address is updated for a platform
     * @param platformId The Platform Id
     * @param signer The new signer address
     */
    event SignerUpdated(uint256 platformId, address signer);

    /**
     * @notice Emit when the minting status is updated
     * @param mintStatus The new mint status
     */
    event MintStatusUpdated(MintStatus mintStatus);

    /**
     * @notice Emit when a platform is whitelisted
     * @param user The new address whitelited
     */
    event UserWhitelisted(address indexed user);

    // =========================== Modifiers ==============================

    /**
     * @notice Check if Platform is able to mint a new Platform ID.
     * @param _platformName name for the platform
     * @param _platformAddress address of the platform associated with the ID
     */
    modifier canMint(string calldata _platformName, address _platformAddress) {
        require(mintStatus == MintStatus.ONLY_WHITELIST || mintStatus == MintStatus.PUBLIC, "Mint status is not valid");
        if (mintStatus == MintStatus.ONLY_WHITELIST) {
            require(whitelist[msg.sender], "You are not whitelisted");
        }
        require(msg.value == mintFee, "Incorrect amount of ETH for mint fee");
        require(balanceOf(_platformAddress) == 0, "Platform already has a Platform ID");
        require(!takenNames[_platformName], "Name already taken");

        _validateHandle(_platformName);
        _;
    }

    /**
     * @notice Check if msg sender is the owner of a platform
     * @param _platformId the ID of the platform
     */
    modifier onlyPlatformOwner(uint256 _platformId) {
        require(ownerOf(_platformId) == msg.sender, "Not the owner");
        _;
    }

    // =========================== Constructor ==============================

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() ERC721("KnowledgeLayerPlatformID", "KLPID") {
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _setupRole(MINT_ROLE, msg.sender);
        mintFee = 0;

        // Increment counter to start platform ids at index 1
        nextPlatformId.increment();
        mintStatus = MintStatus.ONLY_WHITELIST;
    }

    // =========================== View functions ==============================

    /**
     * @notice Check whether the KnowledgeLayer Platform Id is valid.
     * @param _platformId The Platform Id.
     */
    function isValid(uint256 _platformId) public view {
        require(_platformId > 0 && _platformId < nextPlatformId.current(), "Invalid platform ID");
    }

    /**
     * @notice Allows retrieval of a Platform fee
     * @param _platformId The Platform Id
     * @return The Platform fee
     */
    function getOriginFee(uint256 _platformId) external view returns (uint16) {
        isValid(_platformId);
        return platforms[_platformId].originFee;
    }

    /**
     * @notice Allows retrieval of a Platform fee
     * @param _platformId The Platform Id
     * @return The Platform fee
     */
    function getBuyFee(uint256 _platformId) external view returns (uint16) {
        isValid(_platformId);
        return platforms[_platformId].buyFee;
    }

    /**
     * @notice Allows retrieval of a course posting fee
     * @param _platformId The Platform Id
     * @return The Course posting fee
     */
    function getPostingFee(uint256 _platformId) external view returns (uint256) {
        isValid(_platformId);
        return platforms[_platformId].postingFee;
    }

    /**
     * @notice Allows retrieval of the signer of a platform
     * @param _platformId The Platform Id
     * @return The signer of the platform
     */
    function getSigner(uint256 _platformId) external view returns (address) {
        isValid(_platformId);
        return platforms[_platformId].signer;
    }

    /**
     * @notice Allows retrieval of a Platform data
     * @param _platformId The Platform Id
     * @return The Platform data
     */
    function getPlatform(uint256 _platformId) external view returns (Platform memory) {
        isValid(_platformId);
        return platforms[_platformId];
    }

    /**
     * @dev Returns the total number of tokens in existence.
     */
    function totalSupply() public view returns (uint256) {
        return nextPlatformId.current() - 1;
    }

    // =========================== User functions ==============================

    /**
     * @notice Allows a platform to mint a new Platform Id.
     * @param _platformName Platform name
     */
    function mint(string calldata _platformName) public payable canMint(_platformName, msg.sender) returns (uint256) {
        _mint(msg.sender, nextPlatformId.current());
        return _afterMint(_platformName, msg.sender);
    }

    /**
     * @notice Allows a user to mint a new Platform Id and assign it to an eth address.
     * @dev You need to have MINT_ROLE to use this function
     * @param _platformName Platform name
     * @param _platformAddress Eth Address to assign the Platform Id to
     */
    function mintForAddress(
        string calldata _platformName,
        address _platformAddress
    ) public payable canMint(_platformName, _platformAddress) onlyRole(MINT_ROLE) returns (uint256) {
        _mint(_platformAddress, nextPlatformId.current());
        return _afterMint(_platformName, _platformAddress);
    }

    /**
     * @notice Update platform URI data.
     * @dev we are trusting the platform to provide the valid IPFS URI
     * @param _platformId The Platform Id
     * @param _newCid New IPFS URI
     */
    function updateProfileData(uint256 _platformId, string memory _newCid) public onlyPlatformOwner(_platformId) {
        require(bytes(_newCid).length == 46, "Invalid cid");

        platforms[_platformId].dataUri = _newCid;

        emit CidUpdated(_platformId, _newCid);
    }

    /**
     * @notice Allows a platform to update his fee
     * @param _platformId The Platform Id
     * @param _originFee Platform fee to update
     */
    function updateOriginFee(uint256 _platformId, uint16 _originFee) public onlyPlatformOwner(_platformId) {
        platforms[_platformId].originFee = _originFee;
        emit OriginFeeUpdated(_platformId, _originFee);
    }

    /**
     * @notice Allows a platform to update his fee
     * @param _platformId The Platform Id
     * @param _buyFee Platform fee to update
     */
    function updateBuyFee(uint256 _platformId, uint16 _buyFee) public onlyPlatformOwner(_platformId) {
        platforms[_platformId].buyFee = _buyFee;
        emit BuyFeeUpdated(_platformId, _buyFee);
    }

    /**
     * @notice Allows a platform to update the service posting fee for the platform
     * @param _platformId The platform Id of the platform
     * @param postingFee The new fee
     */
    function updatePostingFee(uint256 _platformId, uint256 postingFee) public onlyPlatformOwner(_platformId) {
        platforms[_platformId].postingFee = postingFee;
        emit PostingFeeUpdated(_platformId, postingFee);
    }

    /**
     * @notice Allows a platform to update its signer address
     * @param _platformId The platform Id of the platform
     * @param _signer The new signer address
     */
    function updateSigner(uint256 _platformId, address _signer) public onlyPlatformOwner(_platformId) {
        platforms[_platformId].signer = _signer;
        emit SignerUpdated(_platformId, _signer);
    }

    // =========================== Owner functions ==============================

    /**
     * @notice whitelist a user.
     * @param _user Address of the user to whitelist
     */
    function whitelistUser(address _user) public onlyRole(DEFAULT_ADMIN_ROLE) {
        whitelist[_user] = true;
        emit UserWhitelisted(_user);
    }

    /**
     * @notice Updates the mint status.
     * @param _mintStatus The new mint status
     */
    function updateMintStatus(MintStatus _mintStatus) public onlyRole(DEFAULT_ADMIN_ROLE) {
        mintStatus = _mintStatus;
        emit MintStatusUpdated(_mintStatus);
    }

    /**
     * Updates the mint fee.
     * @param _mintFee The new mint fee
     */
    function updateMintFee(uint256 _mintFee) public onlyRole(DEFAULT_ADMIN_ROLE) {
        mintFee = _mintFee;
        emit MintFeeUpdated(_mintFee);
    }

    /**
     * Withdraws the contract balance to the admin.
     */
    function withdraw() public onlyRole(DEFAULT_ADMIN_ROLE) {
        (bool sent, ) = payable(msg.sender).call{value: address(this).balance}("");
        require(sent, "Failed to withdraw Ether");
    }

    // =========================== Private functions ==============================

    /**
     * @notice Update Platform name mapping and emit event after mint.
     * @param _platformName Name of the platform.
     * @param _platformAddress Address of the platform.
     * @dev Increments the nextTokenId counter.
     */
    function _afterMint(string memory _platformName, address _platformAddress) private returns (uint256) {
        uint256 platformId = nextPlatformId.current();
        nextPlatformId.increment();
        Platform storage platform = platforms[platformId];
        platform.name = _platformName;
        platform.id = platformId;
        platform.signer = address(0);
        takenNames[_platformName] = true;
        ids[_platformAddress] = platformId;

        emit Mint(_platformAddress, platformId, _platformName, mintFee);

        return platformId;
    }

    /**
     * @notice Validate characters used in the handle, only alphanumeric, only lowercase characters, - and _ are allowed but as first one
     * @param handle Handle to validate
     */
    function _validateHandle(string calldata handle) private pure {
        bytes memory byteHandle = bytes(handle);
        uint256 byteHandleLength = byteHandle.length;
        if (byteHandleLength < MIN_HANDLE_LENGTH || byteHandleLength > MAX_HANDLE_LENGTH) revert HandleLengthInvalid();

        bytes1 firstByte = bytes(handle)[0];
        if (firstByte == "-" || firstByte == "_") revert HandleFirstCharInvalid();

        for (uint256 i = 0; i < byteHandleLength; ) {
            if (
                (byteHandle[i] < "0" || byteHandle[i] > "z" || (byteHandle[i] > "9" && byteHandle[i] < "a")) &&
                byteHandle[i] != "-" &&
                byteHandle[i] != "_"
            ) revert HandleContainsInvalidCharacters();
            ++i;
        }
    }

    // =========================== Overrides ==============================

    /**
     * @dev See {IERC165-supportsInterface}.
     */
    function supportsInterface(bytes4 interfaceId) public view virtual override(ERC721, AccessControl) returns (bool) {
        return ERC721.supportsInterface(interfaceId) || AccessControl.supportsInterface(interfaceId);
    }

    /**
     * @dev Override to prevent token transfer.
     */
    function _transfer(address, address, uint256) internal virtual override(ERC721) {
        revert("Token transfer is not allowed");
    }

    /**
     * @notice Implementation of the {IERC721Metadata-tokenURI} function.
     * @param tokenId The ID of the token
     */
    function tokenURI(uint256 tokenId) public view virtual override(ERC721) returns (string memory) {
        return _buildTokenURI(tokenId);
    }

    /**
     * @notice Builds the token URI
     * @param id The ID of the token
     */
    function _buildTokenURI(uint256 id) internal view returns (string memory) {
        string memory platformName = string.concat(platforms[id].name, ".tlp");
        string memory fontSizeStr = bytes(platforms[id].name).length <= 20 ? "60" : "40";

        bytes memory image = abi.encodePacked(
            "data:image/svg+xml;base64,",
            Base64.encode(
                bytes(
                    abi.encodePacked(
                        '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="720"><rect width="100%" height="100%"/><svg xmlns="http://www.w3.org/2000/svg" width="150" height="150" version="1.2" viewBox="-200 -50 1000 1000"><path fill="#FFFFFF" d="M264.5 190.5c0-13.8 11.2-25 25-25H568c13.8 0 25 11.2 25 25v490c0 13.8-11.2 25-25 25H289.5c-13.8 0-25-11.2-25-25z"/><path fill="#FFFFFF" d="M265 624c0-13.8 11.2-25 25-25h543c13.8 0 25 11.2 25 25v56.5c0 13.8-11.2 25-25 25H290c-13.8 0-25-11.2-25-25z"/><path fill="#FFFFFF" d="M0 190.5c0-13.8 11.2-25 25-25h543c13.8 0 25 11.2 25 25V247c0 13.8-11.2 25-25 25H25c-13.8 0-25-11.2-25-25z"/></svg><text x="30" y="670" style="font: ',
                        fontSizeStr,
                        'px sans-serif;fill:#fff">',
                        platformName,
                        "</text></svg>"
                    )
                )
            )
        );
        return
            string(
                abi.encodePacked(
                    "data:application/json;base64,",
                    Base64.encode(
                        bytes(
                            abi.encodePacked(
                                '{"name":"',
                                platformName,
                                '", "image":"',
                                image,
                                unicode'", "description": "KnowledgeLayer Platform ID"}'
                            )
                        )
                    )
                )
            );
    }
}
