# Hardened forms: Cloudflare Worker + Turnstile

A tiny Cloudflare Worker that sits between the website's two forms (alpha sign-up on the home page, bug reports on `feedback.html`) and their
Google Forms. Free tier is plenty. Your site does **not** have to be hosted on Cloudflare (it's on GitHub Pages): the Worker lives at a
`workers.dev` address and the Turnstile widget loads from Cloudflare into any page.

```
browser ──▶ Worker (CAPTCHA + rate limit + validation) ──▶ Google Form ──▶ Google Sheet
            POST /          → sign-up form's Google Form
            POST /feedback  → feedback form's Google Form
```

The Google forms' addresses and field ids exist only in the Worker's settings (`wrangler.toml`), not on the website.

## What is Wrangler?

Cloudflare's command-line tool for uploading Workers. `npx wrangler …` runs it without installing it (needs Node). The website itself never
uses it; only this folder does. **Always run it from `tools/signup-worker/`** (the folder with `wrangler.toml`); from anywhere else it fails with
"Could not detect a directory containing static files".

| Command | What it does |
|---|---|
| `npx wrangler login` / `logout` | sign in / out of Cloudflare (opens a browser) |
| `npx wrangler whoami` | which Cloudflare account you're signed into |
| `npx wrangler deploy` | upload `worker.js` + the settings in `wrangler.toml` (do this after every change to either) |
| `npx wrangler secret put TURNSTILE_SECRET` | store the Turnstile secret on Cloudflare (takes effect immediately, no deploy needed) |
| `npx wrangler secret list` | names of stored secrets (never the values) |
| `npx wrangler tail` | live log of requests, including why a CAPTCHA was rejected |

## Set it up (about 10 minutes)

1. Create a free account at https://dash.cloudflare.com (no domain needed).
2. **Turnstile:** Dashboard → *Turnstile* → *Add widget*. Hostnames: `videobeaux.online` (add `localhost` while testing). Mode: *Managed*.
   Note the **site key** (public, starts `0x4AAAA…`) and the **secret key** (private, a different, longer value). One widget serves both forms.
3. Deploy the Worker, from this folder:
   ```bash
   npx wrangler login
   npx wrangler deploy
   npx wrangler secret put TURNSTILE_SECRET        # paste the Turnstile SECRET key, nothing else
   ```
   Wrangler prints the Worker's address, e.g. `https://videobeaux-signup.YOUR-NAME.workers.dev`.
4. Check `wrangler.toml`: `ALLOWED_ORIGINS` is the website address(es) allowed to call it (add `https://www.…` or a test origin if needed);
   the other values mirror the Google Forms (see below). Change them here whenever you change a form, then deploy again.
5. Put the Worker address and the **site key** in the two scripts: `endpoint` and `turnstile` in `site/site.js` (sign-up) and in `site/feedback.js`
   (the feedback endpoint is the same address plus `/feedback`). Commit and push.
6. Test both live forms: a new row in each Google Sheet. Submitting twice quickly should give a rate-limit message (3 per minute per IP).

## The two Google Forms

Question ids are the `entry.NNNN` numbers in the form's public page: open the responder link (`…/viewform`), View Page Source, search `entry.`
(or fetch the page and read `FB_PUBLIC_LOAD_DATA_`). Changing a question's *type* keeps its id; deleting and re-adding it gives a new one.
Don't require sign-in, leave "Limit to 1 response" off.

**Sign-up form** (`GOOGLE_ACTION`, `ENTRY_EMAIL`, `ENTRY_HEAR`, `ENTRY_INTEREST`):
Email (short answer, required, validated as email), "How did you hear…" (short answer, optional), "Interest / use case" (short answer, optional).

**Feedback form** (`FB_ACTION`, `FB_ENTRY_TYPE`, `FB_ENTRY_SUMMARY`, `FB_ENTRY_OS`, `FB_ENTRY_EMAIL`):

| Question | Type | Notes |
|---|---|---|
| This is a | Multiple choice | options exactly: `Bug`, `Feedback`, `Feature idea` (`FB_TYPES` in `worker.js`) |
| Tell us what's going on | **Paragraph** | not multiple choice: Google rejects typed text for a multiple-choice question |
| Your computer | Multiple choice | options exactly: `MacOS (Apple Silicon)`, `Windows` (`FB_OS` in `worker.js`; also the `value=` on the buttons in `feedback.html`) |
| Email | Short answer | **not required** (the page treats it as optional); email-format validation is fine |

Until `FB_ACTION` is set, `/feedback` answers 503 and the page shows "Feedback isn't set up yet."

## Troubleshooting

Errors shown under the form, and what they mean:

| Message | Cause / fix |
|---|---|
| "Couldn't reach the … service" | the `endpoint` in `site.js` / `feedback.js` is wrong (it needs the account part: `videobeaux-signup.YOUR-NAME.workers.dev`) |
| "Not allowed." | the page's address isn't in `ALLOWED_ORIGINS`; add it, deploy |
| "The check failed." | Cloudflare rejected the CAPTCHA token. Run `npx wrangler tail`, submit again, read the log line: **`invalid-input-secret`** = the stored secret isn't the secret of the widget whose site key the page uses (rotate it in the dashboard, copy the new secret, `secret put` again); **`timeout-or-duplicate`** = the check expired or was reused, tick it again |
| "Choose one of the listed computers." / "Choose what kind of report…" | the page and the Worker disagree on an option's text, or the browser has an old copy of the page: hard-refresh, and check `FB_OS` / `FB_TYPES` |
| "Could not save that right now." | Google rejected the post: a question has the wrong type (the report must be Paragraph), a required question was left empty (Email must not be required), or an option's text doesn't match exactly |
| "Feedback isn't set up yet." | the `FB_*` values in `wrangler.toml` are empty; fill them in and deploy |
| "You're already on the list" (sign-up) | a 10-minute cooldown kept in your browser after a send; clear it with `localStorage.removeItem('vb.signup')` in the console, or use a private window |

**Switching Cloudflare accounts** (`wrangler logout`, then `login`): Wrangler caches the account in `tools/signup-worker/.wrangler/cache/wrangler-account.json`
(git-ignored). If a deploy then fails with *Authentication error [code: 10000]* for an account id you no longer use, delete that file and deploy again.
Then in the new account: create a new Turnstile widget, `deploy`, `secret put TURNSTILE_SECRET` with the new widget's secret, and update `endpoint` and
`turnstile` in both scripts (the Worker address and site key both change).

## Checks

`node tools/signup-worker/test.mjs` runs the Worker's logic against fake Google/Turnstile replies (origin, size, email, allowed choices, CAPTCHA,
rate limit, both forms, Google errors): no network, no deploy needed. Run it after any change to `worker.js`.

## Notes

- The Origin check keeps other *websites* from using the endpoint from a browser; it can't stop a script that forges the header. The CAPTCHA and the
  per-IP limit are what stop scripts.
- Keep the Turnstile **secret** only in the Worker (`wrangler secret`), never in the repo or a script. The site key is public. Never paste the secret
  into chat or an issue; to check one, use the `siteverify` curl test: with a valid secret and a fake token Cloudflare answers `invalid-input-response`;
  with a wrong secret it answers `invalid-input-secret`.
- Logs and analytics: Cloudflare's dashboard shows request counts and errors for the Worker; `npx wrangler tail` shows them live.
