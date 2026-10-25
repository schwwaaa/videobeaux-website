// Cloudflare Worker: the sign-up form's back door (optional "hardened" mode — see README.md in this folder).
//
//   browser ──JSON──▶ this Worker ──checks──▶ Google Form (formResponse) ──▶ Google Sheet
//
// Checks before anything reaches Google: allowed website origin, JSON of a sensible size, valid email, known interest tags, a
// Cloudflare Turnstile token (CAPTCHA, verified with Cloudflare), and a per-IP rate limit. The Google form address and its field
// names live only in this Worker's settings — they never appear on the website.
//
// Settings (wrangler.toml [vars], plus the secret): GOOGLE_ACTION, ENTRY_EMAIL, ENTRY_INTEREST, LABELS (JSON), ALLOWED_ORIGINS
// (comma-separated), TURNSTILE_SECRET (secret: `wrangler secret put TURNSTILE_SECRET`). Optional binding: RATE_LIMITER.

const MAX_BODY = 2048
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/

const json = (obj, status, origin) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {})
    }
  })

export async function handle(request, env, fetchImpl = fetch) {
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
  const origin = request.headers.get('Origin') || ''
  const okOrigin = allowed.includes(origin) ? origin : ''

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: okOrigin ? 204 : 403,
      headers: okOrigin ? {
        'Access-Control-Allow-Origin': okOrigin, 'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600', Vary: 'Origin'
      } : {}
    })
  }
  if (request.method !== 'POST') return json({ ok: false, error: 'Not found.' }, 404, okOrigin)
  if (!okOrigin) return json({ ok: false, error: 'Not allowed.' }, 403, '')

  // size limit (Content-Length can lie, so also check the text we actually read)
  const declared = Number(request.headers.get('Content-Length') || 0)
  if (declared > MAX_BODY) return json({ ok: false, error: 'Too large.' }, 413, okOrigin)
  const raw = await request.text()
  if (raw.length > MAX_BODY) return json({ ok: false, error: 'Too large.' }, 413, okOrigin)

  let data
  try { data = JSON.parse(raw) } catch { return json({ ok: false, error: 'Bad request.' }, 400, okOrigin) }
  const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : ''
  const tags = Array.isArray(data.tags) ? [...new Set(data.tags.map(String))] : []
  const labels = (() => { try { return JSON.parse(env.LABELS || '{}') } catch { return {} } })()
  if (!email || email.length > 254 || !EMAIL.test(email)) return json({ ok: false, error: 'Please enter a valid email address.' }, 400, okOrigin)
  if (!tags.length || tags.length > 5 || !tags.every(t => Object.prototype.hasOwnProperty.call(labels, t))) {
    return json({ ok: false, error: 'Choose at least one option.' }, 400, okOrigin)
  }

  const ip = request.headers.get('CF-Connecting-IP') || ''

  // rate limit (Cloudflare Workers Rate Limiting binding, if configured)
  if (env.RATE_LIMITER && typeof env.RATE_LIMITER.limit === 'function') {
    const { success } = await env.RATE_LIMITER.limit({ key: ip || 'unknown' })
    if (!success) return json({ ok: false, error: 'Too many attempts. Please wait a minute and try again.' }, 429, okOrigin)
  }

  // CAPTCHA (Cloudflare Turnstile), verified server-side
  if (env.TURNSTILE_SECRET) {
    const token = typeof data.token === 'string' ? data.token : ''
    if (!token || token.length > 2048) return json({ ok: false, error: 'Please complete the check and try again.' }, 400, okOrigin)
    const form = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token })
    if (ip) form.set('remoteip', ip)
    const v = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form })
    const verdict = await v.json().catch(() => ({}))
    if (!verdict.success) return json({ ok: false, error: 'The check failed. Please try again.' }, 400, okOrigin)
  }

  // forward to the Google Form
  const body = new URLSearchParams()
  body.append(env.ENTRY_EMAIL, email)
  tags.forEach(t => body.append(env.ENTRY_INTEREST, labels[t]))
  const g = await fetchImpl(env.GOOGLE_ACTION, { method: 'POST', body, redirect: 'manual' })
  // a successful Google Form submission answers 200, or 302 to the confirmation page
  if (!(g.status === 200 || (g.status >= 300 && g.status < 400) || g.type === 'opaqueredirect')) {
    return json({ ok: false, error: 'Could not save that right now. Please try again later.' }, 502, okOrigin)
  }
  return json({ ok: true }, 200, okOrigin)
}

export default { fetch: (request, env) => handle(request, env) }
