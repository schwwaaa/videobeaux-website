# Hardened sign-up (optional)

A tiny Cloudflare Worker that sits between the website's form and your Google Form. Free tier is plenty.

```
browser ──▶ Worker (CAPTCHA + rate limit + validation) ──▶ Google Form ──▶ Google Sheet
```

Once it's live the Google form's address and field names exist only in the Worker's settings, not on the website.

## Set it up (about 10 minutes)

1. Create a free account at https://dash.cloudflare.com (no domain needed).
2. **Turnstile:** Dashboard → *Turnstile* → *Add widget*. Hostnames: `videobeaux.online` (add `localhost` while testing). Mode: *Managed*.
   Note the **site key** (public) and **secret key** (private).
3. Deploy the Worker (needs Node):
   ```bash
   cd tools/signup-worker
   npx wrangler login
   npx wrangler deploy
   npx wrangler secret put TURNSTILE_SECRET        # paste the Turnstile secret key
   ```
   Wrangler prints the Worker's address, e.g. `https://videobeaux-signup.YOUR-NAME.workers.dev`.
4. Check `wrangler.toml`: `ALLOWED_ORIGINS` is the website address(es) allowed to call it; `GOOGLE_ACTION`, `ENTRY_EMAIL`, `ENTRY_INTEREST` and
   `LABELS` mirror the Google Form (change them here if you change the form).
5. In `site/site.js` set `endpoint: 'https://videobeaux-signup.YOUR-NAME.workers.dev'` and `turnstile: 'YOUR-SITE-KEY'`, then empty the
   `google` block (so the Google form address leaves the page). Commit and push.
6. Test: submit the form on the live site → a new row in the Google Sheet. Try submitting twice quickly (you should get a rate-limit message).

## The alpha feedback form

The same Worker also serves `feedback.html` at `POST /feedback` (same Turnstile check and rate limit), forwarding to a second Google Form.
To switch it on: make that form (questions: type, report, computer, email), find each question's `entry.` id in its page source, fill in
the `FB_*` values in `wrangler.toml`, and run `npx wrangler deploy` again. Until `FB_ACTION` is set the page shows "Feedback isn't set up yet."
The type and computer options must match the Google Form's option text exactly (`FB_TYPES` / `FB_OS` at the top of `worker.js`).

## Checks

`node tools/signup-worker/test.mjs` runs the Worker's logic against fake Google/Turnstile replies (origin, size, email, allowed choices, CAPTCHA,
rate limit, Google errors) — no network, no deploy needed. Run it after any change to `worker.js`.

## Notes

- The Origin check keeps other *websites* from using the endpoint from a browser; it can't stop a script that forges the header. The CAPTCHA and the
  per-IP limit are what stop scripts.
- Keep the Turnstile **secret** only in the Worker (`wrangler secret`), never in the repo or `site.js`. The site key is public.
- Logs and analytics: Cloudflare's dashboard shows request counts and errors for the Worker.
