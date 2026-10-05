// YouTube Subscriptions Hub - Page Bridge Script
// Runs natively in YouTube's MAIN World (page context) with direct access to window.ytcfg and window.ytInitialData

(function () {
  if (window.__yt_subscriptions_page_bridge_loaded) return;
  window.__yt_subscriptions_page_bridge_loaded = true;

  // Cookie & Auth helpers
  function getCookie(name) {
    const value = '; ' + document.cookie;
    const parts = value.split('; ' + name + '=');
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
  }

  async function sha1(str) {
    const buffer = new TextEncoder().encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-1', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function getAuthHeaders() {
    const sapisid = getCookie('SAPISID') || getCookie('__Secure-3PAPISID') || getCookie('__Secure-1PAPISID');
    const time = Math.floor(Date.now() / 1000);
    const origin = window.location.origin || 'https://www.youtube.com';
    const hash = sapisid ? await sha1(time + ' ' + sapisid + ' ' + origin) : null;

    const sessionIndex = (window.ytcfg && window.ytcfg.get('SESSION_INDEX')) || '0';
    const clientVersion = (window.ytcfg && window.ytcfg.get('INNERTUBE_CLIENT_VERSION')) || '2.20261002.01.00';

    const headers = {
      'Content-Type': 'application/json',
      'X-Origin': origin,
      'X-YouTube-Client-Name': '1',
      'X-YouTube-Client-Version': clientVersion,
      'X-Goog-AuthUser': sessionIndex
    };

    if (hash) {
      headers['Authorization'] = 'SAPISIDHASH ' + time + '_' + hash;
    }

    return headers;
  }

  window.addEventListener('message', async (event) => {
    if (event.source !== window || !event.data || event.data.from !== 'YT_HUB_CONTENT_SCRIPT') return;

    const { action, reqId } = event.data;

    // -----------------------------------------------------------
    // Action 1: Get Active Account's Subscriptions
    // -----------------------------------------------------------
    if (action === 'GET_MY_SUBSCRIPTIONS') {
      try {
        const userAccountName = (window.ytcfg && window.ytcfg.get('USER_ACCOUNT_NAME')) || 'حساب يوتيوب النشط';
        const sessionIndex = (window.ytcfg && window.ytcfg.get('SESSION_INDEX')) || '0';
        const apiKey = window.ytcfg ? window.ytcfg.get('INNERTUBE_API_KEY') : null;
        const context = window.ytcfg ? window.ytcfg.get('INNERTUBE_CONTEXT') : null;

        const channelIds = new Set();
        const handles = new Set();

        // 1. From rendered elements on page (e.g. /feed/channels)
        document.querySelectorAll('ytd-channel-renderer').forEach(el => {
          const cid = el.querySelector('ytd-subscribe-button-renderer')?.getAttribute('channel-id');
          if (cid) channelIds.add(cid);

          const link = el.querySelector('a#main-link, a#avatar-section')?.getAttribute('href');
          if (link && link.includes('/@')) {
            handles.add('@' + link.split('/@')[1].split('/')[0].split('?')[0].toLowerCase());
          }
        });

        // 2. From window.ytInitialData
        if (window.ytInitialData) {
          try {
            const str = JSON.stringify(window.ytInitialData);
            const cids = (str.match(/"channelId":"(UC[a-zA-Z0-9_-]{22})"/g) || []).map(m => m.split(':"')[1].replace('"', ''));
            cids.forEach(id => channelIds.add(id));
            const browses = (str.match(/"browseId":"(UC[a-zA-Z0-9_-]{22})"/g) || []).map(m => m.split(':"')[1].replace('"', ''));
            browses.forEach(id => channelIds.add(id));
          } catch (e) {}
        }

        // 3. From Innertube browseId: 'FEchannels'
        let apiStatus = 0;
        if (apiKey && context) {
          try {
            const headers = await getAuthHeaders();
            const res = await fetch('/youtubei/v1/browse?key=' + apiKey + '&prettyPrint=false', {
              method: 'POST',
              credentials: 'include',
              headers: headers,
              body: JSON.stringify({ context, browseId: 'FEchannels' })
            });
            apiStatus = res.status;
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
          } catch (apiErr) {
            console.warn('FEchannels API fetch error:', apiErr);
          }
        }

        window.postMessage({
          from: 'YT_HUB_PAGE_BRIDGE',
          reqId,
          success: true,
          userAccountName,
          sessionIndex,
          apiStatus,
          channelIds: Array.from(channelIds),
          handles: Array.from(handles)
        }, '*');
      } catch (err) {
        window.postMessage({ from: 'YT_HUB_PAGE_BRIDGE', reqId, success: false, error: err.message }, '*');
      }
    }

    // -----------------------------------------------------------
    // Action 2: Subscribe to a Channel
    // -----------------------------------------------------------
    if (action === 'SUBSCRIBE_CHANNEL') {
      const { channelId } = event.data;
      try {
        const apiKey = window.ytcfg ? window.ytcfg.get('INNERTUBE_API_KEY') : null;
        const context = window.ytcfg ? window.ytcfg.get('INNERTUBE_CONTEXT') : null;

        if (!apiKey || !context) {
          window.postMessage({ from: 'YT_HUB_PAGE_BRIDGE', reqId, success: false, error: 'تعذر الوصول لبيانات جلسة يوتيوب (ytcfg غير متوفر)' }, '*');
          return;
        }

        const headers = await getAuthHeaders();
        const res = await fetch('/youtubei/v1/subscription/subscribe?key=' + apiKey + '&prettyPrint=false', {
          method: 'POST',
          credentials: 'include',
          headers: headers,
          body: JSON.stringify({
            context: context,
            channelIds: [channelId],
            params: 'EgIIARgAUAE='
          })
        });

        const data = await res.json();
        const isLoggedOut = data?.responseContext?.mainAppWebResponseContext?.loggedOut === true;
        const hasSubscribedFlag = data?.actions?.some(a => a.updateSubscribeButtonAction?.subscribed === true) ||
                                 data?.frameworkUpdates?.entityBatchUpdate?.mutations?.some(m => m.payload?.subscriptionStateEntity?.subscribed === true);

        const isSuccess = res.ok && !isLoggedOut && (hasSubscribedFlag || (!data.error && data.actions));

        window.postMessage({
          from: 'YT_HUB_PAGE_BRIDGE',
          reqId,
          success: isSuccess,
          status: res.status,
          isLoggedOut,
          channelId,
          error: isLoggedOut ? 'انتهت صلاحية الجلسة' : (data?.error?.message || null)
        }, '*');
      } catch (err) {
        window.postMessage({ from: 'YT_HUB_PAGE_BRIDGE', reqId, success: false, channelId, error: err.message }, '*');
      }
    }

    // -----------------------------------------------------------
    // Action 3: Resolve Handle / URL to Channel ID
    // -----------------------------------------------------------
    if (action === 'RESOLVE_HANDLE') {
      const { url } = event.data;
      try {
        const apiKey = window.ytcfg ? window.ytcfg.get('INNERTUBE_API_KEY') : null;
        const context = window.ytcfg ? window.ytcfg.get('INNERTUBE_CONTEXT') : null;

        if (!apiKey || !context) {
          window.postMessage({ from: 'YT_HUB_PAGE_BRIDGE', reqId, success: false, error: 'تعذر الوصول لبيانات جلسة يوتيوب' }, '*');
          return;
        }

        const fullUrl = url.startsWith('http') ? url : ('https://www.youtube.com/' + url.replace(/^\/?/, ''));
        const headers = await getAuthHeaders();
        const res = await fetch('/youtubei/v1/navigation/resolve_url?key=' + apiKey, {
          method: 'POST',
          credentials: 'include',
          headers: headers,
          body: JSON.stringify({ context, url: fullUrl })
        });

        const data = await res.json();
        const browseId = data?.endpoint?.browseEndpoint?.browseId || null;
        window.postMessage({ from: 'YT_HUB_PAGE_BRIDGE', reqId, success: !!browseId, channelId: browseId }, '*');
      } catch (err) {
        window.postMessage({ from: 'YT_HUB_PAGE_BRIDGE', reqId, success: false, error: err.message }, '*');
      }
    }
  });
})();
