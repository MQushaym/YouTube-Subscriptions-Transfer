// YouTube Subscriptions Hub - Popup Controller (v2.2.1)
// Robust Multi-tier execution (chrome.scripting -> chrome.tabs.sendMessage -> fallback)
// Real-time Logging, Clean Distraction-Free UI

document.addEventListener('DOMContentLoaded', async () => {
  // -----------------------------------------------------------
  // 1. Logging & Diagnostics Engine
  // -----------------------------------------------------------
  const logsContainer = document.getElementById('logsContainer');
  const logCountBadge = document.getElementById('logCountBadge');
  const btnToggleLogs = document.getElementById('btnToggleLogs');
  const btnCloseLogs = document.getElementById('btnCloseLogs');
  const btnCopyLogs = document.getElementById('btnCopyLogs');
  const btnClearLogs = document.getElementById('btnClearLogs');
  const logsDrawer = document.getElementById('logsDrawer');

  let logs = [];

  const Logger = {
    async init() {
      try {
        const stored = await chrome.storage.local.get('extensionLogs');
        if (Array.isArray(stored.extensionLogs)) {
          logs = stored.extensionLogs.slice(-150);
        }
      } catch (e) {
        logs = [];
      }
      this.render();
    },

    log(message, type = 'info') {
      const now = new Date();
      const timeStr = now.toTimeString().split(' ')[0];
      const entry = { time: timeStr, text: message, type };
      logs.push(entry);
      if (logs.length > 250) logs.shift();

      chrome.storage.local.set({ extensionLogs: logs }).catch(() => {});
      this.render();
      console.log(`[${timeStr}] [${type.toUpperCase()}] ${message}`);
    },

    render() {
      if (!logsContainer) return;
      logsContainer.innerHTML = '';
      logs.forEach(item => {
        const line = document.createElement('div');
        line.className = 'log-line';
        line.innerHTML = `<span class="log-time">[${item.time}]</span> <span class="log-${item.type}">${this.escapeHtml(item.text)}</span>`;
        logsContainer.appendChild(line);
      });
      logsContainer.scrollTop = logsContainer.scrollHeight;
      if (logCountBadge) logCountBadge.textContent = logs.length;
    },

    clear() {
      logs = [];
      chrome.storage.local.remove('extensionLogs').catch(() => {});
      this.render();
    },

    getText() {
      return logs.map(l => `[${l.time}] [${l.type.toUpperCase()}] ${l.text}`).join('\n');
    },

    escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
  };

  await Logger.init();
  Logger.log('تم تشغيل الإضافة بنجاح.', 'info');

  // Logs Drawer UI
  btnToggleLogs?.addEventListener('click', () => {
    logsDrawer.classList.toggle('hidden');
    if (!logsDrawer.classList.contains('hidden')) {
      logsContainer.scrollTop = logsContainer.scrollHeight;
    }
  });

  btnCloseLogs?.addEventListener('click', () => logsDrawer.classList.add('hidden'));
  btnClearLogs?.addEventListener('click', () => Logger.clear());

  btnCopyLogs?.addEventListener('click', async () => {
    const text = Logger.getText();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      const orig = btnCopyLogs.textContent;
      btnCopyLogs.textContent = '✅ تم النسخ!';
      setTimeout(() => { btnCopyLogs.textContent = orig; }, 1500);
    } catch (e) {
      alert('فشل نسخ السجل تلقائياً.');
    }
  });

  // -----------------------------------------------------------
  // 2. Tab Navigation
  // -----------------------------------------------------------
  const navTabExport = document.getElementById('navTabExport');
  const navTabImport = document.getElementById('navTabImport');
  const tabContentExport = document.getElementById('tabContentExport');
  const tabContentImport = document.getElementById('tabContentImport');

  function switchTab(tab) {
    if (tab === 'export') {
      navTabExport.classList.add('active');
      navTabImport.classList.remove('active');
      tabContentExport.classList.remove('hidden');
      tabContentImport.classList.add('hidden');
    } else {
      navTabImport.classList.add('active');
      navTabExport.classList.remove('active');
      tabContentImport.classList.remove('hidden');
      tabContentExport.classList.add('hidden');
    }
  }

  navTabExport.addEventListener('click', () => switchTab('export'));
  navTabImport.addEventListener('click', () => switchTab('import'));

  // -----------------------------------------------------------
  // 3. Multi-tier YouTube Communication Engine
  // -----------------------------------------------------------
  const activeAccountName = document.getElementById('activeAccountName');

  async function getYouTubeTab() {
    const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTabs[0] && activeTabs[0].url && activeTabs[0].url.includes('youtube.com')) {
      return activeTabs[0];
    }
    const allTabs = await chrome.tabs.query({ url: '*://*.youtube.com/*' });
    return allTabs.length > 0 ? allTabs[0] : null;
  }

  // Multi-tier caller: Tries chrome.scripting (if loaded) -> then chrome.tabs.sendMessage (bridge)
  async function callYouTube(action, payload = {}, inPageFunc = null) {
    const ytTab = await getYouTubeTab();
    if (!ytTab) {
      throw new Error('لم يتم العثور على تبويب يوتيوب مفتوح في المتصفح.');
    }

    // Tier 1: Try chrome.scripting.executeScript if available
    if (inPageFunc && chrome.scripting && typeof chrome.scripting.executeScript === 'function') {
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: ytTab.id },
          world: 'MAIN',
          func: inPageFunc,
          args: payload ? [payload] : []
        });
        if (results && results[0] && results[0].result !== undefined) {
          return results[0].result;
        }
      } catch (scriptingErr) {
        Logger.log(`(scripting غير مفعل، التبديل إلى قنوات المراسلة المباشرة)`, 'warn');
      }
    }

    // Tier 2: chrome.tabs.sendMessage to content script / page bridge
    try {
      const res = await chrome.tabs.sendMessage(ytTab.id, { action, ...payload });
      if (res !== undefined) return res;
    } catch (msgErr) {
      // If content script was not injected, inject it and retry once
      try {
        if (chrome.scripting && typeof chrome.scripting.executeScript === 'function') {
          await chrome.scripting.executeScript({ target: { tabId: ytTab.id }, files: ['content/content.js'] });
        }
        await new Promise(r => setTimeout(r, 200));
        return await chrome.tabs.sendMessage(ytTab.id, { action, ...payload });
      } catch (injectErr) {
        throw new Error('يرجى تحديث صفحة يوتيوب المفتوحة (F5) لتفعيل الاتصال.');
      }
    }

    throw new Error('لم يتم تلقي أي استجابة من صفحة يوتيوب.');
  }

  // In-page functions for Tier 1 execution (MAIN World)
  function inPageGetSubscriptions() {
    return (async () => {
      try {
        const getCookie = (name) => {
          const value = '; ' + document.cookie;
          const parts = value.split('; ' + name + '=');
          if (parts.length === 2) return parts.pop().split(';').shift();
          return null;
        };
        const sha1 = async (str) => {
          const buffer = new TextEncoder().encode(str);
          const hashBuffer = await crypto.subtle.digest('SHA-1', buffer);
          const hashArray = Array.from(new Uint8Array(hashBuffer));
          return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        };

        const sapisid = getCookie('SAPISID') || getCookie('__Secure-3PAPISID') || getCookie('__Secure-1PAPISID');
        const time = Math.floor(Date.now() / 1000);
        const origin = window.location.origin || 'https://www.youtube.com';
        const hash = sapisid ? await sha1(time + ' ' + sapisid + ' ' + origin) : null;
        const authHeader = hash ? 'SAPISIDHASH ' + time + '_' + hash : null;

        const sessionIndex = (window.ytcfg && window.ytcfg.get('SESSION_INDEX')) || '0';
        const userAccountName = (window.ytcfg && window.ytcfg.get('USER_ACCOUNT_NAME')) || 'حساب يوتيوب النشط';
        const apiKey = window.ytcfg && window.ytcfg.get('INNERTUBE_API_KEY');
        const context = window.ytcfg && window.ytcfg.get('INNERTUBE_CONTEXT');
        const clientVersion = (window.ytcfg && window.ytcfg.get('INNERTUBE_CLIENT_VERSION')) || '2.20261002.01.00';

        const channelIds = new Set();
        const handles = new Set();

        document.querySelectorAll('ytd-channel-renderer').forEach(el => {
          const cid = el.querySelector('ytd-subscribe-button-renderer')?.getAttribute('channel-id');
          if (cid) channelIds.add(cid);
          const href = el.querySelector('a#main-link')?.getAttribute('href') || '';
          if (href.includes('/@')) handles.add('@' + href.split('/@')[1].split('/')[0].split('?')[0].toLowerCase());
        });

        if (apiKey && context) {
          const headers = {
            'Content-Type': 'application/json',
            'X-Origin': origin,
            'X-YouTube-Client-Name': '1',
            'X-YouTube-Client-Version': clientVersion,
            'X-Goog-AuthUser': sessionIndex
          };
          if (authHeader) headers['Authorization'] = authHeader;

          try {
            const res = await fetch('/youtubei/v1/browse?key=' + apiKey + '&prettyPrint=false', {
              method: 'POST',
              credentials: 'include',
              headers,
              body: JSON.stringify({ context, browseId: 'FEchannels' })
            });
            if (res.ok) {
              const data = await res.json();
              const jsonStr = JSON.stringify(data);
              const cids = (jsonStr.match(/"channelId":"(UC[a-zA-Z0-9_-]{22})"/g) || []).map(m => m.split(':"')[1].replace('"', ''));
              cids.forEach(id => channelIds.add(id));
              const handleMatches = jsonStr.match(/"canonicalBaseUrl":"\/@([^"]+)"/g) || [];
              handleMatches.forEach(m => {
                const h = m.match(/"canonicalBaseUrl":"\/@([^"]+)"/)?.[1];
                if (h) handles.add('@' + h.toLowerCase());
              });
            }
          } catch (e) {}
        }

        return {
          success: true,
          userAccountName,
          sessionIndex,
          channelIds: Array.from(channelIds),
          handles: Array.from(handles)
        };
      } catch (err) {
        return { success: false, error: err.message };
      }
    })();
  }

  function inPageSubscribeChannel(args) {
    const targetChannelId = typeof args === 'string' ? args : args?.channelId;
    return (async () => {
      try {
        const getCookie = (name) => {
          const value = '; ' + document.cookie;
          const parts = value.split('; ' + name + '=');
          if (parts.length === 2) return parts.pop().split(';').shift();
          return null;
        };
        const sha1 = async (str) => {
          const buffer = new TextEncoder().encode(str);
          const hashBuffer = await crypto.subtle.digest('SHA-1', buffer);
          const hashArray = Array.from(new Uint8Array(hashBuffer));
          return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        };

        const sapisid = getCookie('SAPISID') || getCookie('__Secure-3PAPISID') || getCookie('__Secure-1PAPISID');
        const time = Math.floor(Date.now() / 1000);
        const origin = window.location.origin || 'https://www.youtube.com';
        const hash = sapisid ? await sha1(time + ' ' + sapisid + ' ' + origin) : null;
        const authHeader = hash ? 'SAPISIDHASH ' + time + '_' + hash : null;

        const sessionIndex = (window.ytcfg && window.ytcfg.get('SESSION_INDEX')) || '0';
        const apiKey = window.ytcfg && window.ytcfg.get('INNERTUBE_API_KEY');
        const context = window.ytcfg && window.ytcfg.get('INNERTUBE_CONTEXT');
        const clientVersion = (window.ytcfg && window.ytcfg.get('INNERTUBE_CLIENT_VERSION')) || '2.20261002.01.00';

        if (!apiKey || !context) return { success: false, error: 'تعذر الوصول لبيانات جلسة يوتيوب' };

        const headers = {
          'Content-Type': 'application/json',
          'X-Origin': origin,
          'X-YouTube-Client-Name': '1',
          'X-YouTube-Client-Version': clientVersion,
          'X-Goog-AuthUser': sessionIndex
        };
        if (authHeader) headers['Authorization'] = authHeader;

        const res = await fetch('/youtubei/v1/subscription/subscribe?key=' + apiKey + '&prettyPrint=false', {
          method: 'POST',
          credentials: 'include',
          headers,
          body: JSON.stringify({
            context,
            channelIds: [targetChannelId],
            params: 'EgIIARgAUAE='
          })
        });

        const data = await res.json();
        const isLoggedOut = data?.responseContext?.mainAppWebResponseContext?.loggedOut === true;
        const hasSubscribedFlag = data?.actions?.some(a => a.updateSubscribeButtonAction?.subscribed === true) ||
                                 data?.frameworkUpdates?.entityBatchUpdate?.mutations?.some(m => m.payload?.subscriptionStateEntity?.subscribed === true);

        return {
          success: res.ok && !isLoggedOut && (hasSubscribedFlag || (!data.error && data.actions)),
          status: res.status,
          isLoggedOut,
          channelId: targetChannelId,
          error: isLoggedOut ? 'انتهت الجلسة' : (data?.error?.message || null)
        };
      } catch (err) {
        return { success: false, error: err.message };
      }
    })();
  }

  function inPageResolveHandle(args) {
    const urlOrHandle = typeof args === 'string' ? args : args?.url;
    return (async () => {
      try {
        const apiKey = window.ytcfg && window.ytcfg.get('INNERTUBE_API_KEY');
        const context = window.ytcfg && window.ytcfg.get('INNERTUBE_CONTEXT');
        if (!apiKey || !context) return { success: false, error: 'تعذر الوصول لـ API' };

        const fullUrl = urlOrHandle.startsWith('http') ? urlOrHandle : ('https://www.youtube.com/' + urlOrHandle.replace(/^\/?/, ''));
        const res = await fetch('/youtubei/v1/navigation/resolve_url?key=' + apiKey, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ context, url: fullUrl })
        });
        const data = await res.json();
        const browseId = data?.endpoint?.browseEndpoint?.browseId || null;
        return { success: !!browseId, channelId: browseId };
      } catch (err) {
        return { success: false, error: err.message };
      }
    })();
  }

  // -----------------------------------------------------------
  // 4. Subscriptions Query & Sync
  // -----------------------------------------------------------
  let activeSubscribedIds = new Set();
  let activeSubscribedHandles = new Set();

  async function loadActiveSubscriptions() {
    Logger.log('بدء فحص اشتراكات الحساب النشط في يوتيوب...', 'info');
    activeAccountName.textContent = 'جاري الفحص...';

    try {
      const res = await callYouTube('GET_MY_SUBSCRIPTIONS', {}, inPageGetSubscriptions);

      if (res && res.success) {
        activeAccountName.textContent = res.userAccountName || 'حساب يوتيوب النشط';
        activeSubscribedIds = new Set(res.channelIds || []);
        activeSubscribedHandles = new Set((res.handles || []).map(h => h.toLowerCase()));

        Logger.log(`تم الاتصال بالحساب: "${res.userAccountName}" (Session: ${res.sessionIndex || 0}).`, 'success');
        Logger.log(`تم جلب ${activeSubscribedIds.size} قناة مشتركة في هذا الحساب.`, 'success');
        return true;
      } else {
        activeAccountName.textContent = 'تعذر الجلب';
        Logger.log(`فشل جلب الاشتراكات: ${res?.error || 'استجابة غير متوقعة'}`, 'error');
        return false;
      }
    } catch (err) {
      activeAccountName.textContent = 'تحديث يوتيوب (F5)';
      Logger.log(`خطأ أثناء فحص الاشتراكات: ${err.message}`, 'error');
      return false;
    }
  }

  // -----------------------------------------------------------
  // 5. CSV Parsing & Mutual Channels Matching
  // -----------------------------------------------------------
  let importedChannels = [];
  let currentFilter = 'all';
  let searchQuery = '';
  let isAutoSubscribing = false;
  let pauseAutoSubscribe = false;

  const importDropzoneContainer = document.getElementById('importDropzoneContainer');
  const importManagerContainer = document.getElementById('importManagerContainer');
  const csvFileInput = document.getElementById('csvFileInput');
  const dropzone = document.getElementById('dropzone');
  const btnSelectFile = document.getElementById('btnSelectFile');
  const currentFileName = document.getElementById('currentFileName');
  const btnChangeFile = document.getElementById('btnChangeFile');

  const statTotal = document.getElementById('statTotal');
  const statMutual = document.getElementById('statMutual');
  const statPending = document.getElementById('statPending');

  const btnAutoSubscribe = document.getElementById('btnAutoSubscribe');
  const autoSubCount = document.getElementById('autoSubCount');
  const btnPauseAutoSub = document.getElementById('btnPauseAutoSub');
  const btnRefreshSubs = document.getElementById('btnRefreshSubs');

  const progressBox = document.getElementById('progressBox');
  const progressMessage = document.getElementById('progressMessage');
  const progressPercent = document.getElementById('progressPercent');
  const progressBar = document.getElementById('progressBar');

  const channelSearchInput = document.getElementById('channelSearchInput');
  const pillAll = document.getElementById('pillAll');
  const pillPending = document.getElementById('pillPending');
  const pillMutual = document.getElementById('pillMutual');
  const countAll = document.getElementById('countAll');
  const countPending = document.getElementById('countPending');
  const countMutual = document.getElementById('countMutual');
  const channelsList = document.getElementById('channelsList');

  function parseCSV(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

    const lines = [];
    let row = [''];
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const next = text[i + 1];

      if (char === '"') {
        if (inQuotes && next === '"') {
          row[row.length - 1] += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        row.push('');
      } else if ((char === '\r' || char === '\n') && !inQuotes) {
        if (char === '\r' && next === '\n') i++;
        lines.push(row);
        row = [''];
      } else {
        row[row.length - 1] += char;
      }
    }
    if (row.length > 1 || row[0] !== '') lines.push(row);
    if (lines.length < 2) return [];

    const headerRow = lines[0].map(h => h.trim().toLowerCase());
    const nameIdx = headerRow.findIndex(h => h.includes('اسم') || h.includes('name') || h.includes('title'));
    const urlIdx = headerRow.findIndex(h => h.includes('رابط') || h.includes('url') || h.includes('link'));
    const idIdx = headerRow.findIndex(h => h.includes('معرف القناة') || h.includes('channel id') || h.includes('channelid'));
    const handleIdx = headerRow.findIndex(h => h.includes('المعرف') || h.includes('handle'));
    const subIdx = headerRow.findIndex(h => h.includes('مشترك') || h.includes('sub'));

    const list = [];
    for (let r = 1; r < lines.length; r++) {
      const line = lines[r];
      if (!line || line.length === 0 || (line.length === 1 && !line[0].trim())) continue;

      const name = (nameIdx !== -1 && line[nameIdx]) ? line[nameIdx].trim() : (line[0] || '').trim();
      const url = (urlIdx !== -1 && line[urlIdx]) ? line[urlIdx].trim() : (line[1] || '').trim();
      const channelId = (idIdx !== -1 && line[idIdx]) ? line[idIdx].trim() : '';
      const handle = (handleIdx !== -1 && line[handleIdx]) ? line[handleIdx].trim() : '';
      const subscribers = (subIdx !== -1 && line[subIdx]) ? line[subIdx].trim() : '';

      if (name || url) {
        list.push({
          id: 'ch_' + r,
          name: name || handle || 'قناة يوتيوب',
          url: url || '',
          channelId: channelId || '',
          handle: handle || '',
          subscribers: subscribers || '',
          status: 'pending'
        });
      }
    }
    return list;
  }

  function matchChannels() {
    let mutualCount = 0;
    importedChannels.forEach(c => {
      if (c.status === 'subscribed_now') {
        mutualCount++;
        return;
      }

      const isSubscribed = (c.channelId && activeSubscribedIds.has(c.channelId)) ||
                           (c.handle && activeSubscribedHandles.has(c.handle.toLowerCase()));

      if (isSubscribed) {
        c.status = 'mutual_pre';
        mutualCount++;
      } else {
        c.status = 'pending';
      }
    });

    Logger.log(`نتيجة المطابقة: ${mutualCount} قناة مشتركة مسبقاً، و ${importedChannels.length - mutualCount} قناة متبقية.`, 'info');
  }

  function updateStats() {
    const total = importedChannels.length;
    const mutual = importedChannels.filter(c => c.status === 'mutual_pre' || c.status === 'subscribed_now').length;
    const pending = importedChannels.filter(c => c.status === 'pending').length;

    statTotal.textContent = total;
    statMutual.textContent = mutual;
    statPending.textContent = pending;
    autoSubCount.textContent = pending;

    countAll.textContent = total;
    countPending.textContent = pending;
    countMutual.textContent = mutual;

    if (pending === 0) {
      btnAutoSubscribe.disabled = true;
      btnAutoSubscribe.style.opacity = '0.5';
    } else {
      btnAutoSubscribe.disabled = false;
      btnAutoSubscribe.style.opacity = '1';
    }
  }

  function renderList() {
    channelsList.innerHTML = '';

    const filtered = importedChannels.filter(c => {
      if (currentFilter === 'pending' && c.status !== 'pending') return false;
      if (currentFilter === 'mutual' && (c.status !== 'mutual_pre' && c.status !== 'subscribed_now')) return false;

      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (c.name && c.name.toLowerCase().includes(q)) ||
               (c.handle && c.handle.toLowerCase().includes(q));
      }
      return true;
    });

    if (filtered.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.style.textAlign = 'center';
      emptyDiv.style.padding = '24px 10px';
      emptyDiv.style.color = '#777';
      emptyDiv.textContent = 'لا توجد قنوات في هذا التصنيف.';
      channelsList.appendChild(emptyDiv);
      return;
    }

    filtered.forEach(c => {
      const isMutual = c.status === 'mutual_pre' || c.status === 'subscribed_now';
      const isDone = c.status === 'subscribed_now';

      const card = document.createElement('div');
      card.className = `channel-card ${isMutual ? 'mutual' : ''} ${isDone ? 'newly-subscribed' : ''}`;
      card.id = `card_${c.id}`;

      const initial = (c.name || 'ق').trim().charAt(0);
      let meta = c.handle;
      if (c.subscribers) meta = meta ? `${meta} • ${c.subscribers}` : c.subscribers;

      card.innerHTML = `
        <div class="card-avatar">${initial}</div>
        <div class="card-info">
          <div class="card-title-row">
            <a href="${c.url || '#'}" target="_blank" class="card-title" title="${c.name}">${c.name}</a>
            <span class="card-badge ${isMutual ? 'badge-mutual' : 'badge-new'}">
              ${isDone ? 'تم الاشتراك' : (isMutual ? 'مشترك مسبقاً' : 'جديدة')}
            </span>
          </div>
          <div class="card-meta">${meta || 'يوتيوب'}</div>
        </div>
        <div class="card-action">
          <button class="btn-card-sub ${isDone ? 'done' : (isMutual ? 'mutual' : 'pending')}" 
                  data-id="${c.id}" 
                  ${isMutual ? 'disabled' : ''}>
            ${isDone ? '✅ مشترك' : (isMutual ? 'مشترك مسبقاً' : '➕ اشتراك')}
          </button>
        </div>
      `;

      const subBtn = card.querySelector('.btn-card-sub');
      if (subBtn && c.status === 'pending') {
        subBtn.addEventListener('click', () => subscribeOne(c, subBtn, card));
      }

      channelsList.appendChild(card);
    });
  }

  // -----------------------------------------------------------
  // 6. Subscribe to a Single Channel
  // -----------------------------------------------------------
  async function subscribeOne(channel, btnEl, cardEl) {
    if (btnEl) {
      btnEl.classList.add('loading');
      btnEl.textContent = 'جاري...';
    }

    Logger.log(`محاولة الاشتراك في قناة "${channel.name}"...`, 'info');

    try {
      let channelId = channel.channelId;

      // Resolve handle to channelId if missing
      if (!channelId && (channel.url || channel.handle)) {
        const resolveRes = await callYouTube('RESOLVE_HANDLE', { url: channel.url || channel.handle }, inPageResolveHandle);
        if (resolveRes && resolveRes.success && resolveRes.channelId) {
          channelId = resolveRes.channelId;
          channel.channelId = channelId;
          Logger.log(`تم استخراج المعرف: ${channelId}`, 'info');
        }
      }

      if (!channelId) {
        Logger.log(`فشل استخراج معرف القناة لـ "${channel.name}"`, 'error');
        if (btnEl) {
          btnEl.classList.remove('loading');
          btnEl.textContent = 'فشل المعرف';
        }
        return false;
      }

      // Execute Subscribe
      const res = await callYouTube('SUBSCRIBE_CHANNEL', { channelId }, inPageSubscribeChannel);

      if (btnEl) btnEl.classList.remove('loading');

      if (res && res.success) {
        Logger.log(`✅ تم الاشتراك بنجاح في "${channel.name}" (${channelId}) - HTTP ${res.status}`, 'success');
        channel.status = 'subscribed_now';
        activeSubscribedIds.add(channelId);
        if (channel.handle) activeSubscribedHandles.add(channel.handle.toLowerCase());

        updateStats();

        if (cardEl && btnEl) {
          cardEl.className = 'channel-card newly-subscribed';
          const badge = cardEl.querySelector('.card-badge');
          if (badge) {
            badge.className = 'card-badge badge-mutual';
            badge.textContent = 'تم الاشتراك';
          }
          btnEl.className = 'btn-card-sub done';
          btnEl.textContent = '✅ مشترك';
          btnEl.disabled = true;
        }
        return true;
      } else {
        const errorText = res?.error || `HTTP ${res?.status || 'فشل'}`;
        Logger.log(`❌ فشل الاشتراك في "${channel.name}": ${errorText}`, 'error');
        if (btnEl) {
          btnEl.textContent = errorText.includes('جلسة') ? 'انتهت الجلسة' : 'فشل';
        }
        return false;
      }
    } catch (err) {
      Logger.log(`استثناء أثناء الاشتراك: ${err.message}`, 'error');
      if (btnEl) {
        btnEl.classList.remove('loading');
        btnEl.textContent = 'خطأ';
      }
      return false;
    }
  }

  // -----------------------------------------------------------
  // 7. Batch Auto-Subscribe Runner
  // -----------------------------------------------------------
  btnAutoSubscribe?.addEventListener('click', async () => {
    if (isAutoSubscribing) return;

    const pending = importedChannels.filter(c => c.status === 'pending');
    if (pending.length === 0) {
      alert('جميع القنوات مشتركة بالفعل!');
      return;
    }

    isAutoSubscribing = true;
    pauseAutoSubscribe = false;

    btnAutoSubscribe.classList.add('hidden');
    btnPauseAutoSub.classList.remove('hidden');
    progressBox.classList.remove('hidden');

    Logger.log(`🚀 بدء الاشتراك التلقائي في ${pending.length} قناة متبقية...`, 'info');

    let successCount = 0;
    const totalPending = pending.length;

    for (let i = 0; i < totalPending; i++) {
      if (pauseAutoSubscribe) {
        Logger.log('⏸️ تم إيقاف الاشتراك التلقائي مؤقتاً.', 'warn');
        break;
      }

      const channel = pending[i];
      const percent = Math.round(((i + 1) / totalPending) * 100);

      progressMessage.textContent = `جاري الاشتراك: ${channel.name} (${i + 1} من ${totalPending})`;
      progressPercent.textContent = `${percent}%`;
      progressBar.style.width = `${percent}%`;

      const cardEl = document.getElementById(`card_${channel.id}`);
      const btnEl = cardEl ? cardEl.querySelector('.btn-card-sub') : null;

      const ok = await subscribeOne(channel, btnEl, cardEl);
      if (ok) successCount++;

      if (i < totalPending - 1 && !pauseAutoSubscribe) {
        await new Promise(r => setTimeout(r, 1200));
      }
    }

    isAutoSubscribing = false;
    btnAutoSubscribe.classList.remove('hidden');
    btnPauseAutoSub.classList.add('hidden');

    progressMessage.textContent = `اكتمل: تم الاشتراك في ${successCount} من أصل ${totalPending} قناة بنجاح.`;
    Logger.log(`🎉 اكتملت العملية: تم الاشتراك في ${successCount} قناة بنجاح.`, 'success');

    updateStats();
  });

  btnPauseAutoSub?.addEventListener('click', () => {
    pauseAutoSubscribe = true;
    btnPauseAutoSub.textContent = 'جاري الإيقاف...';
  });

  btnRefreshSubs?.addEventListener('click', async () => {
    btnRefreshSubs.style.transform = 'rotate(180deg)';
    await loadActiveSubscriptions();
    matchChannels();
    updateStats();
    renderList();
    setTimeout(() => { btnRefreshSubs.style.transform = 'none'; }, 400);
  });

  // -----------------------------------------------------------
  // 8. File Loading & Drag-and-Drop
  // -----------------------------------------------------------
  btnSelectFile?.addEventListener('click', () => csvFileInput.click());
  dropzone?.addEventListener('click', (e) => {
    if (e.target !== btnSelectFile) csvFileInput.click();
  });

  csvFileInput?.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) handleFile(e.target.files[0]);
  });

  ['dragenter', 'dragover'].forEach(n => {
    dropzone?.addEventListener(n, (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach(n => {
    dropzone?.addEventListener(n, (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
    });
  });

  dropzone?.addEventListener('drop', (e) => {
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  });

  btnChangeFile?.addEventListener('click', () => {
    importManagerContainer.classList.add('hidden');
    importDropzoneContainer.classList.remove('hidden');
    csvFileInput.value = '';
  });

  async function handleFile(file) {
    if (!file || !file.name.toLowerCase().endsWith('.csv')) {
      alert('يرجى اختيار ملف CSV صالح.');
      return;
    }

    Logger.log(`تم اختيار الملف: ${file.name} (${Math.round(file.size / 1024)} KB)`, 'info');

    const reader = new FileReader();
    reader.onload = async (e) => {
      const content = e.target.result;
      const channels = parseCSV(content);

      if (channels.length === 0) {
        alert('لم يتم العثور على أي قنوات صالحة في هذا الملف.');
        Logger.log('فشل استخراج القنوات من ملف CSV.', 'error');
        return;
      }

      importedChannels = channels;
      currentFileName.textContent = `${file.name} (${channels.length} قناة)`;
      Logger.log(`تم استخراج ${channels.length} قناة من الملف بنجاح.`, 'success');

      await loadActiveSubscriptions();
      matchChannels();

      importDropzoneContainer.classList.add('hidden');
      importManagerContainer.classList.remove('hidden');

      updateStats();
      renderList();
    };
    reader.readAsText(file);
  }

  // Filters & Search
  channelSearchInput?.addEventListener('input', (e) => {
    searchQuery = e.target.value.trim();
    renderList();
  });

  function setFilter(filter) {
    currentFilter = filter;
    [pillAll, pillPending, pillMutual].forEach(p => p.classList.remove('active'));
    if (filter === 'all') pillAll.classList.add('active');
    if (filter === 'pending') pillPending.classList.add('active');
    if (filter === 'mutual') pillMutual.classList.add('active');
    renderList();
  }

  pillAll?.addEventListener('click', () => setFilter('all'));
  pillPending?.addEventListener('click', () => setFilter('pending'));
  pillMutual?.addEventListener('click', () => setFilter('mutual'));

  // -----------------------------------------------------------
  // 9. EXPORT TAB (Seamless from v1.0)
  // -----------------------------------------------------------
  const stateNotYoutube = document.getElementById('stateNotYoutube');
  const stateNotChannels = document.getElementById('stateNotChannels');
  const stateReady = document.getElementById('stateReady');
  const stateExporting = document.getElementById('stateExporting');
  const stateCompleted = document.getElementById('stateCompleted');

  const btnGoToChannels = document.getElementById('btnGoToChannels');
  const btnNavigateChannels = document.getElementById('btnNavigateChannels');
  const btnStartExport = document.getElementById('btnStartExport');
  const btnStopExport = document.getElementById('btnStopExport');
  const btnCopyClipboard = document.getElementById('btnCopyClipboard');
  const copyBtnText = document.getElementById('copyBtnText');
  const btnRedownload = document.getElementById('btnRedownload');
  const btnRestart = document.getElementById('btnRestart');

  const initialCountEl = document.getElementById('initialCount');
  const exportingCountEl = document.getElementById('exportingCount');
  const finalCountEl = document.getElementById('finalCount');

  function showExportState(stateEl) {
    [stateNotYoutube, stateNotChannels, stateReady, stateExporting, stateCompleted].forEach(el => {
      el.classList.add('hidden');
    });
    stateEl.classList.remove('hidden');
  }

  async function initExportTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];

    if (!tab || !tab.url || !tab.url.includes('youtube.com')) {
      showExportState(stateNotYoutube);
      return;
    }

    if (!tab.url.includes('/feed/channels')) {
      showExportState(stateNotChannels);
      return;
    }

    const { exporterState } = await chrome.storage.local.get('exporterState');
    if (exporterState && exporterState.status === 'exporting') {
      showExportState(stateExporting);
      exportingCountEl.textContent = exporterState.count || '0';
      return;
    } else if (exporterState && exporterState.status === 'completed') {
      if (Date.now() - (exporterState.completedAt || 0) < 30 * 60 * 1000) {
        showExportState(stateCompleted);
        finalCountEl.textContent = exporterState.count || '0';
        return;
      }
    }

    showExportState(stateReady);
    try {
      const res = await chrome.tabs.sendMessage(tab.id, { action: 'CHECK_PAGE_STATUS' });
      if (res && res.renderedCount !== undefined) {
        initialCountEl.textContent = res.renderedCount;
      }
    } catch (e) {}
  }

  btnGoToChannels?.addEventListener('click', async () => {
    chrome.tabs.create({ url: 'https://www.youtube.com/feed/channels' });
  });

  btnNavigateChannels?.addEventListener('click', async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]) chrome.tabs.update(tabs[0].id, { url: 'https://www.youtube.com/feed/channels' });
  });

  btnStartExport?.addEventListener('click', async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]) {
      showExportState(stateExporting);
      chrome.tabs.sendMessage(tabs[0].id, { action: 'START_EXPORT' });
    }
  });

  btnStopExport?.addEventListener('click', async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { action: 'STOP_EXPORT' });
  });

  btnCopyClipboard?.addEventListener('click', async () => {
    const { exporterState } = await chrome.storage.local.get('exporterState');
    if (exporterState?.textList) {
      await navigator.clipboard.writeText(exporterState.textList);
      copyBtnText.textContent = '✅ تم النسخ!';
      setTimeout(() => { copyBtnText.textContent = 'نسخ القنوات كنص'; }, 1500);
    }
  });

  btnRedownload?.addEventListener('click', async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { action: 'RE_DOWNLOAD_CSV' });
  });

  btnRestart?.addEventListener('click', async () => {
    await chrome.storage.local.remove('exporterState');
    initExportTab();
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'PROGRESS_UPDATE' && exportingCountEl) {
      exportingCountEl.textContent = msg.count;
    }
    if (msg.type === 'EXPORT_COMPLETED' && finalCountEl) {
      showExportState(stateCompleted);
      finalCountEl.textContent = msg.count;
    }
  });

  // Init
  initExportTab();
  loadActiveSubscriptions();
});
