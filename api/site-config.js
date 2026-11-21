'use strict';

/* Public, non-secret config for the static frontend. */
module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method not allowed' });
  }

  res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
  return res.status(200).json({
    turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || ''
  });
};