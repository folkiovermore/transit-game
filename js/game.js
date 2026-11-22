/* Map, drawing, input and interface. Rules live in sim.js, routing in routing.js. */
(function () {
  'use strict';
  var R = window.TGRouting, S = window.TGSim;
  var MODES = S.MODES, BAL = S.BAL;
  var Z = 14;                       // reference zoom: all game coordinates are map pixels at this zoom
  var SAVE_KEY = 'transit-game-save-v1';
  var DAY_SEC = 40;                 // real seconds per game day at 1x
  var COLOR_NAMES = { '#FFCB0D': 'Yellow', '#E8472B': 'Red', '#2A64B0': 'Blue', '#3DAA5B': 'Green', '#F28A1E': 'Orange', '#9B5DE5': 'Purple', '#00BBF9': 'Cyan', '#F15BB5': 'Pink' };

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fmt(v) { return S.fmtMoney(v); }
  function num(v) { return Math.round(v).toLocaleString('en-IE'); }

  var map, canvas, ctx, dpr = 1;
  var state = null, centerPx = null;
  var gfx = new Map();
  var V = { cx: 0, cy: 0, s: 1, w: 0, h: 0 };
  var ui = { tool: 'move', editing: null, selLine: null, selStation: null, sheet: 'none', speed: 1, dayProg: 0, showDemand: true, hover: null, pendingStation: null, lastS: 0, hint: false };
  var saveTimer = null;
  var tileErrors = 0, tilesLoaded = false;
  function noTiles() { return tileErrors >= 4 && !tilesLoaded; }

  var ICON = {
    hand: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11m0-1.5v-3a1.5 1.5 0 0 1 3 0V11m0-3.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-1.5a5 5 0 0 1-4-2L4 14.5a1.6 1.6 0 0 1 2.5-2L8 14"/></svg>',
    pin: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="7"/><path d="M12 8v8M8 12h8"/></svg>',
    lines: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 18h6l4-4h6M4 6h8l4 4h4"/></svg>',
    eye: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    save: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14"/></svg>',
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
      var segs = R.buildSegments(pts, L.flips);
      var base = R.buildBasePath(pts, L.flips);
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
    state.blocks.forEach(function (b) {
      var p = toScreen(b);
      if (p.x < -60 || p.y < -60 || p.x > V.w + 60 || p.y > V.h + 60) return;
      var rp = Math.sqrt(b.pop) * 1.1 * V.s, rj = Math.sqrt(b.jobs) * 1.1 * V.s;
      if (rp > 1) { ctx.fillStyle = 'rgba(255,180,84,0.13)'; ctx.beginPath(); ctx.arc(p.x, p.y, rp, 0, 6.283); ctx.fill(); }
      if (rj > 1) { ctx.fillStyle = 'rgba(108,168,255,0.16)'; ctx.beginPath(); ctx.arc(p.x, p.y, rj, 0, 6.283); ctx.fill(); }
    });
  }

  function catchRadiusFor(sid) {
    var best = 0;
    state.lines.forEach(function (L) {
      if (L.stations.length >= 2 && L.stations.indexOf(sid) >= 0) best = Math.max(best, MODES[L.mode].catchM);
    });
    return best / state.mpp;
  }

  function drawCatchments() {
    var showAll = ui.tool === 'station' || ui.editing;
    state.stations.forEach(function (s) {
      var isSel = ui.selStation === s.id;
      if (!showAll && !isSel) return;
      var r = catchRadiusFor(s.id) || (MODES.bus.catchM / state.mpp);
      var p = toScreen(s);
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.setLineDash([6, 6]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(p.x, p.y, r * V.s, 0, 6.283); ctx.fill(); ctx.stroke();
      ctx.setLineDash([]);
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
      if (!g || g.path.length < 2) return;
      var dim = ui.selLine && ui.selLine !== L.id && !ui.editing ? 0.45 : 1;
      ctx.globalAlpha = dim;
      strokePath(g.path, lw, L.color);
      drawEndBar(g.path[0], g.path[1], lw, L.color);
      drawEndBar(g.path[g.path.length - 1], g.path[g.path.length - 2], lw, L.color);
      ctx.globalAlpha = 1;
    });
    if (ui.selLine) {
      var sg = gfx.get(ui.selLine), sl = S.lineById(state, ui.selLine);
      if (sg && sl && sg.path.length >= 2 && !ui.editing) {
        ctx.globalAlpha = 0.9;
        strokePath(sg.path, lw + 6, 'rgba(255,255,255,0.18)');
        strokePath(sg.path, lw, sl.color);
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
      for (var i = 0; i < L.vehicles; i++) {
        var ph = ((g.t + i / L.vehicles) % 1 + 1) % 1;
        var u = ph < 0.5 ? ph * 2 : 2 - ph * 2;
        var pt = R.pointAlong(g.path, u * g.len);
        var ang = pt.ang + (ph < 0.5 ? 0 : Math.PI);
        var p = toScreen(pt);
        var len = lw * (L.mode === 'bus' ? 1.7 : L.mode === 'tram' ? 2.2 : 2.8), wid = lw * 1.3;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(ang);
        ctx.fillStyle = '#F2F2F2'; ctx.strokeStyle = '#17181a'; ctx.lineWidth = 2;
        roundRect(-len / 2, -wid / 2, len, wid, 3); ctx.fill(); ctx.stroke();
        ctx.fillStyle = L.color; ctx.globalAlpha = 0.35 + 0.65 * load;
        roundRect(-len / 2 + 2, -wid / 2 + 2, Math.max(2, (len - 4)), wid - 4, 2); ctx.fill();
        ctx.globalAlpha = 1; ctx.restore();
      }
    });
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
    var front = pickEnd(L, target);
    var from = sMap.get(L.stations[front ? 0 : L.stations.length - 1]);
    var g = gfx.get(L.id), prevDir = null;
    if (g && g.base.length >= 2) {
      prevDir = front ? R.unit(g.base[1], g.base[0]) : R.unit(g.base[g.base.length - 2], g.base[g.base.length - 1]);
    }
    var seg = R.routeSegment(from, target, prevDir, false);
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
    var showNames = V.s >= 0.9;
    var editEnds = null, eL = ui.editing ? S.lineById(state, ui.editing) : null;
    if (eL && eL.stations.length) editEnds = { color: eL.color, ids: [eL.stations[0], eL.stations[eL.stations.length - 1]] };
    state.stations.forEach(function (s) {
      var p = toScreen(s);
      if (p.x < -40 || p.y < -40 || p.x > V.w + 40 || p.y > V.h + 40) return;
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
      var w = state.stats && state.stats.waiting[s.id];
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
    var best = null, bd = 26;
    state.stations.forEach(function (s) {
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
      var gf = gfx.get(L.id); if (!gf || gf.path.length < 2) return;
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
    var res = S.addStopToLine(state, L.id, sid, pickEnd(L, hit ? hit : g));
    if (!res.ok) {
      if (created) { state.stations.pop(); state.balance = before; }
      return toast(res.msg);
    }
    ui.hint = false;
    if (created) queueName(sid);
    toast('Stop added, ' + fmt(res.cost) + (res.note ? '. ' + res.note : ''));
    afterChange();
  }

  function setTool(t) {
    ui.tool = ui.tool === t ? 'move' : t;
    if (ui.editing) finishEditing();
    renderDock();
    if (ui.tool === 'station') toast('Tap the map to build stations');
  }

  function selectStation(id) {
    ui.selStation = id; ui.selLine = null; ui.sheet = 'station'; renderSheet(); renderDock();
  }
  function selectLine(id) {
    ui.selLine = id; ui.selStation = null; ui.sheet = 'line'; renderSheet();
  }

  function startEditing(lineId) {
    ui.editing = lineId; ui.selLine = lineId; ui.selStation = null; ui.sheet = 'none'; ui.tool = 'move';
    renderSheet(); renderBanner(); renderDock();
  }
  function finishEditing() {
    var L = S.lineById(state, ui.editing);
    ui.editing = null; ui.hover = null;
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
    state.stations.forEach(function (s) { if (!s.named) queueName(s.id); });
  }
  function pumpNames() {
    if (nameBusy || !nameQueue.length || !state) return;
    var st = state, id = nameQueue.shift();
    var s = S.stationMap(st).get(id);
    if (!s || s.named) return pumpNames();
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
    var base = a.road || a.pedestrian || a.footway || a.cycleway || a.path || a.neighbourhood || a.suburb || a.quarter || a.village || a.town || a.city_district || a.hamlet;
    if (!base) { s.named = true; return; }
    var area = a.suburb || a.neighbourhood || a.quarter || a.city_district || '';
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
    updateHud(); renderSheet(); renderBanner(); scheduleSave();
  }

  function dayEnd() {
    var events = S.endDay(state);
    events.forEach(function (ev) {
      if (ev.type === 'unlock') toast(MODES[ev.mode].name + ' unlocked!', 4200);
      if (ev.type === 'over') showOver();
    });
    if (state.balance < 0 && !state.over) toast('You are in debt. ' + (BAL.bankruptDays - state.negDays) + ' more day(s) and you go bankrupt', 4200);
    updateHud(); renderSheet(); save();
  }

  /* ---------- HUD, dock, banner, toast ---------- */
  function updateHud() {
    if (!state) return;
    $('hudDay').textContent = 'Day ' + state.day;
    var bal = $('hudBal'); bal.textContent = fmt(state.balance); bal.className = state.balance < 0 ? 'neg' : '';
    var st = state.stats || { riders: 0, profit: 0 };
    $('hudRiders').textContent = num(st.riders);
    var pr = $('hudProfit'); pr.textContent = (st.profit >= 0 ? '+' : '') + fmt(st.profit); pr.className = st.profit < 0 ? 'neg' : 'pos';
    $('dayBar').style.width = Math.round(ui.dayProg * 100) + '%';
    document.querySelectorAll('[data-speed]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(+b.getAttribute('data-speed') === ui.speed));
    });
  }

  function renderDock() {
    $('dock').innerHTML =
      dockBtn('move', ICON.hand, 'Move', ui.tool === 'move' && !ui.editing && ui.sheet !== 'lines') +
      dockBtn('station', ICON.pin, 'Station', ui.tool === 'station') +
      dockBtn('lines', ICON.lines, 'Lines', ui.sheet === 'lines' || ui.sheet === 'line' || ui.sheet === 'newline') +
      dockBtn('demand', ICON.eye, 'Demand', ui.showDemand) +
      dockBtn('save', ICON.save, 'Save', ui.sheet === 'save');
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
      b.innerHTML = '<span class="dot" style="background:' + L.color + '"></span><span class="btxt">' + COLOR_NAMES[L.color] + ' ' + MODES[L.mode].name.toLowerCase() + ' line. Tap the map near either end of the line to extend it, or tap an existing station.</span>' +
        '<button type="button" class="btn small" data-act="undo">Undo</button><button type="button" class="btn small primary" data-act="done">Done</button>';
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
  function lineName(L) { return COLOR_NAMES[L.color] + ' line'; }
  function profitHtml(v) { return '<span class="' + (v < 0 ? 'neg' : 'pos') + '">' + (v < 0 ? '−' : '+') + ' ' + fmt(Math.abs(v)) + '</span>'; }

  function renderSheet() {
    var el = $('sheet');
    if (!state || ui.sheet === 'none' || ui.editing) { el.className = 'sheet hidden'; el.innerHTML = ''; return; }
    el.className = 'sheet';
    var html = '';
    if (ui.sheet === 'lines') html = sheetLines();
    else if (ui.sheet === 'line') html = sheetLine();
    else if (ui.sheet === 'station') html = sheetStation();
    else if (ui.sheet === 'newline') html = sheetNewLine();
    else if (ui.sheet === 'save') html = sheetSave();
    el.innerHTML = html;
  }

  function head(title, sub, back) {
    return '<div class="shead">' + (back ? '<button type="button" class="iconbtn" data-act="' + back + '" aria-label="Back">‹</button>' : '') +
      '<div class="stitle"><h2>' + title + '</h2>' + (sub ? '<div class="muted">' + sub + '</div>' : '') + '</div>' +
      '<button type="button" class="iconbtn" data-act="close" aria-label="Close">' + ICON.close + '</button></div>';
  }

  function sheetSave() {
    return head('Save and backup', 'The game saves automatically in this browser. A backup file lets you keep a copy or move the game to another device.') +
      '<button type="button" class="btn big primary" data-act="export">Download backup file</button>' +
      '<button type="button" class="btn big" data-act="import">Load backup file…</button>' +
      '<div class="muted small">Loading a backup replaces the game you are playing now.</div>';
  }

  /* ---------- backup files ---------- */
  function exportSave() {
    if (state) save();
    var raw = null;
    try { raw = localStorage.getItem(SAVE_KEY); } catch (e) { /* ignore */ }
    if (!raw) return toast('Nothing to back up yet.');
    var day = 0; try { day = JSON.parse(raw).state.day; } catch (e) { /* ignore */ }
    var url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
    var a = document.createElement('a');
    a.href = url; a.download = 'transit-game-day-' + day + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    toast('Backup file downloaded.');
  }

  function importSave(file) {
    if (!file) return;
    var rd = new FileReader();
    rd.onerror = function () { toast('Could not read that file.'); };
    rd.onload = function () {
      var data;
      try { data = JSON.parse(rd.result); } catch (e) { return toast('That is not a Transit Game backup.'); }
      var st = data && data.state;
      if (!st || st.v !== 1 || !st.center || !Array.isArray(st.stations) || !Array.isArray(st.lines) || !Array.isArray(st.blocks)) return toast('That is not a Transit Game backup.');
      if (state && !confirm('Replace the game you are playing with this backup?')) return;
      try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch (e) { return toast('Could not store the backup.'); }
      ui.dayProg = data.dayProg || 0;
      beginGame(st, data.view);
      toast('Backup loaded, day ' + st.day + '.');
    };
    rd.readAsText(file);
  }

  function sheetLines() {
    var h = head('Lines', state.lines.length ? '' : 'You have no lines yet');
    state.lines.forEach(function (L) {
      var ls = (state.stats && state.stats.lines[L.id]) || { load: 0, profit: 0 };
      h += '<button type="button" class="card linecard" data-act="selline" data-id="' + L.id + '">' +
        '<span class="lrow"><span class="dot" style="background:' + L.color + '"></span><b>' + lineName(L) + '</b><span class="grow"></span>' + profitHtml(ls.profit) + '/day</span>' +
        '<span class="muted">' + MODES[L.mode].name + ' · ' + L.stations.length + ' stops · ' + L.vehicles + ' vehicles</span>' +
        '<span class="bar"><span style="width:' + Math.min(100, Math.round(ls.load * 100)) + '%;background:' + (ls.load > 0.85 ? '#F28A1E' : '#E9E9E9') + '"></span></span>' +
        '<span class="muted">' + Math.round(ls.load * 100) + '% full at peak</span></button>';
    });
    h += '<button type="button" class="btn big dashed" data-act="newline">+ New line</button>';
    return h;
  }

  function sheetNewLine() {
    var h = head('New line', ui.pendingStation ? 'Starting from the selected station' : 'Pick a transport mode', 'lines');
    S.MODE_ORDER.forEach(function (k) {
      var m = MODES[k], open = S.isUnlocked(state, k);
      h += '<button type="button" class="card modecard' + (open ? '' : ' locked') + '" data-act="mode" data-mode="' + k + '"' + (open ? '' : ' disabled') + '>' +
        '<span class="lrow"><b>' + m.name + '</b><span class="grow"></span><span class="muted">' + (open ? m.speed + ' km/h · ' + m.cap + ' seats' : 'Locked') + '</span></span>' +
        '<span class="muted">' + (open ? 'Track ' + fmt(m.trackKm) + '/km · stop ' + fmt(m.platform) + ' · vehicle ' + fmt(m.vehicle) + ' · stops at least ' + m.minSpacingM + ' m apart'
          : 'Unlocks at ' + num(m.unlockPax) + ' total passengers (' + num(state.lifetimePax) + ' so far)') + '</span></button>';
    });
    return h;
  }

  function sheetLine() {
    var L = S.lineById(state, ui.selLine);
    if (!L) return '';
    var m = MODES[L.mode], ls = (state.stats && state.stats.lines[L.id]) || { riders: 0, load: 0, profit: 0, cost: 0 };
    var km = S.lineLenPx(state, L) * state.mpp / 1000;
    var h = head('<span class="dot" style="background:' + L.color + '"></span> ' + lineName(L), m.name + ' · ' + L.stations.length + ' stops · ' + km.toFixed(1) + ' km', 'lines');
    h += '<div class="stats">' +
      '<div><b>' + num(ls.riders) + '</b><span>riders / day</span></div>' +
      '<div><b>' + Math.round(ls.load * 100) + '%</b><span>full at peak</span></div>' +
      '<div><b>' + profitHtml(ls.profit) + '</b><span>profit / day</span></div>' +
      '<div><b>' + fmt(ls.cost) + '</b><span>running cost / day</span></div></div>';
    h += '<div class="stepper"><span><b>Vehicles</b> <span class="muted">(' + fmt(m.vehicle) + ' each)</span></span><span class="grow"></span>' +
      '<button type="button" class="round" data-act="vminus" aria-label="Sell a vehicle">−</button><b class="vnum">' + L.vehicles + '</b>' +
      '<button type="button" class="round primary" data-act="vplus" aria-label="Buy a vehicle">+</button></div>';
    h += '<div class="btnrow"><button type="button" class="btn primary" data-act="edit">Add stops</button>' +
      '<button type="button" class="btn" data-act="undo">Undo last stop</button>' +
      '<button type="button" class="btn" data-act="reverse">Reverse</button>' +
      '<button type="button" class="btn danger" data-act="delete">Delete</button></div>';
    h += '<p class="muted small tip">Tip: tap a segment of this line on the map to flip its bend.</p>';
    return h;
  }

  function sheetStation() {
    var s = S.stationMap(state).get(ui.selStation);
    if (!s) return '';
    var serving = state.lines.filter(function (L) { return L.stations.indexOf(s.id) >= 0 && L.stations.length >= 2; });
    var r = catchRadiusFor(s.id) || MODES.bus.catchM / state.mpp, pop = 0, jobs = 0;
    state.blocks.forEach(function (b) { if (Math.hypot(b.x - s.x, b.y - s.y) <= r) { pop += b.pop; jobs += b.jobs; } });
    var waiting = state.stats && state.stats.waiting[s.id] || 0;
    var h = head(esc(s.name), serving.length ? 'Served by ' + serving.length + (serving.length > 1 ? ' lines' : ' line') : 'No lines yet');
    h += '<div class="chips">' + serving.map(function (L) { return '<span class="chip"><span class="dot" style="background:' + L.color + '"></span>' + COLOR_NAMES[L.color] + ' ' + MODES[L.mode].name + '</span>'; }).join('') + '</div>';
    h += '<div class="stats"><div><b>' + num(pop) + '</b><span>residents nearby</span></div><div><b>' + num(jobs) + '</b><span>jobs nearby</span></div>' +
      '<div><b>' + num(waiting) + '</b><span>left behind / day</span></div></div>';
    h += '<div class="btnrow"><button type="button" class="btn primary" data-act="linefrom">New line from here</button>' +
      (serving.length ? '' : '<button type="button" class="btn danger" data-act="rmstation">Remove station</button>') + '</div>';
    return h;
  }

  function onSheetClick(e) {
    var t = e.target.closest('[data-act]'); if (!t || !state) return;
    var act = t.getAttribute('data-act'), id = +t.getAttribute('data-id');
    var res;
    switch (act) {
      case 'close': ui.sheet = 'none'; ui.selLine = null; ui.selStation = null; ui.pendingStation = null; renderSheet(); renderDock(); break;
      case 'lines': ui.sheet = 'lines'; ui.selStation = null; ui.pendingStation = null; renderSheet(); renderDock(); break;
      case 'selline': selectLine(id); break;
      case 'newline': ui.sheet = 'newline'; renderSheet(); break;
      case 'export': exportSave(); break;
      case 'import': $('importFile').click(); break;
      case 'mode':
        res = S.startLine(state, t.getAttribute('data-mode'));
        if (!res.ok) return toast(res.msg);
        if (ui.pendingStation) {
          var add = S.addStopToLine(state, res.id, ui.pendingStation);
          if (!add.ok) toast(add.msg);
          ui.pendingStation = null;
        }
        startEditing(res.id); afterChange(); break;
      case 'edit': startEditing(ui.selLine); break;
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
  function save() {
    if (!state) return;
    try {
      var c = map.getCenter();
      localStorage.setItem(SAVE_KEY, JSON.stringify({ state: state, view: { lat: c.lat, lng: c.lng, zoom: map.getZoom() }, dayProg: ui.dayProg }));
    } catch (e) { /* storage full or blocked: ignore */ }
  }
  function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 600); }
  function loadSave() {
    try { var raw = localStorage.getItem(SAVE_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }

  /* ---------- new game and start screen ---------- */
  function beginGame(st, view) {
    state = st;
    centerPx = map.project(L.latLng(st.center.lat, st.center.lng), Z);
    map.setView(view ? [view.lat, view.lng] : [st.center.lat, st.center.lng], view ? view.zoom : 14, { animate: false });
    ui.editing = null; ui.selLine = null; ui.selStation = null; ui.sheet = 'none'; ui.tool = 'move'; ui.speed = 1;
    ui.hint = !st.lines.length;
    ui.lastS = 0;
    $('start').className = 'overlay hidden';
    $('over').className = 'overlay hidden';
    relayout(); state.stats = S.computeNetwork(state);
    updateHud(); renderDock(); renderSheet(); renderBanner();
    nameQueue = []; queueUnnamed();
    if (state.over) showOver();
  }

  var OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

  function fetchOverpass(query, i) {
    i = i || 0;
    var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 45000);
    return fetch(OVERPASS[i], {
      method: 'POST', body: 'data=' + encodeURIComponent(query),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: ctl ? ctl.signal : undefined
    }).then(function (r) { clearTimeout(timer); if (!r.ok) throw new Error('status ' + r.status); return r.json(); })
      .catch(function (e) {
        clearTimeout(timer);
        if (i + 1 < OVERPASS.length) return fetchOverpass(query, i + 1);
        throw e;
      });
  }

  /* Resolves to a list of blocks, or null when real data is unavailable. */
  function loadCityBlocks(lat, lng, mpp) {
    if (!window.TGOsm) return Promise.resolve(null);
    var bb = TGOsm.bboxFor(lat, lng, TGOsm.CFG.radiusM);
    return fetchOverpass(TGOsm.buildQuery(bb)).then(function (json) {
      var res = TGOsm.buildBlocks(json.elements || [], function (la, lo) {
        var p = map.project(L.latLng(la, lo), Z);
        return { x: p.x - centerPx.x, y: p.y - centerPx.y };
      }, mpp);
      return res ? res.blocks : null;
    }).catch(function () { return null; });
  }

  function newGameAt(lat, lng) {
    var mpp = mppAt(lat), useReal = !$('realData') || $('realData').checked;
    function go(blocks) {
      var st = S.newState({ lat: lat, lng: lng }, mpp, (Date.now() & 0x7fffffff), blocks);
      ui.dayProg = 0;
      beginGame(st, null);
      save();
      if (useReal && !blocks) toast('Real building data was not available, using a generated city.');
      else if (blocks) toast('Homes and jobs loaded from OpenStreetMap.');
    }
    if (!useReal) { go(null); return; }
    centerPx = map.project(L.latLng(lat, lng), Z);
    $('startMsg').textContent = 'Loading buildings and land use from OpenStreetMap…';
    $('startBtn').disabled = true;
    loadCityBlocks(lat, lng, mpp).then(function (blocks) {
      $('startBtn').disabled = false;
      $('startMsg').textContent = '';
      go(blocks);
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
    map = L.map('map', {
      zoomControl: false, zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 100,
      zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false,
      doubleClickZoom: false, boxZoom: false, minZoom: 10, maxZoom: 18, attributionControl: true
    }).setView([53.3498, -6.2603], 14);
    map.attributionControl.setPrefix(false);
    setTiles();
    centerPx = map.project(map.getCenter(), Z);

    canvas = $('overlay'); ctx = canvas.getContext('2d');
    resizeCanvas();
    map.on('resize', resizeCanvas);
    window.addEventListener('resize', function () { map.invalidateSize(); resizeCanvas(); });
    map.on('click', function (e) { onTap(e.containerPoint); });
    map.on('mousemove', function (e) { ui.hover = e.containerPoint; });
    map.on('mouseout', function () { ui.hover = null; });

    $('sheet').addEventListener('click', onSheetClick);
    $('banner').addEventListener('click', onSheetClick);
    $('dock').addEventListener('click', function (e) {
      var b = e.target.closest('[data-dock]'); if (!b || !state) return;
      var a = b.getAttribute('data-dock');
      if (a === 'move') { ui.tool = 'move'; if (ui.editing) finishEditing(); ui.sheet = 'none'; ui.selLine = null; ui.selStation = null; renderSheet(); renderDock(); }
      else if (a === 'station') setTool('station');
      else if (a === 'lines') { if (ui.editing) finishEditing(); ui.tool = 'move'; ui.sheet = ui.sheet === 'lines' ? 'none' : 'lines'; ui.selStation = null; renderSheet(); renderDock(); }
      else if (a === 'demand') { ui.showDemand = !ui.showDemand; renderDock(); }
      else if (a === 'save') { if (ui.editing) finishEditing(); ui.tool = 'move'; ui.sheet = ui.sheet === 'save' ? 'none' : 'save'; ui.selLine = null; ui.selStation = null; renderSheet(); renderDock(); }
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
    $('startBtn').addEventListener('click', startFromSearch);
    $('importBtn').addEventListener('click', function () { $('importFile').click(); });
    $('importFile').addEventListener('change', function () { importSave(this.files[0]); this.value = ''; });
    $('offlineBtn').addEventListener('click', function () { newGameAt(53.3498, -6.2603); });
    $('place').addEventListener('keydown', function (e) { if (e.key === 'Enter') startFromSearch(); });
    $('againBtn').addEventListener('click', function () { $('over').className = 'overlay hidden'; $('start').className = 'overlay'; state = null; });
    var saved = loadSave();
    if (saved && saved.state && saved.state.v === 1 && !saved.state.over) {
      $('continueBtn').className = 'btn big';
      $('continueBtn').addEventListener('click', function () { ui.dayProg = saved.dayProg || 0; beginGame(saved.state, saved.view); });
    }
    renderDock();
    requestAnimationFrame(frame);
    try {
      if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) navigator.serviceWorker.register('sw.js').catch(function () {});
    } catch (e) { /* not available here */ }
  }

  window.addEventListener('load', init);
  window.TG = { get state() { return state; }, ui: ui, get gfx() { return gfx; } };
})();
