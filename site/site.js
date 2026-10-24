/* Videobeaux site — before/after player, example library, sign-up form. No dependencies.
 *
 * The examples come from previews/examples.json, written by tools/render-site-examples.py
 * (add an example: edit tools/site_examples.json, run the script, reload).
 */
(function () {
    'use strict'

    // everything this script loads (examples.json, posters, clips) lives next to it, wherever the HTML page sits
    var BASE = document.currentScript.src.replace(/[^/]*$/, '')

    // ── sign-up form ───────────────────────────────────────────────────────────────────────────────
    // Paste your provider's form endpoint here and the "Stay in the loop" section goes live on the real site.
    //   Buttondown:  https://buttondown.email/api/emails/embed-subscribe/YOUR-NAME   (fields: email, tag, embed)
    //   Formspree:   https://formspree.io/f/YOUR-ID                                  (fields: email, tag)
    //   Mailchimp:   the action="" URL from its embedded-form HTML (field names differ — adjust name="" in index.html)
    // Left empty, the section is hidden everywhere except localhost, where it shows with a note.
    var SIGNUP = { action: '' }

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
    var isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || location.protocol === 'file:'
    if (SIGNUP.action) { form.action = SIGNUP.action; stay.hidden = false }
    else if (isLocal) { stay.hidden = false; note.hidden = false }
    form.addEventListener('submit', function (e) {
        var email = form.elements.email
        if (!SIGNUP.action) { e.preventDefault(); note.hidden = false; note.textContent = 'Local preview: nothing was sent. Set SIGNUP.action in site.js.'; return }
        if (!email.value || !email.checkValidity()) { e.preventDefault(); email.focus(); email.reportValidity() }
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
