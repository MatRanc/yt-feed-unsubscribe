// ==UserScript==
// @name         YouTube Feed Unsubscribe
// @namespace    https://github.com/MatRanc/yt-feed-unsubscribe
// @version      1.2.0
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

  // Every card links to its video, and the player API returns that video's channel ID.
  // (Resolving /@handles is unreliable: some, like @Level1Techs, redirect instead of returning an ID.)
  function channelOf(card) {
    const videoId = card.querySelector('a[href*="/watch?v="], a[href^="/shorts/"]')
      ?.getAttribute('href').match(/(?:v=|shorts\/)([\w-]{11})/)?.[1];
    if (!videoId) return null;
    const details = api('player', { videoId }).then(r => {
      if (!r.videoDetails?.channelId) throw new Error(`No channel found for video ${videoId}`);
      return r.videoDetails;
    });
    details.catch(() => {}); // surfaced on click
    const link = card.querySelector(CHANNEL_LINK); // Shorts cards don't have one
    const href = link?.getAttribute('href');
    const name = link?.textContent.trim() ? Promise.resolve(link.textContent.trim()) : details.then(d => d.author);
    return { href, name, id: () => details.then(d => d.channelId) };
  }

  const visibleMenu = () =>
    [...document.querySelectorAll('ytd-popup-container yt-list-view-model')].find(m => m.getClientRects().length);

  function addItem(menu, target) {
    menu.querySelector('[data-feed-unsub]')?.remove();
    const template = menu.querySelector('yt-list-item-view-model:last-of-type');
    if (!template) return;
    const { card, channel } = target;

    // Clone a native row so it inherits YouTube's styling; cloneNode drops their listeners.
    const item = template.cloneNode(true);
    item.dataset.feedUnsub = '';
    item.feedUnsubFor = target;
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
    }, { capture: true, once: true });

    menu.append(item);
    // The popup sizes itself when it opens; without a refit the new row is clipped (and clicks fall through).
    menu.closest('tp-yt-iron-dropdown')?.refit?.();
  }

  let pending = null; // { card, channel } for the ⋮ button clicked last

  function inject() {
    const menu = pending && visibleMenu();
    if (menu && menu.querySelector('[data-feed-unsub]')?.feedUnsubFor !== pending) addItem(menu, pending);
  }

  document.addEventListener('click', e => {
    if (e.target.closest('ytd-popup-container')) return; // clicks inside the menu itself
    const card = location.pathname.startsWith('/feed/subscriptions') && e.target.closest('button')?.closest(CARD);
    const channel = card && channelOf(card);
    pending = channel ? { card, channel } : null;
  }, true);

  // The popup is created lazily and re-rendered per open, so add the item whenever it shows up.
  new MutationObserver(inject).observe(document.body, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['style'],
  });
})();
