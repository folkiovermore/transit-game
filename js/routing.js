/* Mini Metro style auto-routing: every segment between two stations is at most
 * one straight (horizontal/vertical) leg plus one 45 degree diagonal leg.
 * Also lays out parallel offsets where several lines share a corridor.
 * Pure functions, no DOM. Coordinates are plain {x, y} in map pixels. */
(function (root) {
  'use strict';
  var SQ2 = Math.SQRT1_2;

  function sign(v) { return v > 0 ? 1 : v < 0 ? -1 : 0; }

  function unit(a, b) {
    var dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy);
    return l < 1e-9 ? null : { x: dx / l, y: dy / l };
  }

  function turnAngle(d1, d2) {
    if (!d1 || !d2) return 0;
    var dot = Math.max(-1, Math.min(1, d1.x * d2.x + d1.y * d2.y));
    return Math.acos(dot);
  }

  /* Route from a to b. prevDir is the unit direction the line was travelling when it
   * arrived at a (or null). flip swaps the two possible bend layouts. */
  function routeSegment(a, b, prevDir, flip) {
    var dx = b.x - a.x, dy = b.y - a.y;
    var adx = Math.abs(dx), ady = Math.abs(dy);
    var sx = sign(dx), sy = sign(dy);
    if (adx < 1e-6 || ady < 1e-6 || Math.abs(adx - ady) < 1e-6) return [a, b];
    var dmin = Math.min(adx, ady);
    var diagPt = { x: a.x + sx * dmin, y: a.y + sy * dmin };
    var straightPt = adx > ady
      ? { x: a.x + sx * (adx - ady), y: a.y }
      : { x: a.x, y: a.y + sy * (ady - adx) };
    var optDiagFirst = [a, diagPt, b];
    var optStraightFirst = [a, straightPt, b];
    var tDiag = turnAngle(prevDir, unit(a, diagPt));
    var tStraight = turnAngle(prevDir, unit(a, straightPt));
    var useDiag = tDiag < tStraight - 1e-9;
    if (flip) useDiag = !useDiag;
    return useDiag ? optDiagFirst : optStraightFirst;
  }

  /* points: station positions in order. flips: array (length points.length-1) of booleans.
   * Returns one polyline per segment between consecutive stations. */
  function buildSegments(points, flips) {
    var segs = [];
    var prevDir = null;
    for (var i = 0; i < points.length - 1; i++) {
      var seg = routeSegment(points[i], points[i + 1], prevDir, !!(flips && flips[i]));
      segs.push(seg);
      prevDir = unit(seg[seg.length - 2], seg[seg.length - 1]);
    }
    return segs;
  }

  /* The whole line as one polyline (consecutive duplicates removed). */
  function buildBasePath(points, flips) {
    if (!points.length) return [];
    var out = [points[0]];
    buildSegments(points, flips).forEach(function (seg) {
      for (var k = 1; k < seg.length; k++) out.push(seg[k]);
    });
    return dedupe(out);
  }

  function dedupe(pts) {
    var out = [];
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i], q = out[out.length - 1];
      if (!q || Math.hypot(p.x - q.x, p.y - q.y) > 0.01) out.push({ x: p.x, y: p.y });
    }
    return out;
  }

  function pathLength(pts) {
    var s = 0;
    for (var i = 0; i < pts.length - 1; i++) s += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    return s;
  }

  var CLASSES = {
    h: { d: { x: 1, y: 0 }, n: { x: 0, y: 1 } },
    v: { d: { x: 0, y: 1 }, n: { x: 1, y: 0 } },
    a: { d: { x: SQ2, y: SQ2 }, n: { x: -SQ2, y: SQ2 } },
    b: { d: { x: SQ2, y: -SQ2 }, n: { x: SQ2, y: SQ2 } }
  };

  /* lines: [{id, base: [points]}]. Returns Map id -> offset polyline.
   * Legs of different lines that lie on the same straight corridor are laid side by side. */
  function layoutLines(lines, spacing) {
    var legs = [];
    var perLine = new Map();
    lines.forEach(function (L) {
      var mine = [];
      for (var i = 0; i < L.base.length - 1; i++) {
        var p = L.base[i], q = L.base[i + 1];
        var dx = q.x - p.x, dy = q.y - p.y;
        if (Math.hypot(dx, dy) < 1e-6) continue;
        var cls = Math.abs(dy) < 1e-6 ? 'h' : Math.abs(dx) < 1e-6 ? 'v' : (dx * dy > 0 ? 'a' : 'b');
        var C = CLASSES[cls];
        var leg = {
          lineId: L.id, p: p, q: q, cls: cls, n: C.n,
          tp: p.x * C.d.x + p.y * C.d.y,
          tq: q.x * C.d.x + q.y * C.d.y,
          c: p.x * C.n.x + p.y * C.n.y,
          subs: null
        };
        mine.push(leg);
        legs.push(leg);
      }
      perLine.set(L.id, mine);
    });

    var groups = new Map();
    legs.forEach(function (g) {
      var key = g.cls + ':' + Math.round(g.c / 2);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(g);
    });

    groups.forEach(function (list) {
      var ids = new Set(list.map(function (g) { return g.lineId; }));
      if (ids.size < 2) return;
      var cuts = [];
      list.forEach(function (g) { cuts.push(g.tp, g.tq); });
      cuts.sort(function (a, b) { return a - b; });
      var uniq = [];
      cuts.forEach(function (t) { if (!uniq.length || t - uniq[uniq.length - 1] > 0.5) uniq.push(t); });
      list.forEach(function (g) {
        var lo = Math.min(g.tp, g.tq), hi = Math.max(g.tp, g.tq);
        var subs = [];
        for (var i = 0; i < uniq.length - 1; i++) {
          var a = uniq[i], b = uniq[i + 1];
          if (a < lo - 0.5 || b > hi + 0.5) continue;
          var mid = (a + b) / 2;
          var active = new Set();
          list.forEach(function (o) {
            if (mid >= Math.min(o.tp, o.tq) && mid <= Math.max(o.tp, o.tq)) active.add(o.lineId);
          });
          var sorted = Array.from(active).sort(function (x, y) { return x - y; });
          var rank = sorted.indexOf(g.lineId);
          var off = sorted.length > 1 ? (rank - (sorted.length - 1) / 2) * spacing : 0;
          subs.push({ a: a, b: b, off: off });
        }
        if (g.tq < g.tp) {
          subs.reverse();
          subs.forEach(function (s) { var t = s.a; s.a = s.b; s.b = t; });
        }
        g.subs = subs;
      });
    });

    var result = new Map();
    lines.forEach(function (L) {
      var pts = [];
      (perLine.get(L.id) || []).forEach(function (g) {
        if (!g.subs || !g.subs.length) { pts.push(g.p, g.q); return; }
        var span = g.tq - g.tp;
        g.subs.forEach(function (s) {
          var ua = (s.a - g.tp) / span, ub = (s.b - g.tp) / span;
          pts.push({ x: g.p.x + (g.q.x - g.p.x) * ua + g.n.x * s.off, y: g.p.y + (g.q.y - g.p.y) * ua + g.n.y * s.off });
          pts.push({ x: g.p.x + (g.q.x - g.p.x) * ub + g.n.x * s.off, y: g.p.y + (g.q.y - g.p.y) * ub + g.n.y * s.off });
        });
      });
      result.set(L.id, pts.length ? dedupe(pts) : L.base.slice());
    });
    return result;
  }

  /* Point at distance d along a polyline, plus its heading. */
  function pointAlong(pts, d) {
    if (pts.length === 1) return { x: pts[0].x, y: pts[0].y, ang: 0 };
    var rem = d;
    for (var i = 0; i < pts.length - 1; i++) {
      var l = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
      if (rem <= l || i === pts.length - 2) {
        var t = l > 0 ? Math.min(1, rem / l) : 0;
        return {
          x: pts[i].x + (pts[i + 1].x - pts[i].x) * t,
          y: pts[i].y + (pts[i + 1].y - pts[i].y) * t,
          ang: Math.atan2(pts[i + 1].y - pts[i].y, pts[i + 1].x - pts[i].x)
        };
      }
      rem -= l;
    }
    return { x: pts[0].x, y: pts[0].y, ang: 0 };
  }

  /* Distance from point to polyline. */
  function distToPath(pts, p) {
    var best = Infinity;
    for (var i = 0; i < pts.length - 1; i++) {
      var a = pts[i], b = pts[i + 1];
      var vx = b.x - a.x, vy = b.y - a.y, l2 = vx * vx + vy * vy;
      var t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / l2)) : 0;
      best = Math.min(best, Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t)));
    }
    return best;
  }

  var api = {
    routeSegment: routeSegment,
    buildBasePath: buildBasePath,
    buildSegments: buildSegments,
    layoutLines: layoutLines,
    pathLength: pathLength,
    pointAlong: pointAlong,
    distToPath: distToPath,
    unit: unit
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TGRouting = api;
})(typeof window !== 'undefined' ? window : globalThis);
