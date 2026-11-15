// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAgentRegistry} from "./interfaces/IAgentRegistry.sol";

/// @title AgentRegistry
/// @notice Gives every TickerMind agent a unique onchain identity owned by a wallet.
contract AgentRegistry is IAgentRegistry {
    struct Agent {
        address owner;
        uint64 createdAt;
        bool active;
        string metadataURI;
    }

    uint256 public agentCount;
    mapping(uint256 => Agent) private _agents;
    mapping(address => uint256[]) private _agentsByOwner;

    event AgentRegistered(uint256 indexed agentId, address indexed owner, string metadataURI);
    event AgentUpdated(uint256 indexed agentId, string metadataURI);
    event AgentStatusChanged(uint256 indexed agentId, bool active);

    error NotAgentOwner();
    error UnknownAgent();
    error EmptyMetadata();

    modifier onlyAgentOwner(uint256 agentId) {
        if (_agents[agentId].owner == address(0)) revert UnknownAgent();
        if (_agents[agentId].owner != msg.sender) revert NotAgentOwner();
        _;
    }

    /// @param metadataURI A pointer to the agent's offchain config (e.g. "tickermind:agent:<uuid>" or an https/ipfs URI).
    function register(string calldata metadataURI) external returns (uint256 agentId) {
        if (bytes(metadataURI).length == 0) revert EmptyMetadata();
        agentId = ++agentCount;
        _agents[agentId] = Agent({owner: msg.sender, createdAt: uint64(block.timestamp), active: true, metadataURI: metadataURI});
        _agentsByOwner[msg.sender].push(agentId);
        emit AgentRegistered(agentId, msg.sender, metadataURI);
    }

    function updateMetadata(uint256 agentId, string calldata metadataURI) external onlyAgentOwner(agentId) {
        if (bytes(metadataURI).length == 0) revert EmptyMetadata();
        _agents[agentId].metadataURI = metadataURI;
        emit AgentUpdated(agentId, metadataURI);
    }

    function setActive(uint256 agentId, bool active) external onlyAgentOwner(agentId) {
        _agents[agentId].active = active;
        emit AgentStatusChanged(agentId, active);
    }

    function getAgent(uint256 agentId) external view returns (Agent memory) {
        if (_agents[agentId].owner == address(0)) revert UnknownAgent();
        return _agents[agentId];
    }

    function ownerOf(uint256 agentId) external view returns (address) {
        return _agents[agentId].owner;
    }

    function isActive(uint256 agentId) external view returns (bool) {
        return _agents[agentId].active;
    }

    function agentsOf(address owner) external view returns (uint256[] memory) {
        return _agentsByOwner[owner];
    }
}
