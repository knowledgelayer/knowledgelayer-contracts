// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

interface IKnowledgeLayerID {
    function balanceOf(address _user) external view returns (uint256);

    function mint(uint256 _platformId, string calldata _handle) external payable returns (uint256);

    function mintForAddress(
        address _address,
        uint256 _platformId,
        string calldata _handle
    ) external payable returns (uint256);

    function updateProfileData(uint256 _tokenId, string memory _newCid) external;

    function freeMint(uint256 _platformId, address _userAddress, string calldata _handle) external returns (uint256);

    function isValid(uint256 _tokenId) external view;

    function whitelistMint(
        uint256 _platformId,
        string calldata _handle,
        bytes32[] calldata _proof
    ) external payable returns (uint256);

    function ownerOf(uint256 _tokenId) external view returns (address);

    function ownersOf(uint256 _tokenId1, uint256 _tokenId2) external view returns (address, address);

    function getOriginatorPlatformIdByAddress(address _address) external view returns (uint256);

    function isDelegate(uint256 _tokenId, address _address) external view returns (bool);

    function isOwnerOrDelegate(uint256 _tokenId, address _address) external view returns (bool);

    function ids(address _user) external view returns (uint256);

    function setHasActivity(uint256 _profileId) external;
}
