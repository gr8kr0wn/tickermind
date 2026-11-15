// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAgentRegistry {
    function ownerOf(uint256 agentId) external view returns (address);
    function isActive(uint256 agentId) external view returns (bool);
}
