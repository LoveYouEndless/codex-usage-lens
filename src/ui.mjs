export function inspectPage() {
  const normalize = value => {
    const id = String(value || '').replace(/^local:/, '');
    return /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id) ? id : null;
  };
  const active = document.querySelector('[data-app-action-sidebar-thread-active="true"]');
  const activeId = normalize(active?.getAttribute('data-app-action-sidebar-thread-id'));
  if (activeId) return { id: activeId };
  const composerId = normalize(document.querySelector('[data-above-composer-conversation-id]')
    ?.getAttribute('data-above-composer-conversation-id'));
  if (composerId) return { id: composerId };
  const ids = new Set(Array.from(document.querySelectorAll('[data-response-annotation-conversation]'))
    .map(node => normalize(node.getAttribute('data-response-annotation-conversation'))).filter(Boolean));
  return { id: ids.size === 1 ? Array.from(ids)[0] : null };
}

export function removeLens() {
  const runtime = window.__codexUsageLens;
  try { runtime?.destroy(); } catch { /* Remove owned nodes even if an old runtime fails to clean up. */ }
  document.querySelectorAll('[data-usage-lens]').forEach(node => node.remove());
  document.querySelectorAll('[data-usage-lens-reply]').forEach(node => node.removeAttribute('data-usage-lens-reply'));
  return { removed: true };
}

