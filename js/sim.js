/* Game rules and economy. Pure functions on a plain JSON state, no DOM.
 * All tuning numbers live in MODES and BAL so they are easy to change. */
(function (root) {
  'use strict';

  var MODES = {
    bus:   { name: 'Bus',   speed: 20, cap: 80,  trackKm: 80000,   platform: 8000,   vehicle: 120000,  vehicleDay: 250,  maintKmDay: 15,  minSpacingM: 40,   dwellMin: 0.6, catchM: 550, unlockPax: 0 },
    tram:  { name: 'Tram',  speed: 30, cap: 200, trackKm: 600000,  platform: 60000,  vehicle: 700000,  vehicleDay: 600,  maintKmDay: 120, minSpacingM: 100,  dwellMin: 0.8, catchM: 700, unlockPax: 15000 },
    rail:  { name: 'Rail',  speed: 80, cap: 600, trackKm: 1500000, platform: 250000, vehicle: 1800000, vehicleDay: 1400, maintKmDay: 300, minSpacingM: 400, dwellMin: 1.5, catchM: 1100, unlockPax: 100000 },
    metro: { name: 'Metro', speed: 55, cap: 800, trackKm: 3500000, platform: 500000, vehicle: 2500000, vehicleDay: 1800, maintKmDay: 500, minSpacingM: 300,  dwellMin: 1.0, catchM: 900, unlockPax: 300000 }
  };
  MODES.rail.name = 'Commuter rail';
  MODES.lightrail = { name: 'Light rail', speed: 40, cap: 400, trackKm: 1100000, platform: 150000, vehicle: 1400000, vehicleDay: 800, maintKmDay: 180, minSpacingM: 300, dwellMin: 0.9, catchM: 800, unlockPax: 50000 };
  MODES.intercity = { name: 'Intercity rail', speed: 160, cap: 700, trackKm: 1200000, platform: 800000, vehicle: 4000000, vehicleDay: 2500, maintKmDay: 100, minSpacingM: 8000, dwellMin: 4, catchM: 1500, unlockPax: 1500000 };
  MODES.ferry = { name: 'Ferry', speed: 25, cap: 300, trackKm: 150000, platform: 300000, vehicle: 1500000, vehicleDay: 700, maintKmDay: 20, minSpacingM: 500, dwellMin: 3, catchM: 700, unlockPax: 40000 };
  MODES.coach = { name: 'Coach', speed: 70, cap: 50, trackKm: 120000, platform: 40000, vehicle: 260000, vehicleDay: 420, maintKmDay: 25, minSpacingM: 5000, dwellMin: 6, catchM: 1000, unlockPax: 75000 };
  MODES.plane = { name: 'Plane', speed: 650, cap: 180, trackKm: 3000, platform: 20000000, platDay: 15000, vehicle: 15000000, vehicleDay: 60000, fareMult: 0.2, maintKmDay: 0, minSpacingM: 150000, dwellMin: 35, catchM: 25000, unlockPax: 3000000, straight: true };
  MODES.bus.vlen = 1.7; MODES.coach.vlen = 2.4; MODES.plane.vlen = 3.4; MODES.tram.vlen = 2.2; MODES.lightrail.vlen = 2.6; MODES.metro.vlen = 2.8; MODES.rail.vlen = 3.2; MODES.intercity.vlen = 3.6; MODES.ferry.vlen = 2.4;
  var MODE_ORDER = ['bus', 'tram', 'lightrail', 'coach', 'rail', 'metro', 'intercity', 'ferry', 'plane'];

  var BAL = {
    startBalance: 3000000,
    stationCost: 20000,
    stationDay: 8,
    platformDay: 12,
    fareBase: 4,
    fareKm: 1.0,
    tripRate: 0.6,
    gravityM: 4000,
    peakShare: 0.35,
    peakHours: 3,
    operHours: 18,
    transferMin: 5,
    waitMin: 4,
    minStationGapM: 40,
    maxVehicles: 150,
    bankruptDays: 3,
    maxBlocks: 1500,
    growthCap: 4,              // a block can grow to this many times its size when it appeared
    growthServedBonus: 1.5,    // the ceiling is this much higher while a working stop is within reach
    longRate: 0.04,            // share of residents who make a long-distance trip each day
    longGravityM: 120000,      // how quickly long-distance demand falls off with distance
    longMinM: 25000,           // trips shorter than this are covered by the local model
    longCellM: 8000,
    airRate: 0.004,            // share of residents who take a flight each day (only counts places served by a plane line)
    airGravityM: 1500000,      // flights fall off with distance much more slowly than ground trips
    airMinM: 300000,           // closer than this, flying is not worth it
    airMetroM: 60000           // how far around an airport counts as the place you are flying to
  };

  var COLORS = ['#FFCB0D', '#E8472B', '#2A64B0', '#3DAA5B', '#F28A1E', '#9B5DE5', '#00BBF9', '#F15BB5'];

  /* Optional extensions (events, seasons, goals) plug in here; see js/goals.js. */
  var HOOKS = {};
  var NOFX = { demand: 1, cost: 1, fare: 1, cap: {}, strike: {}, closed: {}, spots: [] };
  function getFx(state) { return (HOOKS.fx && HOOKS.fx(state)) || NOFX; }

  /* ---------- helpers ---------- */
  function rng(state) {
    return function () {
      state.seed = (state.seed + 0x6D2B79F5) | 0;
      var t = Math.imul(state.seed ^ (state.seed >>> 15), 1 | state.seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(r) { return Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r()); }

  function edgeLenPx(a, b) {
    var adx = Math.abs(b.x - a.x), ady = Math.abs(b.y - a.y);
    var dmin = Math.min(adx, ady), dmax = Math.max(adx, ady);
    return dmin * Math.SQRT2 + (dmax - dmin);
  }
  /* Metres per game pixel at a given y. The map is Web Mercator, so real distances shrink towards the poles. */
  function mScale(state, y) {
    if (!state.wsz) return state.mpp;
    var n = Math.PI * (1 - 2 * (state.wy0 + y) / state.wsz);
    return state.mpp * Math.cos(Math.atan(Math.sinh(n))) / state.cos0;
  }
  /* straight = true for planes: they fly in a straight line instead of bending at 45 degrees. */
  function edgeLenFor(a, b, straight) { return straight ? Math.hypot(b.x - a.x, b.y - a.y) : edgeLenPx(a, b); }
  function edgeM(state, a, b, straight) { return edgeLenFor(a, b, straight) * mScale(state, (a.y + b.y) / 2); }
  function stationMap(state) {
    var m = new Map();
    state.stations.forEach(function (s) { m.set(s.id, s); });
    return m;
  }
  function lineLenPx(state, line, sMap) {
    sMap = sMap || stationMap(state);
    var s = 0;
    for (var i = 0; i < line.stations.length - 1; i++) s += edgeLenFor(sMap.get(line.stations[i]), sMap.get(line.stations[i + 1]), MODES[line.mode].straight);
    return s;
  }
  function lineLenM(state, line, sMap) {
    sMap = sMap || stationMap(state);
    var s = 0;
    for (var i = 0; i < line.stations.length - 1; i++) s += edgeM(state, sMap.get(line.stations[i]), sMap.get(line.stations[i + 1]), MODES[line.mode].straight);
    return s;
  }
  function roundTripHours(state, line, sMap) {
    var m = MODES[line.mode];
    var km = lineLenM(state, line, sMap) / 1000;
    return Math.max(0.05, 2 * km / m.speed + 2 * line.stations.length * m.dwellMin / 60);
  }
  function peakCapacity(state, line, sMap) {
    var m = MODES[line.mode];
    return line.vehicles * m.cap * BAL.peakHours / roundTripHours(state, line, sMap);
  }

  /* ---------- state ---------- */
  function newState(center, mpp, seed, blocks, world) {
    var st = {
      v: 1, seed: seed | 0, day: 1, balance: BAL.startBalance, lifetimePax: 0, negDays: 0, over: false,
      center: center, mpp: mpp, nextId: 1,
      stations: [], lines: [], blocks: [], stats: null, history: [], source: 'generated', chunks: {},
      gv: 2   // growth ceiling in force from the start (older saves have no gv and are converted on the first day)
    };
    if (world) { st.wy0 = world.wy0; st.wsz = world.wsz; st.cos0 = Math.cos(center.lat * Math.PI / 180); st.popScale = world.popScale; st.jobScale = world.jobScale; }
    if (blocks && blocks.length) { st.blocks = blocks.slice(); st.source = 'osm'; }
    else genBlocks(st, 70);
    st.stats = computeNetwork(st);
    return st;
  }

  /* Homes and jobs. Jobs cluster in the middle, homes spread outwards. */
  function genBlocks(state, count) {
    var r = rng(state);
    var sigma = 1400 / state.mpp;
    for (var i = 0; i < count; i++) {
      var ang = r() * Math.PI * 2;
      var dist = Math.abs(gauss(r)) * sigma;
      var core = Math.exp(-dist / sigma);
      state.blocks.push({
        x: Math.cos(ang) * dist, y: Math.sin(ang) * dist,
        pop: Math.round(60 + r() * 220 * (0.4 + 0.6 * (1 - core * 0.4))),
        jobs: Math.round(15 + r() * 160 * (0.3 + 1.7 * core))
      });
    }
  }

  function reachList(state, sMap, onlyLine) {
    sMap = sMap || stationMap(state);
    var best = new Map(), fx = getFx(state);
    state.lines.forEach(function (L) {
      if (L.stations.length < 2 || (onlyLine !== undefined && L.id !== onlyLine) || fx.strike[L.id]) return;
      var cm = MODES[L.mode].catchM;
      L.stations.forEach(function (id) { if (fx.closed[id]) return; if (!best.has(id) || best.get(id) < cm) best.set(id, cm); });
    });
    var out = [];
    best.forEach(function (cm, id) { var s = sMap.get(id); if (s) out.push({ id: id, x: s.x, y: s.y, r: cm / mScale(state, s.y) }); });
    return out;
  }
  function nearestReach(b, reach) {
    var best = null, bd = Infinity, bxx = b.x, byy = b.y;
    for (var i = 0; i < reach.length; i++) {
      var R = reach[i], dx = bxx - R.x, dy = byy - R.y;
      if (dx > R.r || dx < -R.r || dy > R.r || dy < -R.r) continue;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d <= R.r && d < bd) { bd = d; best = R.id; }
    }
    return best;
  }

  /* How much of the population and the jobs lie within walking distance of a stop on a working line. */
  function coverage(state, onlyLine) {
    var reach = reachList(state, null, onlyLine), c = { pop: 0, popReached: 0, jobs: 0, jobsReached: 0 };
    state.blocks.forEach(function (b) {
      c.pop += b.pop; c.jobs += b.jobs;
      if (nearestReach(b, reach) !== null) { c.popReached += b.pop; c.jobsReached += b.jobs; }
    });
    return c;
  }

  /* ---------- the daily network calculation ---------- */
  function computeNetwork(state) {
    var sMap = stationMap(state);
    var fx = getFx(state);
    var reach = reachList(state, sMap);
    var lines = state.lines.filter(function (L) { return L.stations.length >= 2 && !fx.strike[L.id]; });
    var spotMult = state.blocks.map(function (b) {
      var m = 1;
      for (var q = 0; q < fx.spots.length; q++) {
        var sp = fx.spots[q];
        if (Math.hypot(b.x - sp.x, b.y - sp.y) * mScale(state, b.y) <= sp.r) m = Math.max(m, sp.mult);
      }
      return m;
    });

    var nodes = [], nodeIdx = new Map(), atStation = new Map();
    function node(sid, lid) {
      var k = sid + '|' + lid;
      if (!nodeIdx.has(k)) {
        nodeIdx.set(k, nodes.length);
        nodes.push({ sid: sid, lid: lid });
        if (!atStation.has(sid)) atStation.set(sid, []);
        atStation.get(sid).push(nodes.length - 1);
      }
      return nodeIdx.get(k);
    }
    var adj = [];
    function addEdge(a, b, w, edge) {
      while (adj.length < nodes.length) adj.push([]);
      adj[a].push({ to: b, w: w, edge: edge });
    }
    var lineInfo = new Map();
    lines.forEach(function (L) {
      var m = MODES[L.mode];
      lineInfo.set(L.id, { line: L, peakCap: peakCapacity(state, L, sMap) * (fx.cap[L.id] || 1), lenKm: lineLenM(state, L, sMap) / 1000 });
      for (var i = 0; i < L.stations.length; i++) node(L.stations[i], L.id);
      for (var j = 0; j < L.stations.length - 1; j++) {
        var a = sMap.get(L.stations[j]), b = sMap.get(L.stations[j + 1]);
        var km = edgeM(state, a, b, m.straight) / 1000;
        var w = km / m.speed * 60 + m.dwellMin;
        var na = node(a.id, L.id), nb = node(b.id, L.id);
        addEdge(na, nb, w, { lid: L.id, i: j, dir: 0, km: km });
        addEdge(nb, na, w, { lid: L.id, i: j, dir: 1, km: km });
      }
    });
    while (adj.length < nodes.length) adj.push([]);
    atStation.forEach(function (list) {
      for (var x = 0; x < list.length; x++) for (var y = 0; y < list.length; y++) {
        if (x !== y) addEdge(list[x], list[y], BAL.transferMin, null);
      }
    });

    // trips between stations (gravity model between homes and jobs)
    var homeSt = state.blocks.map(function (b) { return nearestReach(b, reach); });
    var od = new Map();
    var D0c = BAL.gravityM / state.mpp;                 // grid size only; the exact scale is worked out per origin
    var potential = 0, captured = 0;
    var CELL = D0c * 1.5, grid = new Map(), NB = state.blocks.length;
    // flat arrays and numeric keys keep this loop fast; it is the most expensive part of the day
    var bx = new Float64Array(NB), by = new Float64Array(NB), bjw = new Float64Array(NB), bst = new Int32Array(NB);
    var stIdx = new Map(), stIds = [];
    for (var hi0 = 0; hi0 < NB; hi0++) {
      var bb = state.blocks[hi0];
      bx[hi0] = bb.x; by[hi0] = bb.y; bjw[hi0] = bb.jobs * spotMult[hi0];
      var hs = homeSt[hi0];
      if (hs === null) bst[hi0] = -1;
      else { var si0 = stIdx.get(hs); if (si0 === undefined) { si0 = stIds.length; stIdx.set(hs, si0); stIds.push(hs); } bst[hi0] = si0; }
      if (!(bb.jobs > 0)) continue;
      var k = (Math.floor(bb.x / CELL) + 200000) * 400009 + (Math.floor(bb.y / CELL) + 200000);
      var g = grid.get(k); if (!g) { g = []; grid.set(k, g); }
      g.push(hi0);
    }
    var nearIdx = new Int32Array(NB), nearW = new Float64Array(NB);
    var acc = new Float64Array(stIds.length), touched = new Int32Array(stIds.length);
    state.blocks.forEach(function (h, hi) {
      var trips = h.pop * BAL.tripRate * fx.demand * spotMult[hi];
      potential += trips;
      var so = homeSt[hi];
      if (so === null) return;
      var D0 = BAL.gravityM / mScale(state, h.y), invD0 = 1 / D0, hx = h.x, hy = h.y;
      var cx = Math.floor(hx / CELL), cy = Math.floor(hy / CELL), nn = 0, wsum = 0;
      for (var gx = cx - 4; gx <= cx + 4; gx++) for (var gy = cy - 4; gy <= cy + 4; gy++) {
        // skip cells so far away that their weight is below 0.3% of a block next door
        var ddx = gx * CELL > hx ? gx * CELL - hx : ((gx + 1) * CELL < hx ? hx - (gx + 1) * CELL : 0);
        var ddy = gy * CELL > hy ? gy * CELL - hy : ((gy + 1) * CELL < hy ? hy - (gy + 1) * CELL : 0);
        if ((ddx * ddx + ddy * ddy) * invD0 * invD0 > 36) continue;
        var cell = grid.get((gx + 200000) * 400009 + (gy + 200000));
        if (!cell) continue;
        for (var q = 0; q < cell.length; q++) {
          var j = cell[q], dx = hx - bx[j], dy = hy - by[j];
          var w = bjw[j] * Math.exp(-Math.sqrt(dx * dx + dy * dy) * invD0);
          wsum += w; nearIdx[nn] = j; nearW[nn] = w; nn++;
        }
      }
      if (wsum <= 0) return;
      var soI = stIdx.get(so), nt = 0, scale = trips / wsum;
      for (var n = 0; n < nn; n++) {
        var sdI = bst[nearIdx[n]];
        if (sdI < 0 || sdI === soI) continue;
        if (acc[sdI] === 0) touched[nt++] = sdI;
        acc[sdI] += nearW[n];
      }
      for (var u = 0; u < nt; u++) {
        var sI = touched[u], key = so + '|' + stIds[sI];
        od.set(key, (od.get(key) || 0) + acc[sI] * scale);
        acc[sI] = 0;
      }
    });

    // long-distance trips between far-apart places (only between stations that are on the network)
    (function () {
      var popAt = new Map(), attrAt = new Map(), cells = new Map(), cellPx = BAL.longCellM / state.mpp;
      state.blocks.forEach(function (b, i) {
        var a = b.jobs + 0.3 * b.pop;
        var key = Math.floor(b.x / cellPx) + ',' + Math.floor(b.y / cellPx), c = cells.get(key);
        if (!c) { c = { x: 0, y: 0, w: 0 }; cells.set(key, c); }
        c.x += b.x * a; c.y += b.y * a; c.w += a;
        var st = homeSt[i];
        if (st !== null) { popAt.set(st, (popAt.get(st) || 0) + b.pop); attrAt.set(st, (attrAt.get(st) || 0) + a); }
      });
      if (popAt.size < 1 || attrAt.size < 2) return;
      var far = [];
      cells.forEach(function (c) { if (c.w > 0) far.push({ x: c.x / c.w, y: c.y / c.w, w: c.w }); });
      function distM(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by) * mScale(state, (ay + by) / 2); }
      popAt.forEach(function (pop, so) {
        var a = sMap.get(so); if (!a) return;
        var Z = 0;
        far.forEach(function (c) { var d = distM(a.x, a.y, c.x, c.y); if (d >= BAL.longMinM) Z += c.w * Math.exp(-d / BAL.longGravityM); });
        if (Z <= 0) return;
        var trips = pop * BAL.longRate * fx.demand;
        attrAt.forEach(function (attr, sd) {
          if (sd === so) return;
          var b2 = sMap.get(sd); if (!b2) return;
          var d = distM(a.x, a.y, b2.x, b2.y);
          if (d < BAL.longMinM) return;
          var t = trips * attr * Math.exp(-d / BAL.longGravityM) / Z;
          if (t <= 0) return;
          var key = so + '|' + sd;
          od.set(key, (od.get(key) || 0) + t);
        });
      });
    })();

    // air travel: flights between airports, with their own (much longer) distance scale so a 1,500 km flight still has demand
    (function () {
      var airSt = new Set();
      lines.forEach(function (L) { if (MODES[L.mode].straight) L.stations.forEach(function (sid) { airSt.add(sid); }); });
      if (airSt.size < 2) return;
      var popAt = new Map(), attrAt = new Map(), cells = new Map(), cellPx = BAL.longCellM * 4 / state.mpp;
      state.blocks.forEach(function (b, i) {
        var a = b.jobs + 0.3 * b.pop;
        var key = Math.floor(b.x / cellPx) + ',' + Math.floor(b.y / cellPx), c = cells.get(key);
        if (!c) { c = { x: 0, y: 0, w: 0 }; cells.set(key, c); }
        c.x += b.x * a; c.y += b.y * a; c.w += a;
        var st = homeSt[i];
        if (st !== null) popAt.set(st, (popAt.get(st) || 0) + b.pop);
      });
      var far = [];
      cells.forEach(function (c) { if (c.w > 0) far.push({ x: c.x / c.w, y: c.y / c.w, w: c.w }); });
      function distM(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by) * mScale(state, (ay + by) / 2); }
      // an airport draws visitors to its whole metro area, not just the streets right around it
      airSt.forEach(function (sid) {
        var a = sMap.get(sid); if (!a) return;
        var w = 0;
        far.forEach(function (c) { if (distM(a.x, a.y, c.x, c.y) <= BAL.airMetroM) w += c.w; });
        if (w > 0) attrAt.set(sid, w);
      });
      if (attrAt.size < 2) return;
      popAt.forEach(function (pop, so) {
        var a = sMap.get(so); if (!a) return;
        var Z = 0;
        far.forEach(function (c) { var d = distM(a.x, a.y, c.x, c.y); if (d >= BAL.airMinM) Z += c.w * Math.exp(-d / BAL.airGravityM); });
        if (Z <= 0) return;
        var trips = pop * BAL.airRate * fx.demand;
        attrAt.forEach(function (attr, sd) {
          if (sd === so) return;
          var b2 = sMap.get(sd); if (!b2) return;
          var d = distM(a.x, a.y, b2.x, b2.y);
          if (d < BAL.airMinM) return;
          var t = trips * attr * Math.exp(-d / BAL.airGravityM) / Z;
          if (t <= 0) return;
          var key = so + '|' + sd;
          od.set(key, (od.get(key) || 0) + t);
        });
      });
    })();

    // shortest paths from each origin station
    var originCache = new Map();
    function dijkstra(so) {
      if (originCache.has(so)) return originCache.get(so);
      var n = nodes.length, dist = new Array(n).fill(Infinity), prev = new Array(n).fill(-1), prevEdge = new Array(n).fill(null), done = new Array(n).fill(false);
      (atStation.get(so) || []).forEach(function (i) { dist[i] = BAL.waitMin; });
      for (;;) {
        var u = -1, best = Infinity;
        for (var i = 0; i < n; i++) if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
        if (u < 0) break;
        done[u] = true;
        var list = adj[u];
        for (var k = 0; k < list.length; k++) {
          var e = list[k], nd = dist[u] + e.w;
          if (nd < dist[e.to]) { dist[e.to] = nd; prev[e.to] = u; prevEdge[e.to] = e.edge; }
        }
      }
      var res = { dist: dist, prev: prev, prevEdge: prevEdge };
      originCache.set(so, res);
      return res;
    }

    var routes = [];
    var flows = new Map();
    od.forEach(function (trips, key) {
      var parts = key.split('|'), so = +parts[0], sd = +parts[1];
      var res = dijkstra(so);
      var bestNode = -1, bd = Infinity;
      (atStation.get(sd) || []).forEach(function (i) { if (res.dist[i] < bd) { bd = res.dist[i]; bestNode = i; } });
      if (bestNode < 0) return;
      var edges = [];
      for (var c = bestNode; res.prev[c] >= 0; c = res.prev[c]) if (res.prevEdge[c]) edges.push(res.prevEdge[c]);
      edges.reverse();
      if (!edges.length) return;
      routes.push({ so: so, sd: sd, trips: trips, edges: edges });
      edges.forEach(function (e) {
        var k = e.lid + ':' + e.i;
        if (!flows.has(k)) flows.set(k, [0, 0]);
        flows.get(k)[e.dir] += trips;
      });
    });

    var ratio = new Map();
    flows.forEach(function (f, k) {
      var lid = +k.split(':')[0];
      var cap = lineInfo.get(lid).peakCap;
      var peak = Math.max(f[0], f[1]) * BAL.peakShare;
      ratio.set(k, cap > 0 ? peak / cap : 99);
    });

    var stats = { lines: {}, riders: 0, revenue: 0, cost: 0, profit: 0, waiting: {}, potentialTrips: potential, edgeLoad: {} };
    lines.forEach(function (L) {
      var m = MODES[L.mode], info = lineInfo.get(L.id);
      var cost = (L.vehicles * m.vehicleDay + info.lenKm * m.maintKmDay) * fx.cost + L.stations.length * (m.platDay || BAL.platformDay);
      stats.lines[L.id] = { riders: 0, revenue: 0, cost: cost, profit: 0, load: 0 };
    });
    state.lines.forEach(function (L) {
      if (stats.lines[L.id] !== undefined) return;
      var idle = 0;
      if (L.stations.length >= 2 && fx.strike[L.id]) idle = MODES[L.mode].maintKmDay * lineLenM(state, L, sMap) / 1000 * fx.cost + L.stations.length * (MODES[L.mode].platDay || BAL.platformDay);   // on strike: only track and stops cost money
      stats.lines[L.id] = { riders: 0, revenue: 0, cost: idle, profit: 0, load: 0, strike: !!(L.stations.length >= 2 && fx.strike[L.id]) };
    });
    ratio.forEach(function (r, k) {
      stats.edgeLoad[k] = r;
      var lid = +k.split(':')[0];
      stats.lines[lid].load = Math.max(stats.lines[lid].load, r);
    });

    routes.forEach(function (rt) {
      var frac = 1;
      rt.edges.forEach(function (e) {
        var r = ratio.get(e.lid + ':' + e.i);
        if (r > 1) frac = Math.min(frac, 1 / r);
      });
      var carried = rt.trips * frac;
      captured += carried;
      var km = 0;
      rt.edges.forEach(function (e) { km += e.km * (MODES[lineInfo.get(e.lid).line.mode].fareMult || 1); });   // fareMult: air fares per km are far lower than ground fares in this game
      var revenue = carried * 2 * (BAL.fareBase + BAL.fareKm * km) * fx.fare;
      var prevLid = null;
      rt.edges.forEach(function (e) {
        var ls = stats.lines[e.lid];
        ls.revenue += revenue * (e.km / km);
        if (e.lid !== prevLid) ls.riders += carried * 2;
        prevLid = e.lid;
      });
      stats.riders += carried * 2;
      stats.revenue += revenue;
      var lost = rt.trips - carried;
      if (lost > 0) stats.waiting[rt.so] = (stats.waiting[rt.so] || 0) + lost;
    });

    Object.keys(stats.lines).forEach(function (id) {
      var ls = stats.lines[id];
      ls.profit = ls.revenue - ls.cost;
      stats.cost += ls.cost;
    });
    stats.cost += state.stations.length * BAL.stationDay;
    stats.profit = stats.revenue - stats.cost;
    stats.captured = captured;
    stats._day = state.day; stats._nb = state.blocks.length; stats._nl = state.lines.length;
    return stats;
  }

  /* ---------- growth and the daily tick ---------- */
  function grow(state) {
    var r = rng(state);
    var reach = reachList(state);
    // Saves from before the growth ceiling (v50): every block stops growing where it is (cap 0). Blocks from then on get a ceiling.
    if (!state.gv) { state.blocks.forEach(function (b) { if (b.cap === undefined) { b.cap = 0; b.jcap = 0; } }); state.gv = 2; state.legacy = 1; }
    state.blocks.forEach(function (b) {
      if (b.cap === undefined) { b.cap = b.pop * BAL.growthCap; b.jcap = b.jobs * BAL.growthCap; }   // a new block may grow to 4x its size when it appeared
      if (b.cap === 0) return;
      var served = nearestReach(b, reach) !== null;
      var g = (0.003 + r() * 0.006) * (served ? 2.2 : 1), bonus = served ? BAL.growthServedBonus : 1;
      // logistic: growth slows as the block nears its ceiling (50% higher ceiling near a working stop)
      b.pop *= 1 + g * Math.max(0, 1 - b.pop / (b.cap * bonus));
      b.jobs *= 1 + g * 0.8 * Math.max(0, 1 - b.jobs / (b.jcap * bonus));
    });
    if (state.blocks.length < BAL.maxBlocks) {
      var spawns = 1 + (r() < 0.4 ? 1 : 0);
      for (var s = 0; s < spawns; s++) {
        var total = 0;
        state.blocks.forEach(function (b) { total += b.pop; });
        var pick = r() * total, base = state.blocks[0];
        for (var i = 0; i < state.blocks.length; i++) { pick -= state.blocks[i].pop; if (pick <= 0) { base = state.blocks[i]; break; } }
        var ang = r() * Math.PI * 2, d = (150 + r() * 600) / mScale(state, base.y);
        state.blocks.push({ x: base.x + Math.cos(ang) * d, y: base.y + Math.sin(ang) * d, pop: Math.round(40 + r() * 80), jobs: Math.round(10 + r() * 60) });
      }
    }
  }

  function endDay(state) {
    var events = [];
    // the numbers were already worked out after the last change; do not repeat the heavy calculation unless something moved
    var stats = state.stats && state.stats._day === state.day && state.stats._nb === state.blocks.length && state.stats._nl === state.lines.length ? state.stats : computeNetwork(state);
    state.balance += stats.profit;
    state.lifetimePax += stats.riders;
    state.history.push({ day: state.day, riders: Math.round(stats.riders), profit: Math.round(stats.profit), balance: Math.round(state.balance) });
    if (state.history.length > 120) state.history.shift();
    state.day += 1;
    if (HOOKS.events) events = events.concat(HOOKS.events(state) || []);
    if (state.balance < 0) state.negDays += 1; else state.negDays = 0;
    if (state.negDays >= BAL.bankruptDays) { state.over = true; events.push({ type: 'over' }); }
    grow(state);
    state.stats = computeNetwork(state);
    if (HOOKS.goals) events = events.concat(HOOKS.goals(state) || []);
    MODE_ORDER.forEach(function (k) {
      if (!MODES[k].soon && !isUnlocked(state, k) && state.lifetimePax >= MODES[k].unlockPax) {
        state.unlocked = state.unlocked || {};
        state.unlocked[k] = true;
        events.push({ type: 'unlock', mode: k });
      }
    });
    return events;
  }

  function isUnlocked(state, mode) {
    if (MODES[mode].soon) return false;
    return MODES[mode].unlockPax === 0 || !!(state.unlocked && state.unlocked[mode]);
  }

  /* ---------- player actions: each returns {ok, msg} ---------- */
  function fmtMoney(v) {
    var a = Math.abs(v), s = v < 0 ? '-' : '';
    if (a >= 1e6) return s + '€' + (a / 1e6).toFixed(a >= 1e7 ? 1 : 2) + 'M';
    if (a >= 1e3) return s + '€' + Math.round(a / 1e3) + 'k';
    return s + '€' + Math.round(a);
  }

  function addStation(state, x, y) {
    for (var i = 0; i < state.stations.length; i++) {
      if (Math.hypot(state.stations[i].x - x, state.stations[i].y - y) * mScale(state, y) < BAL.minStationGapM) return { ok: false, msg: 'Too close to another station' };
    }
    if (state.balance < BAL.stationCost) return { ok: false, msg: 'Not enough money' };
    state.balance -= BAL.stationCost;
    var id = state.nextId++;
    state.stations.push({ id: id, x: x, y: y, name: 'Stop ' + id, named: false });
    return { ok: true, id: id };
  }

  function removeStation(state, id) {
    var used = state.lines.some(function (L) { return L.stations.indexOf(id) >= 0; });
    if (used) return { ok: false, msg: 'Remove it from its lines first' };
    state.stations = state.stations.filter(function (s) { return s.id !== id; });
    state.balance += BAL.stationCost * 0.5;
    return { ok: true };
  }

  function hslHex(h, sat, lig) {
    var c = (1 - Math.abs(2 * lig - 1)) * sat, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = lig - c / 2, r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
    function hx(v) { var t = Math.round((v + m) * 255).toString(16); return t.length < 2 ? '0' + t : t; }
    return '#' + hx(r) + hx(g) + hx(b);
  }

  function startLine(state, mode) {
    if (!isUnlocked(state, mode)) return { ok: false, msg: MODES[mode].soon || (MODES[mode].name + ' is still locked') };
    var used = state.lines.map(function (L) { return L.color; });
    var color = COLORS.find(function (c) { return used.indexOf(c) < 0; });
    for (var hi = 0; !color; hi++) {
      var cand = hslHex((hi * 137.508 + 20) % 360, 0.68, 0.56);
      if (used.indexOf(cand) < 0) color = cand;
    }
    state.lineCount = (state.lineCount || state.lines.length) + 1;
    var line = { id: state.nextId++, n: state.lineCount, color: color, mode: mode, stations: [], flips: [], vehicles: 0 };
    state.lines.push(line);
    return { ok: true, id: line.id };
  }

  function lineById(state, id) {
    return state.lines.find(function (L) { return L.id === id; });
  }

  function stopCost(state, line, station, sMap, atStart) {
    var m = MODES[line.mode];
    var cost = m.platform;
    var nId = line.stations.length ? line.stations[atStart ? 0 : line.stations.length - 1] : null;
    var neighbour = nId !== null ? sMap.get(nId) : null;
    var segKm = neighbour ? edgeM(state, neighbour, station, m.straight) / 1000 : 0;
    return { cost: cost + segKm * m.trackKm, segKm: segKm };
  }

  /* atStart = true extends the line from its first station instead of its last. */
  function addStopToLine(state, lineId, stationId, atStart) {
    var line = lineById(state, lineId);
    if (!line) return { ok: false, msg: 'No line selected' };
    var sMap = stationMap(state), station = sMap.get(stationId);
    if (!station) return { ok: false, msg: 'No station there' };
    if (line.stations.indexOf(stationId) >= 0) return { ok: false, msg: 'Already on this line' };
    var front = !!atStart && line.stations.length >= 2;
    var m = MODES[line.mode];
    var res = stopCost(state, line, station, sMap, front);
    if (line.stations.length) {
      var nb = sMap.get(line.stations[front ? 0 : line.stations.length - 1]);
      var dm = Math.hypot(nb.x - station.x, nb.y - station.y) * mScale(state, station.y);
      if (dm < m.minSpacingM) return { ok: false, msg: 'Too close for ' + m.name + ' (min ' + (m.minSpacingM >= 1000 ? m.minSpacingM / 1000 + ' km' : m.minSpacingM + ' m') + ')' };
    }
    if (state.balance < res.cost) return { ok: false, msg: 'Need ' + fmtMoney(res.cost) + ' for this stop' };
    state.balance -= res.cost;
    if (front) { line.stations.unshift(stationId); line.flips.unshift(false); }
    else { if (line.stations.length) line.flips.push(false); line.stations.push(stationId); }
    line.lastAdd = front ? 'start' : 'end';
    var note = null;
    if (line.stations.length === 2 && line.vehicles === 0) {
      var buy = Math.min(2, Math.floor(state.balance / m.vehicle));
      line.vehicles = buy;
      state.balance -= buy * m.vehicle;
      note = buy ? 'Bought ' + buy + ' vehicles' : 'No money left for vehicles';
    }
    return { ok: true, cost: res.cost, note: note };
  }

  /* Adds a stop in the middle of a line, at position `index` (1 .. number of stops - 1), between the stops now at index-1 and index.
     Costs the platform plus any extra track the longer route needs. */
  function insertStopInLine(state, lineId, stationId, index) {
    var line = lineById(state, lineId);
    if (!line) return { ok: false, msg: 'No line selected' };
    if (line.stations.length < 2) return { ok: false, msg: 'Finish the line first' };
    var sMap = stationMap(state), station = sMap.get(stationId);
    if (!station) return { ok: false, msg: 'No station there' };
    if (line.stations.indexOf(stationId) >= 0) return { ok: false, msg: 'Already on this line' };
    index = Math.max(1, Math.min(line.stations.length - 1, index | 0));
    var m = MODES[line.mode], pa = sMap.get(line.stations[index - 1]), pb = sMap.get(line.stations[index]);
    var da = Math.hypot(pa.x - station.x, pa.y - station.y) * mScale(state, station.y);
    var db = Math.hypot(pb.x - station.x, pb.y - station.y) * mScale(state, station.y);
    if (da < m.minSpacingM || db < m.minSpacingM) return { ok: false, msg: 'Too close to a neighbouring stop for ' + m.name + ' (min ' + (m.minSpacingM >= 1000 ? m.minSpacingM / 1000 + ' km' : m.minSpacingM + ' m') + ')' };
    var oldKm = edgeM(state, pa, pb, m.straight) / 1000;
    var newKm = edgeM(state, pa, station, m.straight) / 1000 + edgeM(state, station, pb, m.straight) / 1000;
    var cost = m.platform + Math.max(0, newKm - oldKm) * m.trackKm;
    if (state.balance < cost) return { ok: false, msg: 'Need ' + fmtMoney(cost) + ' for this stop' };
    state.balance -= cost;
    line.stations.splice(index, 0, stationId);
    line.flips.splice(index - 1, 1, false, false);
    return { ok: true, cost: cost };
  }

  /* Removes the stop that was added most recently (from whichever end it was added). */
  function undoLastStop(state, lineId) {
    var line = lineById(state, lineId);
    if (!line || !line.stations.length) return { ok: false, msg: 'Nothing to undo' };
    var sMap = stationMap(state), m = MODES[line.mode];
    var front = line.lastAdd === 'start' && line.stations.length > 1;
    var n = line.stations.length;
    var refund = m.platform;
    if (n > 1) {
      var a = sMap.get(front ? line.stations[0] : line.stations[n - 1]);
      var b = sMap.get(front ? line.stations[1] : line.stations[n - 2]);
      refund += edgeM(state, a, b, m.straight) / 1000 * m.trackKm;
    }
    if (front) { line.stations.shift(); line.flips.shift(); }
    else { line.stations.pop(); if (n > 1) line.flips.pop(); }
    state.balance += refund;
    if (line.stations.length < 2 && line.vehicles) { state.balance += line.vehicles * m.vehicle; line.vehicles = 0; }
    return { ok: true };
  }

  /* Takes a stop off a line (any position). The station itself stays on the map. Needs at least two stops to remain.
     Refunds half the platform and half of any track that is no longer needed. */
  function removeStopFromLine(state, lineId, stationId) {
    var line = lineById(state, lineId);
    if (!line) return { ok: false, msg: 'No line selected' };
    var k = line.stations.indexOf(stationId);
    if (k < 0) return { ok: false, msg: 'Not on this line' };
    if (line.stations.length <= 2) return { ok: false, msg: 'A line needs two stops. Delete the line instead.' };
    var sMap = stationMap(state), m = MODES[line.mode], n = line.stations.length;
    function km(i, j) { return edgeM(state, sMap.get(line.stations[i]), sMap.get(line.stations[j]), m.straight) / 1000; }
    var freed = 0;
    if (k === 0) freed = km(0, 1);
    else if (k === n - 1) freed = km(n - 2, n - 1);
    else freed = Math.max(0, km(k - 1, k) + km(k, k + 1) - km(k - 1, k + 1));
    var refund = 0.5 * (m.platform + freed * m.trackKm);
    if (k === 0) { line.stations.shift(); line.flips.shift(); }
    else if (k === n - 1) { line.stations.pop(); line.flips.pop(); }
    else { line.stations.splice(k, 1); line.flips.splice(k - 1, 2, false); }
    state.balance += refund;
    return { ok: true, refund: refund };
  }

  function setVehicles(state, lineId, delta) {
    var line = lineById(state, lineId), m = line && MODES[line.mode];
    if (!line || line.stations.length < 2) return { ok: false, msg: 'Add at least two stops first' };
    if (delta > 0) {
      if (line.vehicles >= BAL.maxVehicles) return { ok: false, msg: 'Maximum of ' + BAL.maxVehicles + ' vehicles reached' };
      if (state.balance < m.vehicle) return { ok: false, msg: 'Need ' + fmtMoney(m.vehicle) };
      state.balance -= m.vehicle; line.vehicles += 1;
    } else {
      if (line.vehicles <= 1) return { ok: false, msg: 'Keep at least one vehicle' };
      state.balance += m.vehicle * 0.5; line.vehicles -= 1;
    }
    return { ok: true };
  }

  // set the fleet to an exact number: buys what you can afford, sells down at half price
  function setVehicleCount(state, lineId, target) {
    var line = lineById(state, lineId);
    if (!line || line.stations.length < 2) return { ok: false, msg: 'Add at least two stops first' };
    target = Math.floor(+target);
    if (!isFinite(target)) return { ok: false, msg: 'Type a number' };
    var wanted = target;
    target = Math.max(1, Math.min(BAL.maxVehicles, target));
    var msg = wanted > BAL.maxVehicles ? 'Maximum of ' + BAL.maxVehicles + ' vehicles' : '';
    while (line.vehicles < target) {
      var r = setVehicles(state, lineId, 1);
      if (!r.ok) { msg = 'Only ' + line.vehicles + ' now: ' + r.msg; break; }
    }
    while (line.vehicles > target) setVehicles(state, lineId, -1);
    return { ok: true, msg: msg, count: line.vehicles };
  }

  function deleteLine(state, lineId) {
    var line = lineById(state, lineId);
    if (!line) return { ok: false };
    state.balance += line.vehicles * MODES[line.mode].vehicle * 0.5;
    state.lines = state.lines.filter(function (L) { return L.id !== lineId; });
    return { ok: true };
  }

  function reverseLine(state, lineId) {
    var line = lineById(state, lineId);
    if (!line) return { ok: false };
    line.stations.reverse();
    line.flips.reverse();
    if (line.lastAdd) line.lastAdd = line.lastAdd === 'start' ? 'end' : 'start';
    return { ok: true };
  }

  function toggleFlip(state, lineId, segIdx) {
    var line = lineById(state, lineId);
    if (!line || segIdx < 0 || segIdx >= line.flips.length) return { ok: false };
    line.flips[segIdx] = !line.flips[segIdx];
    return { ok: true };
  }

  var api = {
    coverage: coverage, mScale: mScale, edgeM: edgeM, lineLenM: lineLenM, MODES: MODES, MODE_ORDER: MODE_ORDER, BAL: BAL, COLORS: COLORS,
    newState: newState, computeNetwork: computeNetwork, endDay: endDay, isUnlocked: isUnlocked,
    addStation: addStation, removeStation: removeStation, startLine: startLine, addStopToLine: addStopToLine,
    undoLastStop: undoLastStop, insertStopInLine: insertStopInLine, removeStopFromLine: removeStopFromLine, setVehicles: setVehicles, setVehicleCount: setVehicleCount, deleteLine: deleteLine, reverseLine: reverseLine,
    toggleFlip: toggleFlip, lineById: lineById, stationMap: stationMap, edgeLenPx: edgeLenPx, edgeLenFor: edgeLenFor,
    lineLenPx: lineLenPx, roundTripHours: roundTripHours, peakCapacity: peakCapacity, stopCost: stopCost,
    fmtMoney: fmtMoney, reachList: reachList, setHooks: function (h) { HOOKS = h || {}; }, getFx: getFx
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TGSim = api;
})(typeof window !== 'undefined' ? window : globalThis);
