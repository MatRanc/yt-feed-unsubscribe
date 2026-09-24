// ==UserScript==
// @name         YouTube Feed Unsubscribe
// @namespace    https://github.com/MatRanc/yt-feed-unsubscribe
// @version      1.1.0
// @description  Adds an "Unsubscribe" item to the ⋮ menu on videos in your YouTube subscriptions feed.
// @author       MatRanc
// @match        https://www.youtube.com/*
// @grant        none
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/MatRanc/yt-feed-unsubscribe/main/yt-feed-unsubscribe.user.js
// @updateURL    https://raw.githubusercontent.com/MatRanc/yt-feed-unsubscribe/main/yt-feed-unsubscribe.user.js
// ==/UserScript==

(() => {
  'use strict';

  const CARD = 'ytd-rich-item-renderer, yt-lockup-view-model, ytm-shorts-lockup-view-model, ytd-video-renderer, ytd-grid-video-renderer';
  const CHANNEL_LINK = 'a[href^="/@"], a[href^="/channel/"]';
  // Material "person_remove" icon
  const ICON = 'M14 8c0-2.21-1.79-4-4-4S6 5.79 6 8s1.79 4 4 4 4-1.79 4-4zm3 2v2h6v-2h-6zM2 18v2h16v-2c0-2.66-5.33-4-8-4s-8 1.34-8 4z';

  // Authenticated call to YouTube's internal API, same as the site's own requests.
  async function api(endpoint, body) {
    const ts = Math.floor(Date.now() / 1000);
    const sapisid = document.cookie.match(/(?:^|; )(?:SAPISID|__Secure-3PAPISID)=([^;]+)/)?.[1];
    const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(`${ts} ${sapisid} ${location.origin}`));
    const hash = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
    const res = await fetch(`/youtubei/v1/${endpoint}?prettyPrint=false`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `SAPISIDHASH ${ts}_${hash}`,
        'X-Origin': location.origin,
        'X-Goog-AuthUser': String(ytcfg.get('SESSION_INDEX') ?? 0),
      },
      body: JSON.stringify({ context: ytcfg.get('INNERTUBE_CONTEXT'), ...body }),
    });
    if (!res.ok) throw new Error(`${endpoint} → HTTP ${res.status}`);
    return res.json();
  }

  async function channelId(href) {
    const direct = href.match(/^\/channel\/(UC[\w-]{22})/)?.[1];
    if (direct) return direct;
    const res = await api('navigation/resolve_url', { url: location.origin + href });
    const id = res.endpoint?.browseEndpoint?.browseId;
    if (!id) throw new Error(`Couldn't resolve ${href}`);
    return id;
  }

  // Regular cards link to the channel; Shorts cards only have the video ID, so ask the player API.
  function channelOf(card) {
    const link = card.querySelector(CHANNEL_LINK);
    if (link) {
      const href = link.getAttribute('href');
      return { href, name: Promise.resolve(link.textContent.trim() || href.slice(1)), id: () => channelId(href) };
    }
    const videoId = card.querySelector('a[href^="/shorts/"]')?.getAttribute('href').split('/')[2];
    if (!videoId) return null;
    const details = api('player', { videoId }).then(r => r.videoDetails);
    return { name: details.then(d => d.author), id: () => details.then(d => d.channelId) };
  }

  const visibleMenu = () =>
    [...document.querySelectorAll('ytd-popup-container yt-list-view-model')].find(m => m.getClientRects().length);

  function addItem(menu, card, channel) {
    menu.querySelector('[data-feed-unsub]')?.remove();
    const template = menu.querySelector('yt-list-item-view-model:last-of-type');
    if (!template) return;

    // Clone a native row so it inherits YouTube's styling; cloneNode drops their listeners.
    const item = template.cloneNode(true);
    item.dataset.feedUnsub = '';
    const title = item.querySelector('.ytListItemViewModelTitle');
    title.textContent = 'Unsubscribe';
    channel.name.then(name => (title.textContent = `Unsubscribe from ${name}`), () => {});

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '24');
    svg.setAttribute('height', '24');
    svg.setAttribute('fill', 'currentColor');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', ICON);
    svg.append(path);
    item.querySelector('.ytListItemViewModelImage')?.replaceChildren(svg);

    item.addEventListener('click', async e => {
      e.stopPropagation();
      menu.closest('tp-yt-iron-dropdown')?.close?.();
      try {
        const name = await channel.name;
        if (!confirm(`Unsubscribe from ${name}?`)) return;
        await api('subscription/unsubscribe', { channelIds: [await channel.id()] });
        // Hide this card, plus the channel's other videos in the feed.
        (card.closest('ytd-rich-item-renderer') || card).style.display = 'none';
        if (channel.href) document.querySelectorAll(`a[href="${CSS.escape(channel.href)}"]`).forEach(a => {
          const c = a.closest('ytd-rich-item-renderer') || a.closest(CARD);
          if (c) c.style.display = 'none';
        });
      } catch (err) {
        alert(`Unsubscribe failed: ${err.message}`);
      }
    }, true);

    menu.append(item);
  }

  document.addEventListener('click', e => {
    if (!location.pathname.startsWith('/feed/subscriptions')) return;
    const card = e.target.closest('button')?.closest(CARD);
    const channel = card && channelOf(card);
    if (!channel) return;

    // The popup renders async; poll briefly for it.
    let tries = 0;
    const timer = setInterval(() => {
      const menu = visibleMenu();
      if (menu || ++tries > 20) clearInterval(timer);
      if (menu) addItem(menu, card, channel);
    }, 50);
  }, true);
})();
