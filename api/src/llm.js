// Any OpenAI-compatible chat endpoint. Default: Groq free tier. Gemini's OpenAI-compat URL also works.
const cfg = require('./config');

const enabled = () => !!cfg.llm.key;

async function generateJSON(system, user) {
  if (!enabled()) return null;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 45000);
  try {
    const r = await fetch(cfg.llm.baseUrl.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.llm.key },
      body: JSON.stringify({
        model: cfg.llm.model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      }),
    });
    if (!r.ok) throw new Error(`LLM HTTP ${r.status}`);
    const j = await r.json();
    let txt = j.choices?.[0]?.message?.content || '';
    txt = txt.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    return JSON.parse(txt);
  } catch (e) {
    console.warn('[llm] failed, falling back to rule-based report:', e.message);
    return null;
  } finally {
    clearTimeout(t);
  }
}

module.exports = { generateJSON, enabled };
