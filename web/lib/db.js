import { createClient } from '@supabase/supabase-js';
import { need } from './env.js';

let client;

/** Server-only Supabase client (service role). Never expose this key to the browser. */
export function db() {
  if (!client) {
    client = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

/** Unwraps a Supabase response, throwing on error. */
export function must({ data, error }) {
  if (error) throw new Error(`Database error: ${error.message}`);
  return data;
}
