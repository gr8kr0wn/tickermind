// LLM calls with a free-tier fallback chain: Gemini (primary) → Gemini (lighter model) → Groq.
import { env } from './env.js';

class RetryableError extends Error {}

async function gemini(model, system, prompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new RetryableError('GEMINI_API_KEY not set');
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.35 },
    }),
  });
  if (res.status === 429 || res.status >= 500 || res.status === 404) throw new RetryableError(`Gemini ${model} ${res.status}`);
  if (!res.ok) throw new Error(`Gemini error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  if (!text) throw new RetryableError('Gemini returned no text');
  return text;
}

async function groq(system, prompt) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new RetryableError('GROQ_API_KEY not set');
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: env.groqModel,
      temperature: 0.35,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
    }),
  });
  if (res.status === 429 || res.status >= 500) throw new RetryableError(`Groq ${res.status}`);
  if (!res.ok) throw new Error(`Groq error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content || '';
}

function parseJson(text) {
  const cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  return JSON.parse(cleaned.slice(start, end + 1));
}

/** Returns { json, model }. Tries each provider until one answers with valid JSON. */
export async function generateJson(system, prompt) {
  const attempts = [
    [`gemini:${env.geminiModel}`, () => gemini(env.geminiModel, system, prompt)],
    [`gemini:${env.geminiFallbackModel}`, () => gemini(env.geminiFallbackModel, system, prompt)],
    [`groq:${env.groqModel}`, () => groq(system, prompt)],
  ];
  const errors = [];
  for (const [model, run] of attempts) {
    try {
      const text = await run();
      return { json: parseJson(text), model };
    } catch (e) {
      errors.push(`${model}: ${e.message}`);
      // fall through to the next provider on any failure (rate limit, bad model name, bad JSON)
    }
  }
  throw new Error(`AI engine unavailable. ${errors.join(' | ')}`);
}
