/**
 * dsh-session-cloud — client half.
 *
 * Loaded by the web shell as a lazy CJS bundle: this file only registers a
 * factory with `window.__ModuleLoader__.load`, and the shell materialises it
 * with a `require` bound to the platform module table. The banner/footer shape
 * below is the one `packages/client/tsdown.client.ts` stamps on every bundle,
 * so `exports.inject` / `exports.apply` are the plugin's exports.
 *
 * Seat: `conversation.input.left` — "the left end of the tool row INSIDE the
 * composer card … the seat for a small always-visible control" (slot catalog,
 * key `conversation.input.left`). Its entries get `sessionId` injected as a
 * standard prop, so the chip is per-conversation without touching a service.
 */
window.__ModuleLoader__.load({
  id: 'dsh-session-cloud',
  factory: (require) => {
    var module = { exports: {} }; var exports = module.exports;

    var React = require('react')
    var h = React.createElement

    var STATE_URL = '/session-cloud/state'
    var MODE_URL = '/session-cloud/mode'

    var TONE = {
      idleBg: 'rgba(127,127,127,0.10)',
      idleBgHover: 'rgba(127,127,127,0.20)',
      idleBorder: 'rgba(127,127,127,0.28)',
      cloudBg: 'rgba(56,132,255,0.14)',
      cloudBgHover: 'rgba(56,132,255,0.24)',
      cloudBorder: 'rgba(56,132,255,0.50)',
      cloudText: '#3b8bff',
      warnBg: 'rgba(217,119,6,0.14)',
      warnBorder: 'rgba(217,119,6,0.45)',
      warnText: '#d97706',
      menuBg: '#1f2126',
      menuBorder: 'rgba(255,255,255,0.14)',
      menuText: '#e8e8ea',
      menuMuted: '#9aa0a6',
      menuHover: 'rgba(255,255,255,0.08)',
    }

    /** Read the JSON body of a response, tolerating non-JSON error pages. */
    function readJson(response) {
      return response.text().then(function (text) {
        try { return text === '' ? null : JSON.parse(text) } catch (e) { return null }
      })
    }

    function describeError(err) {
      if (err && typeof err.message === 'string' && err.message !== '') return err.message
      return String(err)
    }

    /** GET one session's sync state from the host half. */
    function fetchState(sessionId) {
      return fetch(STATE_URL + '?sessionId=' + encodeURIComponent(sessionId), {
        method: 'GET',
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      }).then(function (response) {
        return readJson(response).then(function (data) {
          if (!response.ok || !data || data.ok !== true) {
            throw new Error((data && data.error) || ('state request failed: HTTP ' + response.status))
          }
          return data
        })
      })
    }

    /** POST a mode switch; resolves with the host's persisted answer. */
    function postMode(sessionId, mode) {
      return fetch(MODE_URL, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ sessionId: sessionId, mode: mode }),
      }).then(function (response) {
        return readJson(response).then(function (data) {
          if (!response.ok || !data || data.ok !== true) {
            throw new Error((data && data.error) || ('mode request failed: HTTP ' + response.status))
          }
          return data
        })
      })
    }

    /** Normalise the wire mode to the two chip labels. */
    function normaliseMode(value) {
      return value === 'cloud' ? 'cloud' : 'local'
    }

    function chipLabel(view) {
      if (view.phase === 'error') return '⚠ 未知'
      if (view.phase !== 'ready') return '… 读取中'
      return view.mode === 'cloud' ? '☁ 云同步' : '🖥 仅本机'
    }

    function chipTitle(view) {
      if (view.phase === 'error') return '同步引擎不可用：' + view.error
      if (view.phase !== 'ready') return '正在读取会话同步状态…'
      return view.mode === 'cloud'
        ? '这条会话会进入云端自动备份（点击切换）'
        : '这条会话只留在本机（点击切换）'
    }

    function chipTone(view, hover) {
      if (view.phase === 'error') {
        return { background: TONE.warnBg, border: '1px solid ' + TONE.warnBorder, color: TONE.warnText }
      }
      if (view.phase === 'ready' && view.mode === 'cloud') {
        return {
          background: hover ? TONE.cloudBgHover : TONE.cloudBg,
          border: '1px solid ' + TONE.cloudBorder,
          color: TONE.cloudText,
        }
      }
      return {
        background: hover ? TONE.idleBgHover : TONE.idleBg,
        border: '1px solid ' + TONE.idleBorder,
        color: 'inherit',
        opacity: 0.86,
      }
    }

    /**
     * The switch. Props come from the slot framework: `sessionId` is injected
     * for every `scope: 'session'` slot (SessionStandardProps).
     */
    function SessionCloudChip(props) {
      var safeProps = props && typeof props === 'object' ? props : {}
      var sessionId = typeof safeProps.sessionId === 'string' && safeProps.sessionId !== ''
        ? safeProps.sessionId
        : (safeProps.session && typeof safeProps.session.id === 'string' ? safeProps.session.id : '')

      var viewState = React.useState({ phase: sessionId === '' ? 'error' : 'loading', mode: null, error: sessionId === '' ? '拿不到会话 id' : '' })
      var view = viewState[0]
      var setView = viewState[1]

      var openState = React.useState(false)
      var open = openState[0]
      var setOpen = openState[1]

      var hoverState = React.useState(false)
      var hover = hoverState[0]
      var setHover = hoverState[1]

      var itemState = React.useState(-1)
      var hoveredItem = itemState[0]
      var setHoveredItem = itemState[1]

      var anchorState = React.useState({ left: 0, top: 0 })
      var anchor = anchorState[0]
      var setAnchor = anchorState[1]

      var busyState = React.useState(false)
      var busy = busyState[0]
      var setBusy = busyState[1]

      var rootRef = React.useRef(null)

      // Initial read: show the persisted mode the moment the chip appears.
      React.useEffect(function () {
        if (sessionId === '') return function () {}
        var cancelled = false
        fetchState(sessionId).then(function (data) {
          if (cancelled) return
          setView({ phase: 'ready', mode: normaliseMode(data.mode), error: '' })
        }).catch(function (err) {
          if (cancelled) return
          setView({ phase: 'error', mode: null, error: describeError(err) })
        })
        return function () { cancelled = true }
      }, [sessionId])

      // Outside click / Escape closes the menu.
      React.useEffect(function () {
        if (!open) return function () {}
        var onPointerDown = function (event) {
          var root = rootRef.current
          if (root && event && event.target && root.contains && root.contains(event.target)) return
          setOpen(false)
        }
        var onKeyDown = function (event) {
          if (event && (event.key === 'Escape' || event.key === 'Esc')) setOpen(false)
        }
        var onViewportChange = function () { setOpen(false) }
        document.addEventListener('mousedown', onPointerDown, true)
        document.addEventListener('keydown', onKeyDown, true)
        window.addEventListener('resize', onViewportChange)
        window.addEventListener('scroll', onViewportChange, true)
        return function () {
          document.removeEventListener('mousedown', onPointerDown, true)
          document.removeEventListener('keydown', onKeyDown, true)
          window.removeEventListener('resize', onViewportChange)
          window.removeEventListener('scroll', onViewportChange, true)
        }
      }, [open])

      function toggleOpen() {
        if (busy) return
        var next = !open
        if (next) {
          try {
            var root = rootRef.current
            var rect = root && root.getBoundingClientRect ? root.getBoundingClientRect() : null
            var width = 168
            var left = rect ? Math.round(rect.left) : 0
            var maxLeft = (window.innerWidth || 0) - width - 8
            if (maxLeft > 0 && left > maxLeft) left = maxLeft
            setAnchor({ left: left < 8 ? 8 : left, top: rect ? Math.round(rect.bottom) + 6 : 0 })
          } catch (err) {
            setAnchor({ left: 8, top: 0 })
          }
        }
        setHoveredItem(-1)
        setOpen(next)
      }

      function choose(nextMode) {
        setOpen(false)
        if (busy || sessionId === '') return
        if (view.phase === 'ready' && view.mode === nextMode) return
        if (nextMode === 'cloud') {
          var confirmed = false
          try {
            confirmed = window.confirm('把这条会话同步到云端？\n（之后每 2 小时自动备份会包含它）')
          } catch (err) {
            confirmed = false
          }
          if (!confirmed) return
        }
        setBusy(true)
        postMode(sessionId, nextMode).then(function (data) {
          setView({ phase: 'ready', mode: normaliseMode(data.mode), error: '' })
        }).catch(function (err) {
          setView({ phase: 'error', mode: null, error: describeError(err) })
        }).then(function () {
          setBusy(false)
        })
      }

      try {
        var tone = chipTone(view, hover)
        var chipStyle = {
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '3px',
          height: '22px',
          padding: '0 9px',
          boxSizing: 'border-box',
          borderRadius: '11px',
          fontSize: '11.5px',
          lineHeight: '1',
          fontWeight: 500,
          whiteSpace: 'nowrap',
          userSelect: 'none',
          cursor: busy ? 'progress' : 'pointer',
          transition: 'background 120ms ease, border-color 120ms ease',
          background: tone.background,
          border: tone.border,
          color: tone.color,
          opacity: busy ? 0.7 : (tone.opacity === undefined ? 1 : tone.opacity),
        }

        var itemBase = {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '10px',
          padding: '6px 8px',
          borderRadius: '6px',
          fontSize: '12px',
          lineHeight: '16px',
          cursor: 'pointer',
          color: TONE.menuText,
          userSelect: 'none',
        }

        function itemStyle(index) {
          return hoveredItem === index
            ? Object.assign({}, itemBase, { background: TONE.menuHover })
            : itemBase
        }

        var current = view.phase === 'ready' ? view.mode : null
        var check = h('span', { style: { color: TONE.cloudText, fontSize: '11px', minWidth: '10px', textAlign: 'right' } }, '✓')

        var items = [
          h('div', {
            key: 'cloud',
            role: 'menuitem',
            style: itemStyle(0),
            onMouseEnter: function () { setHoveredItem(0) },
            onMouseLeave: function () { setHoveredItem(-1) },
            onClick: function () { choose('cloud') },
          }, h('span', null, '☁ 云同步'), current === 'cloud' ? check : h('span', { style: { minWidth: '10px' } })),
          h('div', {
            key: 'local',
            role: 'menuitem',
            style: itemStyle(1),
            onMouseEnter: function () { setHoveredItem(1) },
            onMouseLeave: function () { setHoveredItem(-1) },
            onClick: function () { choose('local') },
          }, h('span', null, '🖥 仅本机'), current === 'local' ? check : h('span', { style: { minWidth: '10px' } })),
        ]

        if (view.phase === 'error') {
          items.push(h('div', {
            key: 'note',
            style: {
              marginTop: '4px',
              padding: '6px 8px 2px',
              borderTop: '1px solid ' + TONE.menuBorder,
              fontSize: '11px',
              lineHeight: '15px',
              color: TONE.menuMuted,
              cursor: 'default',
            },
            title: view.error || '',
          }, '引擎不可用', h('div', { style: { opacity: 0.75 } }, '检查 python 与 sync.py 是否就位')))
        }

        var menuStyle = {
          position: 'fixed',
          left: anchor.left + 'px',
          top: anchor.top + 'px',
          zIndex: 2147483000,
          minWidth: '168px',
          padding: '4px',
          boxSizing: 'border-box',
          background: TONE.menuBg,
          border: '1px solid ' + TONE.menuBorder,
          borderRadius: '8px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.28)',
          fontFamily: 'inherit',
        }

        return h('span', {
          ref: rootRef,
          style: { position: 'relative', display: 'inline-flex', alignItems: 'center' },
        }, [
          h('button', {
            key: 'chip',
            type: 'button',
            title: chipTitle(view),
            'aria-haspopup': 'menu',
            'aria-expanded': open,
            disabled: busy,
            style: chipStyle,
            onMouseEnter: function () { setHover(true) },
            onMouseLeave: function () { setHover(false) },
            onClick: toggleOpen,
          }, chipLabel(view)),
          open ? h('div', { key: 'menu', role: 'menu', style: menuStyle }, items) : null,
        ])
      } catch (err) {
        // A render-time failure must never blank the composer: drop the chip.
        try { console.warn('[dsh-session-cloud] render failed', err) } catch (e) { /* noop */ }
        return null
      }
    }

    SessionCloudChip.displayName = 'SessionCloudChip'

    exports.inject = ['slots']

    exports.apply = function apply(ctx) {
      try {
        if (!ctx || !ctx.slots || typeof ctx.slots.register !== 'function') {
          try { console.warn('[dsh-session-cloud] slots service is unavailable — chip not registered') } catch (e) { /* noop */ }
          return
        }
        // `inject` defers until the conversation package declares the slot, so
        // bundle mount order never matters.
        ctx.slots.inject('conversation.input.left', function () {
          return ctx.slots.register({
            name: 'conversation.input.left',
            id: 'session-cloud',
            order: 50,
            label: 'Session cloud sync',
          }, SessionCloudChip)
        })
      } catch (err) {
        try { console.warn('[dsh-session-cloud] slot registration failed', err) } catch (e) { /* noop */ }
      }
    }

    return module.exports
  }
})
