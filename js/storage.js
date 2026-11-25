/* Saves. Uses IndexedDB (hundreds of MB) and falls back to localStorage, then to memory, when it is not available.
 * Values are strings. Every call returns a promise and never rejects. */
(function (root) {
  'use strict';
  var DB = 'transit-game', STORE = 'kv', LS = 'tg-kv:', mem = {}, backendP = null, idbP = null;

  function openDb() {
    if (idbP) return idbP;
    idbP = new Promise(function (resolve, reject) {
      try {
        if (!root.indexedDB) return reject(new Error('no indexedDB'));
        var r = root.indexedDB.open(DB, 1);
        r.onupgradeneeded = function () { r.result.createObjectStore(STORE); };
        r.onsuccess = function () { resolve(r.result); };
        r.onerror = function () { reject(r.error || new Error('open failed')); };
        r.onblocked = function () { reject(new Error('blocked')); };
      } catch (e) { reject(e); }
    });
    return idbP;
  }
  function backend() {
    if (!backendP) backendP = openDb().then(function () { return 'idb'; }).catch(function () { return 'ls'; });
    return backendP;
  }
  function tx(mode, fn) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(STORE, mode), rq = fn(t.objectStore(STORE));
        t.oncomplete = function () { resolve(rq ? rq.result : undefined); };
        t.onerror = t.onabort = function () { reject(t.error || new Error('transaction failed')); };
      });
    });
  }

  function get(key) {
    return backend().then(function (b) {
      if (b === 'idb') return tx('readonly', function (s) { return s.get(key); }).then(function (v) { return v === undefined ? null : v; });
      try { var v = root.localStorage.getItem(LS + key); return v === null ? (mem[key] || null) : v; } catch (e) { return mem[key] || null; }
    }).catch(function () { return mem[key] || null; });
  }
  /* Resolves true when the value was stored for real, false when it only lives in memory. */
  function put(key, val) {
    return backend().then(function (b) {
      if (b === 'idb') return tx('readwrite', function (s) { return s.put(val, key); }).then(function () { return true; });
      root.localStorage.setItem(LS + key, val); return true;
    }).catch(function (e) { mem[key] = val; api.lastError = (e && (e.name || e.message)) || 'unknown'; return false; });
  }
  function del(key) {
    delete mem[key];
    return backend().then(function (b) {
      if (b === 'idb') return tx('readwrite', function (s) { return s['delete'](key); });
      root.localStorage.removeItem(LS + key);
    }).then(function () { return true; }, function () { return false; });
  }
  /* Ask the browser not to clear our storage when space is short. Best effort. */
  function persist() {
    try { if (root.navigator && navigator.storage && navigator.storage.persist) return navigator.storage.persist().catch(function () { return false; }); } catch (e) { /* ignore */ }
    return Promise.resolve(false);
  }

  var api = { get: get, put: put, del: del, persist: persist, backend: backend, lastError: '' };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TGStore = api;
})(typeof window !== 'undefined' ? window : globalThis);
