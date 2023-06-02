// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

import {Arbitrator} from "../Arbitrator.sol";

interface IKnowledgeLayerPlatformID is IERC721 {
    struct Platform {
        uint256 id;
        string name;
        string dataUri;
        uint16 originFee;
        uint16 buyFee;
        uint256 postingFee;
        address signer;
        Arbitrator arbitrator;
        bytes arbitratorExtraData;
        uint256 arbitrationFeeTimeout;
    }

    function balanceOf(address _platformAddress) external view returns (uint256);

    function getOriginFee(uint256 _platformId) external view returns (uint16);

    function getBuyFee(uint256 _platformId) external view returns (uint16);

    function getSigner(uint256 _platformId) external view returns (address);

    function getPlatform(uint256 _platformId) external view returns (Platform memory);

    function mint(string memory _platformName) external payable returns (uint256);

    function mintForAddress(string memory _platformName, address _platformAddress) external payable returns (uint256);

    function totalSupply() external view returns (uint256);

    function updateProfileData(uint256 _platformId, string memory _newCid) external;

    function updateOriginFee(uint256 _platformId, uint16 _originFee) external;

    function updateBuyFee(uint256 _platformId, uint16 _buyFee) external;

    function updateRecoveryRoot(bytes32 _newRoot) external;

    function updateMintFee(uint256 _mintFee) external;

    function withdraw() external;

    function isValid(uint256 _platformId) external view;

    function updateMinArbitrationFeeTimeout(uint256 _minArbitrationFeeTimeout) external;

    function getPostingFee(uint256 _platformId) external view returns (uint256);

    function updatePostingFee(uint256 _platformId, uint256 _postingFee) external;

    function ids(address _user) external view returns (uint256);
}
