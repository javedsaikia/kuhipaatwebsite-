'use strict';

const { clientIp } = require('./rate-limit');

/**
 * Verifies a Turnstile token when TURNSTILE_SECRET_KEY is set.
 * When the secret is unset (local dev), verification is skipped (fail open).
 * When the secret is set, missing/invalid tokens fail closed.
 */
async function verifyTurnstile(token, req) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return { ok: true, skipped: true };

  const response = String(token || '').trim();
  if (!response || response.length > 2048) return { ok: false, reason: 'missing_token' };

  const allowedHosts = (process.env.TURNSTILE_HOSTNAMES || 'kuhipaatwebsite.vercel.app,localhost,127.0.0.1')
    .split(',')
    .map(h => h.trim().toLowerCase())
    .filter(Boolean);
  if (!allowedHosts.length) return { ok: false, reason: 'hostname_config' };

  const expectedAction = process.env.TURNSTILE_ACTION || 'early-access';

  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      secret,
      response,
      remoteip: req ? clientIp(req) : ''
    })
  });

  let data;
  try {
    data = await res.json();
  } catch (err) {
    return { ok: false, reason: 'bad_response' };
  }

  if (!res.ok || !data.success) {
    return { ok: false, reason: 'verify_failed' };
  }

  if (data.action && data.action !== expectedAction) {
    return { ok: false, reason: 'action_mismatch' };
  }

  const host = String(data.hostname || '').toLowerCase();
  if (host && allowedHosts.length && !allowedHosts.includes(host)) {
    return { ok: false, reason: 'hostname' };
  }

  return { ok: true };
}

module.exports = { verifyTurnstile, clientIp };