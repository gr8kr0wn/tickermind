// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./interfaces/IERC20.sol";
import {IAgentRegistry} from "./interfaces/IAgentRegistry.sol";
import {AgentVault} from "./AgentVault.sol";

/// @title AgentMarketplace
/// @notice Agents list research services; buyers (humans or other agents) pay in USDC into escrow.
///         The TickerMind operator releases payment to the seller's vault once the report is delivered,
///         recording the report hash onchain so anyone can verify it.
contract AgentMarketplace {
    enum Status {
        None,
        Pending,
        Fulfilled,
        Refunded
    }

    struct Service {
        uint256 agentId;
        uint256 price; // USDC, 6 decimals
        bool active;
        string metadataURI;
    }

    struct Order {
        uint256 serviceId;
        uint256 sellerAgentId;
        uint256 buyerAgentId; // 0 = human buyer
        address buyer;
        uint256 amount;
        uint64 createdAt;
        Status status;
        bytes32 reportHash;
    }

    uint64 public constant REFUND_DELAY = 1 days;

    IERC20 public immutable usdc;
    IAgentRegistry public immutable registry;
    AgentVault public immutable vault;
    address public admin;
    address public operator;

    uint256 public serviceCount;
    uint256 public orderCount;
    mapping(uint256 => Service) public services;
    mapping(uint256 => Order) public orders;
    mapping(uint256 => uint256) public completedOrders; // per seller agent

    bool private _locked;

    event OperatorSet(address indexed operator);
    event ServiceCreated(uint256 indexed serviceId, uint256 indexed agentId, uint256 price, string metadataURI);
    event ServiceUpdated(uint256 indexed serviceId, uint256 price, bool active);
    event OrderCreated(
        uint256 indexed orderId,
        uint256 indexed serviceId,
        uint256 indexed sellerAgentId,
        uint256 buyerAgentId,
        address buyer,
        uint256 amount
    );
    event OrderFulfilled(uint256 indexed orderId, uint256 indexed sellerAgentId, bytes32 reportHash, uint256 amount);
    event OrderRefunded(uint256 indexed orderId, address indexed buyer, uint256 amount);

    error NotAdmin();
    error NotOperator();
    error NotAgentOwner();
    error ServiceInactive();
    error UnknownService();
    error InvalidPrice();
    error SelfPurchase();
    error BadStatus();
    error RefundNotAllowed();
    error TransferFailed();
    error ZeroAddress();
    error Reentrancy();

    constructor(IERC20 _usdc, IAgentRegistry _registry, AgentVault _vault, address _operator) {
        if (address(_usdc) == address(0) || address(_registry) == address(0) || address(_vault) == address(0)) {
            revert ZeroAddress();
        }
        if (_operator == address(0)) revert ZeroAddress();
        usdc = _usdc;
        registry = _registry;
        vault = _vault;
        admin = msg.sender;
        operator = _operator;
        emit OperatorSet(_operator);
    }

    modifier nonReentrant() {
        if (_locked) revert Reentrancy();
        _locked = true;
        _;
        _locked = false;
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    function setOperator(address _operator) external onlyAdmin {
        if (_operator == address(0)) revert ZeroAddress();
        operator = _operator;
        emit OperatorSet(_operator);
    }

    // ---------------------------------------------------------------- services

    function createService(uint256 agentId, uint256 price, string calldata metadataURI)
        external
        returns (uint256 serviceId)
    {
        if (registry.ownerOf(agentId) != msg.sender) revert NotAgentOwner();
        if (price == 0) revert InvalidPrice();
        serviceId = ++serviceCount;
        services[serviceId] = Service({agentId: agentId, price: price, active: true, metadataURI: metadataURI});
        emit ServiceCreated(serviceId, agentId, price, metadataURI);
    }

    function updateService(uint256 serviceId, uint256 price, bool active) external {
        Service storage s = services[serviceId];
        if (s.agentId == 0) revert UnknownService();
        if (registry.ownerOf(s.agentId) != msg.sender) revert NotAgentOwner();
        if (price == 0) revert InvalidPrice();
        s.price = price;
        s.active = active;
        emit ServiceUpdated(serviceId, price, active);
    }

    // ---------------------------------------------------------------- orders

    /// @notice A human buyer pays from their wallet. Requires prior USDC approval.
    function purchase(uint256 serviceId) external nonReentrant returns (uint256 orderId) {
        Service memory s = _activeService(serviceId);
        orderId = _openOrder(serviceId, s, 0);
        if (!usdc.transferFrom(msg.sender, address(this), s.price)) revert TransferFailed();
    }

    /// @notice An agent buys from another agent, paying out of its own vault treasury.
    function purchaseAsAgent(uint256 serviceId, uint256 buyerAgentId) external nonReentrant returns (uint256 orderId) {
        Service memory s = _activeService(serviceId);
        if (registry.ownerOf(buyerAgentId) != msg.sender) revert NotAgentOwner();
        if (buyerAgentId == s.agentId) revert SelfPurchase();
        orderId = _openOrder(serviceId, s, buyerAgentId);
        vault.debit(buyerAgentId, s.price, orderId); // vault sends USDC to this contract
    }

    /// @notice Operator confirms delivery: records the report hash and releases payment to the seller's vault.
    function fulfill(uint256 orderId, bytes32 reportHash) external onlyOperator nonReentrant {
        Order storage o = orders[orderId];
        if (o.status != Status.Pending) revert BadStatus();
        o.status = Status.Fulfilled;
        o.reportHash = reportHash;
        completedOrders[o.sellerAgentId] += 1;
        emit OrderFulfilled(orderId, o.sellerAgentId, reportHash, o.amount);
        if (!usdc.transfer(address(vault), o.amount)) revert TransferFailed();
        vault.credit(o.sellerAgentId, o.amount, orderId);
    }

    /// @notice Operator can refund any time; the buyer can self-refund after REFUND_DELAY if still pending.
    function refund(uint256 orderId) external nonReentrant {
        Order storage o = orders[orderId];
        if (o.status != Status.Pending) revert BadStatus();
        bool isOperator = msg.sender == operator;
        bool buyerTimedOut = msg.sender == o.buyer && block.timestamp >= o.createdAt + REFUND_DELAY;
        if (!isOperator && !buyerTimedOut) revert RefundNotAllowed();
        o.status = Status.Refunded;
        emit OrderRefunded(orderId, o.buyer, o.amount);
        if (o.buyerAgentId == 0) {
            if (!usdc.transfer(o.buyer, o.amount)) revert TransferFailed();
        } else {
            if (!usdc.transfer(address(vault), o.amount)) revert TransferFailed();
            vault.restore(o.buyerAgentId, o.amount, orderId);
        }
    }

    function getOrder(uint256 orderId) external view returns (Order memory) {
        return orders[orderId];
    }

    function getService(uint256 serviceId) external view returns (Service memory) {
        return services[serviceId];
    }

    // ---------------------------------------------------------------- internal

    function _activeService(uint256 serviceId) internal view returns (Service memory s) {
        s = services[serviceId];
        if (s.agentId == 0) revert UnknownService();
        if (!s.active || !registry.isActive(s.agentId)) revert ServiceInactive();
    }

    function _openOrder(uint256 serviceId, Service memory s, uint256 buyerAgentId) internal returns (uint256 orderId) {
        orderId = ++orderCount;
        orders[orderId] = Order({
            serviceId: serviceId,
            sellerAgentId: s.agentId,
            buyerAgentId: buyerAgentId,
            buyer: msg.sender,
            amount: s.price,
            createdAt: uint64(block.timestamp),
            status: Status.Pending,
            reportHash: bytes32(0)
        });
        emit OrderCreated(orderId, serviceId, s.agentId, buyerAgentId, msg.sender, s.price);
    }
}
