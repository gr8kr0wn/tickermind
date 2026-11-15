// Public, non-secret settings the browser needs (chain + contract addresses).
import { route } from '../lib/http.js';
import { env } from '../lib/env.js';

export default route({
  GET: async () => ({
    chainId: env.chainId,
    rpcUrl: env.rpcUrl,
    explorer: env.explorer,
    addresses: env.addresses,
    usdcDecimals: 6,
    contractsReady: Boolean(env.addresses.registry && env.addresses.vault && env.addresses.marketplace),
  }),
});
