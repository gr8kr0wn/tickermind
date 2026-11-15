// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./interfaces/IERC20.sol";
import {IAgentRegistry} from "./interfaces/IAgentRegistry.sol";

/// @title AgentVault
/// @notice Holds each agent's USDC revenue and its user-defined allocation policy.
/// @dev Simulated stock allocations live offchain; only real USDC sits here.
contract AgentVault {
    struct Policy {
        uint16 reserveBps; // USDC kept in reserve
        uint16 operatingBps; // USDC kept for operating costs
        uint16 simulatedBps; // share mirrored into the paper portfolio (offchain)
        bool set;
    }

    uint16 public constant BPS = 10_000;

    IERC20 public immutable usdc;
    IAgentRegistry public immutable registry;
    address public admin;
    address public marketplace;

    mapping(uint256 => uint256) public balanceOf;
    mapping(uint256 => uint256) public totalEarned;
    mapping(uint256 => uint256) public totalSpent;
    mapping(uint256 => uint256) public totalWithdrawn;
    mapping(uint256 => Policy) private _policies;

    event MarketplaceSet(address indexed marketplace);
    event AdminTransferred(address indexed newAdmin);
    event Credited(uint256 indexed agentId, uint256 amount, uint256 indexed orderId);
    event Debited(uint256 indexed agentId, uint256 amount, uint256 indexed orderId);
    event Withdrawn(uint256 indexed agentId, address indexed to, uint256 amount);
    event PolicySet(uint256 indexed agentId, uint16 reserveBps, uint16 operatingBps, uint16 simulatedBps);

    error NotAdmin();
    error NotMarketplace();
    error NotAgentOwner();
    error InvalidPolicy();
    error InsufficientBalance();
    error ZeroAddress();
    error TransferFailed();

    constructor(IERC20 _usdc, IAgentRegistry _registry) {
        if (address(_usdc) == address(0) || address(_registry) == address(0)) revert ZeroAddress();
        usdc = _usdc;
        registry = _registry;
        admin = msg.sender;
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    modifier onlyMarketplace() {
        if (msg.sender != marketplace) revert NotMarketplace();
        _;
    }

    modifier onlyAgentOwner(uint256 agentId) {
        if (registry.ownerOf(agentId) != msg.sender) revert NotAgentOwner();
        _;
    }

    function setMarketplace(address _marketplace) external onlyAdmin {
        if (_marketplace == address(0)) revert ZeroAddress();
        marketplace = _marketplace;
        emit MarketplaceSet(_marketplace);
    }

    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        admin = newAdmin;
        emit AdminTransferred(newAdmin);
    }

    /// @notice Called by the marketplace after it has transferred `amount` USDC into this vault.
    function credit(uint256 agentId, uint256 amount, uint256 orderId) external onlyMarketplace {
        balanceOf[agentId] += amount;
        totalEarned[agentId] += amount;
        emit Credited(agentId, amount, orderId);
    }

    /// @notice Marketplace pulls USDC from an agent's treasury when that agent buys from another agent.
    function debit(uint256 agentId, uint256 amount, uint256 orderId) external onlyMarketplace {
        if (balanceOf[agentId] < amount) revert InsufficientBalance();
        balanceOf[agentId] -= amount;
        totalSpent[agentId] += amount;
        emit Debited(agentId, amount, orderId);
        if (!usdc.transfer(msg.sender, amount)) revert TransferFailed();
    }

    /// @notice Returns refunded USDC to a buyer agent without counting it as revenue.
    function restore(uint256 agentId, uint256 amount, uint256 orderId) external onlyMarketplace {
        balanceOf[agentId] += amount;
        totalSpent[agentId] -= amount;
        emit Credited(agentId, amount, orderId);
    }

    function withdraw(uint256 agentId, address to, uint256 amount) external onlyAgentOwner(agentId) {
        if (to == address(0)) revert ZeroAddress();
        if (balanceOf[agentId] < amount) revert InsufficientBalance();
        balanceOf[agentId] -= amount;
        totalWithdrawn[agentId] += amount;
        emit Withdrawn(agentId, to, amount);
        if (!usdc.transfer(to, amount)) revert TransferFailed();
    }

    function setPolicy(uint256 agentId, uint16 reserveBps, uint16 operatingBps, uint16 simulatedBps)
        external
        onlyAgentOwner(agentId)
    {
        if (uint256(reserveBps) + operatingBps + simulatedBps != BPS) revert InvalidPolicy();
        _policies[agentId] = Policy(reserveBps, operatingBps, simulatedBps, true);
        emit PolicySet(agentId, reserveBps, operatingBps, simulatedBps);
    }

    /// @notice Returns the agent's policy, or the 40/20/40 default when none is set.
    function getPolicy(uint256 agentId) public view returns (uint16 reserveBps, uint16 operatingBps, uint16 simulatedBps) {
        Policy memory p = _policies[agentId];
        if (!p.set) return (4000, 2000, 4000);
        return (p.reserveBps, p.operatingBps, p.simulatedBps);
    }

    /// @notice Splits the agent's current balance according to its policy.
    function allocationOf(uint256 agentId) external view returns (uint256 reserve, uint256 operating, uint256 simulated) {
        (uint16 r, uint16 o,) = getPolicy(agentId);
        uint256 bal = balanceOf[agentId];
        reserve = (bal * r) / BPS;
        operating = (bal * o) / BPS;
        simulated = bal - reserve - operating;
    }
}
