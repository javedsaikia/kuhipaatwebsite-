/* ==========================================================================
   POST /api/chat — Moina's model proxy

   The one job here is that the API key never reaches a browser. The page calls
   this function, this function calls the provider, the key lives only in an
   environment variable on the server.

   Provider is chosen with MOINA_PROVIDER ('groq' | 'gemini' | 'xai'). Groq and
   xAI both speak the OpenAI chat-completions shape, so they share one adapter
   and differ only by base URL; Gemini has its own. Either way the widget never
   learns which one answered.

   Environment
     MOINA_PROVIDER   groq | gemini | xai     (default: groq)
     GROQ_API_KEY     key, when provider=groq
     GEMINI_API_KEY   key, when provider=gemini
     XAI_API_KEY      key, when provider=xai
     MOINA_MODEL      optional model id override

   The guard runs again here on the way in AND on the way out. The copy in the
   browser is a courtesy; this one is the rule.
   ========================================================================== */
'use strict';

const guard = require('../js/moina-guard.js');

const PROVIDER = (process.env.MOINA_PROVIDER || 'groq').toLowerCase();

/* Model ids move faster than this file will. Override with MOINA_MODEL if your
   account exposes a different one — an unknown id shows up as a 404 from the
   provider, which this function surfaces in the logs verbatim.

   groq default: llama-3.3-70b-versatile, picked by testing the shortlist on
   real Assamese prompts. The 8b model invents Assamese words and qwen3.6 emits
   its <think> scratchpad into the reply. */
const DEFAULT_MODEL = {
  groq: 'llama-3.3-70b-versatile',
  gemini: 'gemini-2.5-flash',
  xai: 'grok-3-mini'
};

/* Both are OpenAI-compatible; only the host differs. */
const OPENAI_COMPATIBLE = {
  groq: 'https://api.groq.com/openai/v1/chat/completions',
  xai: 'https://api.x.ai/v1/chat/completions'
};

const API_KEY_ENV = {
  groq: 'GROQ_API_KEY',
  gemini: 'GEMINI_API_KEY',
  xai: 'XAI_API_KEY'
};

const MAX_TURNS = 16;      // messages, not exchanges
const MAX_TOKENS = 300;    // a bird friend answers in 1-3 sentences

/* -------------------------------------------------------------- gemini --- */
async function callGemini(messages, key, model) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
    encodeURIComponent(model) + ':generateContent';

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: guard.SYSTEM_PROMPT }] },
      contents: messages.map(m => ({
        role: m.role === 'model' ? 'model' : 'user',
        parts: [{ text: m.content }]
      })),
      generationConfig: {
        temperature: 0.8,
        maxOutputTokens: MAX_TOKENS,
        topP: 0.9
      },
      /* Belt and braces alongside our own screening — the provider refuses at
         the lowest threshold it offers, because the audience is 3-10. */
      safetySettings: [
        'HARM_CATEGORY_HARASSMENT',
        'HARM_CATEGORY_HATE_SPEECH',
        'HARM_CATEGORY_SEXUALLY_EXPLICIT',
        'HARM_CATEGORY_DANGEROUS_CONTENT'
      ].map(category => ({ category, threshold: 'BLOCK_LOW_AND_ABOVE' }))
    })
  });

  const data = await res.json();
  if (!res.ok) {
    const detail = data && data.error ? data.error.message : res.statusText;
    throw new Error('gemini ' + res.status + ': ' + detail);
  }

  // Refused by the provider's own filter — treat exactly like our block tier.
  if (data.promptFeedback && data.promptFeedback.blockReason) return { blocked: true };

  const candidate = data.candidates && data.candidates[0];
  if (!candidate || candidate.finishReason === 'SAFETY') return { blocked: true };

  const parts = (candidate.content && candidate.content.parts) || [];
  return { text: parts.map(p => p.text || '').join('').trim() };
}

/* --------------------------------------------------- openai-compatible --- */
async function callOpenAICompatible(url, messages, key, model, label) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + key
    },
    body: JSON.stringify({
      model,
      max_tokens: MAX_TOKENS,
      temperature: 0.8,
      messages: [{ role: 'system', content: guard.SYSTEM_PROMPT }].concat(
        messages.map(m => ({
          role: m.role === 'model' ? 'assistant' : 'user',
          content: m.content
        }))
      )
    })
  });

  const data = await res.json();
  if (!res.ok) {
    const detail = data && data.error
      ? (data.error.message || JSON.stringify(data.error))
      : res.statusText;
    throw new Error(label + ' ' + res.status + ': ' + detail);
  }

  const choice = data.choices && data.choices[0];
  let text = choice && choice.message ? String(choice.message.content || '') : '';

  /* Reasoning-style models can prepend a <think> scratchpad. It is not for a
     child to read, and on some models it swallows the whole reply. */
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*?<\/think>/i, '');

  return { text: text.trim() };
}

/* --------------------------------------------------------------- handler - */
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (err) { body = null; }
  }
  if (!body || !Array.isArray(body.messages)) {
    return res.status(400).json({ error: 'expected { messages: [] }' });
  }

  const lang = body.lang === 'as' ? 'as' : 'en';

  const messages = body.messages
    .filter(m => m && typeof m.content === 'string' && m.content.trim())
    .slice(-MAX_TURNS)
    .map(m => ({
      role: m.role === 'model' ? 'model' : 'user',
      content: m.content.slice(0, guard.MAX_INPUT)
    }));

  if (!messages.length) return res.status(400).json({ error: 'no messages' });

  const latest = messages[messages.length - 1];
  if (latest.role !== 'user') return res.status(400).json({ error: 'last message must be from the user' });

  // The real gate. The browser may have skipped its copy; this one it can't.
  const verdict = guard.screen(latest.content, lang);
  if (verdict) return res.status(200).json({ reply: verdict.reply, guarded: true });

  const key = process.env[API_KEY_ENV[PROVIDER] || 'GROQ_API_KEY'];
  if (!key) {
    console.error('[moina] missing API key for provider "' + PROVIDER + '"');
    return res.status(500).json({ error: 'server is not configured' });
  }

  const model = process.env.MOINA_MODEL || DEFAULT_MODEL[PROVIDER] || DEFAULT_MODEL.groq;

  try {
    const compatible = OPENAI_COMPATIBLE[PROVIDER];
    const result = compatible
      ? await callOpenAICompatible(compatible, messages, key, model, PROVIDER)
      : await callGemini(messages, key, model);

    if (result.blocked) {
      return res.status(200).json({ reply: guard.REPLY[lang].block, guarded: true });
    }

    const text = (result.text || '').trim();
    if (!text) {
      return res.status(200).json({ reply: guard.REPLY[lang].block, guarded: true });
    }

    // Last look at what the model actually said before a child reads it.
    const unsafe = guard.screenOutput(text, lang);
    if (unsafe) return res.status(200).json({ reply: unsafe, guarded: true });

    return res.status(200).json({ reply: text });
  } catch (err) {
    console.error('[moina]', err.message);
    return res.status(502).json({ error: 'upstream failed' });
  }
};