export function installLens(payload) {
  const VERSION = '0.2.0';
  const KEY = '__codexUsageLens';
  const ATTR = 'data-usage-lens';
  const active = () => {
    const normalize = value => {
      const id = String(value || '').replace(/^local:/, '');
      return /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id) ? id : null;
    };
    const row = document.querySelector('[data-app-action-sidebar-thread-active="true"]');
    const rowId = normalize(row?.getAttribute('data-app-action-sidebar-thread-id'));
    if (rowId) return rowId;
    const composerId = normalize(document.querySelector('[data-above-composer-conversation-id]')
      ?.getAttribute('data-above-composer-conversation-id'));
    if (composerId) return composerId;
    const ids = new Set(Array.from(document.querySelectorAll('[data-response-annotation-conversation]'))
      .map(node => normalize(node.getAttribute('data-response-annotation-conversation'))).filter(Boolean));
    return ids.size === 1 ? Array.from(ids)[0] : null;
  };
  if (window[KEY]?.version === VERSION) return window[KEY].update(payload);
  window[KEY]?.destroy();
  const text = {
    zh: {
      usage: '\u7528\u91cf', turn: '\u672c\u8f6e\u7528\u91cf', session: '\u4f1a\u8bdd\u7d2f\u8ba1',
      input: '\u8f93\u5165', cached: '\u5176\u4e2d\u7f13\u5b58\u8f93\u5165', uncached: '\u672a\u7f13\u5b58\u8f93\u5165',
      output: '\u8f93\u51fa', reasoning: '\u5176\u4e2d\u63a8\u7406', model: '\u6a21\u578b',
      provider: '\u63d0\u4f9b\u65b9', context: '\u4e0a\u4e0b\u6587', calls: '\u8ba1\u6570\u66f4\u65b0',
      close: '\u5173\u95ed', meter: '\u663e\u793a\u4f1a\u8bdd\u6d6e\u7a97', raw: '\u539f\u503c',
      partial: '\u672c\u8f6e\u8bb0\u5f55\u4e0d\u5b8c\u6574', working: '\u8fdb\u884c\u4e2d',
      interrupted: '\u5df2\u4e2d\u65ad', updated: '\u66f4\u65b0\u4e8e'
    },
    en: {
      usage: 'Usage', turn: 'Turn usage', session: 'Session total',
      input: 'Input', cached: 'Cached input (included)', uncached: 'Uncached input',
      output: 'Output', reasoning: 'Reasoning (included)', model: 'Model',
      provider: 'Provider', context: 'Context', calls: 'Usage updates',
      close: 'Close', meter: 'Show session meter', raw: 'Raw',
      partial: 'Incomplete turn records', working: 'In progress',
      interrupted: 'Interrupted', updated: 'Updated'
    }
  };
  const language = () => {
    const locale = document.documentElement.lang || navigator.language || 'en';
    return /^zh\b/i.test(locale) ? 'zh' : 'en';
  };
  const t = key => text[language()][key] || key;
  const readPreference = (key, fallback) => {
    try { return localStorage.getItem(`codex-usage-lens:${key}`) || fallback; } catch { return fallback; }
  };
  const preference = (key, value) => { try { localStorage.setItem(`codex-usage-lens:${key}`, value); } catch {} };
  let unit = readPreference('unit', 'auto');
  if (!['auto', 'raw', 'K', 'M'].includes(unit)) unit = 'auto';
  let showMeter = readPreference('meter', 'false') === 'true';
  let selected = null;
  let selectedSession = null;
  let timer = null;
  let destroyed = false;
  let data = payload;
  const replyHosts = new Set();
  const format = value => {
    if (value == null) return '\u2014';
    const scale = unit === 'K' ? 1000 : unit === 'M' ? 1000000
      : unit === 'auto' ? (value >= 1000000 ? 1000000 : value >= 1000 ? 1000 : 1) : 1;
    const suffix = scale === 1000000 ? 'M' : scale === 1000 ? 'K' : '';
    return new Intl.NumberFormat(language() === 'zh' ? 'zh-CN' : 'en-US', {
      maximumFractionDigits: scale === 1 ? 0 : value / scale < 10 ? 2 : 1
    }).format(value / scale) + suffix;
  };
  const make = (tag, className, value) => {
    const node = document.createElement(tag);
    node.setAttribute(ATTR, '');
    if (className) node.className = className;
    if (value != null) node.textContent = value;
    return node;
  };
  const theme = node => {
    const dark = document.documentElement.classList.contains('dark')
      || document.documentElement.getAttribute('data-theme') === 'dark'
      || document.documentElement.getAttribute('data-color-mode') === 'dark'
      || (getComputedStyle(document.body).color.match(/\d+/g)?.slice(0, 3).reduce((a, n) => a + Number(n), 0) > 500);
    node.classList.toggle('ul-dark', dark);
  };
  const style = make('style');
  style.textContent = `
    .ul-row{display:flex;align-items:center;gap:8px;max-width:100%;margin:4px 0 8px;min-height:26px}
    .ul-row.ul-inline{flex:0 0 auto;margin:0 6px;min-height:22px}
    .ul-row.ul-inline .ul-button{min-height:22px;padding:2px 7px;font-size:11px}
    .ul-row.ul-contextual{opacity:0;pointer-events:none}
    [data-usage-lens-reply]:hover .ul-contextual,
    [data-usage-lens-reply]:focus-within .ul-contextual,
    .ul-row.ul-contextual:has(.ul-button[aria-expanded=true]){opacity:1;pointer-events:auto}
    .ul-button,.ul-dialog,.ul-meter{--ul-bg:#fff;--ul-fg:#222;--ul-sub:#707070;--ul-border:#dedede;
      color:var(--ul-fg);font:12px/1.45 system-ui,sans-serif;letter-spacing:0;box-sizing:border-box}
    .ul-dark{--ul-bg:#242424;--ul-fg:#f3f3f3;--ul-sub:#b0b0b0;--ul-border:#494949}
    .ul-row .ul-button{display:inline-flex;align-items:center;gap:5px;min-height:26px;padding:3px 9px;
      color:var(--ul-action-fg,var(--ul-sub));border:0;border-radius:5px;background:transparent;cursor:pointer;
      white-space:nowrap;max-width:100%;box-shadow:none;flex-wrap:wrap;font-variant-numeric:tabular-nums}
    .ul-row .ul-button:hover,.ul-row .ul-button[aria-expanded=true]{background:#f0f1f2}
    .ul-row .ul-dark.ul-button:hover,.ul-row .ul-dark.ul-button[aria-expanded=true]{background:#353535}
    .ul-button svg{width:14px;height:14px;flex:0 0 14px}
    .ul-button:focus-visible,.ul-dialog button:focus-visible{outline:2px solid #348b69;outline-offset:2px}
    .ul-dialog{position:fixed;z-index:2147483001;width:310px;max-width:calc(100vw - 24px);
      max-height:calc(100vh - 24px);overflow:auto;background:var(--ul-bg);border:1px solid var(--ul-border);
      border-radius:8px;padding:14px;box-shadow:0 5px 22px #0002;font-variant-numeric:tabular-nums}
    .ul-dialog *{box-sizing:border-box;letter-spacing:0}
    .ul-head{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px;font-weight:600;font-size:13px}
    .ul-close{border:0;background:transparent;color:var(--ul-sub);width:26px;height:26px;
      padding:0;font-size:20px;cursor:pointer;border-radius:4px;flex:none}
    .ul-table{display:grid;grid-template-columns:minmax(0,1fr) minmax(60px,auto);gap:8px 12px;margin:0}
    .ul-table dt{color:var(--ul-sub);margin:0;overflow-wrap:anywhere;font-weight:400}
    .ul-table dd{margin:0;text-align:right;overflow-wrap:anywhere;max-width:170px}
    .ul-table .ul-subrow{padding-left:10px;font-size:11px}
    .ul-divider{height:1px;background:var(--ul-border);margin:12px 0}
    .ul-total{font-size:14px;font-weight:600}.ul-muted{color:var(--ul-sub);font-size:11px}
    .ul-controls{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:12px;flex-wrap:wrap}
    .ul-units{display:flex;border:1px solid var(--ul-border);border-radius:4px;overflow:hidden}
    .ul-units button{padding:3px 7px;min-height:24px;background:transparent;border:0;color:var(--ul-sub);font:11px system-ui;cursor:pointer}
    .ul-units button[aria-checked=true]{background:var(--ul-border);color:var(--ul-fg)}
    .ul-meter-toggle{display:flex;align-items:center;gap:5px;font-size:11px;color:var(--ul-sub)}
    .ul-meter-toggle input[type=checkbox]{appearance:auto;width:14px;height:14px;min-width:14px;
      flex:0 0 14px;margin:0;opacity:1;accent-color:#348b69;cursor:pointer}
    .ul-meter{position:fixed;right:18px;top:90px;z-index:2147483000;background:var(--ul-bg);
      border:1px solid var(--ul-border);border-radius:6px;padding:8px 10px;max-width:calc(100vw - 24px);
      cursor:grab;box-shadow:0 3px 12px #0001;user-select:none;touch-action:none}
    .ul-meter button{font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer}
    .ul-meter-label{color:var(--ul-sub);margin-right:8px}.ul-meter-value{font-weight:600}
  `;
  document.head.append(style);
  const dialog = make('section', 'ul-dialog');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'false');
  dialog.hidden = true;
  document.body.append(dialog);
  const meter = make('div', 'ul-meter');
  meter.hidden = true;
  document.body.append(meter);
  let anchor = null;
  let dialogSignature = null;

  const place = () => {
    if (dialog.hidden || !anchor?.isConnected) return;
    const rect = (meter.contains(anchor) ? meter : anchor).getBoundingClientRect();
    const gap = meter.contains(anchor) ? 4 : 6;
    const width = dialog.offsetWidth;
    const height = dialog.offsetHeight;
    const alignedLeft = rect.left + width <= innerWidth - 12 ? rect.left : rect.right - width;
    const left = Math.max(12, Math.min(alignedLeft, innerWidth - width - 12));
    const top = rect.bottom + height + gap <= innerHeight - 12
      ? rect.bottom + gap : rect.top - height - gap;
    dialog.style.left = `${left}px`;
    dialog.style.top = `${Math.max(12, Math.min(top, innerHeight - height - 12))}px`;
  };
  const close = () => {
    anchor?.setAttribute('aria-expanded', 'false');
    dialog.hidden = true; selected = null; selectedSession = null; anchor = null; dialogSignature = null;
  };
  function renderDialog() {
    const session = selectedSession || data?.session;
    const usage = selected?.usage || session?.total;
    if (!usage) { close(); return; }
    const signature = JSON.stringify({
      selected, session: {
        model: session.model, provider: session.provider, total: session.total,
        context: session.context, window: session.window, updatedAt: session.updatedAt
      }, unit, showMeter, language: language()
    });
    if (signature === dialogSignature) return;
    dialogSignature = signature;
    const focused = dialog.contains(document.activeElement) ? document.activeElement : null;
    const focusedUnit = focused?.getAttribute('data-ul-unit');
    const focusedCheckbox = focused?.type === 'checkbox';
    dialog.replaceChildren();
    theme(dialog);
    const head = make('div', 'ul-head');
    const title = make('span', '', selected ? t('turn') : t('session'));
    dialog.setAttribute('aria-label', title.textContent);
    const closeButton = make('button', 'ul-close', '\u00d7');
    closeButton.type = 'button';
    closeButton.title = t('close');
    closeButton.setAttribute('aria-label', t('close'));
    closeButton.onclick = () => { const previous = anchor; close(); previous?.focus(); };
    head.append(title, closeButton);
    dialog.append(head);
    const table = make('dl', 'ul-table');
    const row = (label, value, className = '') => {
      const dt = make('dt', className, label);
      const dd = make('dd', className, value);
      table.append(dt, dd);
    };
    row(t('usage'), `${format(usage.total)} tok`, 'ul-total');
    row(t('input'), `${format(usage.input)} tok`);
    row(t('cached'), `${format(usage.cached)} tok`, 'ul-subrow');
    row(t('uncached'), `${format(Math.max(0, usage.input - usage.cached))} tok`, 'ul-subrow');
    row(t('output'), `${format(usage.output)} tok`);
    row(t('reasoning'), `${format(usage.reasoning)} tok`, 'ul-subrow');
    dialog.append(table, make('div', 'ul-divider'));
    const info = make('dl', 'ul-table');
    const detail = (label, value) => info.append(make('dt', '', label), make('dd', '', value));
    detail(t('model'), selected?.model || session?.model || '\u2014');
    if (session?.provider) detail(t('provider'), session.provider);
    if (selected) {
      detail(t('session'), `${format(session.total.total)} tok`);
      detail(t('calls'), String(selected.calls));
    }
    if (session.context != null && session.window) {
      detail(t('context'), `${format(session.context)} / ${format(session.window)}`);
    }
    dialog.append(info);
    if (selected?.partial) dialog.append(make('p', 'ul-muted', t('partial')));
    if (selected && !selected.complete) {
      dialog.append(make('p', 'ul-muted', selected.endedAt ? t('interrupted') : t('working')));
    }
    if (session.updatedAt) {
      const date = new Date(session.updatedAt);
      if (Number.isFinite(date.getTime())) dialog.append(make('p', 'ul-muted',
        `${t('updated')} ${date.toLocaleTimeString(language() === 'zh' ? 'zh-CN' : 'en-US')}`));
    }
    const controls = make('div', 'ul-controls');
    const units = make('div', 'ul-units');
    units.setAttribute('role', 'radiogroup');
    units.setAttribute('aria-label', 'Token units');
    for (const option of ['auto', 'raw', 'K', 'M']) {
      const button = make('button', '', option === 'raw' ? t('raw') : option === 'auto' ? 'Auto' : option);
      button.type = 'button';
      button.setAttribute('role', 'radio');
      button.setAttribute('data-ul-unit', option);
      button.setAttribute('aria-checked', String(unit === option));
      button.onclick = () => { unit = option; preference('unit', unit); paint(); renderDialog(); place(); };
      units.append(button);
    }
    const label = make('label', 'ul-meter-toggle');
    const check = make('input');
    check.type = 'checkbox';
    check.checked = showMeter;
    check.onchange = () => { showMeter = check.checked; preference('meter', String(showMeter)); paintMeter(); };
    label.append(check, make('span', '', t('meter')));
    controls.append(units, label);
    dialog.append(controls);
    if (focusedCheckbox) check.focus({ preventScroll: true });
    else if (focusedUnit) units.querySelector(`[data-ul-unit="${focusedUnit}"]`)?.focus({ preventScroll: true });
  }
  function open(button, turn, session) {
    const same = anchor === button && !dialog.hidden;
    close();
    if (same) return;
    anchor = button;
    selected = turn;
    selectedSession = session;
    renderDialog();
    dialog.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    place();
  }
  function paintMeter() {
    const session = data?.session;
    meter.hidden = !showMeter || !session || session.id !== active();
    if (meter.hidden) { if (anchor && meter.contains(anchor)) close(); return; }
    theme(meter);
    let button = meter.querySelector('button');
    if (!button) {
      button = make('button');
      button.type = 'button';
      button.append(make('span', 'ul-meter-label'), make('span', 'ul-meter-value'));
      meter.append(button);
    }
    const label = button.querySelector('.ul-meter-label');
    const value = button.querySelector('.ul-meter-value');
    const caption = `${format(session.total.total)} tok`;
    if (label.textContent !== t('session')) label.textContent = t('session');
    if (value.textContent !== caption) value.textContent = caption;
  }
  function paint() {
    if (destroyed) return;
    const session = data?.session;
    const id = active();
    if (!session || session.id !== id) {
      document.querySelectorAll('.ul-row[data-usage-lens]').forEach(node => node.remove());
      for (const host of replyHosts) host.removeAttribute('data-usage-lens-reply');
      replyHosts.clear();
      close();
      paintMeter();
      return;
    }
    const byMessage = new Map();
    const byTurn = new Map();
    for (const turn of session.turns) {
      if (turn.usage.total <= 0) continue;
      for (const message of turn.messages) byMessage.set(message, turn);
      byTurn.set(turn.id, turn);
    }
    const hosts = Array.from(document.querySelectorAll('[data-response-annotation-target][data-response-annotation-conversation]'));
    const used = new Set();
    const kept = new Set();
    const keptHosts = new Set();
    for (const host of hosts) {
      const conversation = host.getAttribute('data-response-annotation-conversation')?.replace(/^local:/, '');
      if (conversation !== session.id) continue;
      const message = host.getAttribute('data-response-annotation-target');
      const turn = byMessage.get(message);
      const stamp = host.querySelector('[data-assistant-message-sent-time]');
      const actionRow = stamp?.parentElement;
      if (!turn || used.has(turn.id) || !actionRow || actionRow.closest(`[${ATTR}]`)) continue;
      used.add(turn.id);
      let row = host.querySelector('.ul-row[data-usage-lens]');
      if (!row) {
        row = make('div', 'ul-row');
        actionRow.insertAdjacentElement('afterend', row);
      }
      kept.add(row);
      host.setAttribute('data-usage-lens-reply', '');
      keptHosts.add(host);
      replyHosts.add(host);
      let button = row.querySelector('button');
      if (!button) {
        button = make('button', 'ul-button');
        button.type = 'button';
        // Lucide database icon; see THIRD_PARTY_NOTICES.md.
        button.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/></svg>';
        button.append(make('span', 'ul-caption'));
        row.append(button);
      }
      const caption = `${t('usage')} ${format(turn.usage.total)} tok`;
      const label = button.querySelector('.ul-caption');
      if (label.textContent !== caption) label.textContent = caption;
      button.title = `${t('turn')}: ${new Intl.NumberFormat().format(turn.usage.total)} tok`;
      button.setAttribute('aria-haspopup', 'dialog');
      button.setAttribute('aria-expanded', String(!dialog.hidden && anchor === button));
      button.setAttribute('data-usage-lens-turn', turn.id);
      button.onclick = () => open(button, turn, session);
      theme(button);
      const actionStyle = getComputedStyle(actionRow);
      const nativeChildren = Array.from(actionRow.children).filter(node => node !== row);
      const nativeControls = nativeChildren.find(node => node.querySelector('button'));
      const nativeButton = nativeControls?.querySelector('button');
      row.classList.toggle('ul-contextual', nativeControls
        ? nativeControls.classList.contains('opacity-0')
        : turn.id !== session.turns.at(-1)?.id);
      if (nativeButton) button.style.setProperty('--ul-action-fg', getComputedStyle(nativeButton).color);
      const nativeWidth = nativeChildren.reduce((sum, node) => {
        const style = getComputedStyle(node);
        return sum + node.getBoundingClientRect().width
          + (parseFloat(style.marginLeft) || 0) + (parseFloat(style.marginRight) || 0);
      }, 0);
      const required = nativeWidth + button.getBoundingClientRect().width
        + (parseFloat(actionStyle.columnGap) || 0) * nativeChildren.length + 16;
      const inline = actionStyle.display.includes('flex') && actionStyle.flexDirection === 'row'
        && actionRow.clientWidth >= required;
      row.classList.toggle('ul-inline', inline);
      if (inline) {
        if (row.parentElement !== actionRow || row.nextElementSibling !== stamp) actionRow.insertBefore(row, stamp);
      } else if (row.parentElement !== actionRow.parentElement || row.previousElementSibling !== actionRow) {
        actionRow.insertAdjacentElement('afterend', row);
      }
    }
    document.querySelectorAll('.ul-row[data-usage-lens]').forEach(row => { if (!kept.has(row)) row.remove(); });
    for (const host of replyHosts) {
      if (!keptHosts.has(host)) { host.removeAttribute('data-usage-lens-reply'); replyHosts.delete(host); }
    }
    paintMeter();
    if (!dialog.hidden) {
      if (!anchor?.isConnected || selectedSession?.id !== session.id) close();
      else {
        selected = selected ? byTurn.get(selected.id) : null;
        selectedSession = session;
        if (anchor.getAttribute('data-usage-lens-turn') && !selected) close();
        else { renderDialog(); place(); }
      }
    }
  }
  const schedule = () => {
    if (timer || destroyed) return;
    timer = setTimeout(() => { timer = null; paint(); }, 120);
  };
  const observer = new MutationObserver(records => {
    if (records.every(record => record.target.nodeType === 1
      && (record.target.hasAttribute(ATTR) || record.target.closest?.(`[${ATTR}]`)))) return;
    schedule();
  });
  observer.observe(document.body, {
    childList: true, subtree: true, attributes: true,
    attributeFilter: ['data-app-action-sidebar-thread-active', 'data-response-annotation-conversation']
  });
  const outside = event => {
    const anchorRoot = anchor && meter.contains(anchor) ? meter : anchor;
    if (!dialog.hidden && !dialog.contains(event.target) && !anchorRoot?.contains(event.target)) close();
  };
  const keyboard = event => { if (event.key === 'Escape' && !dialog.hidden) { const previous = anchor; close(); previous?.focus(); } };
  const scrolling = () => { if (!dialog.hidden) place(); };
  const resizing = () => { schedule(); scrolling(); };
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('keydown', keyboard);
  document.addEventListener('scroll', scrolling, true);
  window.addEventListener('resize', resizing);
  let drag = null;
  meter.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    const rect = meter.getBoundingClientRect();
    drag = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false };
    meter.setPointerCapture(event.pointerId);
  });
  meter.addEventListener('pointermove', event => {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    if (!drag.moved) return;
    meter.style.right = 'auto';
    meter.style.left = `${Math.max(8, Math.min(innerWidth - meter.offsetWidth - 8, drag.left + dx))}px`;
    meter.style.top = `${Math.max(8, Math.min(innerHeight - meter.offsetHeight - 8, drag.top + dy))}px`;
    place();
  });
  meter.addEventListener('click', event => {
    if (drag?.moved) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    const session = data?.session;
    const button = meter.querySelector('button');
    if (button && session?.id === active()) open(button, null, session);
  });
  meter.addEventListener('pointerup', () => { setTimeout(() => { drag = null; }, 0); });
  const runtime = {
    version: VERSION,
    update(value) {
      data = value;
      paint();
      return {
        activeThreadId: active(), sessionId: data?.session?.id || null,
        buttons: document.querySelectorAll('.ul-row[data-usage-lens]').length
      };
    },
    destroy() {
      destroyed = true;
      clearTimeout(timer);
      observer.disconnect();
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', keyboard);
      document.removeEventListener('scroll', scrolling, true);
      window.removeEventListener('resize', resizing);
      document.querySelectorAll(`[${ATTR}]`).forEach(node => node.remove());
      for (const host of replyHosts) host.removeAttribute('data-usage-lens-reply');
      delete window[KEY];
    }
  };
  window[KEY] = runtime;
  return runtime.update(payload);
}
