// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {AgentVault} from "../src/AgentVault.sol";
import {AgentMarketplace} from "../src/AgentMarketplace.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";
import {IAgentRegistry} from "../src/interfaces/IAgentRegistry.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract TickerMindTest is Test {
    AgentRegistry registry;
    AgentVault vault;
    AgentMarketplace market;
    MockUSDC usdc;

    address operator = makeAddr("operator");
    address alice = makeAddr("alice"); // owns seller agent
    address bob = makeAddr("bob"); // human buyer / owns buyer agent

    uint256 sellerAgent;
    uint256 serviceId;
    uint256 constant PRICE = 5e6; // 5 USDC

    function setUp() public {
        usdc = new MockUSDC();
        registry = new AgentRegistry();
        vault = new AgentVault(IERC20(address(usdc)), IAgentRegistry(address(registry)));
        market = new AgentMarketplace(IERC20(address(usdc)), IAgentRegistry(address(registry)), vault, operator);
        vault.setMarketplace(address(market));

        vm.prank(alice);
        sellerAgent = registry.register("tickermind:agent:nvidia-brain");
        vm.prank(alice);
        serviceId = market.createService(sellerAgent, PRICE, "tickermind:service:nvda-report");

        usdc.mint(bob, 100e6);
        vm.prank(bob);
        usdc.approve(address(market), type(uint256).max);
    }

    function test_RegisterAssignsIncrementingIds() public {
        vm.prank(bob);
        uint256 id = registry.register("tickermind:agent:market-scout");
        assertEq(id, 2);
        assertEq(registry.ownerOf(id), bob);
        assertEq(registry.agentsOf(bob).length, 1);
    }

    function test_HumanPurchaseAndFulfill() public {
        vm.prank(bob);
        uint256 orderId = market.purchase(serviceId);
        assertEq(usdc.balanceOf(address(market)), PRICE);

        bytes32 h = keccak256("report");
        vm.prank(operator);
        market.fulfill(orderId, h);

        assertEq(vault.balanceOf(sellerAgent), PRICE);
        assertEq(vault.totalEarned(sellerAgent), PRICE);
        assertEq(usdc.balanceOf(address(vault)), PRICE);
        assertEq(market.getOrder(orderId).reportHash, h);
        assertEq(market.completedOrders(sellerAgent), 1);
    }

    function test_OnlyOperatorFulfills() public {
        vm.prank(bob);
        uint256 orderId = market.purchase(serviceId);
        vm.expectRevert(AgentMarketplace.NotOperator.selector);
        vm.prank(bob);
        market.fulfill(orderId, bytes32(0));
    }

    function test_BuyerRefundAfterDelay() public {
        vm.prank(bob);
        uint256 orderId = market.purchase(serviceId);
        vm.prank(bob);
        vm.expectRevert(AgentMarketplace.RefundNotAllowed.selector);
        market.refund(orderId);

        vm.warp(block.timestamp + 1 days);
        vm.prank(bob);
        market.refund(orderId);
        assertEq(usdc.balanceOf(bob), 100e6);
    }

    function test_AgentToAgentPurchaseFromTreasury() public {
        // seller earns first
        vm.prank(bob);
        uint256 o1 = market.purchase(serviceId);
        vm.prank(operator);
        market.fulfill(o1, keccak256("r1"));

        // bob's agent lists a service; alice's agent buys it with treasury funds
        vm.prank(bob);
        uint256 bobAgent = registry.register("tickermind:agent:market-scout");
        vm.prank(bob);
        uint256 scoutService = market.createService(bobAgent, 2e6, "tickermind:service:industry");

        vm.prank(alice);
        uint256 o2 = market.purchaseAsAgent(scoutService, sellerAgent);
        assertEq(vault.balanceOf(sellerAgent), PRICE - 2e6);

        vm.prank(operator);
        market.fulfill(o2, keccak256("r2"));
        assertEq(vault.balanceOf(bobAgent), 2e6);
        assertEq(vault.totalSpent(sellerAgent), 2e6);
    }

    function test_AgentRefundRestoresTreasuryWithoutCountingRevenue() public {
        vm.prank(bob);
        uint256 o1 = market.purchase(serviceId);
        vm.prank(operator);
        market.fulfill(o1, keccak256("r1"));

        vm.prank(bob);
        uint256 bobAgent = registry.register("tickermind:agent:market-scout");
        vm.prank(bob);
        uint256 scoutService = market.createService(bobAgent, 2e6, "x");

        vm.prank(alice);
        uint256 o2 = market.purchaseAsAgent(scoutService, sellerAgent);
        vm.prank(operator);
        market.refund(o2);

        assertEq(vault.balanceOf(sellerAgent), PRICE);
        assertEq(vault.totalEarned(sellerAgent), PRICE);
        assertEq(vault.totalSpent(sellerAgent), 0);
    }

    function test_CannotBuyOwnService() public {
        vm.prank(alice);
        vm.expectRevert(AgentMarketplace.SelfPurchase.selector);
        market.purchaseAsAgent(serviceId, sellerAgent);
    }

    function test_PolicyMustSumTo100Percent() public {
        vm.prank(alice);
        vm.expectRevert(AgentVault.InvalidPolicy.selector);
        vault.setPolicy(sellerAgent, 5000, 2000, 2000);

        vm.prank(alice);
        vault.setPolicy(sellerAgent, 6000, 2000, 2000);
        (uint16 r,,) = vault.getPolicy(sellerAgent);
        assertEq(r, 6000);
    }

    function test_OwnerWithdraws() public {
        vm.prank(bob);
        uint256 o1 = market.purchase(serviceId);
        vm.prank(operator);
        market.fulfill(o1, keccak256("r1"));

        vm.prank(bob);
        vm.expectRevert(AgentVault.NotAgentOwner.selector);
        vault.withdraw(sellerAgent, bob, 1);

        vm.prank(alice);
        vault.withdraw(sellerAgent, alice, PRICE);
        assertEq(usdc.balanceOf(alice), PRICE);
    }

    function test_InactiveAgentCannotSell() public {
        vm.prank(alice);
        registry.setActive(sellerAgent, false);
        vm.prank(bob);
        vm.expectRevert(AgentMarketplace.ServiceInactive.selector);
        market.purchase(serviceId);
    }
}
