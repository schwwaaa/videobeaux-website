// Cloudflare Worker: the back door for the sign-up form and the beta feedback form (optional "hardened" mode — see README.md
// in this folder). POST / is the sign-up form; POST /feedback is the bug-report form (feedback.html), which goes to its own Google Form.
//
//   browser ──JSON──▶ this Worker ──checks──▶ Google Form (formResponse) ──▶ Google Sheet
//
// Checks before anything reaches Google: allowed website origin, JSON of a sensible size, valid email, length-limited free text, a
// Cloudflare Turnstile token (CAPTCHA, verified with Cloudflare), and a per-IP rate limit. The Google form address and its field
// names live only in this Worker's settings — they never appear on the website.
//
// Settings (wrangler.toml [vars], plus the secret): GOOGLE_ACTION, ENTRY_EMAIL, ENTRY_HEAR, ENTRY_INTEREST, ALLOWED_ORIGINS
// (comma-separated), TURNSTILE_SECRET (secret: `wrangler secret put TURNSTILE_SECRET`). Optional binding: RATE_LIMITER.
// Feedback form settings: FB_ACTION, FB_ENTRY_TYPE, FB_ENTRY_SUMMARY, FB_ENTRY_OS, FB_ENTRY_EMAIL (until FB_ACTION is set, /feedback answers 503).

const MAX_BODY = 8192
const MAX_TEXT = 1000
const MAX_REPORT = 4000
const FB_TYPES = ['Bug', 'Feedback', 'Feature idea']
const FB_OS = ['MacOS (Apple Silicon)', 'Windows']   // must match the feedback Google Form's option text exactly
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
  if (!data || typeof data !== 'object') return json({ ok: false, error: 'Bad request.' }, 400, okOrigin)
  const text = v => (typeof v === 'string' ? v.trim() : '')
  const email = text(data.email).toLowerCase()
  const badEmail = email.length > 254 || !EMAIL.test(email)

  // which form: POST /feedback is the beta bug-report form, anything else is the sign-up form
  const feedback = new URL(request.url).pathname.replace(/\/+$/, '') === '/feedback'
  let action, fields   // fields: [Google entry id, value] pairs, in the order they're sent
  if (feedback) {
    const type = text(data.type), summary = text(data.summary), os = text(data.os)
    if (!FB_TYPES.includes(type)) return json({ ok: false, error: 'Choose what kind of report this is.' }, 400, okOrigin)
    if (!summary) return json({ ok: false, error: 'Please tell us what’s going on.' }, 400, okOrigin)
    if (summary.length > MAX_REPORT) return json({ ok: false, error: 'Please keep your report shorter.' }, 400, okOrigin)
    if (os && !FB_OS.includes(os)) return json({ ok: false, error: 'Choose one of the listed computers.' }, 400, okOrigin)
    if (email && badEmail) return json({ ok: false, error: 'That email address doesn’t look right.' }, 400, okOrigin)
    if (!env.FB_ACTION || !env.FB_ENTRY_SUMMARY) return json({ ok: false, error: 'Feedback isn’t set up yet. Please try again later.' }, 503, okOrigin)
    action = env.FB_ACTION
    fields = [[env.FB_ENTRY_TYPE, type], [env.FB_ENTRY_SUMMARY, summary], [env.FB_ENTRY_OS, os], [env.FB_ENTRY_EMAIL, email]]
  } else {
    const hear = text(data.hear), interest = text(data.interest)
    if (!email || badEmail) return json({ ok: false, error: 'Please enter a valid email address.' }, 400, okOrigin)
    if (hear.length > MAX_TEXT || interest.length > MAX_TEXT) return json({ ok: false, error: 'Please keep your answers shorter.' }, 400, okOrigin)
    action = env.GOOGLE_ACTION
    fields = [[env.ENTRY_EMAIL, email], [env.ENTRY_HEAR, hear], [env.ENTRY_INTEREST, interest]]
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
    if (!verdict.success) {
      console.log('turnstile rejected:', JSON.stringify(verdict['error-codes'] || []))   // visible with `npx wrangler tail`; no secrets
      return json({ ok: false, error: 'The check failed. Please try again.' }, 400, okOrigin)
    }
  }

  // forward to the Google Form
  const body = new URLSearchParams()
  fields.forEach(([entry, value]) => { if (entry && value) body.append(entry, value) })
  const g = await fetchImpl(action, { method: 'POST', body, redirect: 'manual' })
  // a successful Google Form submission answers 200, or 302 to the confirmation page
  if (!(g.status === 200 || (g.status >= 300 && g.status < 400) || g.type === 'opaqueredirect')) {
    return json({ ok: false, error: 'Could not save that right now. Please try again later.' }, 502, okOrigin)
  }
  return json({ ok: true }, 200, okOrigin)
}

export default { fetch: (request, env) => handle(request, env) }
