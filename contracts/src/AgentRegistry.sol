// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title AgentRegistry
/// @notice Registers TickerMind research agents on Base and stores each agent's
///         allocation policy. Sandbox only: no real funds are managed here.
contract AgentRegistry {
    struct Agent {
        address owner;
        bool active;
        uint16 reserveBps;
        uint16 stocksBps;
        uint16 operatingBps;
        string metadataURI;
    }

    uint256 public nextAgentId = 1;
    mapping(uint256 => Agent) private _agents;

    event AgentRegistered(uint256 indexed agentId, address indexed owner, string metadataURI);
    event AgentMetadataUpdated(uint256 indexed agentId, string metadataURI);
    event AgentStatusChanged(uint256 indexed agentId, bool active);
    event AllocationPolicyUpdated(uint256 indexed agentId, uint16 reserveBps, uint16 stocksBps, uint16 operatingBps);

    error NotOwner();
    error UnknownAgent();
    error BadPolicy();
    error EmptyMetadata();

    modifier onlyAgentOwner(uint256 agentId) {
        if (_agents[agentId].owner == address(0)) revert UnknownAgent();
        if (_agents[agentId].owner != msg.sender) revert NotOwner();
        _;
    }

    function registerAgent(string calldata metadataURI) external returns (uint256 agentId) {
        if (bytes(metadataURI).length == 0) revert EmptyMetadata();
        agentId = nextAgentId++;
        Agent storage a = _agents[agentId];
        a.owner = msg.sender;
        a.active = true;
        a.metadataURI = metadataURI;
        // default policy: 40% reserve / 40% simulated stocks / 20% operating
        a.reserveBps = 4000;
        a.stocksBps = 4000;
        a.operatingBps = 2000;
        emit AgentRegistered(agentId, msg.sender, metadataURI);
        emit AllocationPolicyUpdated(agentId, 4000, 4000, 2000);
    }

    function updateMetadata(uint256 agentId, string calldata metadataURI) external onlyAgentOwner(agentId) {
        if (bytes(metadataURI).length == 0) revert EmptyMetadata();
        _agents[agentId].metadataURI = metadataURI;
        emit AgentMetadataUpdated(agentId, metadataURI);
    }

    function setActive(uint256 agentId, bool active) external onlyAgentOwner(agentId) {
        _agents[agentId].active = active;
        emit AgentStatusChanged(agentId, active);
    }

    function deactivateAgent(uint256 agentId) external onlyAgentOwner(agentId) {
        _agents[agentId].active = false;
        emit AgentStatusChanged(agentId, false);
    }

    /// @notice Percentages in basis points; must total exactly 10000 (100%).
    function setAllocationPolicy(
        uint256 agentId,
        uint16 reserveBps,
        uint16 stocksBps,
        uint16 operatingBps
    ) external onlyAgentOwner(agentId) {
        if (uint256(reserveBps) + stocksBps + operatingBps != 10000) revert BadPolicy();
        Agent storage a = _agents[agentId];
        a.reserveBps = reserveBps;
        a.stocksBps = stocksBps;
        a.operatingBps = operatingBps;
        emit AllocationPolicyUpdated(agentId, reserveBps, stocksBps, operatingBps);
    }

    /// @notice Pure helper so the UI/back end can preview a split in integer math.
    function calculateAllocation(uint256 agentId, uint256 amount)
        external
        view
        returns (uint256 reserve, uint256 stocks, uint256 operating)
    {
        Agent storage a = _agents[agentId];
        if (a.owner == address(0)) revert UnknownAgent();
        reserve = (amount * a.reserveBps) / 10000;
        stocks = (amount * a.stocksBps) / 10000;
        operating = amount - reserve - stocks; // remainder goes to operating, no dust lost
    }

    function ownerOf(uint256 agentId) external view returns (address) {
        return _agents[agentId].owner;
    }

    function isActive(uint256 agentId) external view returns (bool) {
        return _agents[agentId].active;
    }

    function getAgent(uint256 agentId) external view returns (Agent memory) {
        if (_agents[agentId].owner == address(0)) revert UnknownAgent();
        return _agents[agentId];
    }
}
