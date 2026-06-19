/* ===== KERNEL·A — service worker (offline) =====
   - App shell (same-origin): network-first, fall back to cache.
   - Heavy CDN assets (Pyodide wasm + wheels, mermaid, katex…): cache-first,
     so the app keeps working offline after the first online load.
   - Anthropic API calls are never cached. */
var CACHE='kernel-a-mobile-v1';

self.addEventListener('install', function(e){ self.skipWaiting(); });

self.addEventListener('activate', function(e){
  e.waitUntil((async function(){
    var keys=await caches.keys();
    await Promise.all(keys.map(function(k){ return (k!==CACHE) ? caches.delete(k) : null; }));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', function(e){
  var req=e.request;
  if(req.method!=='GET') return;
  var url;
  try{ url=new URL(req.url); }catch(err){ return; }

  /* never touch the model API */
  if(url.hostname.indexOf('anthropic.com')>=0) return;

  var sameOrigin=(url.origin===location.origin);
  var isCDN = url.hostname.indexOf('cdn.jsdelivr.net')>=0 ||
              url.hostname.indexOf('jsdelivr')>=0 ||
              url.hostname.indexOf('cdnjs.cloudflare.com')>=0 ||
              url.hostname.indexOf('pyodide')>=0;

  if(sameOrigin){
    /* app shell — network-first */
    e.respondWith((async function(){
      try{
        var fresh=await fetch(req);
        try{ var c=await caches.open(CACHE); c.put(req, fresh.clone()); }catch(_){}
        return fresh;
      }catch(err){
        var cached=await caches.match(req);
        if(cached) return cached;
        if(req.mode==='navigate'){
          var shell=await caches.match(location.pathname) || await caches.match('./') || await caches.match(self.registration.scope);
          if(shell) return shell;
        }
        throw err;
      }
    })());
  } else if(isCDN){
    /* big, immutable CDN assets — cache-first */
    e.respondWith((async function(){
      var cached=await caches.match(req);
      if(cached) return cached;
      var fresh=await fetch(req);
      try{ var c=await caches.open(CACHE); c.put(req, fresh.clone()); }catch(_){}
      return fresh;
    })());
  }
  /* everything else: default network */
});
