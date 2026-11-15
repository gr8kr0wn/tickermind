// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {AgentVault} from "../src/AgentVault.sol";
import {AgentMarketplace} from "../src/AgentMarketplace.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";
import {IAgentRegistry} from "../src/interfaces/IAgentRegistry.sol";

/// forge script script/Deploy.s.sol --rpc-url base_sepolia --broadcast
contract Deploy is Script {
    // Circle USDC on Base Sepolia
    address constant BASE_SEPOLIA_USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address operator = vm.envAddress("OPERATOR_ADDRESS");
        address usdc = vm.envOr("USDC_ADDRESS", BASE_SEPOLIA_USDC);

        vm.startBroadcast(pk);
        AgentRegistry registry = new AgentRegistry();
        AgentVault vault = new AgentVault(IERC20(usdc), IAgentRegistry(address(registry)));
        AgentMarketplace market =
            new AgentMarketplace(IERC20(usdc), IAgentRegistry(address(registry)), vault, operator);
        vault.setMarketplace(address(market));
        vm.stopBroadcast();

        console2.log("NEXT_PUBLIC_REGISTRY_ADDRESS=", address(registry));
        console2.log("NEXT_PUBLIC_VAULT_ADDRESS=", address(vault));
        console2.log("NEXT_PUBLIC_MARKETPLACE_ADDRESS=", address(market));
        console2.log("NEXT_PUBLIC_USDC_ADDRESS=", usdc);
    }
}
