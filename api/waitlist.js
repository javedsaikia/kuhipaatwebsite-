'use strict';

const { rateLimit } = require('./rate-limit');
const { verifyTurnstile } = require('./turnstile-verify');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
const MAX_NAME = 80;
const MIN_NAME = 2;
/* Inbox for early-access inquiries only — we never email the visitor back. */
const WAITLIST_INBOX = 'kuhipaatedu@gmail.com';

function waitlistInbox() {
  return WAITLIST_INBOX;
}

function hasResendDelivery() {
  return Boolean(String(process.env.RESEND_API_KEY || '').trim());
}

function hasWebhookDelivery() {
  return Boolean(String(process.env.WAITLIST_WEBHOOK_URL || '').trim());
}

function mustPersistSignup() {
  /* On Vercel, do not pretend success unless delivery is configured. */
  if (process.env.VERCEL) return true;
  return hasWebhookDelivery() || hasResendDelivery();
}

const RECENT = new Map(); /* email → timestamp, per-instance duplicate guard */

function cleanString(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max);
}

function isDuplicateEmail(email) {
  const key = email.toLowerCase();
  const last = RECENT.get(key);
  const now = Date.now();
  if (last && now - last < 24 * 60 * 60 * 1000) return true;
  RECENT.set(key, now);
  if (RECENT.size > 5000) {
    for (const [k, t] of RECENT) {
      if (now - t > 24 * 60 * 60 * 1000) RECENT.delete(k);
    }
  }
  return false;
}

async function forwardWebhook(record) {
  const url = process.env.WAITLIST_WEBHOOK_URL;
  if (!url) return { forwarded: false };
  const payload = {
    ...record,
    inbox: waitlistInbox()
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error('webhook ' + res.status + ': ' + text.slice(0, 120));
  }
  return { forwarded: true };
}

async function notifyResend(record) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { sent: false };
  const domain = String(process.env.RESEND_EMAIL_DOMAIN || '').trim();
  const fromCandidates = [];
  if (process.env.WAITLIST_FROM_EMAIL) fromCandidates.push(process.env.WAITLIST_FROM_EMAIL);
  if (domain) fromCandidates.push(`Moina Mel Waitlist <waitlist@${domain}>`);
  fromCandidates.push('Moina Mel Waitlist <onboarding@resend.dev>');

  const body = {
    to: [waitlistInbox()],
    subject: 'Early access request: ' + record.name,
    text: [
      'Someone requested early access on kuhipaatwebsite.',
      '',
      'Name: ' + record.name,
      'Their email: ' + record.email,
      'Language: ' + record.lang,
      'Submitted: ' + record.at
    ].join('\n')
  };

  let lastErr = '';
  for (const from of fromCandidates) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ ...body, from })
    });
    if (res.ok) return { sent: true };
    lastErr = await res.text().catch(() => '');
    if (res.status !== 422 && res.status !== 403) break;
  }
  throw new Error('resend: ' + lastErr.slice(0, 120));
}

async function persistSignup(record) {
  let webhook = { forwarded: false };
  if (hasWebhookDelivery()) webhook = await forwardWebhook(record);
  let resend = { sent: false };
  if (hasResendDelivery()) resend = await notifyResend(record);

  if (webhook.forwarded || resend.sent) {
    return { stored: true };
  }

  console.log('[waitlist] new signup (no webhook/resend):', record.email, record.lang);
  return { stored: false, logged: true };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method not allowed' });
  }

  const rl = rateLimit(req, {
    key: 'waitlist',
    max: Number(process.env.WAITLIST_RATE_MAX || 8),
    windowMs: 60 * 60 * 1000
  });
  if (!rl.allowed) {
    return res.status(429).json({ error: 'too_many_requests' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (err) { body = null; }
  }
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'invalid body' });
  }

  /* Honeypot — bots fill hidden fields; humans never see them. */
  if (cleanString(body.website, 200)) {
    return res.status(200).json({ ok: true });
  }

  const turnstile = await verifyTurnstile(
    body.turnstileToken || body['cf-turnstile-response'],
    req
  );
  if (!turnstile.ok) {
    return res.status(403).json({ error: 'captcha_failed', lang: body.lang === 'as' ? 'as' : 'en' });
  }

  const lang = body.lang === 'as' ? 'as' : 'en';
  const name = cleanString(body.name, MAX_NAME);
  const email = cleanString(body.email, 254).toLowerCase();

  if (name.length < MIN_NAME) {
    return res.status(400).json({ error: 'invalid_name', lang });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'invalid_email', lang });
  }

  if (isDuplicateEmail(email)) {
    return res.status(200).json({ ok: true, duplicate: true });
  }

  const record = {
    name,
    email,
    lang,
    source: 'early-access',
    at: new Date().toISOString()
  };

  try {
    const mustStore = mustPersistSignup();
    const result = await persistSignup(record);
    if (mustStore && !result.stored) {
      return res.status(503).json({ error: 'storage_not_configured', lang });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[waitlist]', err.message);
    return res.status(502).json({ error: 'storage_failed', lang });
  }
};