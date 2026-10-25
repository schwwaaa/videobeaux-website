/* Videobeaux site — before/after player, example library, sign-up form. No dependencies.
 *
 * The examples come from previews/examples.json, written by tools/render-site-examples.py
 * (add an example: edit tools/site_examples.json, run the script, reload).
 */
(function () {
    'use strict'

    // everything this script loads (examples.json, posters, clips) lives next to it, wherever the HTML page sits
    var BASE = document.currentScript.src.replace(/[^/]*$/, '')

    // ── sign-up ("Stay in the loop") ───────────────────────────────────────────────────────────────
    // The form on the page sends its answers to a Google Form, so replies collect in that form's Google Sheet. Visitors never see
    // Google's form page. Two ways to send, set here (README → "The sign-up form" explains both and the security trade-offs):
    //
    //  1. DIRECT (works today): the page posts to the Google Form's /formResponse address. The form id and `entry.` field names
    //     below are public by nature (anyone can read them in the form's page source) — there is no key or password in this file.
    //  2. HARDENED (optional): set `endpoint` (and `turnstile`) to a small Cloudflare Worker (tools/signup-worker/). The page then
    //     talks only to the Worker, which checks a Turnstile CAPTCHA, rate-limits per IP, validates the input and forwards it to
    //     Google — so the Google form's address never appears in the page at all.
    //
    // In the Google Form: an Email short-answer question (required, validated as an email) and a Checkboxes question whose options are
    // exactly the labels below; don't require sign-in or limit to one response. The section stays hidden until one way is configured.
    var SIGNUP = {
        // 1 — direct
        google: {
            action: 'https://docs.google.com/forms/d/e/1FAIpQLSfnLKqgZKvespQyFbW1iyo24eSuTtdG2LI1nd9GCMLFJG75xg/formResponse',
            email: 'entry.1349102305',          // the "Email" question
            interest: 'entry.1536578059',       // the "interest" checkboxes
            labels: { newsletter: 'Updates and news', testers: 'Join the testing group' }   // option text, exactly
        },
        // 2 — hardened (leave '' until the Worker is deployed; then the google block above can be emptied)
        endpoint: '',                           // e.g. https://videobeaux-signup.YOUR-NAME.workers.dev
        turnstile: ''                           // the Turnstile *site* key (public) for that Worker
    }

    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    var $ = function (s, r) { return (r || document).querySelector(s) }
    var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] }) }

    // ── nav (mobile) ──
    var menu = $('.menu-button'), links = $('#nav-links')
    menu.addEventListener('click', function () {
        var open = menu.getAttribute('aria-expanded') === 'true'
        menu.setAttribute('aria-expanded', String(!open))
        links.dataset.open = String(!open)
    })
    links.addEventListener('click', function (e) {
        if (e.target.tagName === 'A') { menu.setAttribute('aria-expanded', 'false'); links.dataset.open = 'false' }
    })

    // ── sign-up section ──
    var stay = $('#stay'), form = $('#signup'), note = $('#signup-note')
    var statusEl = $('#signup-status'), signBtn = $('#signup-btn'), captchaEl = $('#signup-captcha'), pageLoaded = Date.now()
    var isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || location.protocol === 'file:'
    var G = SIGNUP.google || {}
    var mode = SIGNUP.endpoint ? 'worker' : (G.action && G.email && G.interest) ? 'google' : ''
    var COOLDOWN = 10 * 60 * 1000, KEY = 'vb.signup'
    if (mode) stay.hidden = false
    else if (isLocal) { stay.hidden = false; note.hidden = false }

    function say(text, bad) { statusEl.textContent = text; statusEl.className = 'signup-status' + (bad ? ' bad' : ' good') }
    function recentlyJoined() { try { return Date.now() - Number(localStorage.getItem(KEY)) < COOLDOWN } catch (e) { return false } }
    function remember() { try { localStorage.setItem(KEY, String(Date.now())) } catch (e) { /* private mode */ } }
    function done() { say('Thanks! You’re on the list.'); form.reset(); remember(); signBtn.disabled = false }

    // Turnstile (hardened mode): load Cloudflare's script only when the form is near the screen
    var turnstileId = null
    function setupCaptcha() {
        if (mode !== 'worker' || !SIGNUP.turnstile) return
        var load = function () {
            if (turnstileId !== null || document.getElementById('cf-turnstile-script')) return
            window.__vbTurnstileReady = function () {
                captchaEl.hidden = false
                turnstileId = window.turnstile.render(captchaEl, { sitekey: SIGNUP.turnstile, size: 'flexible', theme: 'light' })
            }
            var s = document.createElement('script')
            s.id = 'cf-turnstile-script'; s.async = true
            s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__vbTurnstileReady'
            document.head.appendChild(s)
        }
        if ('IntersectionObserver' in window) {
            new IntersectionObserver(function (en, io) { if (en[0].isIntersecting) { load(); io.disconnect() } }, { rootMargin: '400px' }).observe(stay)
        } else load()
    }
    setupCaptcha()

    form.addEventListener('submit', function (e) {
        e.preventDefault()
        var email = form.elements.email, address = email.value.trim().toLowerCase()
        if (!mode) { note.hidden = false; note.textContent = 'Local preview: nothing was sent. Fill in SIGNUP in site/site.js.'; return }
        if (!address || address.length > 254 || !email.checkValidity()) { email.focus(); say('Please enter a valid email address.', true); return }
        var tags = Array.prototype.map.call(form.querySelectorAll('input[name=tag]:checked'), function (c) { return c.value })
        if (!tags.length) { say('Choose at least one option.', true); return }
        if (signBtn.disabled) return
        if (recentlyJoined()) { say('You’re already on the list. Thanks!'); return }
        // bots fill the hidden field or submit instantly; pretend it worked and send nothing
        if (form.elements._gotcha.value || Date.now() - pageLoaded < 2500) { done(); return }
        signBtn.disabled = true; say('Sending…')

        if (mode === 'worker') {
            var token = (window.turnstile && turnstileId !== null) ? window.turnstile.getResponse(turnstileId) : ''
            if (SIGNUP.turnstile && !token) { signBtn.disabled = false; say('Please complete the check above.', true); return }
            fetch(SIGNUP.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: address, tags: tags, token: token }) })
                .then(function (r) { return r.json().catch(function () { return {} }).then(function (j) { return { ok: r.ok && j.ok, j: j } }) })
                .then(function (res) {
                    if (res.ok) { done() } else {
                        signBtn.disabled = false
                        say(res.j && res.j.error ? res.j.error : 'Couldn’t send that. Please try again in a moment.', true)
                    }
                    if (window.turnstile && turnstileId !== null) window.turnstile.reset(turnstileId)
                })
                .catch(function () { signBtn.disabled = false; say('Couldn’t reach the sign-up service. Check your connection and try again.', true) })
            return
        }

        var body = new URLSearchParams()
        body.append(G.email, address)
        tags.forEach(function (t) { body.append(G.interest, (G.labels || {})[t] || t) })
        // no-cors: Google doesn't allow reading the reply, so a request that goes through is treated as success
        fetch(G.action, { method: 'POST', mode: 'no-cors', body: body })
            .then(done)
            .catch(function () { signBtn.disabled = false; say('Couldn’t send that. Check your connection and try again.', true) })
    })

    // ── player ──
    var vOrig = $('#v-orig'), vFx = $('#v-fx'), playBtn = $('#play'), seek = $('#seek'), timeOut = $('#time')
    var chainEl = $('#chain'), featuredEl = $('#patches'), stage = $('#stage'), reveal = $('#reveal')
    var playing = false, userPaused = reduceMotion, EX = [], current = -1, cats = {}

    function wireReveal() {
        function set() { stage.style.setProperty('--reveal', reveal.value + '%'); reveal.setAttribute('aria-valuetext', reveal.value + '% original shown on the left') }
        reveal.addEventListener('input', set); set()
    }
    wireReveal()

    function fmt(t) { t = Math.max(0, t || 0); return Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0') }
    function dur() { var d = vOrig.duration; return isFinite(d) && d > 0 ? d : 8 }

    function setPlaying(on) {
        playing = on
        playBtn.textContent = on ? '❚❚' : '▶'
        playBtn.setAttribute('aria-label', on ? 'Pause' : 'Play')
        if (on) Promise.all([vOrig.play(), vFx.play()]).catch(function () { playing = false; playBtn.textContent = '▶' })
        else { vOrig.pause(); vFx.pause() }
    }

    function drawChain(ex) {
        var html = '<li class="io">Input</li>'
        ex.chain.forEach(function (m) {
            html += '<li style="--c:' + (cats[ex.category] || '#fffdf6') + '">' + esc(m.name) + (m.settings ? ' <small>' + esc(m.settings) + '</small>' : '') + '</li>'
        })
        chainEl.innerHTML = html + '<li class="io">Output</li>'
    }

    function choose(i, keepTime) {
        current = i
        var ex = EX[i], t = keepTime ? vOrig.currentTime : 0
        Array.prototype.forEach.call(featuredEl.children, function (b) { b.setAttribute('aria-selected', String(b.dataset.id === ex.id)) })
        vFx.poster = BASE + 'previews/' + ex.id + '.jpg'
        vFx.src = BASE + 'previews/' + ex.id + '.mp4'
        vFx.load()
        vFx.addEventListener('loadedmetadata', function once() {
            vFx.removeEventListener('loadedmetadata', once)
            try { vFx.currentTime = t } catch (e) { /* not seekable yet */ }
            if (playing) vFx.play().catch(function () {})
        })
        drawChain(ex)
    }

    playBtn.addEventListener('click', function () { if (!playing && activeCard) stopCard(activeCard); userPaused = playing; setPlaying(!playing) })
    seek.addEventListener('input', function () { var t = Number(seek.value) * dur(); vOrig.currentTime = t; vFx.currentTime = t })

    // keep both clips on one clock; drive the scrub bar and time readout
    function tick() {
        var t = vOrig.currentTime
        if (playing && vFx.readyState >= 2 && !vFx.seeking) {
            var d = vFx.currentTime - t
            if (Math.abs(d) > .4) vFx.currentTime = t
            else vFx.playbackRate = Math.abs(d) > .04 ? (d > 0 ? .97 : 1.03) : 1
        }
        if (document.activeElement !== seek) seek.value = t / dur()
        timeOut.textContent = fmt(t) + ' / ' + fmt(dur())
        requestAnimationFrame(tick)
    }
    // play when on screen, pause when not (unless the visitor paused it, or prefers reduced motion)
    if ('IntersectionObserver' in window) {
        new IntersectionObserver(function (entries) {
            var on = entries[0].isIntersecting
            if (on && !userPaused && !playing) setPlaying(true)
            if (!on && playing) setPlaying(false)
        }, { threshold: .5 }).observe(stage)
    }
    document.addEventListener('visibilitychange', function () { if (document.hidden && playing) setPlaying(false) })

    // ── featured list (right of the player) ──
    function buildFeatured() {
        EX.forEach(function (ex, i) {
            if (!ex.featured) return
            var b = document.createElement('button')
            b.type = 'button'; b.className = 'patch'; b.dataset.id = ex.id; b.setAttribute('role', 'tab')
            b.innerHTML = '<strong>' + esc(ex.name) + '</strong><span>' + esc(ex.blurb) + '</span>'
            b.addEventListener('click', function () { choose(i, true) })
            featuredEl.appendChild(b)
        })
        featuredEl.addEventListener('keydown', function (e) {
            var d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0
            if (!d) return
            e.preventDefault()
            var btns = Array.prototype.slice.call(featuredEl.children), at = btns.findIndex(function (b) { return b.dataset.id === EX[current].id })
            var n = btns[(at + d + btns.length) % btns.length]
            n.click(); n.focus()
        })
    }

    // ── example library: chains strip + filterable cards, each card is its own little player ──
    var PILLS = ['#ff6847', '#d52c91', '#8654aa', '#32b9df', '#c5d92d']
    var activeCard = null
    function stopCard(c) {
        if (!c) return
        c.video.pause(); c.el.classList.remove('on'); c.btn.setAttribute('aria-label', 'Play ' + c.ex.name)
        if (activeCard === c) activeCard = null
    }
    function playCard(c) {
        if (activeCard && activeCard !== c) stopCard(activeCard)
        if (playing) { userPaused = true; setPlaying(false) }          // one thing moves at a time
        var v = c.video
        if (!v.getAttribute('src')) { v.src = BASE + 'previews/' + c.ex.id + '.mp4'; v.load() }
        v.play().then(function () {
            c.el.classList.add('on'); c.btn.setAttribute('aria-label', 'Pause ' + c.ex.name); activeCard = c
        }).catch(function () {})
    }
    function makeCard(ex) {
        var el = document.createElement('article')
        el.className = 'card' + (ex.category === 'Chains' ? ' chain-card' : '')
        el.dataset.id = ex.id
        var isChain = ex.chain.length > 1
        var pills = ''
        if (isChain) {
            pills = '<ol class="mini-chain" aria-label="Program modes in this chain">' +
                ex.chain.map(function (m, i) { return '<li style="--c:' + PILLS[i % PILLS.length] + '">' + esc(m.name) + (m.settings ? ' <small>' + esc(m.settings) + '</small>' : '') + '</li>' }).join('') + '</ol>'
        }
        el.innerHTML =
            '<div class="clip"><video muted loop playsinline preload="none" poster="' + BASE + 'previews/' + ex.id + '.jpg"></video>' +
            '<button type="button" class="clip-play" aria-label="Play ' + esc(ex.name) + '"><span aria-hidden="true">▶</span></button></div>' +
            '<div class="body"><span class="cat" style="--c:' + cats[ex.category] + '">' + (ex.category === 'Chains' ? ex.chain.length + ' program modes chained' : esc(ex.category)) + '</span>' +
            '<h3>' + esc(ex.name) + '</h3><p>' + esc(ex.blurb) + '</p>' + pills + '</div>'
        var c = { el: el, ex: ex, video: $('video', el), btn: $('.clip-play', el) }
        c.btn.addEventListener('click', function () { c.video.paused ? playCard(c) : stopCard(c) })
        return c
    }
    function buildLibrary() {
        var chainsEl = $('#chains'), filters = $('#filters'), list = $('#library'), more = $('#more'), active = 'All', expanded = false
        var chains = EX.filter(function (e) { return e.category === 'Chains' }), singles = EX.filter(function (e) { return e.category !== 'Chains' })
        chains.forEach(function (ex) { var li = document.createElement('li'); li.appendChild(makeCard(ex).el); chainsEl.appendChild(li) })

        var names = ['All'].concat(Object.keys(cats).filter(function (c) { return singles.some(function (e) { return e.category === c }) }))
        names.forEach(function (n) {
            var b = document.createElement('button')
            b.type = 'button'; b.className = 'chip'; b.setAttribute('aria-pressed', String(n === 'All'))
            b.innerHTML = (n === 'All' ? '' : '<i style="--c:' + cats[n] + '"></i>') + esc(n) + ' <small>' + (n === 'All' ? singles.length : singles.filter(function (e) { return e.category === n }).length) + '</small>'
            b.addEventListener('click', function () {
                active = n
                list.classList.toggle('collapsed', n === 'All' && !expanded); more.hidden = n !== 'All' || expanded
                Array.prototype.forEach.call(filters.children, function (c) { c.setAttribute('aria-pressed', String(c === b)) })
                Array.prototype.forEach.call(list.children, function (li) {
                    var hide = active !== 'All' && li.dataset.cat !== active
                    li.hidden = hide
                    if (hide && activeCard && li.contains(activeCard.el)) stopCard(activeCard)
                })
            })
            filters.appendChild(b)
        })
        singles.forEach(function (ex) {
            var li = document.createElement('li'); li.dataset.cat = ex.category
            li.appendChild(makeCard(ex).el); list.appendChild(li)
        })
        // show the first dozen, with a button for the rest (a category filter always shows all of its cards)
        var LIMIT = 12
        if (singles.length > LIMIT) {
            more.textContent = 'Show all ' + singles.length + ' examples'; more.hidden = false
            more.addEventListener('click', function () { expanded = true; list.classList.remove('collapsed'); more.hidden = true })
        } else { list.classList.remove('collapsed') }
        // a playing card pauses when it scrolls out of view
        if ('IntersectionObserver' in window) {
            var io = new IntersectionObserver(function (entries) {
                entries.forEach(function (en) { if (!en.isIntersecting && activeCard && en.target === activeCard.el) stopCard(activeCard) })
            }, { threshold: .2 })
            document.querySelectorAll('.card').forEach(function (el) { io.observe(el) })
        }
    }

    // ── go ──
    fetch(BASE + 'previews/examples.json').then(function (r) { return r.json() }).then(function (data) {
        cats = data.categories; EX = data.examples
        buildFeatured(); buildLibrary(); choose(0, false)
    }).catch(function () {
        $('#library').innerHTML = '<li class="load-error">Couldn’t load the examples. Serve this folder over http (python3 tools/serve-site.py) instead of opening the file.</li>'
    })
    tick()
})()
