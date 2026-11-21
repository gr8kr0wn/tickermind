try { require('dotenv').config(); } catch (_) {}
const crypto = require('crypto');

const env = (k, d = '') => (process.env[k] === undefined || process.env[k] === '' ? d : process.env[k]);

const cfg = {
  port: Number(env('PORT', '3000')),
  chainId: Number(env('CHAIN_ID', '84532')),
  rpcUrl: env('BASE_RPC_URL', 'https://sepolia.base.org'),
  usdc: env('USDC_ADDRESS', '0x036CbD53842c5426634e7929541eC2318f3dCF7e'),
  registry: env('AGENT_REGISTRY_ADDRESS', '0x86E368dEe7194756528D2f6C7Cd57c63333d030d'),
  marketplace: env('MARKETPLACE_ADDRESS', '0xF4eA5a89E613eAb3196333B76763a12039E35E25'),
  demoMode: env('DEMO_MODE', '1') === '1',
  // On Supabase the service-role key is always present and private, so it gives every instance the same stable secret.
  sessionSecret: env('SESSION_SECRET') ||
    (process.env.SUPABASE_SERVICE_ROLE_KEY
      ? crypto.createHmac('sha256', process.env.SUPABASE_SERVICE_ROLE_KEY).update('tickermind-session').digest('hex')
      : crypto.randomBytes(32).toString('hex')),
  sessionSecretIsRandom: !env('SESSION_SECRET') && !process.env.SUPABASE_SERVICE_ROLE_KEY,
  secUserAgent: env('SEC_USER_AGENT', 'TickerMind hackathon-project greatademola26@gmail.com'),
  llm: {
    key: env('LLM_API_KEY'),
    baseUrl: env('LLM_BASE_URL', 'https://api.groq.com/openai/v1'),
    model: env('LLM_MODEL', 'llama-3.3-70b-versatile'),
  },
  workerIntervalMs: Number(env('WORKER_INTERVAL_MS', '3000')),
  schedulerEnabled: env('SCHEDULER_ENABLED', '1') === '1',
  maxTasksPerAgentPerHour: Number(env('MAX_TASKS_PER_AGENT_PER_HOUR', '20')),
  allowedOrigin: env('ALLOWED_ORIGIN', '*'),
};

cfg.chainEnabled = !!(cfg.registry && cfg.marketplace);
module.exports = cfg;
