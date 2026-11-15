#!/usr/bin/env bash
# Rebuilds public/js/vendor/viem.js. Only needed if you upgrade viem.
# Usage: bash scripts/bundle-viem.sh
set -e
cd "$(dirname "$0")/.."
cat > scripts/.viem-entry.js <<'JS'
export { createWalletClient, createPublicClient, custom, http, parseUnits, formatUnits, maxUint256 } from 'viem';
export { base, baseSepolia } from 'viem/chains';
export { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
export { parseEther, formatEther } from 'viem';
JS
npx --yes esbuild scripts/.viem-entry.js --bundle --format=esm --minify --target=es2020 --outfile=public/js/vendor/viem.js
rm scripts/.viem-entry.js
echo "public/js/vendor/viem.js rebuilt"
