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

      var confirmState = React.useState(false)
      var confirming = confirmState[0]
      var setConfirming = confirmState[1]

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
        // Scrolling must NOT close the menu: the chip sits inside the composer's
        // scroll container, so the click itself can emit a scroll event and the
        // menu would vanish before the user ever sees it. Reposition instead.
        var reposition = function () {
          try {
            var root = rootRef.current
            if (!root || !root.getBoundingClientRect) return
            var rect = root.getBoundingClientRect()
            var width = 168
            var left = Math.round(rect.left)
            var maxLeft = (window.innerWidth || 0) - width - 8
            if (maxLeft > 0 && left > maxLeft) left = maxLeft
            setAnchor({ left: left < 8 ? 8 : left, top: Math.round(rect.bottom) + 6 })
          } catch (err) {
            // keep the previous anchor
          }
        }
        document.addEventListener('mousedown', onPointerDown, true)
        document.addEventListener('keydown', onKeyDown, true)
        window.addEventListener('resize', reposition)
        window.addEventListener('scroll', reposition, true)
        return function () {
          document.removeEventListener('mousedown', onPointerDown, true)
          document.removeEventListener('keydown', onKeyDown, true)
          window.removeEventListener('resize', reposition)
          window.removeEventListener('scroll', reposition, true)
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
        if (!next) setConfirming(false)
        setOpen(next)
      }

      function choose(nextMode) {
        if (busy || sessionId === '') return
        if (view.phase === 'ready' && view.mode === nextMode) { setOpen(false); return }
        // 原生 window.confirm 在 Tauri WebView 里可能被吞掉（点了没反应），
        // 所以确认这一步做在菜单里：先切到 confirming，再由面板上的两个按钮决定。
        if (nextMode === 'cloud' && !confirming) {
          setConfirming(true)
          return
        }
        setConfirming(false)
        setOpen(false)
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

        if (confirming) {
          var confirmTitle = {
            padding: '6px 8px 2px',
            fontSize: '12px',
            fontWeight: 600,
            color: TONE.menuText,
          }
          var confirmBody = {
            padding: '2px 8px 6px',
            fontSize: '11px',
            lineHeight: '16px',
            color: TONE.menuMuted,
          }
          var confirmButton = {
            flex: '1 1 0',
            height: '24px',
            padding: '0 8px',
            boxSizing: 'border-box',
            borderRadius: '6px',
            border: '1px solid ' + TONE.menuBorder,
            background: 'transparent',
            color: TONE.menuText,
            fontSize: '11.5px',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }
          var confirmPrimary = Object.assign({}, confirmButton, {
            border: '1px solid ' + TONE.cloudText,
            color: TONE.cloudText,
            fontWeight: 600,
          })
          items = [
            h('div', { key: 'confirm-title', style: confirmTitle }, '同步到云端？'),
            h('div', { key: 'confirm-body', style: confirmBody },
              '开启后这条会话会随每 2 小时的自动备份上传到你的私有仓库；切回「仅本机」不会删除云端已有的副本。'),
            h('div', {
              key: 'confirm-actions',
              style: { display: 'flex', gap: '6px', padding: '2px 6px 4px' },
            }, [
              h('button', {
                key: 'confirm-yes',
                type: 'button',
                style: confirmPrimary,
                onClick: function () { choose('cloud') },
              }, '确认同步'),
              h('button', {
                key: 'confirm-no',
                type: 'button',
                style: confirmButton,
                onClick: function () { setConfirming(false) },
              }, '取消'),
            ]),
          ]
        }

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

        // 宿主正文区的某个祖先带 transform，`position: fixed` 会被解析成
        // "相对那个祖先"，菜单因此跑到屏幕另一头。改成相对 chip 自身的绝对定位，
        // 并且朝上开（chip 在输入框工具行上，下面没有空间）。
        var menuStyle = {
          position: 'absolute',
          left: '0px',
          bottom: 'calc(100% + 6px)',
          zIndex: 2147483000,
          width: '224px',
          maxWidth: 'calc(100vw - 24px)',
          padding: '4px',
          boxSizing: 'border-box',
          background: TONE.menuBg,
          border: '1px solid ' + TONE.menuBorder,
          borderRadius: '8px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.28)',
          fontFamily: 'inherit',
          textAlign: 'left',
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
            // 阻止焦点跳转：composer 是滚动容器，按钮拿到焦点会把视图滚一下，
            // 表现就是"点了菜单没出来、页面往上跳"。
            onMouseDown: function (event) { if (event && event.preventDefault) event.preventDefault() },
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
