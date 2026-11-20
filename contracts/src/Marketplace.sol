// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IAgentRegistry {
    function ownerOf(uint256 agentId) external view returns (address);
    function isActive(uint256 agentId) external view returns (bool);
}

/// @title Marketplace
/// @notice Settles testnet-USDC payments for agent research orders and records
///         delivery. Funds go straight from buyer to the agent owner, the
///         contract never custodies tokens. The back end verifies the emitted
///         OrderPaid event (chain, token, amount, recipient, orderId).
contract Marketplace {
    IERC20 public immutable usdc;
    IAgentRegistry public immutable registry;

    struct Order {
        address buyer;
        uint256 agentId;
        uint256 amount;
        bool delivered;
        bytes32 reportHash;
    }

    mapping(bytes32 => Order) public orders;
    mapping(uint256 => uint256) public revenueOf;

    uint256 private _lock = 1;

    event OrderPaid(
        bytes32 indexed orderId,
        uint256 indexed agentId,
        address indexed buyer,
        address recipient,
        address token,
        uint256 amount
    );
    event RevenueRecorded(uint256 indexed agentId, uint256 amount);
    event ServiceOrderCompleted(bytes32 indexed orderId, uint256 indexed agentId, bytes32 reportHash);

    error AlreadyPaid();
    error InactiveAgent();
    error ZeroAmount();
    error TransferFailed();
    error NotAgentOwner();
    error UnknownOrder();
    error AlreadyDelivered();
    error Reentrancy();

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(address usdc_, address registry_) {
        usdc = IERC20(usdc_);
        registry = IAgentRegistry(registry_);
    }

    /// @param orderId off-chain order id (bytes32), unique per order
    function payForOrder(bytes32 orderId, uint256 agentId, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (orders[orderId].buyer != address(0)) revert AlreadyPaid();
        if (!registry.isActive(agentId)) revert InactiveAgent();
        address recipient = registry.ownerOf(agentId);

        orders[orderId] = Order(msg.sender, agentId, amount, false, bytes32(0));
        revenueOf[agentId] += amount;

        if (!usdc.transferFrom(msg.sender, recipient, amount)) revert TransferFailed();

        emit OrderPaid(orderId, agentId, msg.sender, recipient, address(usdc), amount);
        emit RevenueRecorded(agentId, amount);
    }

    /// @notice Agent owner marks an order delivered, anchoring a hash of the report.
    function markDelivered(bytes32 orderId, bytes32 reportHash) external {
        Order storage o = orders[orderId];
        if (o.buyer == address(0)) revert UnknownOrder();
        if (registry.ownerOf(o.agentId) != msg.sender) revert NotAgentOwner();
        if (o.delivered) revert AlreadyDelivered();
        o.delivered = true;
        o.reportHash = reportHash;
        emit ServiceOrderCompleted(orderId, o.agentId, reportHash);
    }
}
