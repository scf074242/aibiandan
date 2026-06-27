// ==UserScript==
// @name         OpenClaw BigBiandan Demo Bridge
// @namespace    https://bigbiandan.demo
// @version      0.1.0
// @description  在 OpenClaw 聊天页中以纯前台方式把用户消息转发到 BigBiandan 原型页
// @match        http://127.0.0.1:18789/chat*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict'

  const STORAGE_KEY = 'bigbiandan.openclaw.demo.bridge.v1'
  const DEFAULTS = {
    prototypeUrl: 'http://127.0.0.1:5173/broadcast-plan/create',
    autoForward: true,
  }

  const state = {
    settings: loadSettings(),
    targetWindow: null,
    lastSessionId: '',
    lastSummary: '',
    lastEventType: '',
    lastRequestHash: '',
    statusText: '未连接',
    targetId: '',
    bridgeReady: false,
  }

  const elements = {}

  startWhenReady()

  function startWhenReady() {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      window.setTimeout(safeBootstrap, 0)
      return
    }
    document.addEventListener('DOMContentLoaded', safeBootstrap, { once: true })
  }

  function safeBootstrap() {
    try {
      if (!document.body) {
        window.setTimeout(safeBootstrap, 100)
        return
      }
      bootstrap()
    } catch (error) {
      console.error('[BigBiandanBridge] 启动失败', error)
    }
  }

  function bootstrap() {
    if (elements.root) {
      return
    }
    injectStyles()
    buildPanel()
    window.addEventListener('message', handleIncomingMessage)
    document.addEventListener('keydown', handleComposerKeydown, true)
    document.addEventListener('click', handleComposerClick, true)
    refreshPanel()
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return { ...DEFAULTS }
      return { ...DEFAULTS, ...JSON.parse(raw) }
    } catch (error) {
      console.warn('[BigBiandanBridge] 读取本地配置失败', error)
      return { ...DEFAULTS }
    }
  }

  function saveSettings() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings))
  }

  function injectStyles() {
    const style = document.createElement('style')
    style.textContent = `
      .bb-openclaw-bridge {
        position: fixed;
        right: 16px;
        bottom: 16px;
        width: 320px;
        z-index: 999999;
        border-radius: 14px;
        overflow: hidden;
        border: 1px solid rgba(251, 146, 60, 0.28);
        background: rgba(15, 23, 42, 0.92);
        color: #f8fafc;
        box-shadow: 0 18px 36px rgba(15, 23, 42, 0.32);
        backdrop-filter: blur(12px);
        font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      }
      .bb-openclaw-bridge__header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
        padding: 12px 14px;
        background: linear-gradient(135deg, rgba(251, 146, 60, 0.24), rgba(249, 115, 22, 0.1));
      }
      .bb-openclaw-bridge__title {
        margin: 0;
        font-size: 13px;
        font-weight: 700;
      }
      .bb-openclaw-bridge__tag {
        display: inline-flex;
        align-items: center;
        padding: 2px 8px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.14);
        font-size: 11px;
      }
      .bb-openclaw-bridge__body {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 12px 14px 14px;
      }
      .bb-openclaw-bridge__label {
        display: block;
        margin-bottom: 4px;
        font-size: 11px;
        color: rgba(226, 232, 240, 0.8);
      }
      .bb-openclaw-bridge__input,
      .bb-openclaw-bridge__text {
        width: 100%;
        box-sizing: border-box;
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 10px;
        background: rgba(2, 6, 23, 0.48);
        color: #f8fafc;
        padding: 9px 10px;
        font-size: 12px;
        outline: none;
      }
      .bb-openclaw-bridge__text {
        resize: vertical;
        min-height: 58px;
      }
      .bb-openclaw-bridge__input:focus,
      .bb-openclaw-bridge__text:focus {
        border-color: rgba(251, 146, 60, 0.8);
      }
      .bb-openclaw-bridge__row {
        display: flex;
        gap: 8px;
      }
      .bb-openclaw-bridge__btn {
        border: none;
        border-radius: 10px;
        padding: 8px 10px;
        background: rgba(255, 255, 255, 0.12);
        color: #f8fafc;
        font-size: 12px;
        cursor: pointer;
      }
      .bb-openclaw-bridge__btn:hover {
        background: rgba(255, 255, 255, 0.2);
      }
      .bb-openclaw-bridge__btn--primary {
        background: linear-gradient(135deg, #f97316, #fb923c);
        color: #fff7ed;
      }
      .bb-openclaw-bridge__btn--danger {
        background: rgba(239, 68, 68, 0.18);
        color: #fecaca;
      }
      .bb-openclaw-bridge__status {
        display: grid;
        grid-template-columns: 1fr;
        gap: 6px;
        padding: 10px;
        border-radius: 10px;
        background: rgba(15, 23, 42, 0.66);
        border: 1px solid rgba(255, 255, 255, 0.08);
        font-size: 12px;
        line-height: 1.6;
      }
      .bb-openclaw-bridge__status strong {
        color: #fdba74;
      }
      .bb-openclaw-bridge__toggle {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 12px;
      }
      .bb-openclaw-bridge__toast {
        position: fixed;
        right: 16px;
        bottom: 348px;
        z-index: 1000000;
        max-width: 320px;
        padding: 10px 12px;
        border-radius: 12px;
        background: rgba(15, 23, 42, 0.94);
        color: #f8fafc;
        border: 1px solid rgba(251, 146, 60, 0.22);
        box-shadow: 0 12px 28px rgba(15, 23, 42, 0.3);
        font-size: 12px;
        line-height: 1.6;
      }
    `
    document.head.appendChild(style)
  }

  function buildPanel() {
    const root = document.createElement('aside')
    root.className = 'bb-openclaw-bridge'
    root.innerHTML = `
      <div class="bb-openclaw-bridge__header">
        <h3 class="bb-openclaw-bridge__title">BigBiandan 前台桥接</h3>
        <span class="bb-openclaw-bridge__tag">OpenClaw 侧</span>
      </div>
      <div class="bb-openclaw-bridge__body">
        <div>
          <label class="bb-openclaw-bridge__label">原型页地址</label>
          <input class="bb-openclaw-bridge__input" data-role="prototype-url" />
        </div>
        <div>
          <label class="bb-openclaw-bridge__label">会话 ID</label>
          <input class="bb-openclaw-bridge__input" data-role="conversation-id" />
        </div>
        <div>
          <label class="bb-openclaw-bridge__label">手动消息</label>
          <textarea class="bb-openclaw-bridge__text" data-role="message-text"></textarea>
        </div>
        <div>
          <label class="bb-openclaw-bridge__label">目标节目 ID</label>
          <input class="bb-openclaw-bridge__input" data-role="target-id" />
        </div>
        <label class="bb-openclaw-bridge__toggle">
          <input type="checkbox" data-role="auto-forward" />
          跟随回车键和发送按钮自动转发
        </label>
        <div class="bb-openclaw-bridge__row">
          <button class="bb-openclaw-bridge__btn bb-openclaw-bridge__btn--primary" data-action="open">打开原型页</button>
          <button class="bb-openclaw-bridge__btn" data-action="ping">Ping</button>
          <button class="bb-openclaw-bridge__btn" data-action="submit">Submit</button>
        </div>
        <div class="bb-openclaw-bridge__row">
          <button class="bb-openclaw-bridge__btn" data-action="state">GetState</button>
          <button class="bb-openclaw-bridge__btn" data-action="confirm">Confirm</button>
          <button class="bb-openclaw-bridge__btn" data-action="select">Select</button>
          <button class="bb-openclaw-bridge__btn bb-openclaw-bridge__btn--danger" data-action="cancel">Cancel</button>
        </div>
        <div class="bb-openclaw-bridge__status" data-role="status-box"></div>
      </div>
    `

    document.body.appendChild(root)

    elements.root = root
    elements.prototypeUrl = root.querySelector('[data-role="prototype-url"]')
    elements.conversationId = root.querySelector('[data-role="conversation-id"]')
    elements.messageText = root.querySelector('[data-role="message-text"]')
    elements.targetId = root.querySelector('[data-role="target-id"]')
    elements.autoForward = root.querySelector('[data-role="auto-forward"]')
    elements.statusBox = root.querySelector('[data-role="status-box"]')

    elements.prototypeUrl.value = state.settings.prototypeUrl
    elements.conversationId.value = resolveConversationId()
    elements.messageText.value = ''
    elements.targetId.value = state.targetId
    elements.autoForward.checked = Boolean(state.settings.autoForward)

    elements.prototypeUrl.addEventListener('change', function () {
      state.settings.prototypeUrl = elements.prototypeUrl.value.trim() || DEFAULTS.prototypeUrl
      saveSettings()
      refreshPanel()
    })

    elements.conversationId.addEventListener('change', refreshPanel)
    elements.targetId.addEventListener('change', function () {
      state.targetId = elements.targetId.value.trim()
    })
    elements.autoForward.addEventListener('change', function () {
      state.settings.autoForward = elements.autoForward.checked
      saveSettings()
      refreshPanel()
    })

    root.addEventListener('click', function (event) {
      const action = event.target && event.target.getAttribute && event.target.getAttribute('data-action')
      if (!action) return
      event.preventDefault()
      if (action === 'open') return openPrototypeWindow(true)
      if (action === 'ping') return sendPing()
      if (action === 'submit') return manualSubmit()
      if (action === 'state') return sendEnvelope('bigbiandan.getState', buildSessionPayload())
      if (action === 'confirm') return sendEnvelope('bigbiandan.confirm', buildSessionPayload())
      if (action === 'select') return selectTarget()
      if (action === 'cancel') return sendEnvelope('bigbiandan.cancel', buildSessionPayload())
    })
  }

  function refreshPanel() {
    const conversationId = resolveConversationId()
    if (elements.conversationId && elements.conversationId.value.trim() !== conversationId) {
      elements.conversationId.value = conversationId
    }
    if (!elements.statusBox) return
    elements.statusBox.innerHTML = [
      `<div><strong>桥接状态：</strong>${escapeHtml(state.statusText)}</div>`,
      `<div><strong>会话 ID：</strong>${escapeHtml(state.lastSessionId || '-')}</div>`,
      `<div><strong>最近事件：</strong>${escapeHtml(state.lastEventType || '-')}</div>`,
      `<div><strong>最近摘要：</strong>${escapeHtml(state.lastSummary || '-')}</div>`,
      `<div><strong>自动转发：</strong>${state.settings.autoForward ? '开启' : '关闭'}</div>`,
    ].join('')
  }

  function resolveConversationId() {
    const fromInput = elements.conversationId && elements.conversationId.value.trim()
    if (fromInput) return fromInput
    const params = new URLSearchParams(window.location.search)
    return params.get('session') || 'agent:main:main'
  }

  function buildSessionPayload() {
    return {
      sessionId: state.lastSessionId || undefined,
      conversationId: resolveConversationId(),
    }
  }

  function openPrototypeWindow(forceFocus) {
    const targetUrl = state.settings.prototypeUrl || DEFAULTS.prototypeUrl
    if (!state.targetWindow || state.targetWindow.closed) {
      state.targetWindow = window.open(targetUrl, 'bigbiandan-prototype')
      state.bridgeReady = false
      state.statusText = state.targetWindow ? '已打开原型页，等待握手' : '打开原型页失败'
    } else if (forceFocus) {
      state.targetWindow.focus()
    }

    refreshPanel()
    if (state.targetWindow) {
      window.setTimeout(sendPing, 600)
    }
  }

  function sendPing() {
    sendEnvelope('bigbiandan.ping')
  }

  function manualSubmit() {
    const text = (elements.messageText && elements.messageText.value.trim()) || readComposerText()
    if (!text) {
      showToast('没有可发送的消息内容')
      return
    }
    forwardText(text, 'manual')
  }

  function selectTarget() {
    const targetId = (elements.targetId && elements.targetId.value.trim()) || state.targetId
    if (!targetId) {
      showToast('请先填写 targetId')
      return
    }
    state.targetId = targetId
    sendEnvelope('bigbiandan.selectTarget', {
      ...buildSessionPayload(),
      targetId,
    })
  }

  function sendEnvelope(type, payload) {
    if (!state.targetWindow || state.targetWindow.closed) {
      openPrototypeWindow(false)
    }
    if (!state.targetWindow || state.targetWindow.closed) {
      showToast('原型页未打开，无法发送')
      return
    }

    state.statusText = `发送 ${type}`
    refreshPanel()

    state.targetWindow.postMessage({
      type,
      requestId: `${type}-${Date.now()}`,
      payload,
    }, '*')
  }

  function forwardText(text, reason) {
    const conversationId = resolveConversationId()
    const hash = `${conversationId}::${text}`
    if (hash === state.lastRequestHash) {
      return
    }
    state.lastRequestHash = hash
    state.statusText = `已转发消息 (${reason})`
    refreshPanel()
    showToast(`已转发到编单原型：${truncate(text, 48)}`)
    sendEnvelope('bigbiandan.submit', {
      conversationId,
      text,
    })
  }

  function handleIncomingMessage(event) {
    const data = event.data
    if (!data || typeof data !== 'object' || typeof data.type !== 'string') {
      return
    }
    if (!data.type.startsWith('bigbiandan.')) {
      return
    }

    if (data.type === 'bigbiandan.ready') {
      state.bridgeReady = true
      state.statusText = '原型页已握手'
      state.lastEventType = data.type
      state.lastSummary = '原型页可接收消息'
      refreshPanel()
      showToast('已连接到 BigBiandan 原型页')
      return
    }

    if (data.type === 'bigbiandan.result') {
      const payload = data.payload || {}
      state.lastSessionId = payload.sessionId || state.lastSessionId
      state.lastSummary = payload.summary || state.lastSummary
      state.lastEventType = data.type
      state.statusText = `收到结果：${payload.status || 'unknown'}`
      refreshPanel()
      showToast(`返回结果：${payload.summary || '无摘要'}`)
      return
    }

    if (data.type === 'bigbiandan.state') {
      const payload = data.payload || {}
      const statePayload = payload.state || {}
      state.lastSessionId = payload.sessionId || state.lastSessionId
      state.lastSummary = statePayload.summary || state.lastSummary
      state.lastEventType = data.type
      state.statusText = `会话状态：${statePayload.status || 'unknown'}`
      refreshPanel()
      return
    }

    if (data.type === 'bigbiandan.orchestration') {
      const payload = data.payload || {}
      state.lastEventType = data.type
      state.lastSummary = payload.latestLog || payload.status || '编排状态已更新'
      state.statusText = payload.isRunning ? '编排执行中' : `编排状态：${payload.status || 'unknown'}`
      refreshPanel()
      return
    }

    if (data.type === 'bigbiandan.error') {
      const payload = data.payload || {}
      state.lastEventType = data.type
      state.statusText = '桥接返回错误'
      state.lastSummary = payload.message || '未知错误'
      refreshPanel()
      showToast(`桥接错误：${payload.message || '未知错误'}`)
    }
  }

  function handleComposerKeydown(event) {
    if (!state.settings.autoForward) return
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
    if (!isComposerTarget(event.target)) return

    window.setTimeout(function () {
      const text = readEventTargetText(event.target)
      if (text) {
        forwardText(text, 'enter')
      }
    }, 0)
  }

  function handleComposerClick(event) {
    if (!state.settings.autoForward) return
    const actionEl = event.target && event.target.closest ? event.target.closest('button,[role="button"]') : null
    if (!actionEl || !isLikelySendButton(actionEl)) return

    window.setTimeout(function () {
      const text = readComposerText()
      if (text) {
        forwardText(text, 'click')
      }
    }, 0)
  }

  function isComposerTarget(target) {
    if (!target || !(target instanceof HTMLElement)) return false
    if (target.matches('textarea')) return true
    if (target.matches('input[type="text"], input:not([type])')) return true
    if (target.isContentEditable) return true
    return false
  }

  function isLikelySendButton(element) {
    if (!element || !(element instanceof HTMLElement)) return false
    const text = (element.innerText || element.textContent || '').trim().toLowerCase()
    const aria = (element.getAttribute('aria-label') || element.getAttribute('title') || '').trim().toLowerCase()
    return ['send', '发送', 'submit', '提交'].some(function (token) {
      return text === token || aria === token || text.includes(token) || aria.includes(token)
    })
  }

  function readEventTargetText(target) {
    if (!target || !(target instanceof HTMLElement)) return ''
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
      return target.value.trim()
    }
    if (target.isContentEditable) {
      return (target.innerText || '').trim()
    }
    return ''
  }

  function readComposerText() {
    const candidates = []
    walkRoots(document, function (node) {
      if (!(node instanceof HTMLElement)) return
      if (node instanceof HTMLTextAreaElement) {
        const text = node.value.trim()
        if (text) candidates.push(text)
        return
      }
      if (node instanceof HTMLInputElement && (!node.type || node.type === 'text')) {
        const text = node.value.trim()
        if (text) candidates.push(text)
        return
      }
      if (node.isContentEditable) {
        const text = (node.innerText || '').trim()
        if (text) candidates.push(text)
      }
    })

    candidates.sort(function (a, b) {
      return b.length - a.length
    })
    return candidates[0] || ''
  }

  function walkRoots(root, visitor) {
    if (!root) return
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
    let node = walker.currentNode
    while (node) {
      visitor(node)
      if (node.shadowRoot) {
        walkRoots(node.shadowRoot, visitor)
      }
      node = walker.nextNode()
    }
  }

  function showToast(text) {
    const toast = document.createElement('div')
    toast.className = 'bb-openclaw-bridge__toast'
    toast.textContent = text
    document.body.appendChild(toast)
    window.setTimeout(function () {
      toast.remove()
    }, 2600)
  }

  function truncate(text, length) {
    if (text.length <= length) return text
    return `${text.slice(0, length)}...`
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }
})()
