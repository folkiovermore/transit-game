/* Seasons, random events and goals. Plugs into the simulation through hooks (see setHooks in sim.js).
 * Everything lives in state.ev (events) and state.goals, so it is saved with the game. Pure functions, no DOM. */
(function (root) {
  'use strict';
  var S = (typeof module !== 'undefined' && module.exports) ? require('./sim.js') : root.TGSim;
  var MODES = S.MODES;

  var YEAR = 120;                                   // days in a game year
  var SEASONS = [
    { name: 'Spring', demand: 1.0, note: 'normal demand' },
    { name: 'Summer', demand: 1.06, note: 'tourists: 6% more riders' },
    { name: 'Autumn', demand: 1.0, note: 'normal demand' },
    { name: 'Winter', demand: 0.92, note: 'cold: 8% fewer riders' }
  ];
  function seasonOf(day) { return SEASONS[Math.floor(((day - 1) % YEAR) / (YEAR / 4))]; }

  /* ---------- small helpers ---------- */
  function rnd(state) {
    var e = state.ev;
    e.seed = (Math.imul(e.seed, 1664525) + 1013904223) >>> 0;
    return e.seed / 4294967296;
  }
  function pick(state, arr) { return arr[Math.floor(rnd(state) * arr.length) % arr.length]; }
  function lineName(L) { return L.name || ('Line ' + (L.n || L.id)); }
  function working(state) { return state.lines.filter(function (L) { return L.stations.length >= 2; }); }
  function distM(state, a, b) { return Math.hypot(a.x - b.x, a.y - b.y) * S.mScale(state, (a.y + b.y) / 2); }
  function round5k(v) { return Math.max(5000, Math.round(v / 5000) * 5000); }
  function niceUp(v) {                               // next round number above v
    var steps = [100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000, 2500000, 5000000, 10000000, 25000000, 50000000, 100000000];
    for (var i = 0; i < steps.length; i++) if (steps[i] > v) return steps[i];
    return Math.ceil(v * 1.5);
  }
  function niceRound(v) {                             // 2 significant digits
    if (v < 10) return Math.max(1, Math.round(v));
    var p = Math.pow(10, Math.floor(Math.log10(v)) - 1);
    return Math.round(v / p) * p;
  }
  var money = S.fmtMoney;

  /* ---------- events ---------- */
  function ensureEv(state) {
    if (!state.ev) state.ev = { list: [], seed: ((state.seed | 0) ^ 0x9e3779b9) >>> 0, nextId: 1 };
    return state.ev;
  }
  function activeEvents(state) {
    var ev = ensureEv(state);
    return ev.list.filter(function (e) { return state.day <= e.until; });
  }

  /* What the world looks like today: demand, cost and fare multipliers, reduced capacity, striking lines,
   * closed stops and rush areas. Newer events carry generic fields (dm, cm, fm, caps, closedIds, spot),
   * the first six keep their original fields so older saves still work. */
  function fx(state) {
    var out = { demand: seasonOf(state.day).demand, cost: 1, fare: 1, cap: {}, strike: {}, closed: {}, spots: [] };
    if (!state.ev) return out;
    state.ev.list.forEach(function (e) {
      if (state.day > e.until) return;
      if (e.type === 'strike') out.strike[e.lineId] = true;
      else if (e.type === 'closure') out.closed[e.stationId] = true;
      else if (e.type === 'fuel') out.cost *= e.mult;
      else if (e.type === 'storm') out.demand *= e.mult;
      else if (e.type === 'festival' || e.type === 'match') out.spots.push({ x: e.x, y: e.y, r: e.r, mult: e.mult });
      if (e.dm) out.demand *= e.dm;
      if (e.cm) out.cost *= e.cm;
      if (e.fm) out.fare *= e.fm;
      if (e.caps) Object.keys(e.caps).forEach(function (id) { out.cap[id] = Math.min(out.cap[id] || 1, e.caps[id]); });
      if (e.closedIds) e.closedIds.forEach(function (id) { out.closed[id] = true; });
      if (e.spot) out.spots.push({ x: e.spot.x, y: e.spot.y, r: e.spot.r, mult: e.spot.mult });
    });
    return out;
  }

  /* ---------- the event catalogue ---------- */
  var MODE_NAME = function (k) { return MODES[k].name.toLowerCase(); };
  function profitNow(state) { return Math.max(0, state.stats ? state.stats.profit : 0); }

  function spotEvent(title, text, r, mult, days, season) {
    return {
      good: true, season: season,
      needs: function (st, c) { return c.stations.length > 0; },
      build: function (st, e, c) {
        var s = pick(st, c.stations);
        e.spot = { x: s.x, y: s.y, r: r, mult: mult }; e.until = st.day + days - 1;
        e.title = title + ' near ' + s.name; e.text = text;
      }
    };
  }
  function globalEvent(good, title, text, days, fields, season, weight) {
    return {
      good: good, season: season, weight: weight,
      needs: function (st, c) { return c.lines.length > 0; },
      build: function (st, e) { for (var k in fields) e[k] = fields[k]; e.until = st.day + days - 1; e.title = title; e.text = text; }
    };
  }
  function oneOff(good, title, factor, text, cap) {
    return {
      good: good, oneOff: true,
      needs: function (st, c) { return c.lines.length > 0 && (good || st.balance > 20000); },
      build: function (st, e) {
        var amt = Math.max(10000, Math.round(profitNow(st) * factor / 5000) * 5000);
        if (!good) amt = Math.min(amt, Math.max(5000, Math.round(st.balance * 0.25 / 5000) * 5000));
        e.money = good ? amt : -amt; e.until = st.day;
        e.title = title; e.text = text + ' ' + (good ? '+' : '-') + money(amt) + '.';
        st.balance += e.money;
      }
    };
  }
  function capEvent(title, text, days, mult, pickLines) {
    return {
      good: false,
      needs: function (st, c) { return pickLines(st, c, true).length > 0; },
      build: function (st, e, c) {
        var ls = pickLines(st, c, false);
        e.caps = {}; ls.forEach(function (L) { e.caps[L.id] = mult; });
        e.until = st.day + days - 1;
        e.title = title.replace('%', ls.length === 1 ? lineName(ls[0]) : ls.length + ' lines');
        e.text = text;
      }
    };
  }
  var anyLine = function (st, c, dry) { return dry ? c.lines : [pick(st, c.lines)]; };
  var nonBus = function (st, c, dry) { var l = c.lines.filter(function (L) { return L.mode !== 'bus'; }); return dry ? l : [pick(st, l)]; };
  var roadLines = function (st, c, dry) { var l = c.lines.filter(function (L) { return L.mode === 'bus' || L.mode === 'tram'; }); return dry ? l : l; };
  var oneMode = function (st, c, dry) {
    if (dry) return c.lines;
    var m = pick(st, c.lines).mode;
    return c.lines.filter(function (L) { return L.mode === m; });
  };

  var CATALOGUE = {
    // --- bad ---
    strike: {
      good: false,
      needs: function (st, c) { return c.lines.length > 0; },
      build: function (st, e, c) { var L = pick(st, c.lines); e.lineId = L.id; e.until = st.day + 2; e.title = 'Strike on ' + lineName(L); e.text = 'No service for 3 days. Only track and stop costs continue.'; }
    },
    fuel: {
      good: false,
      needs: function (st, c) { return c.lines.length > 0; },
      build: function (st, e) { e.mult = 1.5; e.until = st.day + 6; e.title = 'Fuel prices up'; e.text = 'Vehicle and track running costs are 50% higher for a week.'; }
    },
    closure: {
      good: false,
      needs: function (st, c) { return c.stations.length > 0; },
      build: function (st, e, c) { var s = pick(st, c.stations); e.stationId = s.id; e.until = st.day + 3; e.title = s.name + ' closed'; e.text = 'Closed for repairs for 4 days, so nobody boards or leaves there.'; }
    },
    storm: globalEvent(false, 'Storm', 'Fewer people travel for 2 days.', 2, { mult: 0.65 }),
    flu: globalEvent(false, 'Flu wave', 'One in five commuters stays home for 6 days.', 6, { dm: 0.8 }, null, 1),
    evasion: globalEvent(false, 'Fare dodging wave', 'Fewer people pay for their ticket: fares are 15% lower for 5 days.', 5, { fm: 0.85 }),
    pricewar: globalEvent(false, 'Taxi price war', 'Cheap taxis lure riders away: 12% fewer riders for a week.', 7, { dm: 0.88 }),
    breakdown: capEvent('Breakdowns on %', 'Vehicles are out of action, so capacity is 40% lower for 3 days.', 3, 0.6, anyLine),
    signal: capEvent('Signal failure on %', 'Trains crawl: capacity is halved for 2 days.', 2, 0.5, nonBus),
    roadworks: capEvent('Road works on %', 'Delays on bus and tram lines: capacity is 25% lower for 5 days.', 5, 0.75, roadLines),
    shortage: capEvent('Driver shortage on %', 'Not enough crew: capacity is 20% lower for 5 days.', 5, 0.8, oneMode),
    flood: {
      good: false,
      needs: function (st, c) { return c.stations.length > 1; },
      build: function (st, e, c) {
        var a = pick(st, c.stations), b = pick(st, c.stations.filter(function (s) { return s.id !== a.id; }));
        e.closedIds = [a.id, b.id]; e.until = st.day + 2;
        e.title = 'Flooding at ' + a.name + ' and ' + b.name; e.text = 'Both stops closed for 3 days.';
      }
    },
    vandal: oneOff(false, 'Vandalism', 0.6, 'Repairs after a bad night.'),
    // --- good ---
    festival: {
      good: true,
      needs: function (st, c) { return c.stations.length > 0; },
      build: function (st, e, c) { var s = pick(st, c.stations); e.x = s.x; e.y = s.y; e.stationId = s.id; e.r = 1500; e.mult = 3; e.until = st.day + 2; e.title = 'Festival near ' + s.name; e.text = 'Crowds in the area for 3 days. Serve them while it lasts.'; }
    },
    match: {
      good: true,
      needs: function (st, c) { return c.stations.length > 0; },
      build: function (st, e, c) { var s = pick(st, c.stations); e.x = s.x; e.y = s.y; e.stationId = s.id; e.r = 1200; e.mult = 4; e.until = st.day + 1; e.title = 'Big match near ' + s.name; e.text = 'A rush of riders around this stop for 2 days.'; }
    },
    concert: spotEvent('Concert', 'A sold-out show: a big rush of riders for one day.', 1000, 3.5, 1),
    market: spotEvent('Market days', 'A busy market keeps the area full for 5 days.', 800, 2, 5),
    marathon: spotEvent('City marathon', 'Thousands of runners and spectators across a wide area for a day.', 2500, 2, 1),
    xmas: spotEvent('Christmas market', 'Winter crowds for 3 days.', 1500, 2.5, 3, 'Winter'),
    beach: spotEvent('Beach weather', 'Everyone heads out for 3 days.', 3000, 2, 3, 'Summer'),
    tourists: globalEvent(true, 'Tourist boom', 'Visitors everywhere: 20% more riders for 5 days.', 5, { dm: 1.2 }),
    surge: globalEvent(true, 'Back-to-work week', 'Commuting is up: 15% more riders for 4 days.', 4, { dm: 1.15 }),
    cheapfuel: globalEvent(true, 'Cheap fuel', 'Running costs are 20% lower for a week.', 7, { cm: 0.8 }),
    subsidy: oneOff(true, 'Government subsidy', 1.5, 'A grant for public transport.'),
    sponsor: oneOff(true, 'Sponsor deal', 1.0, 'A company pays to advertise on your network.')
  };
  var EVENT_TYPES = Object.keys(CATALOGUE);

  function spawnEvent(state, forceType) {
    var ev = ensureEv(state);
    var lines = working(state);
    if (!lines.length) return null;
    var sMap = S.stationMap(state), stations = [], seen = {};
    lines.forEach(function (L) { L.stations.forEach(function (id) { if (!seen[id] && sMap.get(id)) { seen[id] = true; stations.push(sMap.get(id)); } }); });
    var ctx = { lines: lines, stations: stations };
    var season = seasonOf(state.day).name, running = activeEvents(state).map(function (e) { return e.type; });
    var wantGood = rnd(state) < 0.45;
    var pool = EVENT_TYPES.filter(function (t) {
      var d = CATALOGUE[t];
      if (forceType) return t === forceType && d.needs(state, ctx);
      return d.good === wantGood && (!d.season || d.season === season) && running.indexOf(t) < 0 && d.needs(state, ctx);
    });
    if (!pool.length) return null;
    var type = pick(state, pool), def = CATALOGUE[type];
    var e = { id: ev.nextId++, type: type, good: def.good, start: state.day };
    def.build(state, e, ctx);
    ev.list.push(e);
    return e;
  }

  function eventsDaily(state) {
    var ev = ensureEv(state), out = [];
    ev.list = ev.list.filter(function (e) {
      if (state.day > e.until) { out.push({ type: 'eventEnd', event: e }); return false; }
      return true;
    });
    if (state.day > 4 && activeEvents(state).length < 2 && rnd(state) < 0.10) {
      var e = spawnEvent(state);
      if (e) out.push({ type: 'event', event: e });
    }
    return out;
  }

  /* ---------- goals ---------- */
  var CONTINENT = {};
  [['Europe', 'AD AL AT BA BE BG BY CH CY CZ DE DK EE ES FI FO FR GB GG GI GR HR HU IE IM IS IT JE LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS RU SE SI SK SM UA VA XK'],
   ['Asia', 'AE AF AM AZ BD BH BN BT CN GE HK ID IL IN IQ IR JO JP KG KH KP KR KW KZ LA LB LK MM MN MO MV MY NP OM PH PK PS QA SA SG SY TH TJ TL TM TR TW UZ VN YE'],
   ['North America', 'AG BB BS BZ CA CR CU DM DO GD GT HN HT JM KN LC MX NI PA PR SV TT US VC'],
   ['South America', 'AR BO BR CL CO EC GY PE PY SR UY VE'],
   ['Africa', 'AO BF BI BJ BW CD CF CG CI CM CV DJ DZ EG ER ET GA GH GM GN GQ GW KE KM LR LS LY MA MG ML MR MU MW MZ NA NE NG RW SC SD SL SN SO SS ST SZ TD TG TN TZ UG ZA ZM ZW'],
   ['Oceania', 'AU FJ NZ PG SB VU WS TO']].forEach(function (c) { c[1].split(' ').forEach(function (k) { CONTINENT[k] = c[0]; }); });
  function pickUsed(state, m, filter) {
    var c = Object.keys(m.modeCount).filter(filter || function () { return true; });
    return c.length ? c[Math.floor(rnd(state) * c.length) % c.length] : null;
  }
  function modeName(k) { return MODES[k].name.toLowerCase(); }

  function ensureGoals(state) {
    if (!state.goals) state.goals = { active: [], done: [], count: 0, failed: 0, earned: 0, nextId: 1 };
    ensureEv(state);
    return state.goals;
  }

  function metrics(state) {
    var lines = working(state), sMap = S.stationMap(state);
    var m = { lines: lines.length, maxKm: 0, modes: {}, ccs: [], stationsWithCc: 0, maxLineProfit: 0, allBus: lines.length > 0, maxLoad: 0, stuck: 0, vehicles: 0, maxHub: 0, planeRiders: 0, profitable: 0, stops: 0, maxStops: 0, crossBorder: false, kmMode: {}, named: 0, maxLineRiders: 0, waiting: 0, reachPop: 0, reachJobs: 0, totalPop: 0, totalJobs: 0, maxLoopStops: 0, modeHub: 0, airHub: 0, modeCount: {}, modeFleet: {}, modeRiders: {}, groundKm: 0, netModes: 0, conts: [] };
    var stModes = {}, stPlanes = {};
    var hubCount = {};
    var stats = state.stats || { lines: {}, riders: 0, profit: 0 };
    var ids = [], seen = {};
    lines.forEach(function (L) {
      m.maxKm = Math.max(m.maxKm, S.lineLenM(state, L, sMap) / 1000);
      m.modes[L.mode] = true; m.vehicles += L.vehicles;
      var lkm = S.lineLenM(state, L, sMap) / 1000;
      m.kmMode[L.mode] = Math.max(m.kmMode[L.mode] || 0, lkm); m.maxStops = Math.max(m.maxStops, S.stopCount ? S.stopCount(L) : L.stations.length);
      var lcc = [];
      L.stations.forEach(function (sid) { var q = sMap.get(sid); if (q && q.cc && lcc.indexOf(q.cc) < 0) lcc.push(q.cc); });
      if (lcc.length >= 2) { m.crossBorder = true; if (L.mode !== 'plane') m.groundBorder = true; }
      L.stations.forEach(function (sid) { hubCount[sid] = (hubCount[sid] || 0) + 1; m.maxHub = Math.max(m.maxHub, hubCount[sid]); });
      // v66 goal data
      if (S.isLoop && S.isLoop(L)) m.maxLoopStops = Math.max(m.maxLoopStops, S.stopCount(L));
      m.modeCount[L.mode] = (m.modeCount[L.mode] || 0) + 1;
      m.modeFleet[L.mode] = (m.modeFleet[L.mode] || 0) + L.vehicles;
      if (L.mode !== 'plane') m.groundKm += lkm;
      L.stations.forEach(function (sid) {
        var o = stModes[sid] || (stModes[sid] = {}); o[L.mode] = 1; m.modeHub = Math.max(m.modeHub, Object.keys(o).length);
        if (L.mode === 'plane') { stPlanes[sid] = (stPlanes[sid] || 0) + 1; m.airHub = Math.max(m.airHub, stPlanes[sid]); }
      });
      if (L.mode !== 'bus') m.allBus = false;
      var ls = stats.lines[L.id];
      if (ls) {
        m.maxLineProfit = Math.max(m.maxLineProfit, ls.profit); m.maxLoad = Math.max(m.maxLoad, ls.load);
        if (ls.profit > 0) m.profitable++;
        if (L.mode === 'plane') m.planeRiders = Math.max(m.planeRiders, ls.riders);
        m.maxLineRiders = Math.max(m.maxLineRiders, ls.riders);
        m.modeRiders[L.mode] = Math.max(m.modeRiders[L.mode] || 0, ls.riders);
        if (ls.load >= 0.95 && L.vehicles >= S.BAL.maxVehicles) m.stuck++;     // full and cannot take more vehicles
      }
      L.stations.forEach(function (id) {
        if (seen[id]) return; seen[id] = true; ids.push(id);
        var s = sMap.get(id);
        if (s && s.cc !== undefined) m.stationsWithCc++;
        if (s && s.cc && m.ccs.indexOf(s.cc) < 0) m.ccs.push(s.cc);
      });
    });
    m.stops = ids.length;
    m.ccs.forEach(function (cc) { var ct = CONTINENT[cc]; if (ct && m.conts.indexOf(ct) < 0) m.conts.push(ct); });
    // modes joined into one network by shared stations
    var np = {};
    function nf(a) { while (np[a] !== undefined && np[a] !== a) a = np[a]; return a; }
    lines.forEach(function (L) { var r0 = nf(L.stations[0]); if (np[r0] === undefined) np[r0] = r0; L.stations.forEach(function (sid) { var r = nf(sid); if (np[r] === undefined) np[r] = r; if (r !== r0) np[r] = r0; }); });
    var wlk = (state.stats && state.stats.walk) || [];
    wlk.forEach(function (w) { if (np[w.a] === undefined || np[w.b] === undefined) return; var ra = nf(w.a), rb = nf(w.b); if (ra !== rb) np[rb] = ra; });
    var netM = {};
    lines.forEach(function (L) { var r = nf(L.stations[0]); (netM[r] || (netM[r] = {}))[L.mode] = 1; });
    Object.keys(netM).forEach(function (r) { m.netModes = Math.max(m.netModes, Object.keys(netM[r]).length); });
    state.stations.forEach(function (q) { if (q.custom) m.named++; });
    var wt = state.stats && state.stats.waiting;
    if (wt) Object.keys(wt).forEach(function (k) { m.waiting += wt[k] || 0; });
    var cv = S.coverage(state);
    m.reachPop = cv.popReached; m.reachJobs = cv.jobsReached; m.totalPop = cv.pop; m.totalJobs = cv.jobs;
    // separate places: stops that share a line or sit within 15 km of each other belong together
    var parent = {};
    ids.forEach(function (id) { parent[id] = id; });
    function find(a) { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; }
    function join(a, b) { parent[find(a)] = find(b); }
    lines.forEach(function (L) { for (var i = 1; i < L.stations.length; i++) join(L.stations[0], L.stations[i]); });
    for (var i = 0; i < ids.length; i++) for (var j = i + 1; j < ids.length; j++) {
      if (find(ids[i]) === find(ids[j])) continue;
      if (distM(state, sMap.get(ids[i]), sMap.get(ids[j])) <= 15000) join(ids[i], ids[j]);
    }
    var roots = {};
    ids.forEach(function (id) { roots[find(id)] = true; });
    m.places = Object.keys(roots).length;
    return m;
  }

  function rewardBase(state) {
    var p = state.stats ? state.stats.profit : 0;
    return Math.min(2000000, Math.max(50000, p * 2));
  }

  /* Each maker returns a goal (without id) or null when it makes no sense for this game right now. */
  var MAKERS = {
    linelen: function (state, m, base) {
      var X = Math.max(10, Math.ceil(m.maxKm * 1.6 / 5) * 5);
      return { kind: 'build', title: 'Build a line ' + X + ' km long', desc: 'One line with at least ' + X + ' km of track.', target: X, reward: round5k(base * 1.0) };
    },
    places: function (state, m, base) {
      if (!m.lines) return null;
      var N = m.places + 1;
      return { kind: 'build', title: 'Run lines in ' + N + ' separate places', desc: 'Networks that are not joined by a line and are at least 15 km apart, like another town or city.', target: N, reward: round5k(base * 1.5) };
    },
    countries: function (state, m, base) {
      if (!m.stationsWithCc) return null;
      var N = Math.max(2, m.ccs.length + 1);
      return { kind: 'build', title: 'Run lines in ' + N + ' countries', desc: 'Stops on working lines in ' + N + ' different countries. Countries are found from the stop names, so give new stops a moment.', target: N, reward: round5k(base * 2.5) };
    },
    lines: function (state, m, base) {
      var N = m.lines + 2;
      return { kind: 'build', title: 'Operate ' + N + ' lines', desc: 'Have ' + N + ' working lines at the same time.', target: N, reward: round5k(base * 0.8) };
    },
    modeline: function (state, m, base) {
      var c = S.MODE_ORDER.filter(function (k) { return k !== 'bus' && S.isUnlocked(state, k) && !m.modes[k]; });
      if (!c.length) return null;
      var k = c[Math.floor(rnd(state) * c.length) % c.length];
      return { kind: 'build', title: 'Open a ' + MODES[k].name.toLowerCase() + ' line', desc: 'A working ' + MODES[k].name.toLowerCase() + ' line with at least two stops.', mode: k, target: 1, reward: round5k(base * 1.2) };
    },
    pax: function (state, m, base) {
      var T = niceUp(state.lifetimePax);
      return { kind: 'numbers', title: 'Carry ' + num(T) + ' passengers in total', desc: 'All passengers carried so far, across all your lines.', target: T, reward: round5k(base * 1.5) };
    },
    dailyriders: function (state, m, base) {
      var cur = state.stats ? state.stats.riders : 0;
      var T = niceRound(Math.max(500, cur * 1.5));
      return { kind: 'numbers', title: 'Reach ' + num(T) + ' riders a day', desc: 'Riders per day across the whole network.', target: T, reward: round5k(base * 1.0) };
    },
    profit: function (state, m, base) {
      var cur = state.stats ? Math.max(0, state.stats.profit) : 0;
      var T = Math.max(5000, round5k(cur * 1.5));
      return { kind: 'numbers', title: 'Earn ' + money(T) + ' profit a day', desc: 'Daily profit after all costs.', target: T, reward: round5k(base * 1.2) };
    },
    balance: function (state, m, base) {
      var T = niceUp(Math.max(state.balance, 200000) * 1.4 - 1);
      return { kind: 'numbers', title: 'Save up ' + money(T), desc: 'Have this much in the bank.', target: T, reward: round5k(base * 0.8) };
    },
    spot: function (state, m, base) {
      if (!m.lines) return null;
      var reach = S.reachList(state);
      var sMap = S.stationMap(state), best = [];
      state.blocks.forEach(function (b) {
        var w = b.pop + b.jobs;
        if (w < 250) return;
        var near = false, covered = false;
        for (var i = 0; i < reach.length; i++) {
          var d = Math.hypot(b.x - reach[i].x, b.y - reach[i].y) * S.mScale(state, b.y);
          if (d < 700) { covered = true; break; }
          if (d < 50000) near = true;   // v57: 50 km (was 12 km)
        }
        if (!covered && near) best.push({ b: b, w: w });
      });
      if (!best.length) return null;
      best.sort(function (a, c) { return c.w - a.w; });
      var top = best.slice(0, Math.min(12, best.length));
      var c = top[Math.floor(rnd(state) * top.length) % top.length];
      return { kind: 'contract', title: 'Serve the marked busy area', desc: 'Put a stop on a working line within 400 m of the marker. About ' + num(c.b.pop) + ' people live and ' + num(c.b.jobs) + ' jobs are right there.',
        spot: { x: c.b.x, y: c.b.y }, target: 1, days: 25, reward: round5k(base * 1.3) };
    },
    ridersoon: function (state, m, base) {
      var cur = state.stats ? state.stats.riders : 0;
      if (cur < 50) return null;
      var T = niceRound(cur * 1.25);
      return { kind: 'contract', title: 'Reach ' + num(T) + ' riders a day within 15 days', desc: 'Grow the network quickly for a bonus. No penalty if you miss it.', target: T, days: 15, reward: round5k(base * 1.8) };
    },
    busonly: function (state, m, base) {
      if (!m.lines || !m.allBus) return null;
      var cur = state.stats ? Math.max(0, state.stats.profit) : 0;
      var T = Math.max(5000, round5k(cur * 1.5));
      return { kind: 'challenge', title: 'Bus-only: earn ' + money(T) + ' a day', desc: 'Reach this daily profit while every line is a bus line.', target: T, reward: round5k(base * 2.0) };
    },
    allprofit: function (state, m, base) {
      if (m.lines < 3) return null;
      return { kind: 'challenge', title: 'Every line in the black', desc: 'All ' + m.lines + '+ working lines earn a profit at the same time (at least 3 lines). A new line that has not found its riders yet counts against you.', target: 3, reward: round5k(base * 1.5) };
    },
    airline: function (state, m, base) {
      if (!m.modes.plane) return null;
      var T = niceRound(Math.max(100, m.planeRiders * 1.5));
      return { kind: 'challenge', title: 'Airline: ' + num(T) + ' riders a day on one route', desc: 'Get a single plane line to carry this many riders per day.', target: T, reward: round5k(base * 2.0) };
    },
    hub: function (state, m, base) {
      if (m.lines < 2) return null;
      var N = Math.max(3, m.maxHub + 1);
      return { kind: 'build', title: 'Build a hub: ' + N + ' lines at one stop', desc: 'One stop served by ' + N + ' different working lines, so people can change there.', target: N, reward: round5k(base * 1.0) };
    },
    fleet: function (state, m, base) {
      var T = Math.ceil((m.vehicles + 10) / 5) * 5;   // ten more than now, so the goal costs a modest amount
      return { kind: 'numbers', title: 'Run ' + num(T) + ' vehicles', desc: 'Total vehicles across all your lines.', target: T, reward: round5k(base * 0.8) };
    },
    stops: function (state, m, base) {
      if (!m.lines) return null;
      var N = Math.ceil((m.stops + 10) / 5) * 5;
      return { kind: 'build', title: 'Open ' + N + ' stops', desc: 'Stops on working lines, counted once each. You have ' + m.stops + ' now.', target: N, reward: round5k(base * 0.8) };
    },
    modemix: function (state, m, base) {
      var c = Object.keys(m.modes).length, N = c + 1;
      var open = S.MODE_ORDER.filter(function (k) { return S.isUnlocked(state, k); }).length;
      if (!m.lines || N > open) return null;
      return { kind: 'build', title: 'Run ' + N + ' different modes at once', desc: 'Working lines of ' + N + ' different transport modes at the same time.', target: N, reward: round5k(base * 1.3) };
    },
    longstops: function (state, m, base) {
      if (!m.lines) return null;
      var N = Math.max(8, Math.ceil((m.maxStops + 4) / 2) * 2);
      return { kind: 'build', title: 'A line with ' + N + ' stops', desc: 'One line with at least ' + N + ' stops.', target: N, reward: round5k(base * 0.8) };
    },
    crossborder: function (state, m, base) {
      if (!m.stationsWithCc || m.crossBorder) return null;
      return { kind: 'build', title: 'Cross a border with one line', desc: 'A single line with stops in two different countries. Countries are found from the stop names, so give new stops a moment.', target: 1, reward: round5k(base * 2.0) };
    },
    modekm: function (state, m, base) {
      var KM = { tram: 6, lightrail: 12, rail: 20, metro: 12, coach: 40, intercity: 80, ferry: 12, plane: 600 };
      var c = Object.keys(KM).filter(function (k) { return S.isUnlocked(state, k) && (m.kmMode[k] || 0) < KM[k]; });
      if (!c.length) return null;
      var k = c[Math.floor(rnd(state) * c.length) % c.length];
      return { kind: 'build', title: 'A ' + MODES[k].name.toLowerCase() + ' line ' + KM[k] + ' km long', desc: 'One working ' + MODES[k].name.toLowerCase() + ' line with at least ' + KM[k] + ' km of route.', mode: k, target: KM[k], reward: round5k(base * 1.2) };
    },
    namer: function (state, m, base) {
      if (!m.lines) return null;
      var N = m.named + 3;
      return { kind: 'build', title: 'Give ' + N + ' stops your own names', desc: 'Tap a stop, then Rename. You have named ' + m.named + ' so far.', target: N, reward: round5k(base * 0.5) };
    },
    reachpop: function (state, m, base) {
      if (!m.lines || m.reachPop >= m.totalPop * 0.9) return null;
      var T = Math.min(niceUp(m.reachPop * 1.2), Math.floor(m.totalPop * 0.9));
      if (T <= m.reachPop) return null;
      return { kind: 'numbers', title: 'Put ' + num(T) + ' residents near a stop', desc: 'Homes within walking distance of a stop on a working line. ' + num(m.reachPop) + ' now.', target: T, reward: round5k(base * 1.0) };
    },
    reachjobs: function (state, m, base) {
      if (!m.lines || m.reachJobs >= m.totalJobs * 0.9) return null;
      var T = Math.min(niceUp(m.reachJobs * 1.2), Math.floor(m.totalJobs * 0.9));
      if (T <= m.reachJobs) return null;
      return { kind: 'numbers', title: 'Put ' + num(T) + ' jobs near a stop', desc: 'Workplaces within walking distance of a stop on a working line. ' + num(m.reachJobs) + ' now.', target: T, reward: round5k(base * 1.0) };
    },
    busyline: function (state, m, base) {
      if (!m.lines) return null;
      var T = niceRound(Math.max(300, m.maxLineRiders * 1.4));
      return { kind: 'numbers', title: 'One line, ' + num(T) + ' riders a day', desc: 'Get a single line to carry this many riders per day.', target: T, reward: round5k(base * 1.2) };
    },
    waiting: function (state, m, base) {
      if (m.waiting < 300) return null;
      var mag = Math.pow(10, Math.floor(Math.log10(m.waiting * 0.7)) - 1);
      var T = Math.max(100, Math.round(m.waiting * 0.7 / mag) * mag);
      return { kind: 'challenge', title: 'Leave fewer than ' + num(T) + ' people behind', desc: 'People left waiting at stops per day, across the network. Add vehicles or lines where it is crowded. ' + num(m.waiting) + ' now.', target: T, reward: round5k(base * 1.5) };
    },
    quickbal: function (state, m, base) {
      var T = niceUp(Math.max(state.balance, 200000) * 1.25);
      return { kind: 'contract', title: 'Reach ' + money(T) + ' in the bank within 20 days', desc: 'Save quickly for a bonus. No penalty if you miss it.', target: T, days: 20, reward: round5k(base * 1.6) };
    },
    quickprofit: function (state, m, base) {
      var cur = state.stats ? state.stats.profit : 0;
      if (cur <= 0) return null;
      var T = Math.max(5000, round5k(cur * 1.2));
      return { kind: 'contract', title: 'Earn ' + money(T) + ' a day within 20 days', desc: 'Lift your daily profit fast for a bonus. No penalty if you miss it.', target: T, days: 20, reward: round5k(base * 1.6) };
    },
    quickstops: function (state, m, base) {
      if (!m.lines) return null;
      var N = m.stops + 8;
      return { kind: 'contract', title: 'Open 8 new stops within 15 days', desc: 'Have ' + N + ' stops on working lines (you have ' + m.stops + ' now). No penalty if you miss it.', target: N, days: 15, reward: round5k(base * 1.4) };
    },
    // ---- v66: more goals for big networks ----
    loop: function (state, m, base) {
      if (m.lines < 2) return null;
      var N = Math.max(6, m.maxLoopStops + 4);
      return { kind: 'build', title: (m.maxLoopStops ? 'A bigger loop: ' : 'Build a loop line: ') + N + ' stops', desc: 'One line closed into a circle with at least ' + N + ' stops (while adding stops, tap the stop at the other end). Think circle lines like Madrid 6 or the Glasgow Subway.', target: N, reward: round5k(base * 1.3) };
    },
    modehub: function (state, m, base) {
      var open = S.MODE_ORDER.filter(function (k) { return S.isUnlocked(state, k); }).length;
      var N = Math.max(2, m.modeHub + 1);
      if (m.lines < 2 || N > open) return null;
      return { kind: 'build', title: 'Interchange: ' + N + ' modes at one stop', desc: 'One station served by lines of ' + N + ' different modes, like a big city terminal. Best now: ' + m.modeHub + '.', target: N, reward: round5k(base * 1.3) };
    },
    continents: function (state, m, base) {
      if (!m.conts.length || m.conts.length >= 6) return null;
      var N = m.conts.length + 1;
      return { kind: 'build', title: 'Run lines on ' + N + ' continents', desc: 'Stops on working lines in ' + N + ' different continents. You are on ' + m.conts.join(', ') + '.', target: N, reward: round5k(base * 3.0) };
    },
    airhub: function (state, m, base) {
      if (!m.modes.plane) return null;
      var N = Math.max(2, m.airHub + 1);
      return { kind: 'build', title: 'Hub airport: ' + N + ' routes from one airport', desc: 'One airport stop served by ' + N + ' plane lines. Best now: ' + m.airHub + '.', target: N, reward: round5k(base * 1.5) };
    },
    modefleet: function (state, m, base) {
      var k = pickUsed(state, m);
      if (!k) return null;
      var cur = m.modeFleet[k] || 0, T = Math.ceil((cur * 1.3 + 5) / 5) * 5;
      return { kind: 'numbers', title: 'Run ' + num(T) + ' ' + modeName(k) + ' vehicles', desc: 'All your ' + modeName(k) + ' vehicles together. ' + num(cur) + ' now.', mode: k, target: T, reward: round5k(base * 1.0) };
    },
    moderiders: function (state, m, base) {
      var FLOOR = { bus: 2000, tram: 5000, lightrail: 8000, coach: 1000, rail: 10000, metro: 20000, intercity: 3000, ferry: 1000 };
      var k = pickUsed(state, m, function (q) { return q !== 'plane'; });
      if (!k) return null;
      var T = niceRound(Math.max(FLOOR[k] || 1000, (m.modeRiders[k] || 0) * 1.4));
      return { kind: 'numbers', title: 'A ' + modeName(k) + ' line with ' + num(T) + ' riders a day', desc: 'Get one ' + modeName(k) + ' line this busy. Best now: ' + num(m.modeRiders[k] || 0) + '.', mode: k, target: T, reward: round5k(base * 1.2) };
    },
    modecount: function (state, m, base) {
      var k = pickUsed(state, m, function (q) { return q !== 'bus'; });
      if (!k) return null;
      var N = (m.modeCount[k] || 0) + 1;
      return { kind: 'build', title: 'Run ' + N + ' ' + modeName(k) + ' lines', desc: 'Working ' + modeName(k) + ' lines at the same time. ' + (m.modeCount[k] || 0) + ' now.', mode: k, target: N, reward: round5k(base * 1.1) };
    },
    groundkm: function (state, m, base) {
      if (!m.lines || m.groundKm < 5) return null;
      var T = niceUp(m.groundKm * 1.25);
      return { kind: 'build', title: num(T) + ' km of routes on the ground', desc: 'All your lines together, flights not counted (water routes count). ' + num(m.groundKm) + ' km now.', target: T, reward: round5k(base * 1.2) };
    },
    netmodes: function (state, m, base) {
      var open = S.MODE_ORDER.filter(function (k) { return S.isUnlocked(state, k); }).length;
      var N = Math.max(3, m.netModes + 1);
      if (m.lines < 2 || N > open) return null;
      return { kind: 'build', title: N + ' modes in one connected network', desc: 'Lines of ' + N + ' different modes joined by shared stations or a short walk, so people can change between all of them. Best now: ' + m.netModes + '.', target: N, reward: round5k(base * 1.4) };
    },
    longflight: function (state, m, base) {
      if (!m.modes.plane) return null;
      var cur = m.kmMode.plane || 0, X = Math.ceil(Math.max(1000, cur * 1.15, cur + 500) / 500) * 500;
      if (X > 15000) return null;   // the longest real flights are about 15,000 km
      return { kind: 'build', title: 'Fly ' + num(X) + ' km nonstop', desc: 'One plane line at least ' + num(X) + ' km long. Longest now: ' + num(cur) + ' km.', target: X, reward: round5k(base * 1.6) };
    },
    rescue: function (state, m, base) {
      var stl = (state.stats && state.stats.lines) || {}, worst = null;
      working(state).forEach(function (L) { var ls = stl[L.id]; if (ls && L.vehicles && (!worst || ls.profit < worst.p)) worst = { L: L, p: ls.profit }; });
      if (!worst || m.lines < 4) return null;
      var T = round5k(Math.max(10000, worst.p * 2 + 10000));
      return { kind: 'contract', title: 'Turn around ' + (worst.L.name || 'your weakest line') + ' within 20 days', desc: 'Get this line to ' + money(T) + ' profit a day (it makes ' + money(worst.p) + ' now). More stops, better places or fewer vehicles all help. No penalty if you miss it.', lineId: worst.L.id, target: T, days: 20, reward: round5k(base * 1.6) };
    },
    quickplace: function (state, m, base) {
      if (!m.lines) return null;
      var N = m.places + 1;
      return { kind: 'contract', title: 'A line in a new place within 20 days', desc: 'Have ' + N + ' separate places (networks not joined by a line, 15+ km apart). No penalty if you miss it.', target: N, days: 20, reward: round5k(base * 1.8) };
    },
    starline: function (state, m, base) {
      if (!m.lines) return null;
      var T = Math.max(3000, round5k(m.maxLineProfit * 1.5));
      return { kind: 'challenge', title: 'A star line: ' + money(T) + ' a day', desc: 'Get a single line to earn this much profit per day.', target: T, reward: round5k(base * 1.5) };
    }
  };
  function num(v) { return Math.round(v).toLocaleString('en-GB'); }

  /* How far along a goal is. frac 0..1, text for the card. */
  function progress(state, g, m) {
    m = m || metrics(state);
    var st = state.stats || { riders: 0, profit: 0, lines: {} };
    var f = 0, text = '', done = false, bad = '';
    switch (g.key) {
      case 'linelen': f = m.maxKm / g.target; text = m.maxKm.toFixed(1) + ' of ' + g.target + ' km'; break;
      case 'places': f = m.places / g.target; text = m.places + ' of ' + g.target + ' places'; break;
      case 'countries': f = m.ccs.length / g.target; text = m.ccs.length + ' of ' + g.target + ' countries'; break;
      case 'lines': f = m.lines / g.target; text = m.lines + ' of ' + g.target + ' lines'; break;
      case 'modeline': f = m.modes[g.mode] ? 1 : 0; text = f ? 'Done' : 'Not yet'; break;
      case 'pax': f = state.lifetimePax / g.target; text = num(state.lifetimePax) + ' of ' + num(g.target); break;
      case 'dailyriders': case 'ridersoon': f = st.riders / g.target; text = num(st.riders) + ' of ' + num(g.target) + ' a day'; break;
      case 'profit': f = st.profit / g.target; text = money(st.profit) + ' of ' + money(g.target) + ' a day'; break;
      case 'balance': f = state.balance / g.target; text = money(state.balance) + ' of ' + money(g.target); break;
      case 'spot': {
        var sMap = S.stationMap(state), hit = false;
        working(state).forEach(function (L) { L.stations.forEach(function (id) { var s = sMap.get(id); if (s && distM(state, s, g.spot) <= 400) hit = true; }); });
        f = hit ? 1 : 0; text = hit ? 'Served' : 'No stop near the marker yet'; break;
      }
      case 'busonly':
        f = st.profit / g.target; text = money(st.profit) + ' of ' + money(g.target) + ' a day';
        if (!m.lines) { f = 0; bad = 'Build a bus line first'; }
        else if (!m.allBus) { f = Math.min(f, 0.99); bad = 'Only bus lines allowed'; }
        break;
      case 'allprofit':
        f = m.lines ? m.profitable / m.lines : 0; text = m.profitable + ' of ' + m.lines + ' lines in profit';
        if (m.lines < g.target) bad = 'Needs at least ' + g.target + ' lines';
        break;
      case 'airline': f = m.planeRiders / g.target; text = num(m.planeRiders) + ' of ' + num(g.target) + ' a day'; if (!m.modes.plane) bad = 'Needs a plane line'; break;
      case 'hub': f = m.maxHub / g.target; text = 'Best stop: ' + m.maxHub + ' of ' + g.target + ' lines'; break;
      case 'fleet': f = m.vehicles / g.target; text = num(m.vehicles) + ' of ' + num(g.target) + ' vehicles'; break;
      case 'stops': case 'quickstops': f = m.stops / g.target; text = m.stops + ' of ' + g.target + ' stops'; break;
      case 'modemix': { var mc = Object.keys(m.modes).length; f = mc / g.target; text = mc + ' of ' + g.target + ' modes'; break; }
      case 'longstops': f = m.maxStops / g.target; text = 'Longest line: ' + m.maxStops + ' of ' + g.target + ' stops'; break;
      case 'crossborder': f = m.crossBorder ? 1 : 0; text = m.crossBorder ? 'Done' : 'No line crosses a border yet'; break;
      case 'modekm': { var km = m.kmMode[g.mode] || 0; f = km / g.target; text = km.toFixed(1) + ' of ' + g.target + ' km'; break; }
      case 'namer': f = m.named / g.target; text = m.named + ' of ' + g.target + ' named'; break;
      case 'reachpop': f = m.reachPop / g.target; text = num(m.reachPop) + ' of ' + num(g.target) + ' residents'; break;
      case 'reachjobs': f = m.reachJobs / g.target; text = num(m.reachJobs) + ' of ' + num(g.target) + ' jobs'; break;
      case 'busyline': f = m.maxLineRiders / g.target; text = 'Best line: ' + num(m.maxLineRiders) + ' of ' + num(g.target) + ' a day'; break;
      case 'waiting':
        f = m.waiting <= g.target ? 1 : g.target / Math.max(1, m.waiting); text = num(m.waiting) + ' left behind, goal under ' + num(g.target);
        if (!m.lines) bad = 'Build a line first';
        break;
      case 'quickbal': f = state.balance / g.target; text = money(state.balance) + ' of ' + money(g.target); break;
      case 'quickprofit': f = st.profit / g.target; text = money(st.profit) + ' of ' + money(g.target) + ' a day'; break;
      case 'loop': f = m.maxLoopStops / g.target; text = m.maxLoopStops ? 'Biggest loop: ' + m.maxLoopStops + ' of ' + g.target + ' stops' : 'No loop yet'; break;
      case 'modehub': f = m.modeHub / g.target; text = 'Best stop: ' + m.modeHub + ' of ' + g.target + ' modes'; break;
      case 'continents': f = m.conts.length / g.target; text = m.conts.length + ' of ' + g.target + ' continents'; break;
      case 'airhub': f = m.airHub / g.target; text = 'Best airport: ' + m.airHub + ' of ' + g.target + ' routes'; break;
      case 'modefleet': { var fl = m.modeFleet[g.mode] || 0; f = fl / g.target; text = num(fl) + ' of ' + num(g.target) + ' vehicles'; break; }
      case 'moderiders': { var mr = m.modeRiders[g.mode] || 0; f = mr / g.target; text = 'Best ' + modeName(g.mode) + ' line: ' + num(mr) + ' of ' + num(g.target) + ' a day'; break; }
      case 'modecount': { var mc2 = m.modeCount[g.mode] || 0; f = mc2 / g.target; text = mc2 + ' of ' + g.target + ' ' + modeName(g.mode) + ' lines'; break; }
      case 'groundkm': f = m.groundKm / g.target; text = num(m.groundKm) + ' of ' + num(g.target) + ' km'; break;
      case 'netmodes': f = m.netModes / g.target; text = 'Best network: ' + m.netModes + ' of ' + g.target + ' modes'; break;
      case 'longflight': { var pk = m.kmMode.plane || 0; f = pk / g.target; text = num(pk) + ' of ' + num(g.target) + ' km'; break; }
      case 'rescue': {
        var rl = S.lineById(state, g.lineId), rs = st.lines && st.lines[g.lineId];
        if (!rl) { f = 0; bad = 'That line was deleted'; text = 'Line gone'; break; }
        var rp = rs ? rs.profit : 0; f = rp / g.target; text = money(rp) + ' of ' + money(g.target) + ' a day'; break;
      }
      case 'quickplace': f = m.places / g.target; text = m.places + ' of ' + g.target + ' places'; break;
      case 'starline': f = m.maxLineProfit / g.target; text = money(m.maxLineProfit) + ' of ' + money(g.target) + ' a day'; break;
    }
    if (!isFinite(f) || f < 0) f = 0;
    done = f >= 1 && !bad;
    if (bad && f >= 1) f = 0.99;
    return { frac: Math.min(1, f), text: text, bad: bad, done: done };
  }

  function makeGoal(state, key, m) {
    var g = MAKERS[key](state, m, rewardBase(state));
    if (!g) return null;
    g.key = key;
    return g;
  }

  function refill(state) {
    var G = ensureGoals(state), m = metrics(state), added = [];
    var guard = 0;
    while (G.active.length < 3 && guard++ < 40) {
      var haveKeys = G.active.map(function (g) { return g.key; });
      var haveKinds = G.active.map(function (g) { return g.kind; });
      var keys = Object.keys(MAKERS).filter(function (k) { return haveKeys.indexOf(k) < 0 && k !== G.avoidKey; });
      if (!keys.length) break;
      // v66: avoid the last 12 goal types you finished, missed or skipped, so the same ones do not keep coming back
      var recent = G.recent || [], notRecent = keys.filter(function (k) { return recent.indexOf(k) < 0; });
      if (notRecent.length >= 3) keys = notRecent;
      // prefer a kind that is not shown yet, and not the one just completed
      var fresh = keys.filter(function (k) { var kd = kindOf(k); return haveKinds.indexOf(kd) < 0 && kd !== G.lastKind; });
      var pool = fresh.length ? fresh : keys;
      var g = null, tries = pool.slice();
      while (!g && tries.length) {
        var k = tries.splice(Math.floor(rnd(state) * tries.length) % tries.length, 1)[0];
        g = makeGoal(state, k, m);
      }
      if (!g) {   // nothing in the preferred group fits this game right now: try every other type, then the recent ones too
        var rest = Object.keys(MAKERS).filter(function (q) { return haveKeys.indexOf(q) < 0 && pool.indexOf(q) < 0; });
        rest.sort(function (a, b) { return (recent.indexOf(a) >= 0) - (recent.indexOf(b) >= 0); });
        while (!g && rest.length) g = makeGoal(state, rest.shift(), m);
      }
      if (!g) break;
      g.id = G.nextId++;
      g.start = state.day;
      if (g.days) g.deadline = state.day + g.days;
      G.active.push(g); added.push(g);
    }
    return added;
  }
  function remember(G, key) { if (!G.recent) G.recent = []; G.recent.unshift(key); if (G.recent.length > 12) G.recent.length = 12; }
  function kindOf(key) { return { linelen: 'build', places: 'build', countries: 'build', lines: 'build', modeline: 'build', pax: 'numbers', dailyriders: 'numbers', profit: 'numbers', balance: 'numbers', spot: 'contract', ridersoon: 'contract', busonly: 'challenge', allprofit: 'challenge', airline: 'challenge', starline: 'challenge', hub: 'build', fleet: 'numbers', stops: 'build', modemix: 'build', longstops: 'build', crossborder: 'build', modekm: 'build', namer: 'build', reachpop: 'numbers', reachjobs: 'numbers', busyline: 'numbers', waiting: 'challenge', quickbal: 'contract', quickprofit: 'contract', quickstops: 'contract', loop: 'build', modehub: 'build', continents: 'build', airhub: 'build', modefleet: 'numbers', moderiders: 'numbers', modecount: 'build', groundkm: 'build', netmodes: 'build', longflight: 'build', rescue: 'contract', quickplace: 'contract' }[key]; }

  /* Drop a goal you do not want, free. A different one takes its place. */
  function skip(state, id) {
    var G = ensureGoals(state), g = G.active.filter(function (q) { return q.id === id; })[0];
    if (!g) return null;
    G.active = G.active.filter(function (q) { return q.id !== id; });
    G.skipped = (G.skipped || 0) + 1;
    G.avoidKey = g.key; remember(G, g.key);
    refill(state);
    G.avoidKey = null;
    return g;
  }

  /* Checks every active goal: pays out finished ones, drops expired contracts, tops the list up. Returns events for the UI. */
  function check(state) {
    var G = ensureGoals(state), out = [], m = metrics(state);
    var keep = [];
    G.active.forEach(function (g) {
      if (!MAKERS[g.key]) return;   // a goal type that no longer exists (for example the old "no crowding"): dropped without penalty
      var p = progress(state, g, m);
      if (p.done) {
        state.balance += g.reward;
        G.count++; G.earned += g.reward; G.lastKind = g.kind; remember(G, g.key);
        G.done.unshift({ title: g.title, reward: g.reward, day: state.day });
        if (G.done.length > 25) G.done.pop();
        out.push({ type: 'goal', goal: g });
      } else if (g.deadline !== undefined && state.day > g.deadline) {
        G.failed++; G.lastKind = g.kind; remember(G, g.key);
        if (!G.missed) G.missed = [];
        G.missed.unshift({ title: g.title, day: state.day });
        if (G.missed.length > 25) G.missed.pop();
        out.push({ type: 'goalExpired', goal: g });
      } else keep.push(g);
    });
    G.active = keep;
    refill(state);
    return out;
  }

  /* ---------- v68b: achievements, permanent badges kept in state.ach = { id: day } ---------- */
  var ACH = [];
  function tierAch(group, icon, list, get, unit) {
    list.forEach(function (t, i) { ACH.push({ id: group + i, group: group, icon: icon, title: t[1], desc: t[2] || '', target: t[0], get: get, unit: unit || '' }); });
  }
  function oneAch(group, id, icon, title, desc, test) { ACH.push({ id: id, group: group, icon: icon, title: title, desc: desc, test: test }); }
  function achLine(state, f) { return working(state).some(function (L) { return L.vehicles > 0 && f(L); }); }
  function topTier(mode) { return function (state) { return achLine(state, function (L) { var t = S.TIERS && S.TIERS[mode]; return L.mode === mode && t && L.tier === t.length - 1; }); }; }
  var GROUPS = [['pax', 'Passengers carried'], ['riders', 'Riders a day'], ['profit', 'Profit a day'], ['bal', 'Savings'], ['lines', 'Lines'], ['stops', 'Stops'], ['ctry', 'Countries'], ['cont', 'Continents'], ['reach', 'People near a stop'], ['days', 'Time'], ['goals', 'Goals done'], ['net', 'Network'], ['fleet', 'Fleet'], ['far', 'Distance']];
  tierAch('pax', '🎟', [[1e6, 'First million', 'Carry 1 million passengers in total'], [1e7, 'Ten million'], [1e8, 'Hundred million'], [1e9, 'A billion journeys'], [1e10, 'Ten billion journeys']], function (state) { return state.lifetimePax || 0; });
  tierAch('riders', '👥', [[1e4, 'Busy town', '10,000 riders in one day'], [1e5, 'Big city'], [1e6, 'Million a day'], [5e6, 'Five million a day']], function (state) { return state.stats ? state.stats.riders : 0; });
  tierAch('profit', '💶', [[1e5, 'In the money', '€100k profit in one day'], [1e6, 'A million a day'], [1e7, 'Ten million a day'], [1e8, 'Hundred million a day'], [1e9, 'A billion a day']], function (state) { return state.stats ? state.stats.profit : 0; }, '€');
  tierAch('bal', '🏦', [[1e6, 'Millionaire', '€1 million in the bank'], [1e8, 'Rich'], [1e9, 'Billionaire'], [1e10, 'Ten billion'], [1e11, 'Hundred billion']], function (state) { return state.balance; }, '€');
  tierAch('lines', '〰', [[5, 'A real network', '5 lines running'], [10, 'Ten lines'], [25, 'Twenty-five lines'], [50, 'Fifty lines'], [100, 'A hundred lines']], function (state, m) { return m.lines; });
  tierAch('stops', '⦿', [[50, 'Fifty stops', '50 stops on working lines'], [100, 'A hundred stops'], [250, '250 stops'], [500, '500 stops'], [1000, 'A thousand stops']], function (state, m) { return m.stops; });
  tierAch('ctry', '🗺', [[2, 'Going abroad', 'Lines in 2 countries'], [5, 'Five flags'], [10, 'Ten countries'], [15, 'Fifteen countries'], [25, 'Twenty-five countries']], function (state, m) { return m.ccs.length; });
  tierAch('cont', '🌍', [[2, 'Two continents', 'Lines on 2 continents'], [3, 'Three continents'], [4, 'Four continents'], [5, 'Five continents'], [6, 'Around the world', 'Lines on every inhabited continent']], function (state, m) { return m.conts.length; });
  tierAch('reach', '🏘', [[1e5, 'Neighbourhood', '100,000 people live near a stop'], [1e6, 'A million in reach'], [1e7, 'Ten million in reach'], [5e7, 'Fifty million in reach']], function (state, m) { return m.reachPop; });
  tierAch('days', '📅', [[120, 'First year', 'Run for a whole game year (120 days)'], [365, 'Day 365'], [1000, 'Day 1,000'], [2000, 'Veteran', 'Day 2,000']], function (state) { return state.day; });
  tierAch('goals', '🏁', [[10, 'Goal getter', 'Finish 10 goals'], [50, 'Fifty goals'], [100, 'A hundred goals'], [250, 'Goal machine', 'Finish 250 goals']], function (state) { return (state.goals && state.goals.count) || 0; });
  oneAch('net', 'allmodes', '🚦', 'Every mode', 'Run at least one line of every mode at the same time', function (state, m) { return S.MODE_ORDER.every(function (k) { return m.modes[k]; }); });
  oneAch('net', 'loop', '⭕', 'Full circle', 'Run a loop line', function (state, m) { return m.maxLoopStops > 0; });
  oneAch('net', 'walk', '🚶', 'Mind the gap', 'Have a walking interchange between two lines', function (state) { return !!(state.stats && state.stats.walk && state.stats.walk.length); });
  oneAch('net', 'hub5', '✳', 'Grand interchange', 'One stop served by 5 lines', function (state, m) { return m.maxHub >= 5; });
  oneAch('net', 'modes4', '🔀', 'Integrated network', '4 modes joined in one network', function (state, m) { return m.netModes >= 4; });
  oneAch('net', 'border', '🛂', 'No passport needed', 'A line on the ground or water that crosses a border', function (state, m) { return !!m.groundBorder; });
  oneAch('net', 'black', '✅', 'All in the black', 'Every line makes money, with 20 lines or more', function (state, m) { return m.lines >= 20 && m.profitable === m.lines; });
  oneAch('net', 'stops40', '🛑', 'Stopping service', 'One line with 40 stops', function (state, m) { return m.maxStops >= 40; });
  oneAch('net', 'airhub', '🛫', 'Hub airport', 'One airport with 5 routes', function (state, m) { return m.airHub >= 5; });
  oneAch('fleet', 'full', '🚌', 'Full fleet', 'A line with 150 vehicles', function (state) { return achLine(state, function (L) { return L.vehicles >= S.BAL.maxVehicles; }); });
  oneAch('fleet', 'a380', '✈', 'Superjumbo', 'A plane line flying the A380', topTier('plane'));
  oneAch('fleet', 'bendy', '🪗', 'Double bendy', 'A bus line with double bendy buses', topTier('bus'));
  oneAch('fleet', 'cruise', '🛳', 'Cruise ferry', 'A ferry line with cruise ferries', topTier('ferry'));
  oneAch('fleet', 'metro10', '🚇', 'Ten-car metro', 'A metro line with 10-car trains', topTier('metro'));
  oneAch('fleet', 'small', '🚐', 'Small is beautiful', 'A line that makes money with the smallest vehicle type', function (state) { var st = state.stats || { lines: {} }; return achLine(state, function (L) { return L.tier === 0 && S.TIERS && S.TIERS[L.mode] && st.lines[L.id] && st.lines[L.id].profit > 0; }); });
  oneAch('far', 'km100', '📏', 'Long line', 'A ground line 100 km long', function (state, m) { return Object.keys(m.kmMode).some(function (k) { return k !== 'plane' && m.kmMode[k] >= 100; }); });
  oneAch('far', 'fly5000', '🌐', 'Long haul', 'A flight of 5,000 km', function (state, m) { return (m.kmMode.plane || 0) >= 5000; });
  oneAch('far', 'fly10000', '🌏', 'Ultra long haul', 'A flight of 10,000 km', function (state, m) { return (m.kmMode.plane || 0) >= 10000; });

  var DESC = { pax: '{n} passengers carried in total', riders: '{n} riders in one day', profit: '€{n} profit in one day', bal: '€{n} in the bank', lines: '{n} lines running', stops: '{n} stops on working lines', ctry: 'Lines in {n} countries', cont: 'Lines on {n} continents', reach: '{n} people live near a stop', days: 'Reach day {n}', goals: 'Finish {n} goals' };
  function big(v) { return v >= 1e9 ? (v / 1e9) + ' billion' : v >= 1e6 ? (v / 1e6) + ' million' : v >= 1e5 && v % 1000 === 0 ? (v / 1000) + 'k' : num(v); }
  function achDone(state, a, m) { return a.test ? !!a.test(state, m) : a.get(state, m) >= a.target; }
  function checkAch(state, m) {
    m = m || metrics(state);
    var first = !state.ach, out = [], n = 0;
    if (!state.ach) state.ach = {};
    ACH.forEach(function (a) {
      if (state.ach[a.id]) return;
      if (achDone(state, a, m)) { state.ach[a.id] = state.day; n++; if (!first) out.push({ type: 'ach', ach: a }); }
    });
    if (first && n) out.push({ type: 'achBulk', count: n });
    return out;
  }
  function achList(state) {
    var m = metrics(state);
    return ACH.map(function (a) {
      var v = a.get ? a.get(state, m) : null;
      return { id: a.id, group: a.group, icon: a.icon, title: a.title, desc: a.get ? DESC[a.group].replace('{n}', big(a.target)) : a.desc, day: state.ach && state.ach[a.id], frac: a.get ? Math.max(0, Math.min(1, v / a.target)) : null, now: v, target: a.target, unit: a.unit };
    });
  }

  var checkGoals = check;
  check = function (state) { var out = checkGoals(state); return out.concat(checkAch(state)); };

  S.setHooks({ fx: fx, events: eventsDaily, goals: check });

  var api = {
    ensure: ensureGoals, check: function (s) { return check(s); }, achList: achList, ACH_GROUPS: GROUPS, checkAch: checkAch, skip: skip, progress: progress, metrics: metrics, fx: fx, seasonOf: seasonOf, SEASONS: SEASONS,
    activeEvents: activeEvents, spawnEvent: spawnEvent, EVENT_TYPES: EVENT_TYPES, GOAL_TYPES: Object.keys(MAKERS), makeGoal: function (state, key) { return makeGoal(state, key, metrics(state)); }, YEAR: YEAR
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TGGoals = api;
})(typeof window !== 'undefined' ? window : globalThis);
