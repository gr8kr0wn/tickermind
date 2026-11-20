// Tiny storage adapter. Uses Supabase when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set,
// otherwise a local JSON file (data/db.json) so the app runs with zero setup for demos/dev.
// BIGINT money columns are plain integers in JS; micro-USDC stays far below 2^53.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const uuid = () => crypto.randomUUID();

function makeLocal() {
  const file = process.env.LOCAL_DB_FILE || path.join(__dirname, '..', '..', 'data', 'db.json');
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {}
  let timer = null;
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(data));
    }, 100);
  };
  const tbl = (t) => (data[t] = data[t] || []);
  const matches = (row, where = {}) => Object.entries(where).every(([k, v]) => row[k] === v);
  return {
    kind: 'local',
    async insert(t, row) {
      const r = { id: uuid(), created_at: new Date().toISOString(), ...row };
      tbl(t).push(r);
      save();
      return { ...r };
    },
    async insertMany(t, rows) {
      const out = [];
      for (const row of rows) out.push(await this.insert(t, row));
      return out;
    },
    async get(t, id) {
      const r = tbl(t).find((x) => x.id === id);
      return r ? { ...r } : null;
    },
    async list(t, { where = {}, order = 'created_at', desc = true, limit = 1000 } = {}) {
      const rows = tbl(t).filter((r) => matches(r, where));
      rows.sort((a, b) => (a[order] > b[order] ? 1 : a[order] < b[order] ? -1 : 0));
      if (desc) rows.reverse();
      return rows.slice(0, limit).map((r) => ({ ...r }));
    },
    async update(t, id, patch) {
      const r = tbl(t).find((x) => x.id === id);
      if (!r) return null;
      Object.assign(r, patch);
      save();
      return { ...r };
    },
    // Atomically claim the oldest pending task (single process, so a plain check-and-set is safe).
    async claimTask() {
      const r = tbl('tasks')
        .filter((x) => x.status === 'pending')
        .sort((a, b) => (a.created_at > b.created_at ? 1 : -1))[0];
      if (!r) return null;
      r.status = 'processing';
      save();
      return { ...r };
    },
  };
}

function makeSupabase() {
  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const check = ({ data, error }) => {
    if (error) throw new Error('Supabase: ' + error.message);
    return data;
  };
  return {
    kind: 'supabase',
    async insert(t, row) {
      return check(await sb.from(t).insert(row).select().single());
    },
    async insertMany(t, rows) {
      return check(await sb.from(t).insert(rows).select());
    },
    async get(t, id) {
      return check(await sb.from(t).select('*').eq('id', id).maybeSingle());
    },
    async list(t, { where = {}, order = 'created_at', desc = true, limit = 1000 } = {}) {
      let q = sb.from(t).select('*');
      for (const [k, v] of Object.entries(where)) q = q.eq(k, v);
      return check(await q.order(order, { ascending: !desc }).limit(limit));
    },
    async update(t, id, patch) {
      return check(await sb.from(t).update(patch).eq('id', id).select().maybeSingle());
    },
    async claimTask() {
      // optimistic claim: set processing only if still pending
      const next = check(
        await sb.from('tasks').select('*').eq('status', 'pending').order('created_at', { ascending: true }).limit(1)
      )[0];
      if (!next) return null;
      const won = check(
        await sb.from('tasks').update({ status: 'processing' }).eq('id', next.id).eq('status', 'pending').select()
      );
      return won && won.length ? won[0] : null;
    },
  };
}

const useSupabase = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
module.exports = useSupabase ? makeSupabase() : makeLocal();
