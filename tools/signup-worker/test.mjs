// node tools/signup-worker/test.mjs — runs the Worker's checks against fake Google/Turnstile replies (no network, no deploy)
import assert from 'node:assert/strict'
import { handle } from './worker.js'

const env = {
  ALLOWED_ORIGINS: 'https://videobeaux.online', GOOGLE_ACTION: 'https://example.test/formResponse', ENTRY_EMAIL: 'entry.1',
  ENTRY_HEAR: 'entry.2', ENTRY_INTEREST: 'entry.3', TURNSTILE_SECRET: 's3cret'
}
let calls = []
const fakeFetch = (verdict = true, googleStatus = 200) => async (url, init) => {
  calls.push({ url: String(url), body: String(init?.body) })
  if (String(url).includes('turnstile')) return new Response(JSON.stringify({ success: verdict }))
  return new Response('', { status: googleStatus })
}
const req = (body, { origin = 'https://videobeaux.online', method = 'POST', headers = {}, path = '/' } = {}) =>
  new Request('https://signup.test' + path, { method, headers: { Origin: origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.2.3.4', ...headers }, body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined })
const good = { email: 'Tester@Example.com', hear: 'A friend', interest: 'VJ sets & glitch art', token: 'tok' }

let r
calls = []; r = await handle(req(good), env, fakeFetch())
assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ok: true })
assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'https://videobeaux.online')
assert.equal(calls.length, 2)
assert.match(calls[1].body, /entry\.1=tester%40example\.com/); assert.match(calls[1].body, /entry\.2=A\+friend/); assert.match(calls[1].body, /entry\.3=VJ\+sets/)

r = await handle(req(good, { origin: 'https://evil.example' }), env, fakeFetch()); assert.equal(r.status, 403)
r = await handle(req(good, { origin: '' }), env, fakeFetch()); assert.equal(r.status, 403)
r = await handle(req(null, { method: 'GET' }), env, fakeFetch()); assert.equal(r.status, 404)
r = await handle(req(null, { method: 'OPTIONS' }), env, fakeFetch()); assert.equal(r.status, 204)
r = await handle(req(null, { method: 'OPTIONS', origin: 'https://evil.example' }), env, fakeFetch()); assert.equal(r.status, 403)
r = await handle(req('not json'), env, fakeFetch()); assert.equal(r.status, 400)
r = await handle(req({ ...good, email: 'nope' }), env, fakeFetch()); assert.equal(r.status, 400)
r = await handle(req({ ...good, email: 'a'.repeat(300) + '@b.co' }), env, fakeFetch()); assert.equal(r.status, 400)
r = await handle(req({ ...good, interest: 'x'.repeat(1500) }), env, fakeFetch()); assert.equal(r.status, 400)
calls = []; r = await handle(req({ email: 'a@b.co', token: 'tok' }), env, fakeFetch()); assert.equal(r.status, 200)                      // the two text answers are optional
assert.doesNotMatch(calls[1].body, /entry\.2|entry\.3/)
r = await handle(req('x'.repeat(9000)), env, fakeFetch()); assert.equal(r.status, 413)
calls = []; r = await handle(req({ ...good, token: '' }), env, fakeFetch()); assert.equal(r.status, 400); assert.equal(calls.length, 0)   // no CAPTCHA token → nothing sent to Google
calls = []; r = await handle(req(good), env, fakeFetch(false)); assert.equal(r.status, 400); assert.equal(calls.length, 1)               // CAPTCHA rejected → nothing sent to Google
r = await handle(req(good), env, fakeFetch(true, 500)); assert.equal(r.status, 502)
r = await handle(req(good), env, fakeFetch(true, 302)); assert.equal(r.status, 200)                                                    // Google redirect = success
r = await handle(req(good), { ...env, RATE_LIMITER: { limit: async () => ({ success: false }) } }, fakeFetch()); assert.equal(r.status, 429)
// ── beta feedback form (POST /feedback) ──
const fbEnv = { ...env, FB_ACTION: 'https://example.test/fb/formResponse', FB_ENTRY_TYPE: 'entry.10', FB_ENTRY_SUMMARY: 'entry.11', FB_ENTRY_OS: 'entry.12', FB_ENTRY_EMAIL: 'entry.13' }
const fb = { type: 'Bug', summary: 'CRT mode crashes on export', os: 'Windows', email: 'T@Example.com', token: 'tok' }
const fbReq = (body, o = {}) => req(body, { path: '/feedback', ...o })

calls = []; r = await handle(fbReq(fb), fbEnv, fakeFetch())
assert.equal(r.status, 200); assert.equal(calls.length, 2)
assert.equal(calls[1].url, 'https://example.test/fb/formResponse')
assert.match(calls[1].body, /entry\.10=Bug/); assert.match(calls[1].body, /entry\.11=CRT\+mode/); assert.match(calls[1].body, /entry\.12=Windows/); assert.match(calls[1].body, /entry\.13=t%40example\.com/)
calls = []; r = await handle(fbReq({ type: 'Feedback', summary: 'Love it', token: 'tok' }), fbEnv, fakeFetch()); assert.equal(r.status, 200)   // computer and email are optional
assert.doesNotMatch(calls[1].body, /entry\.12|entry\.13/)
r = await handle(fbReq({ ...fb, type: 'Spam' }), fbEnv, fakeFetch()); assert.equal(r.status, 400)
r = await handle(fbReq({ ...fb, summary: '  ' }), fbEnv, fakeFetch()); assert.equal(r.status, 400)
r = await handle(fbReq({ ...fb, summary: 'x'.repeat(4500) }), fbEnv, fakeFetch()); assert.equal(r.status, 400)
r = await handle(fbReq({ ...fb, os: 'TempleOS' }), fbEnv, fakeFetch()); assert.equal(r.status, 400)
r = await handle(fbReq({ ...fb, email: 'nope' }), fbEnv, fakeFetch()); assert.equal(r.status, 400)
calls = []; r = await handle(fbReq({ ...fb, token: '' }), fbEnv, fakeFetch()); assert.equal(r.status, 400); assert.equal(calls.length, 0)       // no CAPTCHA token → nothing sent
calls = []; r = await handle(fbReq(fb), fbEnv, fakeFetch(false)); assert.equal(r.status, 400); assert.equal(calls.length, 1)                  // CAPTCHA rejected
calls = []; r = await handle(fbReq(fb), env, fakeFetch()); assert.equal(r.status, 503); assert.equal(calls.length, 0)                         // feedback Google Form not configured yet
r = await handle(fbReq(fb, { origin: 'https://evil.example' }), fbEnv, fakeFetch()); assert.equal(r.status, 403)
r = await handle(fbReq(fb), { ...fbEnv, RATE_LIMITER: { limit: async () => ({ success: false }) } }, fakeFetch()); assert.equal(r.status, 429)
calls = []; r = await handle(req(good, { path: '/' }), fbEnv, fakeFetch()); assert.equal(r.status, 200)                                         // sign-up still goes to the sign-up form
assert.equal(calls[1].url, 'https://example.test/formResponse')
console.log('✅ signup worker: all checks pass')
