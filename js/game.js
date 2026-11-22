/* Map, drawing, input and interface. Rules live in sim.js, routing in routing.js. */
(function () {
  'use strict';
  var R = window.TGRouting, S = window.TGSim;
  var MODES = S.MODES, BAL = S.BAL;
  var Z = 14;                       // reference zoom: all game coordinates are map pixels at this zoom
  var LEGACY_KEY = 'transit-game-save-v1';          // older versions kept the save in localStorage
  var Store = window.TGStore;
  var DAY_SEC = 40;                 // real seconds per game day at 1x
  var PALETTE = ['#FFCB0D', '#E8472B', '#2A64B0', '#3DAA5B', '#F28A1E', '#9B5DE5', '#00BBF9', '#F15BB5', '#FF6F61', '#B5E61D', '#06D6A0', '#C77DFF', '#FFD166', '#EF476F', '#118AB2', '#8D6E63', '#B0B7C3', '#FFFFFF', '#00A896', '#FF9F1C'];
  var COLOR_NAMES = { '#FFCB0D': 'Yellow', '#E8472B': 'Red', '#2A64B0': 'Blue', '#3DAA5B': 'Green', '#F28A1E': 'Orange', '#9B5DE5': 'Purple', '#00BBF9': 'Cyan', '#F15BB5': 'Pink' };

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fmt(v) { return S.fmtMoney(v); }
  function num(v) { return Math.round(v).toLocaleString('en-IE'); }

  var map, canvas, ctx, dpr = 1;
  var state = null, centerPx = null;
  var gfx = new Map();
  var V = { cx: 0, cy: 0, s: 1, w: 0, h: 0 };
  var ui = { tool: 'move', editing: null, selLine: null, selStation: null, sheet: 'none', speed: 1, dayProg: 0, showDemand: true, view: { waiting: true, names: true, vehicles: true, markers: true, chunks: true, hide: {} }, hover: null, pendingStation: null, lastS: 0, hint: false };
  var saveTimer = null;
  var tileErrors = 0, tilesLoaded = false;
  function noTiles() { return tileErrors >= 4 && !tilesLoaded; }

  var ICON = {
    hand: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11m0-1.5v-3a1.5 1.5 0 0 1 3 0V11m0-3.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-1.5a5 5 0 0 1-4-2L4 14.5a1.6 1.6 0 0 1 2.5-2L8 14"/></svg>',
    pin: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="7"/><path d="M12 8v8M8 12h8"/></svg>',
    lines: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 18h6l4-4h6M4 6h8l4 4h4"/></svg>',
    eye: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    gear: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg>',
    save: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14"/></svg>',
    chart: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 20V11m7 9V5m7 15v-6"/></svg>',
    flag: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 21V4m0 1h11l-2 4 2 4H6"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'
  };

  /* ---------- geometry between the map and the game ---------- */
  function mppAt(lat) { return 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, Z); }
  function updateView() {
    var sz = map.getSize(), c = map.project(map.getCenter(), Z);
    V = { cx: c.x - centerPx.x, cy: c.y - centerPx.y, s: map.getZoomScale(map.getZoom(), Z), w: sz.x, h: sz.y };
  }
  function toScreen(p) { return { x: (p.x - V.cx) * V.s + V.w / 2, y: (p.y - V.cy) * V.s + V.h / 2 }; }
  function toGame(sx, sy) { return { x: (sx - V.w / 2) / V.s + V.cx, y: (sy - V.h / 2) / V.s + V.cy }; }
  function lineWidth() { return Math.max(4, Math.min(9, 7 * Math.pow(V.s, 0.3))); }
  function stationRadius() { return Math.max(5.5, Math.min(12, 8 * Math.pow(V.s, 0.4))); }

  /* ---------- line layout (routing + bundling) ---------- */
  function relayout() {
    if (!state) return;
    var sMap = S.stationMap(state);
    var lw = lineWidth(), spacing = (lw + 2) / V.s;
    var items = [], next = new Map();
    state.lines.forEach(function (L) {
      var old = gfx.get(L.id);
      var t = old ? old.t : 0;
      if (L.stations.length < 2) { next.set(L.id, { segs: [], base: [], path: [], len: 0, baseLen: 0, t: t }); return; }
      var pts = L.stations.map(function (id) { return sMap.get(id); });
      var straight = !!MODES[L.mode].straight;
      var segs = R.buildSegments(pts, L.flips, straight);
      var base = R.buildBasePath(pts, L.flips, straight);
      if (straight) { next.set(L.id, { segs: segs, base: base, path: base, len: R.pathLength(base), baseLen: R.pathLength(base), t: t }); return; }   // flights are not bundled with other lines
      items.push({ id: L.id, base: base });
      next.set(L.id, { segs: segs, base: base, path: null, len: 0, baseLen: R.pathLength(base), t: t });
    });
    var lay = R.layoutLines(items, spacing);
    items.forEach(function (it) {
      var g = next.get(it.id);
      g.path = lay.get(it.id);
      g.len = R.pathLength(g.path);
    });
    gfx = next;
  }

  /* ---------- drawing ---------- */
  /* shown only when map tiles cannot load, so you still have something to navigate by */
  function drawGrid() {
    var step = 128, x0 = Math.floor((V.cx - V.w / 2 / V.s) / step) * step, y0 = Math.floor((V.cy - V.h / 2 / V.s) / step) * step;
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1; ctx.beginPath();
    for (var gx = x0; gx < V.cx + V.w / 2 / V.s + step; gx += step) { var a = toScreen({ x: gx, y: 0 }).x; ctx.moveTo(a, 0); ctx.lineTo(a, V.h); }
    for (var gy = y0; gy < V.cy + V.h / 2 / V.s + step; gy += step) { var b = toScreen({ x: 0, y: gy }).y; ctx.moveTo(0, b); ctx.lineTo(V.w, b); }
    ctx.stroke();
  }

  function drawBlocks() {
    if (!ui.showDemand) return;
    if (ui.view.chunks) drawChunks();
    ctx.globalCompositeOperation = 'lighter';
    state.blocks.forEach(function (b) {
      var p = toScreen(b);
      if (p.x < -90 || p.y < -90 || p.x > V.w + 90 || p.y > V.h + 90) return;
      var rp = Math.sqrt(b.pop) * 2.3 * V.s, rj = Math.sqrt(b.jobs) * 2.3 * V.s;
      if (rp > 1) { ctx.globalAlpha = Math.min(0.5, 0.10 + Math.sqrt(b.pop) / 110); ctx.drawImage(heatSprite('home'), p.x - rp, p.y - rp, rp * 2, rp * 2); }
      if (rj > 1) { ctx.globalAlpha = Math.min(0.55, 0.12 + Math.sqrt(b.jobs) / 100); ctx.drawImage(heatSprite('job'), p.x - rj, p.y - rj, rj * 2, rj * 2); }
    });
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  /* Heat map: each block is a soft glow, and glows add up where blocks overlap. */
  var heatSprites = {};
  function heatSprite(kind) {
    if (heatSprites[kind]) return heatSprites[kind];
    var c = document.createElement('canvas'); c.width = c.height = 96;
    var g = c.getContext('2d'), col = kind === 'home' ? '255,120,0' : '30,120,255';
    var gr = g.createRadialGradient(48, 48, 0, 48, 48, 48);
    gr.addColorStop(0, 'rgba(' + col + ',1)'); gr.addColorStop(0.35, 'rgba(' + col + ',0.55)'); gr.addColorStop(0.7, 'rgba(' + col + ',0.16)'); gr.addColorStop(1, 'rgba(' + col + ',0)');
    g.fillStyle = gr; g.fillRect(0, 0, 96, 96);
    heatSprites[kind] = c;
    return c;
  }

  /* Shows which parts of the map have real homes and jobs loaded. */
  function drawChunks() {
    if (state.source !== 'osm' || !state.wsz || !window.TGOsm || !centerPx) return;
    var tl = map.unproject(L.point(centerPx.x + V.cx - V.w / 2 / V.s, centerPx.y + V.cy - V.h / 2 / V.s), Z);
    var br = map.unproject(L.point(centerPx.x + V.cx + V.w / 2 / V.s, centerPx.y + V.cy + V.h / 2 / V.s), Z);
    var keys = TGOsm.chunksIn({ s: br.lat, n: tl.lat, w: tl.lng, e: br.lng });
    if (keys.length > 40) return;
    ctx.save();
    ctx.font = '600 13px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    keys.forEach(function (k) {
      var bd = chunkPxBounds(k), a = toScreen({ x: bd.x0, y: bd.y0 }), c = toScreen({ x: bd.x1, y: bd.y1 });
      var loaded = state.chunks && state.chunks[k];
      if (loaded) {
        ctx.setLineDash([6, 6]); ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 1;
        ctx.strokeRect(a.x, a.y, c.x - a.x, c.y - a.y);
      } else {
        ctx.fillStyle = 'rgba(0,0,0,0.38)'; ctx.fillRect(a.x, a.y, c.x - a.x, c.y - a.y);
        if (map.getZoom() >= LOAD_ZOOM) {
          var x0 = Math.max(a.x, 0), x1 = Math.min(c.x, V.w), y0 = Math.max(a.y, 0), y1 = Math.min(c.y, V.h);
          if (x1 - x0 > 120 && y1 - y0 > 40) {
            var msg = chunkFailed[k] && Date.now() - chunkFailed[k] < 90000 ? 'Could not load, retrying soon' : 'Loading homes and jobs…';
            ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.fillText(msg, (x0 + x1) / 2, (y0 + y1) / 2);
          }
        }
      }
    });
    if (map.getZoom() < LOAD_ZOOM && keys.some(function (k) { return !(state.chunks && state.chunks[k]); })) {
      ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillText('Zoom in closer to load homes and jobs in the dark areas', V.w / 2, V.h * 0.3);
    }
    ctx.restore();
  }

  function catchRadiusFor(sid) {
    var best = 0;
    state.lines.forEach(function (L) {
      if (L.stations.length >= 2 && L.stations.indexOf(sid) >= 0) best = Math.max(best, MODES[L.mode].catchM);
    });
    var st = S.stationMap(state).get(sid);
    return st ? best / S.mScale(state, st.y) : 0;
  }

  function drawCatchments() {
    var showAll = ui.tool === 'station' || ui.editing;
    state.stations.forEach(function (s) {
      var isSel = ui.selStation === s.id;
      if (!showAll && !isSel) return;
      var r = catchRadiusFor(s.id) || (MODES.bus.catchM / S.mScale(state, s.y));
      var p = toScreen(s);
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.setLineDash([6, 6]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(p.x, p.y, r * V.s, 0, 6.283); ctx.fill(); ctx.stroke();
      ctx.setLineDash([]);
    });
  }

  /* contract markers and event areas */
  function drawMarkers() {
    if (!ui.view.markers || !window.TGGoals || !state.goals) return;
    var t = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    state.goals.active.forEach(function (g) {
      if (!g.spot) return;
      var p = toScreen(g.spot), r = Math.max(10, 400 / S.mScale(state, g.spot.y) * V.s), pulse = 1 + 0.08 * Math.sin(t * 3);
      ctx.strokeStyle = '#FFCB0D'; ctx.fillStyle = 'rgba(255,203,13,0.12)'; ctx.lineWidth = 2.5; ctx.setLineDash([8, 6]);
      ctx.beginPath(); ctx.arc(p.x, p.y, r * pulse, 0, 6.283); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#FFCB0D'; ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, 6.283); ctx.fill();
      ctx.font = '600 12px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#FFCB0D';
      ctx.fillText('Goal', p.x, p.y - r * pulse - 6);
    });
    var sMap = S.stationMap(state);
    TGGoals.activeEvents(state).forEach(function (e) {
      var sp = e.spot || (e.x !== undefined ? e : null);
      if (sp) {
        var p = toScreen(sp), r = sp.r / S.mScale(state, sp.y) * V.s;
        ctx.strokeStyle = '#6FD08C'; ctx.fillStyle = 'rgba(111,208,140,0.10)'; ctx.lineWidth = 2; ctx.setLineDash([4, 6]);
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 6.283); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
      } else {
        var ids = e.closedIds || (e.type === 'closure' ? [e.stationId] : []);
        ids.forEach(function (sid) {
          var s = sMap.get(sid); if (!s) return;
          var q = toScreen(s);
          ctx.strokeStyle = '#FF6B6B'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(q.x, q.y, stationRadius() + 6, 0, 6.283); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(q.x - 5, q.y - 5); ctx.lineTo(q.x + 5, q.y + 5); ctx.moveTo(q.x + 5, q.y - 5); ctx.lineTo(q.x - 5, q.y + 5); ctx.stroke();
        });
      }
    });
  }

  function strokePath(pts, width, color, dash) {
    if (pts.length < 2) return;
    ctx.beginPath();
    pts.forEach(function (p, i) { var q = toScreen(p); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); });
    ctx.lineWidth = width; ctx.strokeStyle = color; ctx.lineJoin = 'round'; ctx.lineCap = 'butt';
    ctx.setLineDash(dash || []); ctx.stroke(); ctx.setLineDash([]);
  }

  function drawEndBar(a, b, width, color) {
    var pa = toScreen(a), pb = toScreen(b);
    var d = R.unit(pb, pa); if (!d) return;
    var nx = -d.y, ny = d.x, half = width * 1.15;
    ctx.beginPath();
    ctx.moveTo(pa.x + nx * half, pa.y + ny * half); ctx.lineTo(pa.x - nx * half, pa.y - ny * half);
    ctx.lineWidth = Math.max(3, width * 0.5); ctx.strokeStyle = color; ctx.lineCap = 'butt'; ctx.stroke();
  }

  function drawLines() {
    var lw = lineWidth();
    state.lines.forEach(function (L) {
      var g = gfx.get(L.id);
      if (!g || g.path.length < 2 || !lineShown(L)) return;
      var dim = ui.selLine && ui.selLine !== L.id && !ui.editing ? 0.45 : 1;
      ctx.globalAlpha = dim;
      if (MODES[L.mode].straight) { strokePath(g.path, lw * 0.55, L.color, [lw * 2.2, lw * 1.6]); } else strokePath(g.path, lw, L.color);
      drawEndBar(g.path[0], g.path[1], lw, L.color);
      drawEndBar(g.path[g.path.length - 1], g.path[g.path.length - 2], lw, L.color);
      ctx.globalAlpha = 1;
    });
    if (ui.selLine) {
      var sg = gfx.get(ui.selLine), sl = S.lineById(state, ui.selLine);
      if (sg && sl && sg.path.length >= 2 && !ui.editing && lineShown(sl)) {
        ctx.globalAlpha = 0.9;
        strokePath(sg.path, lw + 6, 'rgba(255,255,255,0.18)');
        if (MODES[sl.mode].straight) strokePath(sg.path, lw * 0.55, sl.color, [lw * 2.2, lw * 1.6]); else strokePath(sg.path, lw, sl.color);
        ctx.globalAlpha = 1;
      }
    }
  }

  function drawVehicles(dt) {
    var lw = lineWidth();
    state.lines.forEach(function (L) {
      var g = gfx.get(L.id);
      if (!g || g.path.length < 2 || !L.vehicles) return;
      var m = MODES[L.mode];
      if (ui.speed > 0 && !state.over) g.t += dt * ui.speed * m.speed * 4 / (2 * Math.max(40, g.baseLen));
      var load = state.stats && state.stats.lines[L.id] ? Math.min(1, state.stats.lines[L.id].load) : 0;
      if (!ui.view.vehicles || !lineShown(L)) return;
      for (var i = 0; i < L.vehicles; i++) {
        var ph = ((g.t + i / L.vehicles) % 1 + 1) % 1;
        var u = ph < 0.5 ? ph * 2 : 2 - ph * 2;
        var pt = R.pointAlong(g.path, u * g.len);
        var ang = pt.ang + (ph < 0.5 ? 0 : Math.PI);
        var p = toScreen(pt);
        var len = lw * (m.vlen || 2.8), wid = lw * 1.3;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(ang);
        drawVehicleShape(L.mode, len, wid, L.color, load);
        ctx.restore();
      }
    });
  }

  /* One shape per mode, drawn top-down with the front pointing right (+x).
   * The coloured fill gets stronger the fuller the vehicle is. */
  function bodyCar(x, y, w, h, r, color, load) {
    ctx.fillStyle = '#F2F2F2'; ctx.strokeStyle = '#17181a'; ctx.lineWidth = 1.6;
    roundRect(x, y, w, h, r); ctx.fill(); ctx.stroke();
    ctx.globalAlpha = 0.3 + 0.7 * load; ctx.fillStyle = color;
    roundRect(x + 1.5, y + 1.5, Math.max(2, w - 3), Math.max(2, h - 3), Math.max(1, r - 1)); ctx.fill();
    ctx.globalAlpha = 1;
  }
  function windows(x0, x1, h, n) {
    var gap = (x1 - x0) / n, ww = gap * 0.62;
    ctx.fillStyle = 'rgba(15,20,26,0.78)';
    for (var i = 0; i < n; i++) ctx.fillRect(x0 + gap * i + (gap - ww) / 2, -h / 2, ww, h);
  }
  function drawVehicleShape(mode, len, wid, color, load) {
    var h = wid / 2, i;
    if (mode === 'plane') {
      var L2 = len * 1.25, span = wid * 2.1;
      ctx.fillStyle = '#F2F2F2'; ctx.strokeStyle = '#17181a'; ctx.lineWidth = 1.6; ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(L2 / 2, 0);
      ctx.quadraticCurveTo(L2 * 0.32, -wid * 0.28, L2 * 0.12, -wid * 0.28);
      ctx.lineTo(-L2 * 0.04, -span / 2); ctx.lineTo(-L2 * 0.16, -span / 2); ctx.lineTo(-L2 * 0.12, -wid * 0.28);
      ctx.lineTo(-L2 * 0.38, -wid * 0.26); ctx.lineTo(-L2 * 0.5, -wid * 0.62); ctx.lineTo(-L2 * 0.5, -wid * 0.5);
      ctx.lineTo(-L2 * 0.5, wid * 0.5); ctx.lineTo(-L2 * 0.5, wid * 0.62); ctx.lineTo(-L2 * 0.38, wid * 0.26);
      ctx.lineTo(-L2 * 0.12, wid * 0.28); ctx.lineTo(-L2 * 0.16, span / 2); ctx.lineTo(-L2 * 0.04, span / 2);
      ctx.lineTo(L2 * 0.12, wid * 0.28); ctx.quadraticCurveTo(L2 * 0.32, wid * 0.28, L2 / 2, 0);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.globalAlpha = 0.3 + 0.7 * load; ctx.fillStyle = color;
      ctx.fillRect(-L2 * 0.3, -wid * 0.12, L2 * 0.55, wid * 0.24);
      ctx.globalAlpha = 1;
      return;
    }
    if (mode === 'ferry') {
      ctx.fillStyle = '#F2F2F2'; ctx.strokeStyle = '#17181a'; ctx.lineWidth = 1.6; ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(len / 2, 0); ctx.quadraticCurveTo(len * 0.3, -h, len * 0.05, -h); ctx.lineTo(-len / 2 + 3, -h);
      ctx.quadraticCurveTo(-len / 2, -h, -len / 2, -h + 3); ctx.lineTo(-len / 2, h - 3); ctx.quadraticCurveTo(-len / 2, h, -len / 2 + 3, h);
      ctx.lineTo(len * 0.05, h); ctx.quadraticCurveTo(len * 0.3, h, len / 2, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.globalAlpha = 0.3 + 0.7 * load; ctx.fillStyle = color; roundRect(-len * 0.32, -h * 0.55, len * 0.5, h * 1.1, 2); ctx.fill(); ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(15,20,26,0.78)'; ctx.fillRect(len * 0.0, -h * 0.3, len * 0.12, h * 0.6);
      return;
    }
    if (mode === 'tram' || mode === 'lightrail') {
      var parts = mode === 'tram' ? 2 : 3, gap = 2, cw = (len - gap * (parts - 1)) / parts;
      for (i = 0; i < parts; i++) {
        var x = -len / 2 + i * (cw + gap);
        bodyCar(x, -h * 0.9, cw, h * 1.8, 3, color, load); windows(x + 2, x + cw - 2, h * 0.7, 2);
      }
      ctx.fillStyle = '#17181a'; for (i = 1; i < parts; i++) ctx.fillRect(-len / 2 + i * (cw + gap) - gap, -1, gap, 2);
      return;
    }
    if (mode === 'metro' || mode === 'rail' || mode === 'intercity') {
      var cars = mode === 'metro' ? 3 : mode === 'rail' ? 3 : 4, g2 = 1.5, w2 = (len - g2 * (cars - 1)) / cars;
      for (i = 0; i < cars; i++) {
        var x0 = -len / 2 + i * (w2 + g2), nose = i === cars - 1 && mode === 'intercity';
        if (nose) {
          ctx.fillStyle = '#F2F2F2'; ctx.strokeStyle = '#17181a'; ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.moveTo(x0, -h * 0.9); ctx.lineTo(x0 + w2 * 0.55, -h * 0.9); ctx.quadraticCurveTo(x0 + w2 * 1.35, -h * 0.7, x0 + w2 * 1.35, 0);
          ctx.quadraticCurveTo(x0 + w2 * 1.35, h * 0.7, x0 + w2 * 0.55, h * 0.9); ctx.lineTo(x0, h * 0.9); ctx.closePath(); ctx.fill(); ctx.stroke();
          ctx.globalAlpha = 0.3 + 0.7 * load; ctx.fillStyle = color; ctx.fillRect(x0 + 1.5, -h * 0.55, w2 * 0.8, h * 1.1); ctx.globalAlpha = 1;
          ctx.fillStyle = 'rgba(15,20,26,0.78)'; ctx.fillRect(x0 + w2 * 0.8, -h * 0.35, w2 * 0.35, h * 0.7);
        } else { bodyCar(x0, -h * 0.9, w2, h * 1.8, 2.5, color, load); windows(x0 + 1.5, x0 + w2 - 1.5, h * 0.6, mode === 'metro' ? 2 : 3); }
      }
      return;
    }
    // bus and coach: a rounded body, side windows and a windscreen
    var big = mode === 'coach';
    bodyCar(-len / 2, -h * 0.95, len, h * 1.9, 4, color, load);
    windows(-len / 2 + 3, len / 2 - len * 0.2, h * 0.75, big ? 5 : 3);
    ctx.fillStyle = 'rgba(15,20,26,0.85)'; ctx.fillRect(len / 2 - len * 0.17, -h * 0.7, len * 0.12, h * 1.4);
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }

  function drawPreview() {
    if (!ui.editing || !ui.hover) return;
    var L = S.lineById(state, ui.editing);
    if (!L || !L.stations.length) return;
    var sMap = S.stationMap(state);
    var target = toGame(ui.hover.x, ui.hover.y);
    var snap = stationAt(ui.hover);
    if (snap) target = snap;
    if (ui.insertMode && L.stations.length >= 2) {
      var ix = insertIndex(L, target), pa = sMap.get(L.stations[ix - 1]), pb = sMap.get(L.stations[ix]), st2 = !!MODES[L.mode].straight;
      strokePath(R.routeSegment(pa, target, null, false, st2), lineWidth(), L.color + '99', [10, 8]);
      strokePath(R.routeSegment(target, pb, null, false, st2), lineWidth(), L.color + '99', [10, 8]);
      var pp = toScreen(target);
      ctx.beginPath(); ctx.arc(pp.x, pp.y, stationRadius(), 0, 6.283);
      ctx.setLineDash([4, 3]); ctx.lineWidth = 3; ctx.strokeStyle = L.color; ctx.stroke(); ctx.setLineDash([]);
      return;
    }
    var front = pickEnd(L, target);
    var from = sMap.get(L.stations[front ? 0 : L.stations.length - 1]);
    var g = gfx.get(L.id), prevDir = null;
    if (g && g.base.length >= 2) {
      prevDir = front ? R.unit(g.base[1], g.base[0]) : R.unit(g.base[g.base.length - 2], g.base[g.base.length - 1]);
    }
    var seg = R.routeSegment(from, target, prevDir, false, !!MODES[L.mode].straight);
    strokePath(seg, lineWidth(), L.color + '99', [10, 8]);
    var p = toScreen(target);
    ctx.beginPath(); ctx.arc(p.x, p.y, stationRadius(), 0, 6.283);
    ctx.setLineDash([4, 3]); ctx.lineWidth = 3; ctx.strokeStyle = L.color; ctx.stroke(); ctx.setLineDash([]);
  }

  function drawStations() {
    var r0 = stationRadius();
    var perStation = new Map();
    state.lines.forEach(function (L) {
      L.stations.forEach(function (id) { perStation.set(id, (perStation.get(id) || 0) + 1); });
    });
    var showNames = ui.view.names && V.s >= 0.9, vis = shownStations();
    var editEnds = null, eL = ui.editing ? S.lineById(state, ui.editing) : null;
    if (eL && eL.stations.length) editEnds = { color: eL.color, ids: [eL.stations[0], eL.stations[eL.stations.length - 1]] };
    state.stations.forEach(function (s) {
      var p = toScreen(s);
      if (p.x < -40 || p.y < -40 || p.x > V.w + 40 || p.y > V.h + 40) return;
      if (!stationVisible(vis, s.id)) return;
      var n = perStation.get(s.id) || 0;
      var r = n > 1 ? r0 * 1.35 : r0;
      if (ui.selStation === s.id) {
        ctx.beginPath(); ctx.arc(p.x, p.y, r + 9, 0, 6.283);
        ctx.fillStyle = 'rgba(255,255,255,0.16)'; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
      }
      if (editEnds && editEnds.ids.indexOf(s.id) >= 0) {
        ctx.beginPath(); ctx.arc(p.x, p.y, r + 8, 0, 6.283);
        ctx.setLineDash([5, 4]); ctx.lineWidth = 3; ctx.strokeStyle = editEnds.color; ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 6.283);
      ctx.fillStyle = '#1b1d1f'; ctx.fill();
      ctx.lineWidth = n > 1 ? 4.5 : 3.5;
      ctx.strokeStyle = n ? '#F2F2F2' : '#8a8f95';
      if (!n) ctx.setLineDash([3, 3]);
      ctx.stroke(); ctx.setLineDash([]);
      var w = ui.view.waiting && state.stats && state.stats.waiting[s.id];
      if (w) {
        var pips = Math.min(8, Math.ceil(w / 30));
        for (var i = 0; i < pips; i++) {
          var a = -Math.PI / 2 + (i - (pips - 1) / 2) * 0.5;
          ctx.beginPath(); ctx.arc(p.x + Math.cos(a) * (r + 7), p.y + Math.sin(a) * (r + 7), 2.6, 0, 6.283);
          ctx.fillStyle = '#F28A1E'; ctx.fill();
        }
      }
      if (showNames) {
        ctx.font = '600 12px system-ui, sans-serif'; ctx.textBaseline = 'middle';
        ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(20,21,23,0.85)'; ctx.lineJoin = 'round';
        ctx.strokeText(s.name, p.x + r + 7, p.y + 1);
        ctx.fillStyle = '#E9E9E9'; ctx.fillText(s.name, p.x + r + 7, p.y + 1);
      }
    });
  }

  function draw(dt) {
    updateView();
    if (V.s !== ui.lastS) { ui.lastS = V.s; relayout(); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, V.w, V.h);
    if (!state) return;
    if (noTiles()) drawGrid();
    drawBlocks();
    drawMarkers();
    drawCatchments();
    drawLines();
    drawVehicles(dt);
    drawPreview();
    drawStations();
  }

  function resizeCanvas() {
    dpr = window.devicePixelRatio || 1;
    var sz = map.getSize();
    canvas.width = Math.round(sz.x * dpr); canvas.height = Math.round(sz.y * dpr);
    canvas.style.width = sz.x + 'px'; canvas.style.height = sz.y + 'px';
  }

  /* ---------- hit testing ---------- */
  function stationAt(cp) {
    if (!state) return null;
    var best = null, bd = 26, vis = shownStations();
    state.stations.forEach(function (s) {
      if (!stationVisible(vis, s.id)) return;
      var p = toScreen(s), d = Math.hypot(p.x - cp.x, p.y - cp.y);
      if (d < bd) { bd = d; best = s; }
    });
    return best;
  }
  function segmentHit(lineId, g) {
    var gf = gfx.get(lineId); if (!gf) return -1;
    var best = -1, bd = 14 / V.s;
    gf.segs.forEach(function (seg, i) { var d = R.distToPath(seg, g); if (d < bd) { bd = d; best = i; } });
    return best;
  }
  function lineHit(g) {
    var best = null, bd = 12 / V.s;
    state.lines.forEach(function (L) {
      var gf = gfx.get(L.id); if (!gf || gf.path.length < 2 || !lineShown(L)) return;
      var d = R.distToPath(gf.path, g); if (d < bd) { bd = d; best = L.id; }
    });
    return best;
  }

  /* ---------- input ---------- */
  function onTap(cp) {
    if (!state || state.over) return;
    updateView();
    var g = toGame(cp.x, cp.y), hit = stationAt(cp);
    if (ui.editing) return editTap(g, hit);
    if (ui.tool === 'station') {
      if (hit) return selectStation(hit.id);
      var r = S.addStation(state, g.x, g.y);
      if (!r.ok) toast(r.msg); else { toast('Station built, ' + fmt(BAL.stationCost)); queueName(r.id); afterChange(); }
      return;
    }
    if (hit) return selectStation(hit.id);
    if (ui.selLine) {
      var idx = segmentHit(ui.selLine, g);
      if (idx >= 0 && MODES[S.lineById(state, ui.selLine).mode].straight) { toast('Flights always go straight'); return; }
      if (idx >= 0) { S.toggleFlip(state, ui.selLine, idx); toast('Bend flipped'); afterChange(); return; }
    }
    var lid = lineHit(g);
    if (lid) return selectLine(lid);
    ui.selLine = null; ui.selStation = null; ui.sheet = 'none'; renderSheet();
  }

  /* Which end of the line a new stop joins: the end nearest to where you tapped. */
  function pickEnd(L, g) {
    if (L.stations.length < 2) return false;
    var sMap = S.stationMap(state), a = sMap.get(L.stations[0]), b = sMap.get(L.stations[L.stations.length - 1]);
    return Math.hypot(a.x - g.x, a.y - g.y) < Math.hypot(b.x - g.x, b.y - g.y);
  }

  /* Insert mode: which section of the line a new stop splits, the one whose drawn path is nearest to the tap. */
  function insertIndex(L, g) {
    var gf = gfx.get(L.id), best = L.stations.length - 1, bd = Infinity;
    if (!gf || !gf.segs) return best;
    gf.segs.forEach(function (seg, i) { var d = R.distToPath(seg, g); if (d < bd) { bd = d; best = i + 1; } });
    return best;
  }

  function editTap(g, hit) {
    var L = S.lineById(state, ui.editing);
    if (!L) return;
    var created = false, before = state.balance, sid;
    if (hit) sid = hit.id;
    else {
      var r = S.addStation(state, g.x, g.y);
      if (!r.ok) return toast(r.msg);
      sid = r.id; created = true;
    }
    var res = ui.insertMode ? S.insertStopInLine(state, L.id, sid, insertIndex(L, hit ? hit : g)) : S.addStopToLine(state, L.id, sid, pickEnd(L, hit ? hit : g));
    if (!res.ok) {
      if (created) {
        state.stations.pop(); state.balance = before;
        var m = /^Need (.+) for this stop$/.exec(res.msg || '');
        if (m) {
          var sm = S.stationMap(state), tmp = { id: -1, x: g.x, y: g.y };
          var c = (ui.insertMode ? MODES[L.mode].platform : S.stopCost(state, L, tmp, sm, pickEnd(L, g)).cost) + BAL.stationCost;
          return toast('Need ' + fmt(c) + ' (stop plus new station), you have ' + fmt(before));
        }
      }
      return toast(res.msg);
    }
    ui.hint = false;
    if (created) queueName(sid);
    toast('Stop added, ' + fmt(res.cost + (created ? BAL.stationCost : 0)) + (res.note ? '. ' + res.note : ''));
    afterChange();
  }

  function setTool(t) {
    ui.tool = ui.tool === t ? 'move' : t;
    if (ui.editing) finishEditing();
    renderDock();
    if (ui.tool === 'station') toast('Tap the map to build stations');
  }

  function selectStation(id) {
    ui.renamingStation = false; ui.selStation = id; ui.selLine = null; ui.sheet = 'station'; renderSheet(); renderDock();
  }
  function selectLine(id) {
    ui.renaming = false; ui.pickingColor = false; ui.selLine = id; ui.selStation = null; ui.sheet = 'line'; renderSheet();
  }

  function setLineColor(c) {
    var L = state && S.lineById(state, ui.selLine);
    if (!L || !/^#[0-9a-fA-F]{6}$/.test(c)) return;
    L.color = c.toUpperCase(); ui.pickingColor = false;
    renderSheet(); renderBanner(); updateHud(); scheduleSave();
  }

  function startEditing(lineId) {
    ui.editing = lineId; ui.insertMode = false; ui.selLine = lineId; ui.selStation = null; ui.sheet = 'none'; ui.tool = 'move';
    renderSheet(); renderBanner(); renderDock();
  }
  function finishEditing() {
    var L = S.lineById(state, ui.editing);
    ui.editing = null; ui.insertMode = false; ui.hover = null;
    if (L && L.stations.length < 2) {
      while (L.stations.length) S.undoLastStop(state, L.id);
      S.deleteLine(state, L.id);
      ui.selLine = null; ui.sheet = 'none';
      toast('Line needs at least two stops, so it was cancelled');
      afterChange();
    } else if (L) {
      ui.sheet = 'line'; ui.selLine = L.id;
      afterChange();
    }
    renderBanner(); renderDock();
  }


  /* ---------- station names from OpenStreetMap (Nominatim reverse geocoding, one request per second) ---------- */
  var nameQueue = [], nameBusy = false;
  function queueName(id) {
    if (nameQueue.indexOf(id) < 0) nameQueue.push(id);
    pumpNames();
  }
  function queueUnnamed() {
    state.stations.forEach(function (s) { if (!s.named || s.cc === undefined) queueName(s.id); });
  }
  function pumpNames() {
    if (nameBusy || !nameQueue.length || !state) return;
    var st = state, id = nameQueue.shift();
    var s = S.stationMap(st).get(id);
    if (!s || (s.named && s.cc !== undefined)) return pumpNames();
    nameBusy = true;
    var ll = map.unproject(L.point(centerPx.x + s.x, centerPx.y + s.y), Z);
    fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&addressdetails=1&lat=' + ll.lat.toFixed(6) + '&lon=' + ll.lng.toFixed(6))
      .then(function (r) { if (!r.ok) throw new Error('bad status'); return r.json(); })
      .then(function (j) { if (st === state) applyName(st, s, j); })
      .catch(function () {
        s.nameTries = (s.nameTries || 0) + 1;
        if (s.nameTries < 3) setTimeout(function () { if (st === state) queueName(id); }, 8000);
      })
      .then(function () { setTimeout(function () { nameBusy = false; pumpNames(); }, 1100); });
  }
  function applyName(st, s, j) {
    var a = (j && j.address) || {};
    s.cc = String(a.country_code || '').toUpperCase(); s.country = a.country || '';
    if (s.named) { scheduleSave(); return; }                 // only the country was missing, keep the name
    var base = a.road || a.pedestrian || a.footway || a.cycleway || a.path || a.neighbourhood || a.suburb || a.quarter || a.village || a.town || a.city_district || a.hamlet;
    if (!base) { s.named = true; return; }
    var area = a.suburb || a.neighbourhood || a.quarter || a.city_district || '';
    if (/^[A-Za-z]?\d{1,4}[A-Za-z]?$/.test(String(base).trim())) {            // a bare road number such as "811"
      var place = a.suburb || a.village || a.hamlet || a.neighbourhood || a.town || a.city_district || a.city || '';
      base = 'Road ' + String(base).trim() + (place ? ' (' + place + ')' : ''); area = '';
    }
    var taken = function (n) { return st.stations.some(function (o) { return o !== s && o.name.toLowerCase() === n.toLowerCase(); }); };
    var name = base;
    if (taken(name) && area && area !== base) name = base + ' (' + area + ')';
    for (var k = 2; taken(name); k++) name = base + ' ' + k;
    s.name = name.length > 28 ? name.slice(0, 27) + '…' : name;
    s.named = true;
    scheduleSave();
    if (ui.sheet === 'station') renderSheet();
  }

  /* ---------- state changes ---------- */
  function afterChange() {
    relayout();
    state.stats = S.computeNetwork(state);
    if (window.TGGoals) handleEvents(TGGoals.check(state));
    updateHud(); renderSheet(); renderBanner(); scheduleSave();
  }
  function handleEvents(events) {
    events.forEach(function (ev) {
      if (ev.type === 'unlock') toast(MODES[ev.mode].name + ' unlocked!', 4200);
      else if (ev.type === 'over') showOver();
      else if (ev.type === 'goal') toast('Goal done: ' + ev.goal.title + '. +' + fmt(ev.goal.reward), 5200);
      else if (ev.type === 'goalExpired') toast('Contract ran out: ' + ev.goal.title, 4200);
      else if (ev.type === 'event') toast((ev.event.good ? 'Good news: ' : 'Trouble: ') + ev.event.title, 5200);
      else if (ev.type === 'eventEnd') toast('Over: ' + ev.event.title, 3000);
    });
    if (ui.sheet === 'goals') renderSheet();
  }

  function dayEnd() {
    var events = S.endDay(state);
    handleEvents(events);
    if (state.balance < 0 && !state.over) toast('You are in debt. ' + (BAL.bankruptDays - state.negDays) + ' more day(s) and you go bankrupt', 4200);
    updateHud(); renderSheet(); save();
  }

  /* ---------- HUD, dock, banner, toast ---------- */
  function updateHud() {
    if (!state) return;
    $('hudDay').textContent = 'Day ' + state.day + (window.TGGoals ? ' · ' + TGGoals.seasonOf(state.day).name : '');
    var bal = $('hudBal'); bal.textContent = fmt(state.balance); bal.className = state.balance < 0 ? 'neg' : '';
    var st = state.stats || { riders: 0, profit: 0 };
    $('hudRiders').textContent = num(st.riders);
    var pr = $('hudProfit'); pr.textContent = (st.profit >= 0 ? '+' : '') + fmt(st.profit); pr.className = st.profit < 0 ? 'neg' : 'pos';
    $('dayBar').style.width = Math.round(ui.dayProg * 100) + '%';
    document.querySelectorAll('[data-speed]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(+b.getAttribute('data-speed') === ui.speed));
    });
  }

  function updateLegend() {
    var el = $('legend'); if (!el) return;
    el.className = state && ui.showDemand && !ui.legendHidden ? 'legend' : 'legend hidden';
  }

  function renderDock() {
    updateLegend();
    $('dock').innerHTML =
      dockBtn('move', ICON.hand, 'Move', ui.tool === 'move' && !ui.editing && ui.sheet !== 'lines') +
      dockBtn('station', ICON.pin, 'Station', ui.tool === 'station') +
      dockBtn('lines', ICON.lines, 'Lines', ui.sheet === 'lines' || ui.sheet === 'line' || ui.sheet === 'newline') +
      dockBtn('demand', ICON.eye, 'Demand', ui.showDemand) +
      dockBtn('goals', ICON.flag, 'Goals', ui.sheet === 'goals') +
      dockBtn('stats', ICON.chart, 'Stats', ui.sheet === 'stats') +
      dockBtn('save', ICON.gear, 'Menu', ui.sheet === 'save');
  }
  function dockBtn(act, icon, label, on) {
    return '<button type="button" class="dockbtn" data-dock="' + act + '" aria-pressed="' + on + '">' + icon + '<span>' + label + '</span></button>';
  }

  function renderBanner() {
    var b = $('banner');
    if (ui.editing) {
      var L = S.lineById(state, ui.editing);
      if (!L) { b.className = 'banner hidden'; return; }
      b.className = 'banner';
      b.innerHTML = '<span class="dot" style="background:' + L.color + '"></span><span class="btxt">' + lineName(L) + ' (' + MODES[L.mode].name.toLowerCase() + '). ' + (ui.insertMode ? 'Insert mode: tap the map or an existing station and it joins the nearest part of the line.' : 'Tap the map near either end of the line to extend it, or tap an existing station.') + '</span>' +
        (ui.insertMode ? '' : '<button type="button" class="btn small" data-act="undo">Undo</button>') + '<button type="button" class="btn small primary" data-act="done">Done</button>';
    } else if (ui.hint && state && !state.lines.length) {
      b.className = 'banner';
      b.innerHTML = '<span class="btxt">Welcome! Tap <b>Lines</b>, then <b>New line</b>, and tap the map to place stops. Orange and blue blobs show where people live and work.</span>';
    } else b.className = 'banner hidden';
  }

  var toastTimer = null;
  function toast(msg, ms) {
    var t = $('toast'); t.textContent = msg; t.className = 'toast show';
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.className = 'toast'; }, ms || 2400);
  }

  /* ---------- sheet ---------- */
  function colorName(L) { return COLOR_NAMES[L.color] || ('Line ' + (L.n || L.id)); }
  function lineRaw(L) { return L.name || (COLOR_NAMES[L.color] ? COLOR_NAMES[L.color] + ' line' : 'Line ' + (L.n || L.id)); }
  function lineName(L) { return esc(lineRaw(L)); }
  function profitHtml(v) { return '<span class="' + (v < 0 ? 'neg' : 'pos') + '">' + (v < 0 ? '−' : '+') + ' ' + fmt(Math.abs(v)) + '</span>'; }

  function renderSheet() {
    var el = $('sheet');
    if (ui.renaming && ui.sheet === 'line' && document.activeElement && document.activeElement.id === 'lineNameInput') return;
    if (ui.sheet === 'line' && document.activeElement && (document.activeElement.id === 'vehInput' || document.activeElement.id === 'lineColorInput')) return;
    if (ui.renamingStation && ui.sheet === 'station' && document.activeElement && document.activeElement.id === 'stationNameInput') return;
    if (!state || ui.sheet === 'none' || ui.editing) { el.className = 'sheet hidden'; el.innerHTML = ''; return; }
    el.className = 'sheet';
    var html = '';
    if (ui.sheet === 'lines') html = sheetLines();
    else if (ui.sheet === 'line') html = sheetLine();
    else if (ui.sheet === 'station') html = sheetStation();
    else if (ui.sheet === 'newline') html = sheetNewLine();
    else if (ui.sheet === 'save') html = sheetSave();
    else if (ui.sheet === 'stats') html = sheetStats();
    else if (ui.sheet === 'goals') html = sheetGoals();
    el.innerHTML = html;
  }

  function head(title, sub, back) {
    return '<div class="shead">' + (back ? '<button type="button" class="iconbtn" data-act="' + back + '" aria-label="Back">‹</button>' : '') +
      '<div class="stitle"><h2>' + title + '</h2>' + (sub ? '<div class="muted">' + sub + '</div>' : '') + '</div>' +
      '<button type="button" class="iconbtn" data-act="close" aria-label="Close">' + ICON.close + '</button></div>';
  }

  function clockTime(t) { var d = new Date(t); return (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes(); }
  function toggleRow(key, label, hint, on, modeKey) {
    return '<button type="button" class="toggle" data-act="set" data-key="' + key + '"' + (modeKey ? ' data-mode="' + modeKey + '"' : '') + ' aria-pressed="' + on + '">' +
      '<span class="tgtxt"><b>' + label + '</b>' + (hint ? '<span class="muted small">' + hint + '</span>' : '') + '</span><span class="sw"><i></i></span></button>';
  }
  function viewSettingsHtml() {
    var v = ui.view;
    var h = '<div class="muted small"><b>Show on the map</b></div><div class="togglelist">' +
      toggleRow('demand', 'Homes and jobs', 'Orange and blue blobs', ui.showDemand) +
      toggleRow('chunks', 'Loaded areas', 'Dashed outlines and darkened areas', v.chunks) +
      toggleRow('waiting', 'Waiting passengers', 'Orange dots around stations', v.waiting) +
      toggleRow('names', 'Station names', 'Shown when zoomed in', v.names) +
      toggleRow('vehicles', 'Vehicles', 'The moving buses, trains and so on', v.vehicles) +
      toggleRow('markers', 'Goals and events', 'Gold goal rings, green rush rings, closures', v.markers) +
      '</div>';
    var present = S.MODE_ORDER.filter(function (k) { return state.lines.some(function (L) { return L.mode === k; }); });
    if (present.length > 1) {
      h += '<div class="muted small"><b>Lines by mode</b> (hidden lines still run and earn money)</div><div class="togglelist">';
      present.forEach(function (k) { h += toggleRow('mode', MODES[k].name + ' lines', '', !v.hide[k], k); });
      h += '</div>';
    }
    return h;
  }
  function sheetSave() {
    var h = head('Menu', 'Autosave is on. ' + (ui.lastSaved ? 'Last saved at ' + clockTime(ui.lastSaved) + '.' : 'Saving…'));
    h += mapDataHtml();
    h += viewSettingsHtml();
    h += '<div class="muted small"><b>Save and backup</b></div>';
    h += '<button type="button" class="btn big primary" data-act="export">Download backup file</button>' +
      '<button type="button" class="btn big" data-act="import">Load backup file…</button>' +
      '<div class="muted small">A backup file lets you keep a copy or move the game to another device. Loading one replaces the game you are playing now.</div>' +
      '<button type="button" class="btn big" data-act="menu">Back to start screen</button>' +
      '<div class="muted small">Your game is saved first. Pick Continue to come back to it, or start a new game (a new game replaces the saved one).</div>';
    if (ui.snaps && ui.snaps.length) {
      h += '<div class="muted small"><b>Older autosaves</b> (every few minutes)</div>';
      ui.snaps.forEach(function (e) {
        h += '<button type="button" class="btn big" data-act="snap" data-slot="' + e.slot + '">Day ' + e.day + ' · saved at ' + clockTime(e.at) + '</button>';
      });
    }
    return h;
  }

  /* ---------- backup files ---------- */
  function exportSave() {
    (state ? save() : Promise.resolve()).then(function () { return Store.get('main'); }).then(function (raw) {
      if (!raw) return toast('Nothing to back up yet.');
      var day = 0; try { day = JSON.parse(raw).state.day; } catch (e) { /* ignore */ }
      var url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
      var a = document.createElement('a');
      a.href = url; a.download = 'transit-game-day-' + day + '.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      toast('Backup file downloaded.');
    });
  }

  function restoreData(data, msg) {
    var st = data && data.state;
    if (!st || st.v !== 1 || !st.center || !Array.isArray(st.stations) || !Array.isArray(st.lines) || !Array.isArray(st.blocks)) return toast('That is not a Transit Game save.');
    Store.put('main', JSON.stringify(data)).then(function (ok) {
      if (!ok) return toast('Could not store it in this browser.');
      ui.dayProg = data.dayProg || 0;
      beginGame(st, data.view);
      toast(msg + ' Day ' + st.day + '.');
    });
  }
  function restoreSnapshot(slot) {
    Store.get(slot).then(function (raw) {
      var data; try { data = JSON.parse(raw); } catch (e) { return toast('That copy could not be read.'); }
      if (state && !confirm('Replace the game you are playing with this older copy?')) return;
      restoreData(data, 'Older copy loaded.');
    });
  }

  function importSave(file) {
    if (!file) return;
    var rd = new FileReader();
    rd.onerror = function () { toast('Could not read that file.'); };
    rd.onload = function () {
      var data;
      try { data = JSON.parse(rd.result); } catch (e) { return toast('That is not a Transit Game backup.'); }
      if (state && !confirm('Replace the game you are playing with this backup?')) return;
      restoreData(data, 'Backup loaded.');
    };
    rd.readAsText(file);
  }

  /* A small line chart as inline SVG. */
  function spark(values, color, label, fmtV) {
    if (values.length < 2) return '<div class="muted small">' + label + ': not enough days yet.</div>';
    var W = 300, H = 70, P = 4, lo = Math.min.apply(null, values), hi = Math.max.apply(null, values);
    if (hi === lo) { hi += 1; lo -= 1; }
    var pts = values.map(function (v, i) { return (P + (W - 2 * P) * i / (values.length - 1)).toFixed(1) + ',' + (H - P - (H - 2 * P) * (v - lo) / (hi - lo)).toFixed(1); }).join(' ');
    var zero = lo < 0 && hi > 0 ? '<line x1="0" x2="' + W + '" y1="' + (H - P - (H - 2 * P) * (0 - lo) / (hi - lo)).toFixed(1) + '" y2="' + (H - P - (H - 2 * P) * (0 - lo) / (hi - lo)).toFixed(1) + '" stroke="#555" stroke-dasharray="3 3"/>' : '';
    return '<div class="chartbox"><div class="lrow"><b>' + label + '</b><span class="grow"></span><span class="muted">' + fmtV(values[values.length - 1]) + ' now</span></div>' +
      '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" width="100%" height="70" role="img" aria-label="' + label + '">' + zero +
      '<polyline points="' + pts + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>' +
      '<div class="lrow muted small"><span>' + fmtV(lo) + '</span><span class="grow"></span><span>' + fmtV(hi) + '</span></div></div>';
  }
  function pct(a, b) { return b > 0 ? Math.round(100 * a / b) : 0; }

  function sheetStats() {
    var st = state.stats || { riders: 0, revenue: 0, cost: 0, profit: 0, waiting: {}, lines: {} };
    var cov = S.coverage(state), vehicles = 0, km = 0, working = 0;
    state.lines.forEach(function (L) { vehicles += L.vehicles; km += S.lineLenM(state, L) / 1000; if (L.stations.length >= 2) working++; });
    var h = head('Network stats', 'Day ' + state.day);
    h += '<div class="stats">' +
      '<div><b>' + fmt(state.balance) + '</b><span>balance</span></div>' +
      '<div><b>' + num(st.riders) + '</b><span>riders / day</span></div>' +
      '<div><b>' + profitHtml(st.profit) + '</b><span>profit / day</span></div>' +
      '<div><b>' + fmt(st.revenue) + '</b><span>fares / day</span></div>' +
      '<div><b>' + fmt(st.cost) + '</b><span>costs / day</span></div>' +
      '<div><b>' + num(state.lifetimePax) + '</b><span>passengers so far</span></div></div>';
    h += '<div class="stats">' +
      '<div><b>' + working + '</b><span>working lines</span></div>' +
      '<div><b>' + state.stations.length + '</b><span>stops</span></div>' +
      '<div><b>' + vehicles + '</b><span>vehicles</span></div>' +
      '<div><b>' + km.toFixed(1) + '</b><span>km of track</span></div></div>';
    h += '<div class="chartbox"><div class="lrow"><b>Within reach of a stop</b></div>' +
      '<div class="lrow muted small"><span>Residents</span><span class="grow"></span><span>' + num(cov.popReached) + ' of ' + num(cov.pop) + ' (' + pct(cov.popReached, cov.pop) + '%)</span></div>' +
      '<span class="bar"><span style="width:' + pct(cov.popReached, cov.pop) + '%;background:#FFB454"></span></span>' +
      '<div class="lrow muted small"><span>Jobs</span><span class="grow"></span><span>' + num(cov.jobsReached) + ' of ' + num(cov.jobs) + ' (' + pct(cov.jobsReached, cov.jobs) + '%)</span></div>' +
      '<span class="bar"><span style="width:' + pct(cov.jobsReached, cov.jobs) + '%;background:#6CA8FF"></span></span></div>';
    var hist = state.history || [];
    h += spark(hist.map(function (e) { return e.balance; }), '#E9E9E9', 'Balance', fmt);
    h += spark(hist.map(function (e) { return e.riders; }), '#6CA8FF', 'Riders per day', num);
    h += spark(hist.map(function (e) { return e.profit; }), '#6FD08C', 'Profit per day', fmt);
    if (hist.length >= 2) h += '<div class="muted small">Last ' + hist.length + ' days.</div>';

    var rows = state.lines.filter(function (L) { return st.lines[L.id]; }).sort(function (a, b) { return st.lines[b.id].profit - st.lines[a.id].profit; });
    if (rows.length) {
      h += '<div class="muted small"><b>Lines, best profit first</b></div>';
      rows.forEach(function (L) {
        var ls = st.lines[L.id];
        h += '<button type="button" class="card linecard" data-act="selline" data-id="' + L.id + '"><span class="lrow"><span class="dot" style="background:' + L.color + '"></span><b>' + lineName(L) + '</b><span class="grow"></span>' + profitHtml(ls.profit) + '/day</span>' +
          '<span class="muted">' + num(ls.riders) + ' riders · ' + Math.round(ls.load * 100) + '% full at peak</span></button>';
      });
    }
    var sMap = S.stationMap(state);
    var wait = Object.keys(st.waiting || {}).map(function (id) { return { id: +id, n: st.waiting[id] }; }).filter(function (w) { return w.n >= 1 && sMap.get(w.id); }).sort(function (a, b) { return b.n - a.n; }).slice(0, 5);
    if (wait.length) {
      h += '<div class="muted small"><b>Where people are left behind</b> (trips per day)</div>';
      wait.forEach(function (w) {
        h += '<button type="button" class="card linecard" data-act="selstation" data-id="' + w.id + '"><span class="lrow"><b>' + esc(sMap.get(w.id).name) + '</b><span class="grow"></span><span class="neg">' + num(w.n) + '</span></span></button>';
      });
    }
    return h;
  }

  function sheetGoals() {
    var T = window.TGGoals;
    if (!T) return head('Goals', 'Not available');
    var G = T.ensure(state), m = T.metrics(state), se = T.seasonOf(state.day);
    var h = head('Goals and events', 'Day ' + state.day + ' · ' + se.name + ' (' + se.note + ')');
    var labels = { build: 'Build', numbers: 'Numbers', contract: 'Contract', challenge: 'Challenge' };
    h += '<div class="muted small"><b>Active goals</b>, paid when done</div>';
    G.active.forEach(function (g) {
      var p = T.progress(state, g, m);
      var left = g.deadline !== undefined ? Math.max(0, g.deadline - state.day + 1) + ' days left' : '';
      h += '<div class="card goalcard"><span class="lrow"><b>' + esc(g.title) + '</b><span class="grow"></span><span class="pos">+' + fmt(g.reward) + '</span></span>' +
        '<span class="muted">' + labels[g.kind] + ' · ' + esc(g.desc) + '</span>' +
        '<span class="bar"><span style="width:' + Math.round(p.frac * 100) + '%;background:#6FD08C"></span></span>' +
        '<span class="lrow muted small"><span' + (p.bad ? ' class="neg"' : '') + '>' + esc(p.bad || p.text) + '</span><span class="grow"></span><span>' + left + '</span></span>' +
        '<span class="lrow">' + (g.spot ? '<button type="button" class="btn small" data-act="gotospot" data-id="' + g.id + '">Show on map</button>' : '') + '<span class="grow"></span><button type="button" class="btn small" data-act="skipgoal" data-id="' + g.id + '">Skip</button></span></div>';
    });
    var evs = T.activeEvents(state);
    h += '<div class="muted small"><b>Events right now</b></div>';
    if (!evs.length) h += '<div class="card muted">Nothing unusual. Things can happen any day: strikes, fuel prices, closures and storms, but also festivals and matches.</div>';
    evs.forEach(function (e) {
      var left = Math.max(1, e.until - state.day + 1);
      h += '<div class="card goalcard"><span class="lrow"><span class="dot" style="background:' + (e.good ? '#6FD08C' : '#FF6B6B') + '"></span><b>' + esc(e.title) + '</b><span class="grow"></span><span class="muted small">' + left + ' day' + (left > 1 ? 's' : '') + ' left</span></span>' +
        '<span class="muted">' + esc(e.text) + '</span></div>';
    });
    h += '<div class="stats"><div><b>' + G.count + '</b><span>goals done</span></div><div><b>' + fmt(G.earned) + '</b><span>earned from goals</span></div><div><b>' + G.failed + '</b><span>contracts missed</span></div></div>';
    if (G.done.length) {
      h += '<div class="muted small"><b>Recently done</b></div>';
      G.done.slice(0, 5).forEach(function (d) {
        h += '<div class="lrow muted small"><span>Day ' + d.day + ' · ' + esc(d.title) + '</span><span class="grow"></span><span class="pos">+' + fmt(d.reward) + '</span></div>';
      });
    }
    if (G.missed && G.missed.length) {
      h += '<div class="muted small"><b>Recently missed</b></div>';
      G.missed.slice(0, 5).forEach(function (d) {
        h += '<div class="lrow muted small"><span>Day ' + d.day + ' · ' + esc(d.title) + '</span><span class="grow"></span><span class="neg">missed</span></div>';
      });
    } else if (G.failed) h += '<div class="muted small">Contracts missed before this update were not recorded by name.</div>';
    return h;
  }

  /* ---------- the lines list: search, sort and filters ---------- */
  /* ---------- what is shown on the map (Menu > Show on the map) ---------- */
  var VIEW_KEY = 'transit-game-view';
  function loadView() {
    try {
      var o = JSON.parse(window.localStorage.getItem(VIEW_KEY) || 'null');
      if (!o) return;
      ['waiting', 'names', 'vehicles', 'markers', 'chunks'].forEach(function (k) { if (o[k] === false) ui.view[k] = false; });
      if (o.hide && typeof o.hide === 'object') ui.view.hide = o.hide;
      if (o.demand === false) ui.showDemand = false;
    } catch (e) { /* ignore */ }
  }
  function saveView() {
    try { window.localStorage.setItem(VIEW_KEY, JSON.stringify({ waiting: ui.view.waiting, names: ui.view.names, vehicles: ui.view.vehicles, markers: ui.view.markers, chunks: ui.view.chunks, hide: ui.view.hide, demand: ui.showDemand })); } catch (e) { /* ignore */ }
  }
  function lineShown(L) { return !ui.view.hide[L.mode]; }
  /* A station is hidden only when every line through it is hidden. Stations with no line stay visible. */
  function shownStations() {
    var any = Object.keys(ui.view.hide).some(function (k) { return ui.view.hide[k]; });
    if (!any) return null;
    var seen = new Map();
    state.lines.forEach(function (L) {
      L.stations.forEach(function (id) { seen.set(id, (seen.get(id) || false) || lineShown(L)); });
    });
    return seen;   // id -> true when at least one visible line serves it; ids without any line are absent
  }
  function stationVisible(map, id) { return !map || !map.has(id) || map.get(id); }

  var LV_KEY = 'transit-game-linesview';
  var SORTS = [['new', 'Oldest first'], ['newest', 'Newest first'], ['name', 'Name A to Z'], ['profit', 'Profit, high to low'], ['profitlow', 'Profit, low to high'],
    ['riders', 'Most riders'], ['load', 'Most crowded'], ['stops', 'Most stops'], ['length', 'Longest'], ['vehicles', 'Most vehicles']];
  var STATUSES = [['all', 'All lines'], ['crowded', 'Crowded (85%+ full)'], ['over', 'Overloaded (95%+)'], ['loss', 'Losing money'], ['quiet', 'Nearly empty (under 20%)'],
    ['disrupted', 'Hit by an event'], ['unfinished', 'Unfinished (under 2 stops)']];
  function lv() {
    if (!ui.lv) {
      ui.lv = { sort: 'new', mode: 'all', status: 'all', country: 'all', q: '' };
      try { var o = JSON.parse(window.localStorage.getItem(LV_KEY) || 'null'); if (o) { ui.lv.sort = o.sort || 'new'; ui.lv.mode = o.mode || 'all'; ui.lv.status = o.status || 'all'; ui.lv.country = o.country || 'all'; } } catch (e) { /* ignore */ }
    }
    return ui.lv;
  }
  function saveLv() { try { window.localStorage.setItem(LV_KEY, JSON.stringify({ sort: ui.lv.sort, mode: ui.lv.mode, status: ui.lv.status, country: ui.lv.country })); } catch (e) { /* ignore */ } }
  function lvActive() { var v = lv(); return v.mode !== 'all' || v.status !== 'all' || v.country !== 'all' || !!v.q; }

  /* Countries come from the stop names (Nominatim). Stops not named yet have no country. */
  function lineCountries(L, sMap) {
    var out = [];
    L.stations.forEach(function (id) {
      var s = sMap.get(id); if (!s || !s.cc) return;
      if (!out.some(function (c) { return c.cc === s.cc; })) out.push({ cc: s.cc, name: s.country || s.cc });
    });
    return out;
  }
  function lineRows() {
    var sMap = S.stationMap(state);
    var v = lv(), st = state.stats || { lines: {} }, fxo = window.TGGoals ? TGGoals.fx(state) : null, q = v.q.trim().toLowerCase();
    var rows = state.lines.map(function (L, i) {
      var ls = st.lines[L.id] || { load: 0, profit: 0, riders: 0 };
      return { L: L, ls: ls, i: i, km: S.lineLenM(state, L) / 1000, hit: !!(fxo && (fxo.strike[L.id] || (fxo.cap[L.id] || 1) < 1)), work: L.stations.length >= 2, countries: lineCountries(L, sMap) };
    });
    rows = rows.filter(function (r) {
      if (v.mode !== 'all' && r.L.mode !== v.mode) return false;
      if (v.country === 'none') { if (r.countries.length) return false; }
      else if (v.country !== 'all' && !r.countries.some(function (c) { return c.cc === v.country; })) return false;
      if (q && lineRaw(r.L).toLowerCase().indexOf(q) < 0) return false;
      switch (v.status) {
        case 'crowded': return r.work && r.ls.load >= 0.85;
        case 'over': return r.work && r.ls.load >= 0.95;
        case 'loss': return r.work && r.ls.profit < 0;
        case 'quiet': return r.work && r.ls.load < 0.2;
        case 'disrupted': return r.hit;
        case 'unfinished': return !r.work;
      }
      return true;
    });
    var by = {
      new: function (a, b) { return a.i - b.i; },
      newest: function (a, b) { return b.i - a.i; },
      name: function (a, b) { return lineRaw(a.L).localeCompare(lineRaw(b.L), undefined, { numeric: true, sensitivity: 'base' }); },
      profit: function (a, b) { return b.ls.profit - a.ls.profit; },
      profitlow: function (a, b) { return a.ls.profit - b.ls.profit; },
      riders: function (a, b) { return b.ls.riders - a.ls.riders; },
      load: function (a, b) { return b.ls.load - a.ls.load; },
      stops: function (a, b) { return b.L.stations.length - a.L.stations.length; },
      length: function (a, b) { return b.km - a.km; },
      vehicles: function (a, b) { return b.L.vehicles - a.L.vehicles; }
    };
    rows.sort(function (a, b) { return (by[v.sort] || by.new)(a, b) || a.i - b.i; });
    return rows;
  }
  function lineListHtml() {
    var rows = lineRows(), h = '';
    if (state.lines.length > 1 || lvActive()) {
      h += '<div class="lrow muted small"><span>Showing ' + rows.length + ' of ' + state.lines.length + ' lines</span><span class="grow"></span>' +
        (lvActive() ? '<button type="button" class="linkbtn" data-act="clearlv">Clear filters</button>' : '') + '</div>';
    }
    rows.forEach(function (r) {
      var L = r.L, ls = r.ls;
      h += '<button type="button" class="card linecard" data-act="selline" data-id="' + L.id + '">' +
        '<span class="lrow"><span class="dot" style="background:' + L.color + '"></span><b>' + lineName(L) + '</b><span class="grow"></span>' + profitHtml(ls.profit) + '/day</span>' +
        '<span class="muted">' + MODES[L.mode].name + ' · ' + L.stations.length + ' stops · ' + r.km.toFixed(1) + ' km · ' + L.vehicles + ' vehicles' + (r.countries.length ? ' · ' + esc(r.countries.map(function (c) { return c.name; }).slice(0, 2).join(', ')) + (r.countries.length > 2 ? ' +' + (r.countries.length - 2) : '') : '') + (r.hit ? ' · <span class="neg">disrupted</span>' : '') + '</span>' +
        '<span class="bar"><span style="width:' + Math.min(100, Math.round(ls.load * 100)) + '%;background:' + (ls.load > 0.85 ? '#F28A1E' : '#E9E9E9') + '"></span></span>' +
        '<span class="muted">' + Math.round(ls.load * 100) + '% full at peak · ' + num(ls.riders) + ' riders</span></button>';
    });
    if (!rows.length && state.lines.length) h += '<div class="card muted">No lines match. Try clearing the filters.</div>';
    return h;
  }
  function sheetLines() {
    var h = head('Lines', state.lines.length ? '' : 'You have no lines yet'), v = lv();
    if (state.lines.length >= 2) {
      var modes = {}; state.lines.forEach(function (L) { modes[L.mode] = true; });
      var opt = function (list, cur) { return list.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === cur ? ' selected' : '') + '>' + o[1] + '</option>'; }).join(''); };
      var cMap = {}, sM = S.stationMap(state), anyNone = false;
      state.lines.forEach(function (L) { var cs = lineCountries(L, sM); if (!cs.length) anyNone = true; cs.forEach(function (c) { cMap[c.cc] = c.name; }); });
      var countryList = [['all', 'All countries']].concat(Object.keys(cMap).sort(function (a, b) { return cMap[a].localeCompare(cMap[b]); }).map(function (k) { return [k, cMap[k]]; }));
      if (anyNone) countryList.push(['none', 'Country not known yet']);
      if (v.country !== 'all' && v.country !== 'none' && !cMap[v.country]) countryList.push([v.country, v.country]);
      var modeList = [['all', 'All modes']].concat(S.MODE_ORDER.filter(function (k) { return modes[k] || v.mode === k; }).map(function (k) { return [k, MODES[k].name]; }));
      h += '<div class="lfilters"><input id="lineSearch" type="search" placeholder="Search lines by name" value="' + esc(v.q) + '" autocomplete="off">' +
        '<div class="lfrow"><label>Sort<select data-lv="sort">' + opt(SORTS, v.sort) + '</select></label>' +
        '<label>Mode<select data-lv="mode">' + opt(modeList, v.mode) + '</select></label>' +
        '<label>Show<select data-lv="status">' + opt(STATUSES, v.status) + '</select></label></div>' +
        (countryList.length > 1 ? '<div class="lfrow"><label>Country<select data-lv="country">' + opt(countryList, v.country) + '</select></label></div>' : '') + '</div>';
    }
    h += '<div id="lineList" class="lineList">' + lineListHtml() + '</div>';
    h += '<button type="button" class="btn big dashed" data-act="newline">+ New line</button>';
    return h;
  }

  function sheetNewLine() {
    var h = head('New line', ui.pendingStation ? 'Starting from the selected station' : 'Pick a transport mode', 'lines');
    S.MODE_ORDER.forEach(function (k) {
      var m = MODES[k], open = S.isUnlocked(state, k);
      h += '<button type="button" class="card modecard' + (open ? '' : ' locked') + '" data-act="mode" data-mode="' + k + '"' + (open ? '' : ' disabled') + '>' +
        '<span class="lrow"><b>' + m.name + '</b><span class="grow"></span><span class="muted">' + (open ? m.speed + ' km/h · ' + m.cap + ' seats' : m.soon ? 'Coming soon' : 'Locked') + '</span></span>' +
        '<span class="muted">' + (open ? (m.straight ? 'Route ' : 'Track ') + fmt(m.trackKm) + '/km · stop ' + fmt(m.platform) + ' · vehicle ' + fmt(m.vehicle) + ' · stops at least ' + (m.minSpacingM >= 1000 ? (m.minSpacingM / 1000) + ' km' : m.minSpacingM + ' m') + ' apart'
          : m.soon ? m.soon : 'Unlocks at ' + num(m.unlockPax) + ' total passengers (' + num(state.lifetimePax) + ' so far)') + '</span></button>';
    });
    return h;
  }

  function sheetLine() {
    var L = S.lineById(state, ui.selLine);
    if (!L) return '';
    var m = MODES[L.mode], ls = (state.stats && state.stats.lines[L.id]) || { riders: 0, load: 0, profit: 0, cost: 0 };
    var km = S.lineLenM(state, L) / 1000, lc = S.coverage(state, L.id);
    var h = head('<span class="dot" style="background:' + L.color + '"></span> ' + lineName(L), m.name + ' · ' + L.stations.length + ' stops · ' + km.toFixed(1) + ' km', 'lines');
    if (ui.renaming) {
      h += '<div class="renamerow"><input id="lineNameInput" type="text" maxlength="24" placeholder="Line name" value="' + esc(L.name || '') + '" autocomplete="off"><button type="button" class="btn primary" data-act="saverename">Save</button><button type="button" class="btn" data-act="cancelrename">Cancel</button></div>';
    }
    h += '<div class="stats">' +
      '<div><b>' + num(ls.riders) + '</b><span>riders / day</span></div>' +
      '<div><b>' + Math.round(ls.load * 100) + '%</b><span>full at peak</span></div>' +
      '<div><b>' + profitHtml(ls.profit) + '</b><span>profit / day</span></div>' +
      '<div><b>' + fmt(ls.cost) + '</b><span>running cost / day</span></div>' +
      '<div><b>' + num(lc.popReached) + '</b><span>residents near stops</span></div>' +
      '<div><b>' + num(lc.jobsReached) + '</b><span>jobs near stops</span></div></div>';
    h += '<div class="stepper"><span><b>Vehicles</b> <span class="muted">(' + fmt(m.vehicle) + ' each)</span></span><span class="grow"></span>' +
      '<button type="button" class="round" data-act="vminus" aria-label="Sell a vehicle">−</button><input id="vehInput" class="vinput" type="number" inputmode="numeric" min="1" max="' + S.BAL.maxVehicles + '" value="' + L.vehicles + '" aria-label="Number of vehicles">' +
      '<button type="button" class="round primary" data-act="vplus" aria-label="Buy a vehicle">+</button></div>';
    if (ui.pickingColor) {
      h += '<div class="swatches"><span class="muted small">Line colour</span><div class="swrow">' + PALETTE.map(function (c) {
        return '<button type="button" class="sw' + (c.toLowerCase() === String(L.color).toLowerCase() ? ' on' : '') + '" data-act="setcolor" data-color="' + c + '" style="background:' + c + '" aria-label="Colour ' + c + '"></button>';
      }).join('') + '<label class="sw custom" title="Pick any colour">+<input id="lineColorInput" type="color" value="' + (/^#[0-9a-fA-F]{6}$/.test(L.color) ? L.color : '#ffffff') + '"></label></div></div>';
    }
    h += '<div class="btnrow"><button type="button" class="btn primary" data-act="edit">Add stops</button>' +
      (L.stations.length >= 2 ? '<button type="button" class="btn" data-act="insert">Insert a stop</button>' : '') +
      '<button type="button" class="btn" data-act="undo">Undo last stop</button>' +
      '<button type="button" class="btn" data-act="rename">Rename</button>' +
      '<button type="button" class="btn" data-act="colour">Colour</button>' +
      '<button type="button" class="btn" data-act="reverse">Reverse</button>' +
      '<button type="button" class="btn danger" data-act="delete">Delete</button></div>';
    h += MODES[L.mode].straight ? '<p class="muted small tip">Planes fly in a straight line between airports.</p>' : '<p class="muted small tip">Tip: tap a segment of this line on the map to flip its bend.</p>';
    return h;
  }

  function sheetStation() {
    var s = S.stationMap(state).get(ui.selStation);
    if (!s) return '';
    var serving = state.lines.filter(function (L) { return L.stations.indexOf(s.id) >= 0 && L.stations.length >= 2; });
    var r = catchRadiusFor(s.id) || MODES.bus.catchM / S.mScale(state, s.y), pop = 0, jobs = 0;
    state.blocks.forEach(function (b) { if (Math.hypot(b.x - s.x, b.y - s.y) <= r) { pop += b.pop; jobs += b.jobs; } });
    var waiting = state.stats && state.stats.waiting[s.id] || 0;
    var h = head(esc(s.name), serving.length ? 'Served by ' + serving.length + (serving.length > 1 ? ' lines' : ' line') : 'No lines yet');
    h += '<div class="chips">' + serving.map(function (L) { return '<span class="chip"><span class="dot" style="background:' + L.color + '"></span>' + lineName(L) + '</span>'; }).join('') + '</div>';
    if (serving.length) {
      h += '<div class="rmlines">' + serving.map(function (L) {
        var can = L.stations.length > 2;
        return '<button type="button" class="btn small" data-act="rmfromline" data-id="' + L.id + '"' + (can ? '' : ' disabled title="A line needs two stops"') + '>Remove from ' + lineName(L) + '</button>';
      }).join('') + '</div>';
    }
    h += '<div class="stats"><div><b>' + num(pop) + '</b><span>residents nearby</span></div><div><b>' + num(jobs) + '</b><span>jobs nearby</span></div>' +
      '<div><b>' + num(waiting) + '</b><span>left behind / day</span></div></div>';
    if (ui.renamingStation) {
      h += '<div class="renamerow"><input id="stationNameInput" type="text" maxlength="28" placeholder="Station name (empty = automatic)" value="' + esc(s.name) + '" autocomplete="off"><button type="button" class="btn primary" data-act="ssave">Save</button><button type="button" class="btn" data-act="scancel">Cancel</button></div>';
    }
    h += '<div class="btnrow"><button type="button" class="btn primary" data-act="linefrom">New line from here</button>' +
      '<button type="button" class="btn" data-act="srename">Rename</button>' +
      (serving.length ? '' : '<button type="button" class="btn danger" data-act="rmstation">Remove station</button>') + '</div>';
    return h;
  }

  function onSheetClick(e) {
    var t = e.target.closest('[data-act]'); if (!t || !state) return;
    var act = t.getAttribute('data-act'), id = +t.getAttribute('data-id');
    var res;
    switch (act) {
      case 'speed': bulk.speed = Math.max(1, Math.min(3, id)); try { window.localStorage.setItem('transit-game-loadspeed', String(bulk.speed)); } catch (e2) { /* ignore */ } renderSheet(); setTimeout(ensureView, 50); break;
      case 'skiparea': skipLoading(); break;
      case 'unskip': skippedKeys = {}; chunkFailed = {}; setTimeout(ensureView, 50); renderSheet(); break;
      case 'loadfirst': bulk.first = bulk.first === id ? null : id; bulk.on = true; chunkFailed = {}; setTimeout(ensureView, 50); renderSheet(); break;
      case 'bulkload': bulk.on = !bulk.on; if (bulk.on) { chunkFailed = {}; setTimeout(ensureView, 50); } renderSheet(); break;
      case 'set': {
        var key = t.getAttribute('data-key');
        if (key === 'demand') { ui.showDemand = !ui.showDemand; if (ui.showDemand) ui.legendHidden = false; }
        else if (key === 'mode') { var mk = t.getAttribute('data-mode'); if (ui.view.hide[mk]) delete ui.view.hide[mk]; else ui.view.hide[mk] = true; if (ui.selLine && ui.view.hide[(S.lineById(state, ui.selLine) || {}).mode]) ui.selLine = null; }
        else ui.view[key] = !ui.view[key];
        saveView(); renderSheet(); renderDock(); break;
      }
      case 'close': ui.renaming = false; ui.renamingStation = false; ui.sheet = 'none'; ui.selLine = null; ui.selStation = null; ui.pendingStation = null; renderSheet(); renderDock(); break;
      case 'lines': ui.sheet = 'lines'; ui.selStation = null; ui.pendingStation = null; renderSheet(); renderDock(); break;
      case 'selline': selectLine(id); break;
      case 'rmfromline':
        if (!window.confirm('Take this stop off the line? The station stays on the map and you get half the cost back.')) break;
        res = S.removeStopFromLine(state, id, ui.selStation);
        if (!res.ok) toast(res.msg); else { toast('Stop removed, ' + fmt(res.refund) + ' back'); afterChange(); renderSheet(); }
        break;
      case 'clearlv': lv().mode = 'all'; lv().status = 'all'; lv().country = 'all'; lv().q = ''; saveLv(); renderSheet(); break;
      case 'selstation': selectStation(id); break;
      case 'skipgoal': {
        var sk = TGGoals.skip(state, id);
        if (sk) { toast('Skipped: ' + sk.title); scheduleSave(); renderSheet(); }
        break;
      }
      case 'gotospot': {
        var gg = state.goals && state.goals.active.filter(function (q) { return q.id === id; })[0];
        if (gg && gg.spot) { map.setView(map.unproject(L.point(centerPx.x + gg.spot.x, centerPx.y + gg.spot.y), Z), Math.max(map.getZoom(), 14), { animate: true }); ui.sheet = 'none'; renderSheet(); renderDock(); }
        break;
      }
      case 'rename': ui.renaming = true; renderSheet(); setTimeout(function () { var i = $('lineNameInput'); if (i) { i.focus(); i.select(); } }, 30); break;
      case 'srename': ui.renamingStation = true; renderSheet(); setTimeout(function () { var i = $('stationNameInput'); if (i) { i.focus(); i.select(); } }, 30); break;
      case 'scancel': ui.renamingStation = false; renderSheet(); break;
      case 'ssave': {
        var si = $('stationNameInput'), st2 = S.stationMap(state).get(ui.selStation);
        if (st2 && si) {
          var nm2 = si.value.trim().slice(0, 28);
          if (nm2) { st2.name = nm2; st2.named = true; st2.custom = true; }
          else { st2.custom = false; st2.named = false; st2.name = 'Stop ' + st2.id; queueName(st2.id); }   // back to the automatic street name
        }
        ui.renamingStation = false; renderSheet(); scheduleSave(); break;
      }
      case 'cancelrename': ui.renaming = false; renderSheet(); break;
      case 'saverename':
        var li = $('lineNameInput'), ln = S.lineById(state, ui.selLine);
        if (ln && li) { var nm = li.value.trim().slice(0, 24); if (nm) ln.name = nm; else delete ln.name; }
        ui.renaming = false; renderSheet(); renderBanner(); scheduleSave(); break;
      case 'newline': ui.sheet = 'newline'; renderSheet(); break;
      case 'export': exportSave(); break;
      case 'import': $('importFile').click(); break;
      case 'menu': save().then(function () { state = null; ui.sheet = 'none'; renderSheet(); $('start').className = 'overlay'; $('startMsg').textContent = ''; refreshContinue(); }); break;
      case 'snap': restoreSnapshot(t.getAttribute('data-slot')); break;
      case 'mode':
        res = S.startLine(state, t.getAttribute('data-mode'));
        if (!res.ok) return toast(res.msg);
        if (ui.pendingStation) {
          var add = S.addStopToLine(state, res.id, ui.pendingStation);
          if (!add.ok) toast(add.msg);
          ui.pendingStation = null;
        }
        startEditing(res.id); afterChange(); break;
      case 'colour': ui.pickingColor = !ui.pickingColor; renderSheet(); break;
      case 'setcolor': setLineColor(t.getAttribute('data-color')); break;
      case 'edit': startEditing(ui.selLine); break;
      case 'insert': startEditing(ui.selLine); ui.insertMode = true; renderBanner(); toast('Tap the map: the stop joins the nearest part of the line'); break;
      case 'done': finishEditing(); break;
      case 'undo':
        res = S.undoLastStop(state, ui.editing || ui.selLine);
        if (!res.ok) toast(res.msg); else afterChange();
        break;
      case 'reverse': S.reverseLine(state, ui.selLine); afterChange(); break;
      case 'delete':
        if (window.confirm('Delete this line? You get half the vehicle cost back.')) { S.deleteLine(state, ui.selLine); ui.selLine = null; ui.sheet = 'lines'; afterChange(); }
        break;
      case 'vplus': res = S.setVehicles(state, ui.selLine, 1); if (!res.ok) toast(res.msg); afterChange(); break;
      case 'vminus': res = S.setVehicles(state, ui.selLine, -1); if (!res.ok) toast(res.msg); afterChange(); break;
      case 'linefrom': ui.pendingStation = ui.selStation; ui.sheet = 'newline'; renderSheet(); break;
      case 'rmstation':
        res = S.removeStation(state, ui.selStation);
        if (!res.ok) toast(res.msg); else { ui.selStation = null; ui.sheet = 'none'; afterChange(); }
        break;
    }
  }

  /* ---------- save / load ---------- */
  var lastSnap = 0, saveFailed = false;
  function save() {
    if (!state) return Promise.resolve();
    var raw;
    try {
      var c = map.getCenter();
      raw = JSON.stringify({ state: state, view: { lat: c.lat, lng: c.lng, zoom: map.getZoom() }, dayProg: ui.dayProg, savedAt: Date.now() });
    } catch (e) { return Promise.resolve(); }
    var day = state.day, p = Store.put('main', raw).then(function (ok) {
      if (ok) { ui.lastSaved = Date.now(); saveFailed = false; if (ui.sheet === 'save') renderSheet(); }
      else if (!saveFailed) { saveFailed = true; toast('Could not save in this browser. Download a backup from the Save button.', 6000); }
    });
    if (Date.now() - lastSnap > 5 * 60 * 1000) { lastSnap = Date.now(); p = p.then(function () { return writeSnapshot(raw, day); }); }
    return p;
  }

  /* A few older copies of the save, so a mistake can be undone. */
  function readMeta() { return Store.get('snapmeta').then(function (m) { try { return m ? JSON.parse(m) : { n: 0, list: [] }; } catch (e) { return { n: 0, list: [] }; } }); }
  function writeSnapshot(raw, day) {
    return readMeta().then(function (meta) {
      var slot = 'snap' + (meta.n % 3);
      return Store.put(slot, raw).then(function (ok) {
        if (!ok) return;
        meta.list = meta.list.filter(function (e) { return e.slot !== slot; });
        meta.list.push({ slot: slot, day: day, at: Date.now() });
        meta.n += 1;
        return Store.put('snapmeta', JSON.stringify(meta));
      });
    });
  }
  function loadSnapshotList() {
    return readMeta().then(function (meta) { ui.snaps = meta.list.slice().sort(function (a, b) { return b.at - a.at; }); });
  }

  /* Resolves to the saved game or null. Moves a save from the old localStorage location when it finds one. */
  function loadSave() {
    return Store.get('main').then(function (raw) {
      if (raw) { try { return JSON.parse(raw); } catch (e) { return null; } }
      var old = null;
      try { old = window.localStorage.getItem(LEGACY_KEY); } catch (e) { /* ignore */ }
      if (!old) return null;
      var parsed; try { parsed = JSON.parse(old); } catch (e) { return null; }
      return Store.put('main', old).then(function (ok) {
        if (ok) { try { window.localStorage.removeItem(LEGACY_KEY); } catch (e) { /* ignore */ } }
        return parsed;
      });
    });
  }
  function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 600); }

  /* ---------- new game and start screen ---------- */
  function beginGame(st, view) {
    state = st;
    if (!state.chunks) state.chunks = {};
    centerPx = map.project(L.latLng(st.center.lat, st.center.lng), Z);
    map.setView(view ? [view.lat, view.lng] : [st.center.lat, st.center.lng], view ? view.zoom : 14, { animate: false });
    ui.editing = null; ui.selLine = null; ui.selStation = null; ui.sheet = 'none'; ui.tool = 'move'; ui.speed = 1;
    ui.hint = !st.lines.length;
    ui.lastS = 0;
    $('start').className = 'overlay hidden';
    $('over').className = 'overlay hidden';
    relayout(); state.stats = S.computeNetwork(state);
    if (window.TGGoals) { TGGoals.ensure(state); TGGoals.check(state); }
    updateHud(); renderDock(); renderSheet(); renderBanner();
    state.stations.forEach(function (x) { if (x.named && !x.custom && /^[A-Za-z]?\d{1,4}[A-Za-z]?$/.test(String(x.name).trim())) { x.named = false; x.name = 'Stop ' + x.id; } });
    nameQueue = []; queueUnnamed();
    upgradeOldSave(state);
    setTimeout(ensureView, 2500);
    if (state.over) showOver();
  }

  var OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
  var lastLoadError = '';
  var nextServer = 0;   // each request starts on the next server, so several at once spread out
  var skipHooks = [], skipping = false, skippedKeys = {};   // "Skip this area" cancels the running load and puts the area on a skip list
  function skipLoading() { skipping = true; skipHooks.slice().forEach(function (h) { h(); }); setTimeout(function () { skipping = false; }, 150); }

  /* Asks the servers, not all at once: the next one joins in if the first is slow (hedged request).
   * The first good answer wins and the others are cancelled. An answer that says the query timed out is treated as a failure. */
  function fetchOverpass(query, timeoutMs) {
    timeoutMs = timeoutMs || 60000;
    var hook = null, startAt = nextServer++;
    function drop() { var i = skipHooks.indexOf(hook); if (i >= 0) skipHooks.splice(i, 1); }
    var prom = new Promise(function (resolve, reject) {
      var ctls = [], timers = [], finished = false, failed = 0, started = 0, reason = '';
      hook = function () { if (finished) return; finished = true; stopAll(); reject(new Error('skipped')); };
      skipHooks.push(hook);
      if (skipping) { hook(); return; }
      function stopAll(except) {
        timers.forEach(clearTimeout);
        ctls.forEach(function (c) { if (c !== except) { try { c.abort(); } catch (e) { /* ignore */ } } });
      }
      function fail(why) {
        failed++; reason = why || reason;
        if (finished) return;
        if (started < OVERPASS.length) launch();                  // a server answered badly: try the next at once
        else if (failed >= started) { finished = true; stopAll(); reject(new Error(reason || 'failed')); }
      }
      function launch() {
        var i = started++;
        var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        if (ctl) ctls.push(ctl);
        var t = setTimeout(function () { if (ctl) try { ctl.abort(); } catch (e) { /* ignore */ } }, timeoutMs);
        timers.push(t);
        fetch(OVERPASS[(startAt + i) % OVERPASS.length], {
          method: 'POST', body: 'data=' + encodeURIComponent(query),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: ctl ? ctl.signal : undefined
        }).then(function (r) {
          if (!r.ok) throw new Error(r.status === 429 ? 'server busy' : r.status === 504 || r.status === 408 ? 'too heavy for the server' : 'server error ' + r.status);
          return r.json();
        }).then(function (json) {
          if (json && json.remark && /error|timed out|out of memory/i.test(json.remark)) throw new Error('too heavy for the server');
          if (finished) return;
          finished = true; stopAll(ctl); resolve(json);
        }).catch(function (e) {
          clearTimeout(t);
          fail(e && e.name === 'AbortError' ? 'timed out' : (e && e.message) || 'no connection');
        });
        if (started < OVERPASS.length) timers.push(setTimeout(function () { if (!finished && started < OVERPASS.length) launch(); }, 7000));
      }
      launch();
    });
    prom.then(drop, drop);
    return prom;
  }

  /* One chunk of the world. If the whole square is too heavy (a dense city), it is cut into four smaller squares, and again if needed.
   * Pieces that worked are remembered, so a retry only repeats the pieces that failed. */
  var pieceCache = new Map(), denseBoxes = {};
  function boxId(b) { return [b.s, b.w, b.n, b.e].map(function (v) { return v.toFixed(5); }).join(','); }
  function splitBox(b) {
    var mlat = (b.s + b.n) / 2, mlng = (b.w + b.e) / 2;
    return [{ s: b.s, n: mlat, w: b.w, e: mlng }, { s: b.s, n: mlat, w: mlng, e: b.e }, { s: mlat, n: b.n, w: b.w, e: mlng }, { s: mlat, n: b.n, w: mlng, e: b.e }];
  }
  function fetchBox(b, depth, startSplit) {
    var id = boxId(b);
    if (skipping) return Promise.reject(new Error('skipped'));
    if (pieceCache.has(id)) return Promise.resolve(pieceCache.get(id));
    startSplit = startSplit || !!denseBoxes[id];
    function pieces() {
      var out = [], chain = Promise.resolve();
      splitBox(b).forEach(function (q) {
        chain = chain.then(function () { return fetchBox(q, depth + 1, false); }).then(function (els) { out.push(els); });
      });
      return chain.then(function () { return [].concat.apply([], out); });
    }
    var run = startSplit && depth < 2 ? pieces() :
      fetchOverpass(TGOsm.buildQuery(b, depth ? 40 : 55), depth ? 45000 : 60000).then(function (json) { return json.elements || []; })
        .catch(function (e) { if (e && e.message === 'skipped') throw e; lastLoadError = e && e.message || ''; denseBoxes[id] = true; if (depth >= 2) throw e; return pieces(); });
    return run.then(function (els) { if (depth) pieceCache.set(id, els); return els; });
  }
  function fetchChunkElements(key) {
    return fetchBox(TGOsm.chunkBox(key), 0, false);
  }
  function fetchKeysElements(keys) {
    var seen = new Set(), all = [], chain = Promise.resolve();
    keys.forEach(function (k, i) {
      chain = chain.then(function () { setLoadTag(keys.length > 1 ? 'Loading homes and jobs ' + (i + 1) + '/' + keys.length + '…' : 'Loading homes and jobs…'); return fetchChunkElements(k); })
        .then(function (els) { els.forEach(function (e) { var id = e.type + e.id; if (!seen.has(id)) { seen.add(id); all.push(e); } }); });
    });
    return chain.then(function () { return all; });
  }

  /* ---------- real homes and jobs, loaded one chunk at a time ---------- */
  var chunkBusy = false, chunkFailed = {}, chunkTimer = null, LOAD_ZOOM = 13;
  var bulk = { on: false, left: 0, first: null, speed: 2 }, inFlight = {};
  function nBusy() { return Object.keys(inFlight).length; }
  try { var sp0 = +window.localStorage.getItem('transit-game-loadspeed'); if (sp0 >= 1 && sp0 <= 3) bulk.speed = sp0; } catch (e) { /* ignore */ }   // first = id of the stop whose area is loaded first

  /* Which map areas (chunks) the network needs: everything within reach of a stop on a working line. */
  function needInfo() {
    var sMap = S.stationMap(state), radius = {}, per = [], all = {};
    state.lines.forEach(function (Ln) {
      if (Ln.stations.length < 2) return;
      var r = MODES[Ln.mode].catchM;
      Ln.stations.forEach(function (id) { if (!radius[id] || radius[id] < r) radius[id] = r; });
    });
    Object.keys(radius).forEach(function (id) {
      var st = sMap.get(+id); if (!st) return;
      var ll = map.unproject(L.point(centerPx.x + st.x, centerPx.y + st.y), Z);
      var ks = TGOsm.chunksIn(TGOsm.bboxFor(ll.lat, ll.lng, radius[id]));
      var miss = ks.filter(function (k) { return !(state.chunks && state.chunks[k]); });
      ks.forEach(function (k) { all[k] = 1; });
      per.push({ id: st.id, name: st.name, total: ks.length, missing: miss.length, keys: miss, ll: ll });
    });
    var keys = Object.keys(all), missing = keys.filter(function (k) { return !(state.chunks && state.chunks[k]); });
    per = per.filter(function (x) { return x.missing > 0; }).sort(function (a, b) { return b.missing - a.missing; });
    return { total: keys.length, missing: missing, per: per };
  }
  function nearestStationName(key) {
    var b = TGOsm.chunkBox(key), p = projFn((b.s + b.n) / 2, (b.w + b.e) / 2), best = null, bd = Infinity;
    state.stations.forEach(function (st) { var d = Math.hypot(st.x - p.x, st.y - p.y); if (d < bd) { bd = d; best = st; } });
    return best ? best.name : 'the map';
  }
  function mapDataHtml() {
    if (!state || state.source !== 'osm' || !window.TGOsm || !centerPx) return '';
    var ni = needInfo(), loaded = ni.total - ni.missing.length, now = Date.now();
    var failed = ni.missing.filter(function (k) { return chunkFailed[k] && now - chunkFailed[k] < 90000; }).length;
    var pct = ni.total ? Math.round(100 * loaded / ni.total) : 100;
    var h = '<div class="muted small"><b>Map data</b> (homes and jobs)</div><div class="card mapdata">' +
      '<span class="lrow"><b>Around your stops</b><span class="grow"></span><span class="muted">' + loaded + ' of ' + ni.total + ' areas · ' + pct + '%</span></span>' +
      '<span class="bar"><i style="width:' + pct + '%"></i></span>';
    if (nBusy()) {
      Object.keys(inFlight).forEach(function (k) { h += '<span class="muted">Loading now: the area near ' + esc(nearestStationName(k)) + '</span>'; });
      h += '<button type="button" class="btn" data-act="skiparea">' + (nBusy() > 1 ? 'Skip these areas' : 'Skip this area') + '</button>';
    }
    else if (ni.missing.length && bulk.on) h += '<span class="muted">Waiting for the next area…</span>';
    else if (!ni.missing.length) h += '<span class="muted">Everything your stops can reach is loaded.</span>';
    else h += '<span class="muted">' + ni.missing.length + ' areas around your stops are not loaded yet. They load when you look at them, or all at once below.</span>';
    if (bulk.on && ni.missing.length) h += '<span class="muted small">While this runs, moving around the map does not load anything extra.</span>';
    var nSkipped = ni.missing.filter(function (k) { return skippedKeys[k]; }).length;
    if (nSkipped) h += '<span class="muted small">' + nSkipped + ' area' + (nSkipped > 1 ? 's' : '') + ' skipped.</span><button type="button" class="btn" data-act="unskip">Try the skipped areas again</button>';
    if (failed) h += '<span class="neg small">' + failed + ' area' + (failed > 1 ? 's' : '') + ' failed and will be tried again soon.</span>';
    if (ni.per.length) {
      h += '<span class="muted small"><b>Missing data near</b></span>';
      h += '<span class="muted small">Tap a stop to load its area first.</span>';
      ni.per.slice(0, 6).forEach(function (x) {
        var first = bulk.first === x.id;
        h += '<button type="button" class="lrow small pick' + (first ? ' on' : '') + '" data-act="loadfirst" data-id="' + x.id + '"><span>' + esc(x.name) + (first ? ' · loading first' : '') + '</span><span class="grow"></span><span class="muted">' + (x.total - x.missing) + ' of ' + x.total + '</span></button>';
      });
      if (ni.per.length > 6) h += '<span class="muted small">and ' + (ni.per.length - 6) + ' more stops</span>';
    }
    h += '<span class="muted small"><b>Loading speed</b> (how many areas at once)</span><span class="lrow speedrow">' +
      [[1, 'Careful'], [2, 'Normal'], [3, 'Fast']].map(function (o) { return '<button type="button" class="btn' + (bulk.speed === o[0] ? ' primary' : '') + '" data-act="speed" data-id="' + o[0] + '">' + o[1] + ' (' + o[0] + ')</button>'; }).join('') + '</span>';
    if (ni.missing.length) h += '<button type="button" class="btn big ' + (bulk.on ? '' : 'primary') + '" data-act="bulkload">' + (bulk.on ? 'Stop loading' : 'Load data around my stops') + '</button>';
    return h + '</div>';
  }
  function worldParams() {
    return { wy0: centerPx.y, wsz: 256 * Math.pow(2, Z) };
  }
  function projFn(la, lo) {
    var p = map.project(L.latLng(la, lo), Z);
    return { x: p.x - centerPx.x, y: p.y - centerPx.y };
  }
  function chunkPxBounds(key) {
    var b = TGOsm.chunkBox(key), a = projFn(b.n, b.w), c = projFn(b.s, b.e);
    return { x0: a.x, y0: a.y, x1: c.x, y1: c.y, midLat: (b.s + b.n) / 2 };
  }
  function setLoadTag(txt) {
    var el = $('loadTag'); if (!el) return;
    el.textContent = txt || ''; el.className = txt ? 'loadtag' : 'loadtag hidden';
  }

  function ensureView() {
    if (!state || chunkBusy || state.source !== 'osm' || !state.wsz || !state.popScale || !window.TGOsm) return;
    if ($('start').className.indexOf('hidden') < 0) return;
    var c = map.getCenter(), now = Date.now(), keys = [];
    function fresh(k) { return !(state.chunks && state.chunks[k]) && !inFlight[k] && !skippedKeys[k] && !(chunkFailed[k] && now - chunkFailed[k] < 90000); }
    if (map.getZoom() >= LOAD_ZOOM && !bulk.on) {   // while the queue runs, looking around the map loads nothing; it resumes when the queue is done or stopped
      var bd = map.getBounds();
      keys = TGOsm.chunksIn({ s: bd.getSouth(), n: bd.getNorth(), w: bd.getWest(), e: bd.getEast() }).filter(fresh);
    }
    if (!keys.length && bulk.on) {
      var ni = needInfo();
      bulk.left = ni.missing.length;
      var pri = bulk.first ? ni.per.filter(function (x) { return x.id === bulk.first; })[0] : null;
      if (bulk.first && !pri) bulk.first = null;                       // that stop is fully loaded
      if (pri) { keys = pri.keys.filter(fresh); if (keys.length) c = pri.ll; }
      if (!keys.length) keys = ni.missing.filter(fresh);
      if (!keys.length && ni.missing.length && ni.missing.every(function (k) { return skippedKeys[k]; })) { bulk.on = false; toast('Queue finished. Some areas were skipped.', 3500); if (ui.sheet === 'save') renderSheet(); }
      if (!ni.missing.length) { bulk.on = false; toast('All the data around your stops is loaded', 3500); if (ui.sheet === 'save') renderSheet(); }
    }
    var room = (bulk.on ? bulk.speed : 1) - nBusy();
    if (!keys.length || room <= 0) return;
    keys.sort(function (a, b) {
      function d(k) { var x = TGOsm.chunkBox(k); return Math.hypot((x.s + x.n) / 2 - c.lat, ((x.w + x.e) / 2 - c.lng) * Math.cos(c.lat * Math.PI / 180)); }
      return d(a) - d(b);
    });
    keys.slice(0, room).forEach(function (k) { loadChunks([k], state); });
  }

  function loadChunks(keys, st) {
    inFlight[keys[0]] = true; skipping = false;
    setLoadTag(bulk.on && bulk.left ? 'Loading map data, ' + bulk.left + ' areas left…' : 'Loading homes and jobs…');
    if (ui.sheet === 'save') renderSheet();
    return fetchKeysElements(keys).then(function (els) {
      if (st !== state) return;
      var added = 0;
      keys.forEach(function (k) {
        var bnd = chunkPxBounds(k);
        var blocks = TGOsm.buildChunkBlocks(els, projFn, mppAt(bnd.midLat), bnd, { popScale: st.popScale, jobScale: st.jobScale });
        blocks.forEach(function (b) { st.blocks.push(b); });
        added += blocks.length;
        st.chunks[k] = 1;
      });
      if (added) { st.stats = S.computeNetwork(st); updateHud(); scheduleSave(); }
    }).catch(function (e) {
      if (e && e.message === 'skipped') { keys.forEach(function (k) { skippedKeys[k] = true; }); toast('Skipped this area. You can load it later from the Menu.', 3500); return; }
      keys.forEach(function (k) { chunkFailed[k] = Date.now(); });
      toast('Could not load homes and jobs' + (lastLoadError ? ' (' + lastLoadError + ')' : '') + '. Will retry.', 4500);
      clearTimeout(chunkTimer); chunkTimer = setTimeout(ensureView, 95000);
    }).then(function () {
      delete inFlight[keys[0]]; if (!nBusy()) setLoadTag('');
      if (ui.sheet === 'save') renderSheet();
      setTimeout(ensureView, 1500);
    });
  }

  /* Games saved before the world map existed only have homes and jobs within 3.5 km of the start.
   * Give them true distances and load the wider area around the start, leaving their existing blocks alone. */
  function upgradeOldSave(st) {
    if (!st.wsz) { st.wy0 = centerPx.y; st.wsz = 256 * Math.pow(2, Z); st.cos0 = Math.cos(st.center.lat * Math.PI / 180); }
    if (!st.chunks) st.chunks = {};
    if (st.source !== 'osm' || st.popScale || !window.TGOsm) return;
    st.legacyR = TGOsm.CFG.startRadiusM / st.mpp;
    chunkBusy = true; setLoadTag('Loading homes and jobs…');
    var keys = TGOsm.chunksIn(TGOsm.bboxFor(st.center.lat, st.center.lng, TGOsm.CFG.startRadiusM));
    fetchKeysElements(keys).then(function (els) {
      if (st !== state) return;
      var cal = TGOsm.calibrate(els, projFn, st.mpp, TGOsm.CFG.startRadiusM);
      st.popScale = cal ? cal.popScale : TGOsm.CFG.defaultScale;
      st.jobScale = cal ? cal.jobScale : TGOsm.CFG.defaultScale;
      keys.forEach(function (k) {
        var bnd = chunkPxBounds(k);
        TGOsm.buildChunkBlocks(els, projFn, mppAt(bnd.midLat), bnd, { popScale: st.popScale, jobScale: st.jobScale }).forEach(function (b) {
          if (Math.hypot(b.x, b.y) >= st.legacyR) st.blocks.push(b);
        });
        st.chunks[k] = 1;
      });
      st.stats = S.computeNetwork(st); updateHud(); scheduleSave();
      toast('Loaded homes and jobs for the wider area.');
    }).catch(function () {
      toast('Could not load the wider area yet. Will retry next time you open the game.', 5000);
    }).then(function () { chunkBusy = false; setLoadTag(''); setTimeout(ensureView, 1500); });
  }

  function newGameAt(lat, lng) {
    var mpp = mppAt(lat), useReal = !$('realData') || $('realData').checked;
    centerPx = map.project(L.latLng(lat, lng), Z);
    var world = worldParams();
    function go(blocks, scales, keys) {
      var seed = (Date.now() & 0x7fffffff);
      var w = { wy0: world.wy0, wsz: world.wsz, popScale: scales ? scales.popScale : TGOsm.CFG.defaultScale, jobScale: scales ? scales.jobScale : TGOsm.CFG.defaultScale };
      var st = S.newState({ lat: lat, lng: lng }, mpp, seed, blocks, w);
      if (blocks && keys) keys.forEach(function (k) { st.chunks[k] = 1; });
      ui.dayProg = 0;
      chunkFailed = {};
      beginGame(st, null);
      save();
      if (useReal && !blocks) toast('Real building data was not available, using a generated city.');
      else if (blocks) toast('Homes and jobs loaded from OpenStreetMap.');
      setTimeout(ensureView, 2500);
    }
    if (!useReal || !window.TGOsm) { go(null, null, null); return; }
    $('startMsg').textContent = 'Loading buildings and land use from OpenStreetMap…';
    $('startBtn').disabled = true;
    var keys = TGOsm.chunksIn(TGOsm.bboxFor(lat, lng, TGOsm.CFG.startRadiusM));
    fetchKeysElements(keys).then(function (els) {
      var cal = TGOsm.calibrate(els, projFn, mpp, TGOsm.CFG.startRadiusM);
      if (!cal) return [null, null];
      var blocks = [];
      keys.forEach(function (k) {
        var bnd = chunkPxBounds(k);
        TGOsm.buildChunkBlocks(els, projFn, mppAt(bnd.midLat), bnd, cal).forEach(function (b) { blocks.push(b); });
      });
      return [blocks.length >= 8 ? blocks : null, cal];
    }).catch(function () { return [null, null]; }).then(function (r) {
      $('startBtn').disabled = false;
      $('startMsg').textContent = '';
      go(r[0], r[1], r[0] ? keys : null);
    });
  }

  function refreshContinue() {
    loadSave().then(function (saved) {
      var btn = $('continueBtn');
      if (saved && saved.state && saved.state.v === 1 && !saved.state.over) {
        btn.className = 'btn big';
        btn.onclick = function () { ui.dayProg = saved.dayProg || 0; beginGame(saved.state, saved.view); };
      } else btn.className = 'btn big hidden';
    });
  }

  function startFromSearch() {
    var q = $('place').value.trim(), msg = $('startMsg');
    if (!q) { msg.textContent = 'Type a city or place first.'; return; }
    msg.textContent = 'Searching…';
    $('startBtn').disabled = true;
    fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q))
      .then(function (r) { if (!r.ok) throw new Error('bad status'); return r.json(); })
      .then(function (res) {
        $('startBtn').disabled = false;
        if (!res.length) { msg.textContent = 'Could not find that place. Try adding the country.'; return; }
        $('offlineBtn').className = 'btn big hidden';
        msg.textContent = '';
        newGameAt(parseFloat(res[0].lat), parseFloat(res[0].lon));
      })
      .catch(function () {
        $('startBtn').disabled = false;
        msg.textContent = 'Search failed. Check your internet connection, or start in Dublin without searching.';
        $('offlineBtn').className = 'btn big';
      });
  }

  function showOver() {
    $('overText').textContent = 'You ran out of money on day ' + state.day + '. Your network carried ' + num(state.lifetimePax) + ' passengers in total.';
    $('over').className = 'overlay';
  }

  /* ---------- main loop ---------- */
  var lastT = performance.now(), saveAcc = 0;
  function frame(now) {
    var dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
    if (state && !state.over && ui.speed > 0 && $('start').className.indexOf('hidden') >= 0) {
      ui.dayProg += dt * ui.speed / DAY_SEC;
      if (ui.dayProg >= 1) { ui.dayProg = 0; dayEnd(); }
      $('dayBar').style.width = Math.round(ui.dayProg * 100) + '%';
      saveAcc += dt; if (saveAcc > 20) { saveAcc = 0; save(); }
    }
    draw(state && ui.speed > 0 && $('start').className.indexOf('hidden') >= 0 ? dt : 0);
    requestAnimationFrame(frame);
  }

  /* ---------- boot ---------- */
  /* Map tiles. With a free CARTO key we get the real dark map. Without one we use plain OpenStreetMap tiles
   * and darken them with a CSS filter, so the game still works. */
  var TILE_KEY = 'transit-game-tilekey', tileLayer = null, keyTimer = null;
  function getTileKey() { try { return (localStorage.getItem(TILE_KEY) || '').trim(); } catch (e) { return ''; } }
  function setTiles() {
    if (tileLayer) map.removeLayer(tileLayer);
    var key = getTileKey();
    document.body.classList.toggle('dimtiles', !key);
    tileLayer = key
      ? L.tileLayer('https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png?key=' + encodeURIComponent(key), { maxZoom: 20, attribution: '© OpenStreetMap contributors © CARTO' })
      : L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' });
    tileLayer.addTo(map);
    tileLayer.on('tileload', function () { tilesLoaded = true; });
    tileLayer.on('tileerror', function () { tileErrors++; if (key && tileErrors === 6 && !tilesLoaded) toast('Map tiles are not loading. Check the map key.', 6000); });
  }

  function init() {
    loadView();
    map = L.map('map', {
      zoomControl: false, zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 100,
      zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false,
      doubleClickZoom: false, boxZoom: false, minZoom: 3, maxZoom: 18, attributionControl: true
    }).setView([53.3498, -6.2603], 14);
    map.attributionControl.setPrefix(false);
    L.control.scale({ metric: true, imperial: false, position: 'bottomleft', maxWidth: 110 }).addTo(map);
    setTiles();
    centerPx = map.project(map.getCenter(), Z);

    canvas = $('overlay'); ctx = canvas.getContext('2d');
    resizeCanvas();
    map.on('resize', resizeCanvas);
    window.addEventListener('resize', function () { map.invalidateSize(); resizeCanvas(); });
    map.on('moveend', function () { clearTimeout(chunkTimer); chunkTimer = setTimeout(ensureView, 600); });
    map.on('click', function (e) { onTap(e.containerPoint); });
    map.on('mousemove', function (e) { ui.hover = e.containerPoint; });
    map.on('mouseout', function () { ui.hover = null; });

    $('sheet').addEventListener('click', onSheetClick);
    $('sheet').addEventListener('change', function (e) {
      if (e.target && e.target.id === 'lineColorInput') { setLineColor(e.target.value); return; }
      if (e.target && e.target.id === 'vehInput' && state && ui.selLine) {
        var vr = S.setVehicleCount(state, ui.selLine, e.target.value);
        if (!vr.ok) toast(vr.msg); else if (vr.msg) toast(vr.msg);
        e.target.blur(); afterChange(); renderSheet(); return;
      }
      var k = e.target && e.target.getAttribute && e.target.getAttribute('data-lv');
      if (!k || !state) return;
      lv()[k] = e.target.value; saveLv(); renderSheet();
    });
    $('sheet').addEventListener('input', function (e) {
      if (!e.target || e.target.id !== 'lineSearch' || !state) return;
      lv().q = e.target.value;
      var box = $('lineList'); if (box) box.innerHTML = lineListHtml();
    });
    $('sheet').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.id === 'stationNameInput') { e.preventDefault(); onSheetClick({ target: document.querySelector('[data-act=ssave]') }); }
      if (e.key === 'Enter' && e.target.id === 'vehInput') { e.preventDefault(); e.target.blur(); }
      if (e.key === 'Enter' && e.target.id === 'lineNameInput') { e.preventDefault(); onSheetClick({ target: document.querySelector('[data-act=saverename]') }); }
    });
    $('banner').addEventListener('click', onSheetClick);
    $('dock').addEventListener('click', function (e) {
      var b = e.target.closest('[data-dock]'); if (!b || !state) return;
      var a = b.getAttribute('data-dock');
      if (a === 'move') { ui.tool = 'move'; if (ui.editing) finishEditing(); ui.sheet = 'none'; ui.selLine = null; ui.selStation = null; renderSheet(); renderDock(); }
      else if (a === 'station') setTool('station');
      else if (a === 'lines') { if (ui.editing) finishEditing(); ui.tool = 'move'; ui.sheet = ui.sheet === 'lines' ? 'none' : 'lines'; ui.selStation = null; renderSheet(); renderDock(); }
      else if (a === 'demand') { ui.showDemand = !ui.showDemand; if (ui.showDemand) ui.legendHidden = false; saveView(); renderDock(); }
      else if (a === 'goals') { if (ui.editing) finishEditing(); ui.tool = 'move'; ui.sheet = ui.sheet === 'goals' ? 'none' : 'goals'; ui.selLine = null; ui.selStation = null; ui.renaming = false; if (ui.sheet === 'goals') ui.goalsSeen = true; renderSheet(); renderDock(); }
      else if (a === 'stats') { if (ui.editing) finishEditing(); ui.tool = 'move'; ui.sheet = ui.sheet === 'stats' ? 'none' : 'stats'; ui.selLine = null; ui.selStation = null; ui.renaming = false; renderSheet(); renderDock(); }
      else if (a === 'save') { if (ui.editing) finishEditing(); ui.tool = 'move'; ui.sheet = ui.sheet === 'save' ? 'none' : 'save'; ui.selLine = null; ui.selStation = null; renderSheet(); renderDock(); if (ui.sheet === 'save') loadSnapshotList().then(function () { if (ui.sheet === 'save') renderSheet(); }); }
    });
    document.querySelectorAll('[data-speed]').forEach(function (b) {
      b.addEventListener('click', function () { ui.speed = +b.getAttribute('data-speed'); updateHud(); });
    });
    window.addEventListener('keydown', function (e) {
      if (!state || e.target.tagName === 'INPUT') return;
      if (e.key === 'Escape') { if (ui.editing) finishEditing(); else { ui.tool = 'move'; ui.sheet = 'none'; ui.selLine = null; ui.selStation = null; renderSheet(); renderDock(); } }
      if (e.key === ' ') { e.preventDefault(); ui.speed = ui.speed === 0 ? 1 : 0; updateHud(); }
    });
    window.addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', function () { if (document.hidden) save(); });

    $('tileKey').value = getTileKey();
    function applyKey() {
      var v = $('tileKey').value.trim();
      try { localStorage.setItem(TILE_KEY, v); } catch (e) { /* ignore */ }
      tileErrors = 0; tilesLoaded = false;
      setTiles();
      $('startMsg').textContent = v ? 'Map key saved. The dark map shows once you start a game.' : 'Map key removed.';
    }
    $('tileKey').addEventListener('change', applyKey);
    $('tileKey').addEventListener('input', function () { clearTimeout(keyTimer); keyTimer = setTimeout(applyKey, 700); });
    $('legendClose').addEventListener('click', function () { ui.legendHidden = true; updateLegend(); });
    $('startBtn').addEventListener('click', startFromSearch);
    $('importBtn').addEventListener('click', function () { $('importFile').click(); });
    $('importFile').addEventListener('change', function () { importSave(this.files[0]); this.value = ''; });
    $('offlineBtn').addEventListener('click', function () { newGameAt(53.3498, -6.2603); });
    $('place').addEventListener('keydown', function (e) { if (e.key === 'Enter') startFromSearch(); });
    $('againBtn').addEventListener('click', function () { $('over').className = 'overlay hidden'; $('start').className = 'overlay'; state = null; });
    Store.persist();
    refreshContinue();
    renderDock();
    requestAnimationFrame(frame);
    try {
      if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) navigator.serviceWorker.register('sw.js').catch(function () {});
    } catch (e) { /* not available here */ }
  }

  window.addEventListener('load', init);
  /* test helper: draws every vehicle shape big on a given canvas */
  function shapeSheet(c) {
    var old = ctx, modes = ['bus', 'coach', 'tram', 'lightrail', 'metro', 'rail', 'intercity', 'ferry', 'plane'];
    ctx = c.getContext('2d'); ctx.fillStyle = '#222'; ctx.fillRect(0, 0, c.width, c.height);
    modes.forEach(function (m, i) {
      ctx.save(); ctx.translate(c.width / 2, 40 + i * 70); ctx.scale(2.5, 2.5);
      drawVehicleShape(m, 9 * (MODES[m].vlen || 2.8), 9 * 1.3, '#1E88E5', 0.7);
      ctx.restore();
      ctx.fillStyle = '#ccc'; ctx.font = '14px sans-serif'; ctx.fillText(m, 10, 45 + i * 70);
    });
    ctx = old;
  }
  window.TG = { shapeSheet: shapeSheet, get state() { return state; }, ui: ui, get gfx() { return gfx; }, get map() { return map; } };
})();
