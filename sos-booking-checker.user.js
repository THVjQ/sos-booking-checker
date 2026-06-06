// ==UserScript==
// @name         SOS Booking Checker v28
// @namespace    https://sosphonerepairs.com.au
// @version      3.5
// @description  Watches Roundcube for booking emails and shows them on SOS POS
// @author       SOS Phone Repairs
// @match        https://webmail.sosphonerepairs.com.au/*
// @match        https://app.sospos.com.au/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const get   = (k, d) => { try { const v = GM_getValue(k, null); return v !== null ? v : d; } catch { return d; } };
  const set   = (k, v) => { try { GM_setValue(k, v); } catch {} };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const XB = `background:none;border:none;color:#666;font-size:20px;cursor:pointer;padding:0 2px;line-height:1`;
  const L  = `display:block;font-size:10.5px;font-weight:700;color:#a6adc8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px`;
  const I  = `width:100%;padding:6px 8px;border-radius:6px;border:1px solid #45475a;background:#313244;color:#cdd6f4;font-size:12px;font-family:inherit;outline:none;box-sizing:border-box`;
  const BP = `padding:7px 12px;background:#4285f4;color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit`;
  const BS = `padding:7px 10px;background:#313244;color:#cdd6f4;border:none;border-radius:6px;font-size:12px;cursor:pointer;font-family:inherit`;
  const BR = `flex:1;padding:7px 8px;background:#c62828;color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit`;

  const hostname    = location.hostname.toLowerCase();
  const url         = location.href.toLowerCase();
  const isSOSPOS    = hostname.includes('sospos.com.au');
  const isRoundcube = url.includes('roundcube') || hostname.includes('webmail');

  if      (isSOSPOS)    initSOSPOS();
  else if (isRoundcube) initRoundcube();

  // ============================================================================
  // ROUNDCUBE
  // ============================================================================

  function initRoundcube() {
    keepAwake();
    addRoundcubeIndicator();
    setTimeout(runCheck, 5000);
    try {
      GM_addValueChangeListener('scanTrigger', (name, oldVal, newVal) => {
        if (newVal && Date.now() - newVal < 120000) { set('scanTrigger', 0); runCheck(); }
      });
    } catch(e) {}
  }

  function keepAwake() {
    set('rcCurrentUrl', location.href);
    if (navigator.locks?.request) {
      navigator.locks.request('sos_checker_lock', { mode: 'shared' }, () => new Promise(() => {}));
    }
    try {
      const ctx = new AudioContext(); const osc = ctx.createOscillator(); const gain = ctx.createGain();
      gain.gain.value = 0; osc.connect(gain); gain.connect(ctx.destination); osc.start();
    } catch(e) {}

    function loop() {
      set('rcHeartbeat', Date.now());
      const dot = document.getElementById('sos-rc-dot');
      if (dot) dot.style.background = dot.style.background.includes('161') ? '#66bb6a' : 'rgb(166,227,161)';

      const trigger = get('scanTrigger', 0);
      if (trigger && Date.now() - trigger < 120000) { set('scanTrigger', 0); runCheck(); }

      const lastChecked = get('lastChecked', null);
      const intervalMs  = get('interval', 30) * 60 * 1000;
      const elapsed     = lastChecked ? Date.now() - new Date(lastChecked).getTime() : Infinity;
      if (elapsed >= intervalMs && get('checkStatus', '') !== 'checking') runCheck();

      fetch(location.pathname + '?_sos_ping=' + Date.now(), {
        method: 'HEAD', mode: 'same-origin', cache: 'no-store'
      }).catch(() => {}).finally(() => setTimeout(loop, 3000));
    }
    setTimeout(loop, 1000);
  }

  function addRoundcubeIndicator() {
    if (document.getElementById('sos-rc-indicator') || !document.body) return;
    const el = document.createElement('div');
    el.id = 'sos-rc-indicator';
    el.style.cssText = `position:fixed;bottom:8px;left:8px;z-index:99999;display:flex;align-items:center;gap:5px;background:rgba(26,26,42,.9);border:1px solid #313244;border-radius:20px;padding:3px 8px 3px 5px;font-family:system-ui,sans-serif;font-size:10.5px;color:#a6adc8;cursor:default;user-select:none;`;
    el.innerHTML = `<span id="sos-rc-dot" style="width:7px;height:7px;border-radius:50%;background:#a6e3a1;display:inline-block;box-shadow:0 0 4px #a6e3a1"></span> SOS Checker active`;
    document.body.appendChild(el);
  }

  // ============================================================================
  // REFRESH INBOX — fetch checkmail + click refresh button
  // ============================================================================

  async function refreshInbox() {
    console.log('[SOS v3.5] refreshing inbox…');
    // Tell Roundcube to check for new mail via AJAX
    try {
      await fetch(location.origin + location.pathname + '?_task=mail&_action=checkmail', {
        credentials: 'same-origin', cache: 'no-store'
      });
    } catch(e) {}

    // Also click the visible refresh / check-mail button if present
    const refreshBtn = document.querySelector(
      'a.button.refresh, a[onclick*="check_mail"], a[onclick*="checkmail"], ' +
      '[title*="Check mail"], [title*="Refresh"], [aria-label*="Refresh"], ' +
      '#rcmbtn_checkmail, .rcmtoolbarbutton[id*="check"]'
    );
    if (refreshBtn) { refreshBtn.click(); console.log('[SOS v3.5] clicked refresh button'); }

    // Wait for the message list to settle
    await sleep(3000);
  }

  // ============================================================================
  // SCAN
  // ============================================================================

  async function runCheck() {
    set('lastChecked', new Date().toISOString());
    set('checkStatus', 'checking');

    // ── Refresh inbox first so new emails appear ─────────────────────────────
    await refreshInbox();

    const subjectFilter = get('subjectFilter', 'New submission from Book a repair');
    const processed     = get('processedUids', []);

    try {
      // Wait for message list to be present
      let tableRows = [];
      for (let attempt = 0; attempt < 12; attempt++) {
        tableRows = [...document.querySelectorAll(
          '#messagelist tr, table#messagelist tr, .messagelist tr, tr[data-uid], tr[id^="rcmrow"], tr[id^="uid"]'
        )].filter(r => r.querySelectorAll('td').length > 0);
        if (tableRows.length) break;
        await sleep(500);
      }

      if (!tableRows.length) { set('checkStatus', 'ok_none'); return; }

      const matching = [];
      for (const row of tableRows) {

        // ── Subject: use specific child elements only ──────────────────────────
        const subjectEl = row.querySelector(
          '.subject a, .subject span, .subject, [class*="subject"] a, [class*="subject"] span, [class*="subject"]'
        );
        const subject = subjectEl ? subjectEl.textContent.trim().replace(/\s+/g, ' ') : '';
        if (!subject) continue;
        if (/^(re:|fw:|fwd:)/i.test(subject)) continue;
        if (!subject.toLowerCase().includes(subjectFilter.toLowerCase())) continue;

        // ── UID: extract first run of digits from any attribute or row id ──────
        // Handles: data-uid="123", id="rcmrow123", id="uid123:INBOX", id="row_123"
        const rawId     = row.id || '';
        const numMatch  = rawId.match(/(\d+)/);           // first number in id
        const realUid   =
          row.dataset?.uid                                 ||
          row.getAttribute('data-uid')                    ||
          row.getAttribute('data-id')                     ||
          row.getAttribute('data-cid')                    ||
          (numMatch ? numMatch[1] : null);                // e.g. "123" from "uid123:INBOX"

        // Dedup key — real UID when available, else subject hash
        const dedupUid = realUid
          ? String(realUid)
          : 'h' + Math.abs(subject.split('').reduce((a,c) => (a<<5)-a+c.charCodeAt(0)|0, 0));

        if (processed.includes(dedupUid)) continue;

        // ── Unread only ────────────────────────────────────────────────────────
        const isUnread =
          row.classList.contains('unread') ||
          row.classList.contains('new') ||
          row.getAttribute('data-read') === '0' ||
          row.getAttribute('data-flags')?.includes('UNSEEN') ||
          (row.getAttribute('class') || '').includes('unread');
        if (!isUnread) continue;

        const fromEl = row.querySelector('.from, [class*="from"], [class*="sender"]');
        matching.push({
          uid: dedupUid, realUid: realUid ? String(realUid) : null,
          row, subject, from: (fromEl?.textContent || '').trim()
        });
      }

      if (!matching.length) { set('checkStatus', 'ok_none'); return; }

      const bookings = [];

      for (const em of matching) {
        let parsed = null;

        // ── Strategy 1: AJAX fetch using real UID ──────────────────────────────
        if (em.realUid) {
          const uid  = em.realUid;
          const base = location.origin + (location.pathname.replace(/\/+$/, '') || '');
          const urls = [
            `${base}?_task=mail&_action=preview&_uid=${uid}&_mbox=INBOX&_safe=1`,
            `${base}?_task=mail&_action=preview&_uid=${uid}&_mbox=INBOX`,
            `${base}?_task=mail&_action=show&_uid=${uid}&_mbox=INBOX`,
            `${location.origin}/index.php?_task=mail&_action=preview&_uid=${uid}&_mbox=INBOX&_safe=1`,
          ];
          for (const u of urls) {
            try {
              const res  = await fetch(u, { credentials: 'same-origin' });
              if (!res.ok) continue;
              const html = await res.text();
              if (/rcmlogin|action=login|id="login-form"/i.test(html)) break;
              const attempt = parseEmailHtml(html);
              console.log('[SOS v3.5] AJAX parsed:', JSON.stringify(attempt), 'url:', u);
              if (attempt.name || attempt.phone || attempt.email) { parsed = attempt; break; }
            } catch(e) { console.warn('[SOS v3.5] fetch error:', e.message); }
          }
        }

        // ── Strategy 2: click row, wait for reading pane to load, read it ─────
        if (!parsed || (!parsed.name && !parsed.phone && !parsed.email)) {
          console.log('[SOS v3.5] clicking row, waiting for reading pane…');
          em.row.click();

          // Poll until content appears (up to 8 seconds)
          parsed = await pollForEmailBody(8000);
          console.log('[SOS v3.5] click+poll parsed:', JSON.stringify(parsed));
        }

        // Only use parsed data if we got at least something real
        const hasData = parsed && (parsed.name || parsed.phone || parsed.email || parsed.device);
        const final   = hasData ? parsed : { name:'', phone:'', email:'', device:'', issue:'', location:'' };

        // Issue: use parsed issue, or subject only if we got real data (avoids garbage)
        if (!final.issue && hasData) final.issue = em.subject;

        bookings.push({
          uid: em.uid, subject: em.subject, from: em.from,
          ...final,
          receivedAt: new Date().toISOString()
        });
      }

      const allProcessed = [...get('processedUids', []), ...matching.map(e => e.uid)];
      set('pendingBookings', [...get('pendingBookings', []), ...bookings]);
      set('processedUids',   allProcessed);
      set('checkStatus', 'ok_found');
      showBanner(bookings);

    } catch(e) {
      set('checkStatus', 'error_' + e.message.substring(0, 50));
      console.error('[SOS Checker]', e);
    }
  }

  // Poll for email body content in the reading pane or iframe (max timeoutMs)
  async function pollForEmailBody(timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      // Reading pane (not inside messagelist)
      for (const sel of [
        '#messagecontent .message-body',
        '#messagecontent table',
        '#messagecontent',
        '#message-content',
        '.message-content',
        '.rcmBody',
        '[id*="messagecontent"]',
      ]) {
        const el = document.querySelector(sel);
        if (!el) continue;
        if (el.closest('#messagelist, .messagelist, #message-list, table.listing')) continue;
        const text = el.textContent.trim();
        // Must look like a form email — has "Name" and at least one other field label
        if (text.length > 80 && /name/i.test(text) && /phone|email|device/i.test(text)) {
          const attempt = parseEmailHtml(el.innerHTML);
          if (attempt.name || attempt.phone || attempt.email) return attempt;
        }
      }

      // Iframe (Roundcube Elastic)
      const iframe = document.querySelector('#messageiframe, iframe[id*="message"], iframe[name*="message"]');
      if (iframe) {
        try {
          const iDoc = iframe.contentDocument || iframe.contentWindow?.document;
          if (iDoc && iDoc.body) {
            const text = iDoc.body.textContent.trim();
            if (text.length > 80 && /name/i.test(text) && /phone|email|device/i.test(text)) {
              const attempt = parseEmailHtml(iDoc.body.innerHTML);
              if (attempt.name || attempt.phone || attempt.email) return attempt;
            }
          }
        } catch(e) {}
      }

      await sleep(400);
    }
    return null;
  }

  function showBanner(bookings) {
    if (!bookings.length) return;
    document.getElementById('sos-new-banner')?.remove();
    const b  = bookings[0];
    const el = document.createElement('div');
    el.id    = 'sos-new-banner';
    el.style.cssText = `position:fixed;top:16px;right:16px;z-index:99999;background:#1a1a2a;border:2px solid #c62828;border-radius:10px;padding:14px 16px;font-family:system-ui,sans-serif;font-size:13px;color:#cdd6f4;box-shadow:0 6px 24px rgba(198,40,40,.45);max-width:290px;`;
    el.innerHTML = `
      <div style="font-weight:800;color:#ff5252;margin-bottom:8px">📋 ${bookings.length} New Booking${bookings.length > 1 ? 's' : ''}!</div>
      <div style="font-size:12px;color:#a6adc8;margin-bottom:10px">${esc(b.name || b.from || 'Unknown')}${b.device ? ' — ' + esc(b.device) : ''}</div>
      <div style="display:flex;gap:6px">
        <button id="nb-open"  style="${BR}">Open SOS POS</button>
        <button id="nb-close" style="${BS}">✕</button>
      </div>`;
    document.body.appendChild(el);
    document.getElementById('nb-open').onclick  = () => { window.open('https://app.sospos.com.au/#sos=' + btoa(unescape(encodeURIComponent(JSON.stringify(b)))), '_blank'); el.remove(); };
    document.getElementById('nb-close').onclick = () => el.remove();
    setTimeout(() => el.isConnected && el.remove(), 15000);
  }

  // ============================================================================
  // SOS POS
  // ============================================================================

  function initSOSPOS() {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addSOSFAB);
    else { addSOSFAB(); setTimeout(addSOSFAB, 1500); }
    try {
      GM_addValueChangeListener('pendingBookings', () => { updateBadge(); if (panel) { panel.remove(); panel = null; buildSOSPanel(); } });
    } catch(e) {}
    const match = (location.hash || '').match(/sos=([A-Za-z0-9+/=]+)/);
    if (match) {
      let data; try { data = JSON.parse(decodeURIComponent(escape(atob(match[1])))); } catch { return; }
      history.replaceState(null, '', location.pathname + location.search);
      waitForEl('input[placeholder="Search customer..."]', 10000).then(() => showFillPanel(data));
    }
  }

  function addSOSFAB() {
    if (document.getElementById('sos-fab') || !document.body) return;
    const fab = document.createElement('button');
    fab.id = 'sos-fab'; fab.title = 'SOS Bookings'; fab.textContent = '📋';
    fab.style.cssText = `position:fixed;bottom:20px;left:72px;z-index:99999;width:44px;height:44px;border-radius:50%;background:#c62828;color:#fff;border:none;font-size:18px;cursor:pointer;box-shadow:0 3px 14px rgba(198,40,40,.55);display:flex;align-items:center;justify-content:center;`;
    fab.onmouseenter = () => fab.style.background = '#b71c1c';
    fab.onmouseleave = () => fab.style.background = '#c62828';
    fab.onclick = () => { if (panel) { panel.remove(); panel = null; } else buildSOSPanel(); };
    document.body.appendChild(fab);
    const badge = document.createElement('span');
    badge.id = 'sos-badge';
    badge.style.cssText = `position:fixed;bottom:66px;left:76px;z-index:100000;background:#ff5252;color:#fff;border-radius:10px;font-size:10px;font-weight:800;padding:1px 5px;display:none;pointer-events:none;font-family:system-ui,sans-serif;`;
    document.body.appendChild(badge);
    updateBadge();
  }

  function updateBadge() {
    const b = document.getElementById('sos-badge'); if (!b) return;
    const n = get('pendingBookings', []).length;
    b.textContent = n; b.style.display = n > 0 ? 'block' : 'none';
  }

  let panel = null;

  function buildSOSPanel() {
    if (panel) panel.remove();
    const bookings      = get('pendingBookings', []);
    const lastCheck     = get('lastChecked', null);
    const checkStatus   = get('checkStatus', '');
    const rcHeartbeat   = get('rcHeartbeat', 0);
    const subjectFilter = get('subjectFilter', 'New submission from Book a repair');
    const interval      = get('interval', 30);
    const rcEmail       = get('rcEmail', '');

    const agoText = lastCheck
      ? (() => { const m = Math.round((Date.now() - new Date(lastCheck)) / 60000); return m < 1 ? 'just now' : m + 'min ago'; })()
      : 'Never';

    const hbAge   = rcHeartbeat ? Math.round((Date.now() - rcHeartbeat) / 1000) : 999;
    const hbLabel = hbAge < 10  ? '<span style="color:#a6e3a1">🟢 Webmail active</span>'
                  : hbAge < 120 ? '<span style="color:#a6e3a1">🟢 Webmail active ' + hbAge + 's ago</span>'
                  : '<span style="color:#f38ba8">⚠️ Webmail tab not detected</span>';

    const lastCheckedMs  = lastCheck ? new Date(lastCheck).getTime() : 0;
    const nextScanInSecs = lastCheckedMs ? Math.max(0, Math.round((lastCheckedMs + interval * 60000 - Date.now()) / 1000)) : 0;
    const nextScanLabel  = nextScanInSecs > 0 ? (nextScanInSecs >= 60 ? Math.round(nextScanInSecs / 60) + 'min' : nextScanInSecs + 's') : 'soon';

    const statusLabel = {
      ok_none:  '✅ No new bookings',
      ok_found: '✅ New bookings found',
      checking: '⏳ Checking…',
    }[checkStatus] || (checkStatus.startsWith('error') ? '❌ ' + checkStatus.replace('error_','') : '');

    panel = document.createElement('div');
    panel.id = 'sos-panel';
    panel.style.cssText = `position:fixed;bottom:72px;left:16px;z-index:99998;width:320px;background:#1a1a2a;border:1.5px solid #c62828;border-radius:12px;color:#cdd6f4;font-family:system-ui,-apple-system,sans-serif;font-size:13px;box-shadow:0 8px 36px rgba(0,0,0,.55);max-height:80vh;overflow-y:auto;`;
    panel.innerHTML = `
      <div style="padding:12px 14px;border-bottom:1px solid #313244;display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:#1a1a2a;z-index:1">
        <span style="font-weight:800;font-size:14px;color:#ff5252">📋 Bookings</span>
        <button id="sos-close" style="${XB}">✕</button>
      </div>
      <div style="padding:8px 14px;border-bottom:1px solid #313244;display:flex;justify-content:space-between;align-items:center">
        <div style="font-size:11px;color:#6c7086;line-height:1.6">
          <div>Last check: <b style="color:#a6adc8">${agoText}</b> · Next: <b style="color:#a6adc8">${nextScanLabel}</b></div>
          <div>${hbLabel}</div>
          ${statusLabel ? '<div>' + statusLabel + '</div>' : ''}
        </div>
        <button id="sos-scan-now" style="padding:7px 12px;background:#c62828;color:#fff;border:none;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">🔍 Scan Now</button>
      </div>
      <details ${!rcEmail ? 'open' : ''} style="border-bottom:1px solid #313244">
        <summary style="padding:9px 14px;cursor:pointer;font-size:11px;font-weight:700;color:#6c7086;text-transform:uppercase;letter-spacing:.06em;user-select:none;list-style:none;display:flex;justify-content:space-between;align-items:center">
          ⚙ Email Settings <span>▾</span>
        </summary>
        <div style="padding:4px 14px 12px;display:flex;flex-direction:column;gap:8px">
          <div>
            <label style="${L}">Subject Filter</label>
            <input id="sos-subject" value="${esc(subjectFilter)}" style="${I}">
            <div style="font-size:10px;color:#6c7086;margin-top:2px">Must match part of the email subject</div>
          </div>
          <div>
            <label style="${L}">Check Every (minutes)</label>
            <input id="sos-interval" type="number" value="${interval}" min="5" max="240" style="${I}">
          </div>
          <div>
            <label style="${L}">Webmail Email</label>
            <input id="sos-email" type="email" value="${esc(get('rcEmail',''))}" placeholder="coffs@sosphonerepairs.com.au" style="${I}">
          </div>
          <div>
            <label style="${L}">Webmail Password <span style="font-weight:400;text-transform:none;color:#6c7086">(saved locally)</span></label>
            <div style="position:relative">
              <input id="sos-pass" type="password" value="${esc(get('rcPass',''))}" placeholder="••••••••" style="${I}">
              <button id="sos-eye" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;font-size:14px;padding:0;color:#6c7086">👁</button>
            </div>
            <div style="font-size:10px;color:#f38ba8;margin-top:3px">⚠️ Webmail tab must be open in Chrome</div>
          </div>
          <div style="display:flex;gap:6px">
            <button id="sos-save" style="${BP}">💾 Save</button>
            <button id="sos-reset" style="${BS}">↺ Reset Seen</button>
          </div>
          <div id="sos-smsg" style="font-size:11px;color:#a6e3a1;min-height:14px"></div>
        </div>
      </details>
      <div id="sos-cards">
        ${!bookings.length
          ? '<p style="text-align:center;color:#6c7086;padding:20px 14px;font-size:12px;line-height:1.6">No pending bookings.<br>' +
            (!rcEmail ? '<span style="color:#ff5252;font-weight:600">Add email credentials above to get started.</span>' : 'Auto-checks every ' + interval + ' min while webmail is open.') + '</p>'
          : bookings.slice().reverse().map((b, ri) => bookingCard(b, bookings.length - 1 - ri)).join('')
        }
      </div>
      ${bookings.length > 0 ? `<div style="padding:8px 14px;border-top:1px solid #313244"><button id="sos-clearall" style="${BS};width:100%">🗑 Clear All</button></div>` : ''}
    `;
    document.body.appendChild(panel);

    document.getElementById('sos-close').onclick  = () => { panel.remove(); panel = null; };
    document.getElementById('sos-eye').onclick     = () => { const i = document.getElementById('sos-pass'); i.type = i.type === 'password' ? 'text' : 'password'; };
    document.getElementById('sos-save').onclick    = () => {
      set('subjectFilter', document.getElementById('sos-subject').value.trim() || 'New submission from Book a repair');
      set('interval',      parseInt(document.getElementById('sos-interval').value) || 30);
      set('rcEmail',       document.getElementById('sos-email').value.trim());
      set('rcPass',        document.getElementById('sos-pass').value);
      const m = document.getElementById('sos-smsg'); m.textContent = '✅ Saved!';
      setTimeout(() => { if (m) m.textContent = ''; }, 2500);
    };
    document.getElementById('sos-reset').onclick = () => {
      set('processedUids', []);
      const m = document.getElementById('sos-smsg'); m.textContent = '↺ Reset — emails will re-appear next check';
      setTimeout(() => { if (m) m.textContent = ''; }, 3000);
    };
    document.getElementById('sos-scan-now').onclick = () => {
      set('scanTrigger', Date.now());
      const btn = document.getElementById('sos-scan-now');
      if (btn) { btn.textContent = '⏳ Triggered…'; btn.disabled = true; }
      setTimeout(() => { if (panel) { panel.remove(); panel = null; buildSOSPanel(); } }, 20000);
    };
    const clearBtn = document.getElementById('sos-clearall');
    if (clearBtn) clearBtn.onclick = () => {
      if (!confirm('Clear all pending bookings?')) return;
      set('pendingBookings', []); updateBadge(); panel.remove(); panel = null; buildSOSPanel();
    };
    panel.querySelectorAll('.sos-open').forEach(b => {
      b.onclick = () => {
        const booking = get('pendingBookings', [])[parseInt(b.dataset.idx)];
        if (!booking) return;
        showFillPanel(booking); panel.remove(); panel = null;
      };
    });
    panel.querySelectorAll('.sos-dismiss').forEach(b => {
      b.onclick = () => {
        const bs = get('pendingBookings', []); bs.splice(parseInt(b.dataset.idx), 1);
        set('pendingBookings', bs); updateBadge(); panel.remove(); panel = null; buildSOSPanel();
      };
    });
  }

  function bookingCard(b, idx) {
    return `<div style="margin:6px 10px;background:#181825;border:1px solid #313244;border-left:3px solid #c62828;border-radius:8px;padding:10px 12px">
      <div style="font-weight:700;margin-bottom:5px;color:#cdd6f4">${esc(b.name || b.from || 'Unknown')}</div>
      <div style="font-size:11.5px;line-height:1.8;color:#a6adc8;margin-bottom:8px">
        ${b.phone    ? '<div><b style="color:#7f849c">Phone:</b> '    + esc(b.phone)    + '</div>' : ''}
        ${b.email    ? '<div><b style="color:#7f849c">Email:</b> '    + esc(b.email)    + '</div>' : ''}
        ${b.device   ? '<div><b style="color:#7f849c">Device:</b> '   + esc(b.device)   + '</div>' : ''}
        ${b.location ? '<div><b style="color:#7f849c">Location:</b> ' + esc(b.location) + '</div>' : ''}
        ${b.issue    ? '<div><b style="color:#7f849c">Issue:</b> '    + esc(b.issue)    + '</div>' : ''}
      </div>
      <div style="display:flex;gap:5px">
        <button class="sos-open"    data-idx="${idx}" style="${BR}">🔧 Open in SOS POS</button>
        <button class="sos-dismiss" data-idx="${idx}" style="${BS}">✕</button>
      </div>
    </div>`;
  }

  // ============================================================================
  // AUTO-FILL
  // ============================================================================

  function showFillPanel(data) {
    if (document.getElementById('sos-fill')) return;
    const p = document.createElement('div');
    p.id = 'sos-fill';
    p.style.cssText = `position:fixed;top:68px;right:14px;z-index:99999;width:300px;background:#181825;border:2px solid #c62828;border-radius:12px;padding:16px;color:#fff;font-family:system-ui,sans-serif;font-size:13px;box-shadow:0 8px 40px rgba(198,40,40,.4);`;
    p.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <span style="font-weight:800;font-size:14px;color:#ff5252">📋 Booking Request</span>
        <button id="fill-close" style="${XB}">✕</button>
      </div>
      <div style="background:#ffffff0d;border-radius:8px;padding:10px 12px;margin-bottom:12px;line-height:1.9;font-size:12px">
        <div><b style="color:#aaa">Name:</b>   ${esc(data.name)     || '—'}</div>
        <div><b style="color:#aaa">Phone:</b>  ${esc(data.phone)    || '—'}</div>
        <div><b style="color:#aaa">Email:</b>  ${esc(data.email)    || '—'}</div>
        <div><b style="color:#aaa">Device:</b> ${esc(data.device)   || '—'}</div>
        ${data.location ? '<div><b style="color:#aaa">Location:</b> ' + esc(data.location) + '</div>' : ''}
        ${data.issue    ? '<div><b style="color:#aaa">Issue:</b>    ' + esc(data.issue)    + '</div>' : ''}
      </div>
      <button id="fill-go" style="width:100%;padding:11px;border:none;border-radius:8px;background:#c62828;color:#fff;font-size:13px;font-weight:800;cursor:pointer;font-family:inherit">⚡ Auto-Fill Ticket Form</button>
      <div id="fill-msg" style="margin-top:9px;font-size:11px;color:#888;text-align:center;min-height:15px"></div>`;
    document.body.appendChild(p);
    document.getElementById('fill-close').onclick = () => p.remove();
    document.getElementById('fill-go').onclick    = async () => {
      const btn = document.getElementById('fill-go'); btn.disabled = true; btn.textContent = 'Working…';
      await autoFill(data, msg => { const e = document.getElementById('fill-msg'); if (e) e.textContent = msg; });
      await sleep(900); p.remove();
    };
  }

  async function autoFill(data, status) {
    status('Adding customer…');
    const addBtn = document.querySelector('svg.lucide-user-plus')?.closest('button');
    if (addBtn) {
      addBtn.click();
      await waitForEl('input[placeholder="Customer name"]', 4000); await sleep(200);
      fillInput('input[placeholder="Customer name"]', data.name);
      fillInput('input[placeholder="0400 000 000"]',  data.phone);
      fillInput('input[type="email"]',                data.email);
      const notes = document.querySelector('textarea[placeholder="Additional information..."]');
      if (notes && data.issue) fillTextarea(notes, 'Repair request: ' + data.issue);
      await sleep(400);
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Create Customer');
      if (btn && !btn.disabled) { btn.click(); await sleep(1400); }
    }
    status('Setting device…');
    fillInput('input[placeholder="Search or type device name..."]', data.device); await sleep(300);
    status('Setting issue → Other…');
    await pickOpt('issues', 'Other'); await sleep(400);
    status('DOA → No…');
    document.getElementById('doa-no')?.click(); await sleep(200);
    status('Status → Booking…');
    await pickOpt('status', 'Booking'); await sleep(200);
    status('✅ Done!');
  }

  async function pickOpt(type, label) {
    const trigger = type === 'issues'
      ? [...document.querySelectorAll('button')].find(b => b.textContent.includes('Select issues'))
      : [...document.querySelectorAll('button[role="combobox"]')].find(b => ['Repairing','Booking','Pending','Ready','Waiting','New'].includes(b.textContent.trim()));
    if (!trigger) return;
    trigger.click(); await sleep(500);
    for (const opt of document.querySelectorAll('[role="option"]')) {
      if (opt.textContent.toLowerCase().includes(label.toLowerCase())) { opt.click(); return; }
    }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }

  // ============================================================================
  // EMAIL PARSERS
  // ============================================================================

  function parseEmailHtml(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const r   = { name:'', email:'', phone:'', device:'', issue:'', location:'' };

    // Strategy 1: two-column table rows  <td>Label</td><td>Value</td>
    doc.querySelectorAll('tr').forEach(row => {
      const tds = [...row.querySelectorAll('td')];
      if (tds.length < 2) return;
      const k = tds[0].textContent.trim().toLowerCase();
      const v = tds[1].textContent.trim();
      if (!v) return;
      applyField(r, k, v);
    });

    // Strategy 2: alternating rows — label row then value row
    if (!r.name && !r.phone && !r.email) {
      const rows = [...doc.querySelectorAll('tr')];
      for (let i = 0; i < rows.length - 1; i++) {
        const k = rows[i].textContent.trim().toLowerCase();
        const v = rows[i + 1].textContent.trim();
        if (!v || v.length > 300) continue;
        if (applyField(r, k, v)) i++;
      }
    }

    // Strategy 3: plain-text key: value lines
    if (!r.name && !r.phone && !r.email) {
      return parseEmailText(doc.body ? (doc.body.innerText || doc.body.textContent || '') : '');
    }

    const fullText = doc.body ? (doc.body.innerText || doc.body.textContent || '') : '';
    if (!r.email) { const m = fullText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/); if (m) r.email = m[0]; }
    if (!r.phone) { const m = fullText.match(/(?:\+?61\s?|0)[2-9]\d[\s-]?\d{3,4}[\s-]?\d{3,4}/); if (m) r.phone = m[0].replace(/[\s-]/g,''); }
    return r;
  }

  function applyField(r, k, v) {
    if (!r.name     && /^name$/i.test(k))                                                              { r.name     = v; return true; }
    if (!r.email    && /email/i.test(k))                                                               { r.email    = v; return true; }
    if (!r.phone    && /phone|mobile|telephone/i.test(k))                                              { r.phone    = v; return true; }
    if (!r.device   && /phone\s*type|device|model|handset|brand/i.test(k))                            { r.device   = v; return true; }
    if (!r.issue    && /damage|tell us|issue|problem|fault|repair|description|message|info/i.test(k)) { r.issue    = v; return true; }
    if (!r.location && /location|choose.*location|store|branch/i.test(k))                             { r.location = v; return true; }
    return false;
  }

  function parseEmailText(text) {
    const r   = { name:'', email:'', phone:'', device:'', issue:'', location:'' };
    const map = {
      name:     ['name','full name','your name','customer name'],
      email:    ['email','email address','your email','e-mail'],
      phone:    ['phone','phone number','mobile','mobile number','contact number','telephone'],
      device:   ['phone type','device','device type','phone model','model','make','make/model','handset','brand'],
      issue:    ['issue','problem','fault','repair','info','information','message','details','description','damage','tell us'],
      location: ['location','choose a location','store','branch'],
    };
    for (const line of text.split('\n')) {
      const t = line.trim(); if (!t || !t.includes(':')) continue;
      const ci = t.indexOf(':'); const k = t.substring(0,ci).toLowerCase().trim(); const v = t.substring(ci+1).trim(); if (!v) continue;
      for (const [field, kws] of Object.entries(map)) {
        if (!r[field] && kws.some(kw => k.includes(kw))) { r[field] = v; break; }
      }
    }
    if (!r.email) { const m = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/); if (m) r.email = m[0]; }
    if (!r.phone) { const m = text.match(/(?:\+?61\s?|0)[2-9]\d[\s-]?\d{3,4}[\s-]?\d{3,4}/); if (m) r.phone = m[0].replace(/[\s-]/g,''); }
    return r;
  }

  // ============================================================================
  // DOM HELPERS
  // ============================================================================

  function fillInput(sel, val) {
    if (!val) return; const el = typeof sel==='string' ? document.querySelector(sel) : sel; if (!el) return;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,val);
    el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true}));
  }
  function fillTextarea(el, val) {
    if (!el||!val) return;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,val);
    el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true}));
  }
  function waitForEl(selector, timeout) {
    return new Promise(resolve => {
      const el = document.querySelector(selector); if (el) { resolve(el); return; }
      const obs = new MutationObserver(() => { const e=document.querySelector(selector); if(e){obs.disconnect();resolve(e);} });
      obs.observe(document.body,{childList:true,subtree:true});
      setTimeout(()=>{obs.disconnect();resolve(null);},timeout);
    });
  }
  function esc(s) { return String(s||'').replace(/[<>"'&]/g,c=>({'<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','&':'&amp;'}[c])); }

})();