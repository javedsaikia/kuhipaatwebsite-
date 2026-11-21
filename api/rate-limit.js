'use strict';

/* Best-effort in-memory limiter (per serverless instance). Enough to blunt
   casual abuse; pair with Vercel Firewall for production hardening. */

const buckets = new Map();

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'] || req.headers['X-Forwarded-For'];
  if (typeof fwd === 'string' && fwd.trim()) return fwd.split(',')[0].trim();
  if (Array.isArray(fwd) && fwd[0]) return String(fwd[0]).trim();
  const real = req.headers['x-real-ip'] || req.headers['X-Real-Ip'];
  if (typeof real === 'string' && real.trim()) return real.trim();
  if (req.socket && req.socket.remoteAddress) return req.socket.remoteAddress;
  return 'unknown';
}

/**
 * @returns {{ allowed: boolean, remaining: number }}
 */
function rateLimit(req, options) {
  const key = options.key || 'default';
  const max = options.max || 30;
  const windowMs = options.windowMs || 60 * 60 * 1000;
  const id = key + ':' + clientIp(req);
  const now = Date.now();

  let bucket = buckets.get(id);
  if (!bucket || now - bucket.start > windowMs) {
    bucket = { start: now, count: 0 };
    buckets.set(id, bucket);
  }
  bucket.count += 1;

  if (buckets.size > 8000) {
    for (const [k, v] of buckets) {
      if (now - v.start > windowMs) buckets.delete(k);
    }
  }

  return {
    allowed: bucket.count <= max,
    remaining: Math.max(0, max - bucket.count)
  };
}

module.exports = { rateLimit, clientIp };