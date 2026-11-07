'use strict';

/**
 * Messages between the presenter window and the audience window.
 * Sent over BroadcastChannel and window.postMessage (both work on file://); duplicates are dropped.
 */
const ROLE = location.hash === '#audience' ? 'audience' : 'console';

const Link = (() => {
  const APP = 'contest-manager-link';
  const handlers = [], seen = new Set();
  let peer = null, bc = null;

  function receive(m) {
    if (!m || m.app !== APP || m.from === ROLE || seen.has(m.id)) return;
    seen.add(m.id);
    if (seen.size > 2000) seen.clear();
    handlers.forEach(h => { try { h(m); } catch (e) { console.error(e); } });
  }
  try { bc = new BroadcastChannel(APP); bc.onmessage = e => receive(e.data); } catch (e) { /* not available */ }
  window.addEventListener('message', e => {
    if (!e.data || e.data.app !== APP) return;
    if (e.source && e.source !== window) peer = e.source;
    receive(e.data);
  });

  function send(type, data = {}) {
    const m = { app: APP, id: uid(), from: ROLE, type, ...data };
    if (bc) bc.postMessage(m);
    const p = peer && !peer.closed ? peer : window.opener;
    if (p && !p.closed) { try { p.postMessage(m, '*'); } catch (e) { /* closed */ } }
  }

  return {
    send,
    on(h) { handlers.push(h); },
    setPeer(w) { peer = w; },
    get peer() { return peer && !peer.closed ? peer : null; },
  };
})();
