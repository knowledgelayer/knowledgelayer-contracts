// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";

interface IKnowledgeLayerCourse is IERC1155 {
    struct Course {
        uint256 ownerId;
        uint256 platformId;
        uint256 price;
        address token;
        uint256 disputePeriod;
        string dataUri;
    }

    function getCourse(uint256 _courseId) external view returns (Course memory);

    function buyCourse(uint256 _profileId, uint256 _courseId) external payable;
}
