// YouTube Subscriptions Hub - Content Script (ISOLATED World)
// Relays messages between Popup and Page Bridge, and handles channel scraping & export

(function () {
  if (window.__yt_subscriptions_hub_loaded) return;
  window.__yt_subscriptions_hub_loaded = true;

  let isRunning = false;
  let stopRequested = false;

  // -------------------------------------------------------------
  // 1. Communication with Page Bridge (MAIN World)
  // -------------------------------------------------------------
  const pendingRequests = new Map();
  let requestSeq = 0;

  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.from !== 'YT_HUB_PAGE_BRIDGE') return;
    const { reqId } = event.data;
    if (reqId && pendingRequests.has(reqId)) {
      const resolver = pendingRequests.get(reqId);
      pendingRequests.delete(reqId);
      resolver(event.data);
    }
  });

  function callPageBridge(action, payload = {}) {
    return new Promise((resolve) => {
      const reqId = 'req_' + (++requestSeq) + '_' + Date.now();
      pendingRequests.set(reqId, resolve);

      // 4-second timeout: If bridge doesn't respond, attempt direct content-script fallback
      const timer = setTimeout(async () => {
        if (pendingRequests.has(reqId)) {
          pendingRequests.delete(reqId);
          // Fallback direct execution
          const fallbackRes = await fallbackDirectFetch(action, payload);
          resolve(fallbackRes);
        }
      }, 4000);

      window.postMessage({
        from: 'YT_HUB_CONTENT_SCRIPT',
        action,
        reqId,
        ...payload
      }, '*');
    });
  }

  // Fallback: If page_bridge.js was not injected yet, execute directly from content script
  async function fallbackDirectFetch(action, payload) {
    try {
      const html = document.documentElement.innerHTML;
      const apiKey = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1];
      const sessionIndex = html.match(/"SESSION_INDEX":"?(\d+)"?/)?.[1] || '0';
      const userAccountName = html.match(/"USER_ACCOUNT_NAME":"([^"]+)"/)?.[1] || 'حساب يوتيوب';

      // Context
      let context = null;
      const ctxMatch = html.match(/"INNERTUBE_CONTEXT":(\{.+?"client":\{.+?\}\})/);
      if (ctxMatch) {
        try { context = JSON.parse(ctxMatch[1]); } catch (e) {}
      }

      // Cookies & SAPISID
      const getCookie = (name) => {
        const value = '; ' + document.cookie;
        const parts = value.split('; ' + name + '=');
        if (parts.length === 2) return parts.pop().split(';').shift();
        return null;
      };
      const sapisid = getCookie('SAPISID') || getCookie('__Secure-3PAPISID') || getCookie('__Secure-1PAPISID');
      const time = Math.floor(Date.now() / 1000);
      const origin = window.location.origin || 'https://www.youtube.com';

      let authHeader = null;
      if (sapisid) {
        const buffer = new TextEncoder().encode(time + ' ' + sapisid + ' ' + origin);
        const hashBuffer = await crypto.subtle.digest('SHA-1', buffer);
        const hash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
        authHeader = 'SAPISIDHASH ' + time + '_' + hash;
      }

      const headers = {
        'Content-Type': 'application/json',
        'X-Origin': origin,
        'X-YouTube-Client-Name': '1',
        'X-YouTube-Client-Version': '2.20261002.01.00',
        'X-Goog-AuthUser': sessionIndex
      };
      if (authHeader) headers['Authorization'] = authHeader;

      if (action === 'GET_MY_SUBSCRIPTIONS') {
        const channelIds = new Set();
        const handles = new Set();

        // DOM items
        document.querySelectorAll('ytd-channel-renderer').forEach(el => {
          const cid = el.querySelector('ytd-subscribe-button-renderer')?.getAttribute('channel-id');
          if (cid) channelIds.add(cid);
          const link = el.querySelector('a#main-link')?.getAttribute('href') || '';
          if (link.includes('/@')) handles.add('@' + link.split('/@')[1].split('/')[0].split('?')[0].toLowerCase());
        });

        // HTML search
        const cids = (html.match(/"channelId":"(UC[a-zA-Z0-9_-]{22})"/g) || []).map(m => m.split(':"')[1].replace('"', ''));
        cids.forEach(id => channelIds.add(id));

        return {
          success: true,
          userAccountName,
          sessionIndex,
          channelIds: Array.from(channelIds),
          handles: Array.from(handles),
          fallback: true
        };
      }

      if (action === 'SUBSCRIBE_CHANNEL') {
        const { channelId } = payload;
        if (!apiKey) return { success: false, error: 'تعذر العثور على مفتاح API' };

        const res = await fetch('/youtubei/v1/subscription/subscribe?key=' + apiKey + '&prettyPrint=false', {
          method: 'POST',
          credentials: 'include',
          headers,
          body: JSON.stringify({
            context: context || { client: { hl: 'ar', gl: 'SA', clientName: 'WEB', clientVersion: '2.20261002.01.00' } },
            channelIds: [channelId],
            params: 'EgIIARgAUAE='
          })
        });

        const data = await res.json();
        const isLoggedOut = data?.responseContext?.mainAppWebResponseContext?.loggedOut === true;
        const hasSubscribedFlag = data?.actions?.some(a => a.updateSubscribeButtonAction?.subscribed === true) ||
                                 data?.frameworkUpdates?.entityBatchUpdate?.mutations?.some(m => m.payload?.subscriptionStateEntity?.subscribed === true);

        const isSuccess = res.ok && !isLoggedOut && (hasSubscribedFlag || (!data.error && data.actions));

        return {
          success: isSuccess,
          status: res.status,
          isLoggedOut,
          channelId,
          error: isLoggedOut ? 'انتهت الجلسة' : (data?.error?.message || null),
          fallback: true
        };
      }

      return { success: false, error: 'إجراء غير مدعوم في الوضع البديل' };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // -------------------------------------------------------------
  // 2. Channel Parsing & Scraper Logic for Export
  // -------------------------------------------------------------
  function parseChannelElement(el) {
    if (!el) return null;

    let name = '';
    const nameSelectors = [
      '#channel-title #text',
      'ytd-channel-name #text',
      '#channel-title',
      '#text.ytd-channel-name',
      'a#main-link yt-formatted-string',
      '#title'
    ];
    for (const selector of nameSelectors) {
      const target = el.querySelector(selector);
      if (target && target.textContent && target.textContent.trim()) {
        name = target.textContent.trim();
        break;
      }
    }

    let url = '';
    const linkSelectors = [
      'a#main-link',
      'a#avatar-section',
      'a.ytd-channel-name',
      'a[href*="/@"]',
      'a[href*="/channel/"]',
      'a.channel-link'
    ];
    for (const selector of linkSelectors) {
      const link = el.querySelector(selector);
      if (link && link.getAttribute('href')) {
        const href = link.getAttribute('href');
        if (href.startsWith('http')) {
          url = href;
        } else {
          url = `https://www.youtube.com${href.split('?')[0]}`;
        }
        break;
      }
    }

    if (!name && !url) return null;

    let channelId = '';
    const subBtn = el.querySelector('ytd-subscribe-button-renderer');
    if (subBtn && subBtn.getAttribute('channel-id')) {
      channelId = subBtn.getAttribute('channel-id');
    } else if (url.includes('/channel/')) {
      const match = url.match(/\/channel\/(UC[a-zA-Z0-9_-]+)/);
      if (match) channelId = match[1];
    }

    let handle = '';
    if (url.includes('/@')) {
      const parts = url.split('/@');
      if (parts[1]) {
        handle = '@' + parts[1].split('/')[0].split('?')[0];
      }
    }

    let subscribers = '';
    const subSelectors = ['#subscribers', 'yt-formatted-string#subscribers', '#video-count', '#metadata-line span'];
    for (const selector of subSelectors) {
      const target = el.querySelector(selector);
      if (target && target.textContent && target.textContent.trim()) {
        subscribers = target.textContent.trim();
        break;
      }
    }

    let description = '';
    const descSelectors = ['#description-text', '#description', 'yt-formatted-string#description'];
    for (const selector of descSelectors) {
      const target = el.querySelector(selector);
      if (target && target.textContent && target.textContent.trim()) {
        description = target.textContent.trim().replace(/\s+/g, ' ');
        break;
      }
    }

    return { name, url, channelId, handle, subscribers, description };
  }

  function collectRenderedChannels() {
    const channelElements = document.querySelectorAll('ytd-channel-renderer');
    const channelsMap = new Map();

    channelElements.forEach(el => {
      const channel = parseChannelElement(el);
      if (channel && (channel.channelId || channel.url || channel.name)) {
        const key = channel.channelId || channel.url || channel.name;
        if (!channelsMap.has(key)) {
          channelsMap.set(key, channel);
        }
      }
    });

    return Array.from(channelsMap.values());
  }

  function escapeCsvCell(text) {
    if (text === null || text === undefined) return '""';
    const str = String(text).replace(/"/g, '""');
    return `"${str}"`;
  }

  function generateCsv(channels) {
    const BOM = '\uFEFF';
    const headers = [
      'اسم القناة',
      'رابط القناة',
      'معرف القناة (Channel ID)',
      'المعرف (@Handle)',
      'عدد المشتركين',
      'نبذة عن القناة'
    ];

    const rows = channels.map(c => [
      escapeCsvCell(c.name),
      escapeCsvCell(c.url),
      escapeCsvCell(c.channelId),
      escapeCsvCell(c.handle),
      escapeCsvCell(c.subscribers),
      escapeCsvCell(c.description)
    ].join(','));

    return BOM + [headers.map(escapeCsvCell).join(','), ...rows].join('\r\n');
  }

  function generateTextList(channels) {
    return channels.map((c, i) => {
      const parts = [`${i + 1}. ${c.name}`];
      if (c.handle) parts.push(`(${c.handle})`);
      if (c.url) parts.push(`- ${c.url}`);
      return parts.join(' ');
    }).join('\n');
  }

  function downloadBlob(content, filename) {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 1000);
  }

  function scrollPageDown() {
    const continuation = document.querySelector('ytd-continuation-item-renderer');
    if (continuation) {
      continuation.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }

    const maxScroll = Math.max(
      document.documentElement.scrollHeight,
      document.body.scrollHeight,
      document.documentElement.clientHeight
    );
    window.scrollTo({ top: maxScroll, behavior: 'smooth' });
  }

  async function runAutoExport() {
    if (isRunning) return;
    isRunning = true;
    stopRequested = false;

    await chrome.storage.local.set({
      exporterState: { status: 'exporting', count: 0, lastUpdated: Date.now() }
    });

    let consecutiveUnchangedCount = 0;
    let previousChannelCount = 0;
    const MAX_UNCHANGED_ATTEMPTS = 5;
    const SCROLL_INTERVAL_MS = 1400;

    while (isRunning && !stopRequested) {
      const currentChannels = collectRenderedChannels();
      const currentCount = currentChannels.length;

      await chrome.storage.local.set({
        exporterState: { status: 'exporting', count: currentCount, lastUpdated: Date.now() }
      });

      try {
        chrome.runtime.sendMessage({ type: 'PROGRESS_UPDATE', count: currentCount });
      } catch (e) {}

      if (currentCount > previousChannelCount) {
        consecutiveUnchangedCount = 0;
        previousChannelCount = currentCount;
      } else {
        consecutiveUnchangedCount++;
      }

      if (consecutiveUnchangedCount >= MAX_UNCHANGED_ATTEMPTS) {
        break;
      }

      scrollPageDown();
      await new Promise(resolve => setTimeout(resolve, SCROLL_INTERVAL_MS));
    }

    const finalChannels = collectRenderedChannels();
    const csvContent = generateCsv(finalChannels);
    const textList = generateTextList(finalChannels);
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `قنوات_يوتيوب_${dateStr}.csv`;

    downloadBlob(csvContent, filename);

    await chrome.storage.local.set({
      exporterState: {
        status: 'completed',
        count: finalChannels.length,
        channels: finalChannels,
        csvData: csvContent,
        textList: textList,
        filename: filename,
        completedAt: Date.now()
      }
    });

    isRunning = false;
    stopRequested = false;

    try {
      chrome.runtime.sendMessage({
        type: 'EXPORT_COMPLETED',
        count: finalChannels.length,
        channels: finalChannels,
        textList: textList,
        filename: filename
      });
    } catch (e) {}
  }

  // -------------------------------------------------------------
  // 3. Message Listeners (Communication with Popup)
  // -------------------------------------------------------------
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // 1. Export page check
    if (request.action === 'CHECK_PAGE_STATUS') {
      const isFeedChannels = window.location.pathname.includes('/feed/channels');
      const renderedChannels = collectRenderedChannels();
      sendResponse({
        isFeedChannels,
        currentUrl: window.location.href,
        renderedCount: renderedChannels.length,
        isRunning
      });
      return true;
    }

    // 2. Start export
    if (request.action === 'START_EXPORT') {
      if (!isRunning) {
        runAutoExport();
        sendResponse({ started: true });
      } else {
        sendResponse({ alreadyRunning: true });
      }
      return true;
    }

    // 3. Stop export
    if (request.action === 'STOP_EXPORT') {
      stopRequested = true;
      sendResponse({ stopping: true });
      return true;
    }

    // 4. Redownload CSV
    if (request.action === 'RE_DOWNLOAD_CSV') {
      const channels = collectRenderedChannels();
      if (channels.length > 0) {
        const csvContent = generateCsv(channels);
        const dateStr = new Date().toISOString().slice(0, 10);
        downloadBlob(csvContent, `قنوات_يوتيوب_${dateStr}.csv`);
        sendResponse({ success: true, count: channels.length });
      } else {
        sendResponse({ success: false, error: 'لم يتم العثور على قنوات' });
      }
      return true;
    }

    // 5. Get My Subscriptions (Pass to page bridge or fallback)
    if (request.action === 'GET_MY_SUBSCRIPTIONS') {
      callPageBridge('GET_MY_SUBSCRIPTIONS').then(res => {
        sendResponse(res);
      });
      return true; // Asynchronous response
    }

    // 6. Subscribe to Channel
    if (request.action === 'SUBSCRIBE_CHANNEL') {
      callPageBridge('SUBSCRIBE_CHANNEL', { channelId: request.channelId }).then(res => {
        sendResponse(res);
      });
      return true; // Asynchronous response
    }

    // 7. Resolve Handle
    if (request.action === 'RESOLVE_HANDLE') {
      callPageBridge('RESOLVE_HANDLE', { url: request.url }).then(res => {
        sendResponse(res);
      });
      return true; // Asynchronous response
    }
  });
})();
