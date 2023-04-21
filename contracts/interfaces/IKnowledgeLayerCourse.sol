// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

interface IKnowledgeLayerCourse {
    struct Course {
        uint256 ownerId;
        uint256 platformId;
        uint256 price;
        string dataUri;
    }

    function getCourse(uint256 _courseId) external view returns (Course memory);

    function buyCourse(uint256 _profileId, uint256 _courseId) external payable;
}
