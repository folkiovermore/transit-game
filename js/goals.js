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

  /* What the world looks like today: demand and cost multipliers, striking lines, closed stops, rush spots. */
  function fx(state) {
    var out = { demand: seasonOf(state.day).demand, cost: 1, strike: {}, closed: {}, spots: [] };
    if (!state.ev) return out;
    state.ev.list.forEach(function (e) {
      if (state.day > e.until) return;
      if (e.type === 'strike') out.strike[e.lineId] = true;
      else if (e.type === 'closure') out.closed[e.stationId] = true;
      else if (e.type === 'fuel') out.cost *= e.mult;
      else if (e.type === 'storm') out.demand *= e.mult;
      else if (e.type === 'festival' || e.type === 'match') out.spots.push({ x: e.x, y: e.y, r: e.r, mult: e.mult });
    });
    return out;
  }

  var EVENT_KINDS = {
    strike: { good: false, icon: '✊' },
    fuel: { good: false, icon: '⛽' },
    closure: { good: false, icon: '🚧' },
    storm: { good: false, icon: '⛈' },
    festival: { good: true, icon: '🎪' },
    match: { good: true, icon: '🏟' }
  };

  function spawnEvent(state) {
    var ev = ensureEv(state);
    var lines = working(state);
    if (!lines.length) return null;
    var sMap = S.stationMap(state);
    var onLine = [];
    lines.forEach(function (L) { L.stations.forEach(function (id) { if (onLine.indexOf(id) < 0) onLine.push(id); }); });
    var good = rnd(state) < 0.45;
    var types = good ? ['festival', 'match'] : ['strike', 'fuel', 'closure', 'storm'];
    var type = pick(state, types);
    var e = { id: ev.nextId++, type: type, good: good, start: state.day };
    if (type === 'strike') {
      var L = pick(state, lines);
      e.lineId = L.id; e.until = state.day + 2;
      e.title = 'Strike on ' + lineName(L);
      e.text = 'No service for 3 days. Only track and stop costs continue.';
    } else if (type === 'fuel') {
      e.mult = 1.5; e.until = state.day + 6;
      e.title = 'Fuel prices up';
      e.text = 'Vehicle and track running costs are 50% higher for a week.';
    } else if (type === 'closure') {
      var cands = onLine.filter(function (id) { return sMap.get(id); });
      var sid = pick(state, cands), st = sMap.get(sid);
      e.stationId = sid; e.until = state.day + 3;
      e.title = st.name + ' closed';
      e.text = 'Closed for repairs for 4 days, so nobody boards or leaves there.';
    } else if (type === 'storm') {
      e.mult = 0.65; e.until = state.day + 1;
      e.title = 'Storm';
      e.text = 'Fewer people travel for 2 days.';
    } else {
      var st2 = sMap.get(pick(state, onLine));
      e.x = st2.x; e.y = st2.y; e.stationId = st2.id;
      if (type === 'festival') { e.r = 1500; e.mult = 3; e.until = state.day + 2; e.title = 'Festival near ' + st2.name; e.text = 'Crowds in the area for 3 days. Serve them while it lasts.'; }
      else { e.r = 1200; e.mult = 4; e.until = state.day + 1; e.title = 'Big match near ' + st2.name; e.text = 'A rush of riders around this stop for 2 days.'; }
    }
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
  function ensureGoals(state) {
    if (!state.goals) state.goals = { active: [], done: [], count: 0, failed: 0, earned: 0, nextId: 1 };
    ensureEv(state);
    return state.goals;
  }

  function metrics(state) {
    var lines = working(state), sMap = S.stationMap(state);
    var m = { lines: lines.length, maxKm: 0, modes: {}, ccs: [], stationsWithCc: 0, maxLineProfit: 0, allBus: lines.length > 0, maxLoad: 0 };
    var stats = state.stats || { lines: {}, riders: 0, profit: 0 };
    var ids = [], seen = {};
    lines.forEach(function (L) {
      m.maxKm = Math.max(m.maxKm, S.lineLenM(state, L, sMap) / 1000);
      m.modes[L.mode] = true;
      if (L.mode !== 'bus') m.allBus = false;
      var ls = stats.lines[L.id];
      if (ls) { m.maxLineProfit = Math.max(m.maxLineProfit, ls.profit); m.maxLoad = Math.max(m.maxLoad, ls.load); }
      L.stations.forEach(function (id) {
        if (seen[id]) return; seen[id] = true; ids.push(id);
        var s = sMap.get(id);
        if (s && s.cc !== undefined) m.stationsWithCc++;
        if (s && s.cc && m.ccs.indexOf(s.cc) < 0) m.ccs.push(s.cc);
      });
    });
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
          if (d < 12000) near = true;
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
    smooth: function (state, m, base) {
      if (m.lines < 2) return null;
      var cur = state.stats ? state.stats.riders : 0;
      var T = niceRound(Math.max(300, cur * 1.3));
      return { kind: 'challenge', title: 'No crowding: ' + num(T) + ' riders a day', desc: 'Reach this many riders with every line under 95% full at peak. Add vehicles where it is crowded.', target: T, reward: round5k(base * 1.5) };
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
      case 'smooth':
        f = st.riders / g.target; text = num(st.riders) + ' of ' + num(g.target) + ' a day';
        if (m.lines < 2) bad = 'Needs at least 2 lines';
        else if (m.maxLoad >= 0.95) bad = 'A line is ' + Math.round(m.maxLoad * 100) + '% full';
        break;
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
      var keys = Object.keys(MAKERS).filter(function (k) { return haveKeys.indexOf(k) < 0; });
      if (!keys.length) break;
      // prefer a kind that is not shown yet, and not the one just completed
      var fresh = keys.filter(function (k) { var kd = kindOf(k); return haveKinds.indexOf(kd) < 0 && kd !== G.lastKind; });
      var pool = fresh.length ? fresh : keys;
      var g = null, tries = pool.slice();
      while (!g && tries.length) {
        var k = tries.splice(Math.floor(rnd(state) * tries.length) % tries.length, 1)[0];
        g = makeGoal(state, k, m);
      }
      if (!g) break;
      g.id = G.nextId++;
      g.start = state.day;
      if (g.days) g.deadline = state.day + g.days;
      G.active.push(g); added.push(g);
    }
    return added;
  }
  function kindOf(key) { return { linelen: 'build', places: 'build', countries: 'build', lines: 'build', modeline: 'build', pax: 'numbers', dailyriders: 'numbers', profit: 'numbers', balance: 'numbers', spot: 'contract', ridersoon: 'contract', busonly: 'challenge', smooth: 'challenge', starline: 'challenge' }[key]; }

  /* Checks every active goal: pays out finished ones, drops expired contracts, tops the list up. Returns events for the UI. */
  function check(state) {
    var G = ensureGoals(state), out = [], m = metrics(state);
    var keep = [];
    G.active.forEach(function (g) {
      var p = progress(state, g, m);
      if (p.done) {
        state.balance += g.reward;
        G.count++; G.earned += g.reward; G.lastKind = g.kind;
        G.done.unshift({ title: g.title, reward: g.reward, day: state.day });
        if (G.done.length > 25) G.done.pop();
        out.push({ type: 'goal', goal: g });
      } else if (g.deadline !== undefined && state.day > g.deadline) {
        G.failed++; G.lastKind = g.kind;
        out.push({ type: 'goalExpired', goal: g });
      } else keep.push(g);
    });
    G.active = keep;
    refill(state);
    return out;
  }

  S.setHooks({ fx: fx, events: eventsDaily, goals: check });

  var api = {
    ensure: ensureGoals, check: check, progress: progress, metrics: metrics, fx: fx, seasonOf: seasonOf, SEASONS: SEASONS,
    activeEvents: activeEvents, spawnEvent: spawnEvent, EVENT_KINDS: EVENT_KINDS, YEAR: YEAR
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TGGoals = api;
})(typeof window !== 'undefined' ? window : globalThis);
