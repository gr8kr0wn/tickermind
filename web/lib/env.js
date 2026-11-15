// Central place for configuration. Everything comes from environment variables (.env locally, Vercel settings in prod).

const BASE_SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

export class ConfigError extends Error {}

export function need(name) {
  const v = process.env[name];
  if (!v || !String(v).trim()) throw new ConfigError(`Missing environment variable ${name}. Add it to your .env (see .env.example).`);
  return String(v).trim();
}

export const env = {
  get chainId() { return Number(process.env.CHAIN_ID || 84532); },
  get rpcUrl() { return process.env.RPC_URL || (this.chainId === 8453 ? 'https://mainnet.base.org' : 'https://sepolia.base.org'); },
  get explorer() { return this.chainId === 8453 ? 'https://basescan.org' : 'https://sepolia.basescan.org'; },
  get addresses() {
    return {
      registry: process.env.REGISTRY_ADDRESS || '',
      vault: process.env.VAULT_ADDRESS || '',
      marketplace: process.env.MARKETPLACE_ADDRESS || '',
      usdc: process.env.USDC_ADDRESS || BASE_SEPOLIA_USDC,
    };
  },
  get geminiModel() { return process.env.GEMINI_MODEL || 'gemini-3.8-flash'; },
  get geminiFallbackModel() { return process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.5-flash-lite'; },
  get groqModel() { return process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'; },
  get secUserAgent() { return process.env.SEC_USER_AGENT || 'TickerMind research-bot contact@example.com'; },
};
