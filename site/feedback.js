/* Videobeaux alpha feedback form (feedback.html). No dependencies.
 *
 * The form posts to the same Cloudflare Worker as the sign-up form (tools/signup-worker/), at /feedback. The Worker checks a Cloudflare
 * Turnstile CAPTCHA, rate-limits per IP, validates the input and forwards it to the feedback Google Form, so that form's address and
 * field ids live only in the Worker's settings (FB_* in tools/signup-worker/wrangler.toml), never on the website. Until those are
 * filled in and the Worker is redeployed, sending shows "Feedback isn't set up yet."
 *
 * CONTACT (below) is the optional public email address. It isn't in the page's HTML: the button builds it from the two parts only when a
 * visitor clicks, which keeps it away from the simple scrapers that read page source. Leave `user` empty to hide the whole line.
 */
(function () {
    'use strict'

    var FEEDBACK = {
        endpoint: 'https://videobeaux-signup.schwwaaa.workers.dev/feedback',
        turnstile: '0x4AAAAAAFy0O3KnDLgqR5Dk'     // the Turnstile *site* key (public), same widget as the sign-up form
    }
    var CONTACT = { user: 'videobeaux', domain: 'schwwaaa.net' }

    var $ = function (s, r) { return (r || document).querySelector(s) }

    // ── nav (mobile) ──
    var menu = $('.menu-button'), links = $('#nav-links')
    menu.addEventListener('click', function () {
        var open = menu.getAttribute('aria-expanded') === 'true'
        menu.setAttribute('aria-expanded', String(!open))
        links.dataset.open = String(!open)
    })

    // ── contact email, revealed on click ──
    var contact = $('#contact'), contactBtn = $('#contact-btn')
    if (CONTACT.user && CONTACT.domain) {
        contact.hidden = false
        contactBtn.addEventListener('click', function () {
            var address = CONTACT.user + '@' + CONTACT.domain
            var a = document.createElement('a')
            a.href = 'mailto:' + address; a.textContent = address
            contactBtn.replaceWith(a)
            a.focus()
        })
    }

    // ── form ──
    var form = $('#feedback'), statusEl = $('#fb-status'), btn = $('#fb-btn'), captchaEl = $('#fb-captcha'), pageLoaded = Date.now()

    function say(text, bad) { statusEl.textContent = text; statusEl.className = 'signup-status' + (bad ? ' bad' : ' good') }
    // after a send the form is replaced by a thank-you note; reloading the page brings the form back
    function thanks() {
        var box = $('#fb-thanks')
        form.reset(); form.hidden = true; box.hidden = false; box.focus()
    }

    // Turnstile: load Cloudflare's script only when the form is near the screen
    var turnstileId = null
    function setupCaptcha() {
        if (!FEEDBACK.turnstile) return
        var load = function () {
            if (turnstileId !== null || document.getElementById('cf-turnstile-script')) return
            window.__vbTurnstileReady = function () {
                captchaEl.hidden = false
                turnstileId = window.turnstile.render(captchaEl, { sitekey: FEEDBACK.turnstile, size: 'flexible', theme: 'light' })
            }
            var s = document.createElement('script')
            s.id = 'cf-turnstile-script'; s.async = true
            s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__vbTurnstileReady'
            document.head.appendChild(s)
        }
        if ('IntersectionObserver' in window) {
            new IntersectionObserver(function (en, io) { if (en[0].isIntersecting) { load(); io.disconnect() } }, { rootMargin: '400px' }).observe(form)
        } else load()
    }
    setupCaptcha()

    form.addEventListener('submit', function (e) {
        e.preventDefault()
        var v = function (name) { return form.elements[name].value.trim() }   // works for radio groups too (value of the checked one)
        var email = form.elements.email
        if (!v('summary')) { form.elements.summary.focus(); say('Please tell us what’s going on.', true); return }
        if (v('email') && !email.checkValidity()) { email.focus(); say('That email address doesn’t look right.', true); return }
        if (btn.disabled) return
        // bots fill the hidden field or submit instantly; pretend it worked and send nothing
        if (form.elements._gotcha.value || Date.now() - pageLoaded < 2500) { thanks(); return }
        var token = (window.turnstile && turnstileId !== null) ? window.turnstile.getResponse(turnstileId) : ''
        if (FEEDBACK.turnstile && !token) { say('Please complete the check above.', true); return }
        btn.disabled = true; say('Sending…')

        fetch(FEEDBACK.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: v('type'), summary: v('summary'), os: v('os'), email: v('email').toLowerCase(), token: token }) })
            .then(function (r) { return r.json().catch(function () { return {} }).then(function (j) { return { ok: r.ok && j.ok, j: j } }) })
            .then(function (res) {
                btn.disabled = false
                if (res.ok) thanks()
                else say(res.j && res.j.error ? res.j.error : 'Couldn’t send that. Please try again in a moment.', true)
                if (window.turnstile && turnstileId !== null) window.turnstile.reset(turnstileId)
            })
            .catch(function () { btn.disabled = false; say('Couldn’t reach the feedback service. Check your connection and try again.', true) })
    })
})()
