// Supabase-only storage adapter for the Edge Function build. Tables live in the public schema
// with a "tm_" prefix so TickerMind can share a project without touching other apps' tables.
const { createClient } = require('@supabase/supabase-js');

const PREFIX = 'tm_';
const T = (t) => PREFIX + t;
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const check = ({ data, error }) => {
  if (error) throw new Error('Supabase: ' + error.message);
  return data;
};

module.exports = {
  kind: 'supabase',
  async insert(t, row) {
    return check(await sb.from(T(t)).insert(row).select().single());
  },
  async insertMany(t, rows) {
    return check(await sb.from(T(t)).insert(rows).select());
  },
  async get(t, id) {
    return check(await sb.from(T(t)).select('*').eq('id', id).maybeSingle());
  },
  // PostgREST caps a response at 1000 rows, so page through until `limit` rows (or the end) are read.
  async list(t, { where = {}, order = 'created_at', desc = true, limit = 1000 } = {}) {
    const out = [];
    const PAGE = 1000;
    while (out.length < limit) {
      let q = sb.from(T(t)).select('*');
      for (const [k, v] of Object.entries(where)) q = q.eq(k, v);
      const rows = check(await q.order(order, { ascending: !desc }).order('id').range(out.length, Math.min(out.length + PAGE, limit) - 1));
      out.push(...rows);
      if (rows.length < PAGE) break;
    }
    return out;
  },
  async update(t, id, patch) {
    return check(await sb.from(T(t)).update(patch).eq('id', id).select().maybeSingle());
  },
  async claimTask() {
    const next = check(await sb.from(T('tasks')).select('*').eq('status', 'pending').order('created_at', { ascending: true }).limit(1))[0];
    if (!next) return null;
    const won = check(await sb.from(T('tasks')).update({ status: 'processing' }).eq('id', next.id).eq('status', 'pending').select());
    return won && won.length ? won[0] : null;
  },
};
