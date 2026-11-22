/* Turns OpenStreetMap land use and points of interest into "blocks" of homes and jobs.
 * The world is cut into chunks of about 9 km. Each chunk is loaded on its own when the player looks at it.
 * Pure functions, no DOM and no network: game.js does the fetching. */
(function (root) {
  'use strict';

  var CFG = {
    startRadiusM: 3500,            // the area around the start point that is used to calibrate how many people the game shows
    targetPop: 14000,              // ...so that this area holds about this many residents...
    targetJobs: 9000,              // ...and this many jobs. Every other place then uses the same scale.
    defaultScale: 0.15,            // used when calibration is not possible
    chunkDeg: 0.08,                // chunk height in degrees of latitude (about 9 km)
    maxCells: 450,                 // per chunk
    cellSizesM: [300, 400, 550, 800],
    sampleM: 100,                  // spacing used to spread a land use area over the map
    popPerM2: 0.011,               // residents per m2 of residential land use
    jobsPerM2: { commercial: 0.015, retail: 0.012, industrial: 0.004 },
    apartmentPop: 45,              // residents per mapped apartment building
    office: 8, shop: 4,
    amenityJobs: { school: 30, college: 60, university: 120, hospital: 150 }
  };

  /* ---------- chunks ---------- */
  function rowLngStep(row) {
    var latMid = (row + 0.5) * CFG.chunkDeg;
    var c = Math.max(0.05, Math.cos(Math.min(85, Math.abs(latMid)) * Math.PI / 180));
    return Math.round(CFG.chunkDeg / c * 100) / 100;
  }
  function chunkAt(lat, lng) {
    var row = Math.floor(lat / CFG.chunkDeg), step = rowLngStep(row), col = Math.floor(lng / step);
    return row + ':' + col;
  }
  function chunkBox(key) {
    var p = key.split(':'), row = +p[0], col = +p[1], step = rowLngStep(row);
    return { s: row * CFG.chunkDeg, n: (row + 1) * CFG.chunkDeg, w: col * step, e: (col + 1) * step };
  }
  /* All chunks that touch a lat/lng box. */
  function chunksIn(box) {
    var out = [], r0 = Math.floor(box.s / CFG.chunkDeg), r1 = Math.floor(box.n / CFG.chunkDeg);
    for (var r = r0; r <= r1; r++) {
      var step = rowLngStep(r), c0 = Math.floor(box.w / step), c1 = Math.floor(box.e / step);
      for (var c = c0; c <= c1; c++) out.push(r + ':' + c);
    }
    return out;
  }
  function unionBox(keys) {
    var u = null;
    keys.forEach(function (k) {
      var b = chunkBox(k);
      u = u ? { s: Math.min(u.s, b.s), n: Math.max(u.n, b.n), w: Math.min(u.w, b.w), e: Math.max(u.e, b.e) } : b;
    });
    return u;
  }
  function bboxFor(lat, lng, radiusM) {
    var dLat = radiusM / 111320, dLng = radiusM / (111320 * Math.cos(lat * Math.PI / 180));
    return { s: lat - dLat, n: lat + dLat, w: lng - dLng, e: lng + dLng };
  }

  /* Overpass QL: land use outlines with geometry, then points and buildings as centres. */
  function buildQuery(b, timeoutSec) {
    var box = '(' + [b.s, b.w, b.n, b.e].map(function (v) { return v.toFixed(5); }).join(',') + ')';
    return '[out:json][timeout:' + (timeoutSec || 90) + '];\n' +
      '(way["landuse"~"^(residential|commercial|retail|industrial)$"]' + box + ';);\n' +
      'out geom;\n' +
      '(node["office"]' + box + ';node["shop"]' + box + ';' +
      'nwr["amenity"~"^(school|college|university|hospital)$"]' + box + ';' +
      'way["building"="apartments"]' + box + ';);\n' +
      'out center;';
  }

  /* ---------- geometry ---------- */
  function polyArea(pts) {
    var a = 0;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
    return Math.abs(a / 2);
  }
  function inPoly(x, y, pts) {
    var inside = false;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      if (((pts[i].y > y) !== (pts[j].y > y)) && (x < (pts[j].x - pts[i].x) * (y - pts[i].y) / (pts[j].y - pts[i].y) + pts[i].x)) inside = !inside;
    }
    return inside;
  }

  /* Every home and job in the data as a list of weighted points {x, y, pop, jobs}, in game pixels. */
  function collectSamples(elements, proj, mpp) {
    var samples = [];
    (elements || []).forEach(function (el) {
      var t = el.tags || {};
      if (el.geometry && t.landuse) {
        var pts = el.geometry.map(function (g) { return proj(g.lat, g.lon); });
        if (pts.length < 3) return;
        var isPop = t.landuse === 'residential';
        var perM2 = isPop ? CFG.popPerM2 : CFG.jobsPerM2[t.landuse];
        if (!perM2) return;
        var total = polyArea(pts) * mpp * mpp * perM2;
        var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        pts.forEach(function (p) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); });
        var step = Math.max(CFG.sampleM / mpp, Math.sqrt((maxX - minX) * (maxY - minY) / 1500));
        var found = [];
        for (var x = minX + step / 2; x < maxX; x += step) for (var y = minY + step / 2; y < maxY; y += step) {
          if (inPoly(x, y, pts)) found.push({ x: x, y: y });
        }
        if (!found.length) {
          var cx = 0, cy = 0;
          pts.forEach(function (p) { cx += p.x; cy += p.y; });
          found.push({ x: cx / pts.length, y: cy / pts.length });
        }
        found.forEach(function (f) { samples.push({ x: f.x, y: f.y, pop: isPop ? total / found.length : 0, jobs: isPop ? 0 : total / found.length }); });
        return;
      }
      var lat = el.lat !== undefined ? el.lat : el.center && el.center.lat;
      var lon = el.lon !== undefined ? el.lon : el.center && el.center.lon;
      if (lat === undefined || lon === undefined) return;
      var p = proj(lat, lon), pop = 0, jobs = 0;
      if (t.building === 'apartments') pop = CFG.apartmentPop;
      else if (t.amenity && CFG.amenityJobs[t.amenity]) jobs = CFG.amenityJobs[t.amenity];
      else if (t.office) jobs = CFG.office;
      else if (t.shop) jobs = CFG.shop;
      if (pop || jobs) samples.push({ x: p.x, y: p.y, pop: pop, jobs: jobs });
    });
    return samples;
  }

  /* How strongly to scale raw numbers so the area around the start point holds about targetPop and targetJobs.
   * Returns null when there is not enough data (no homes or no jobs mapped). */
  function calibrate(elements, proj, mpp, radiusM) {
    var maxR = (radiusM || CFG.startRadiusM) / mpp, pop = 0, jobs = 0;
    collectSamples(elements, proj, mpp).forEach(function (s) {
      if (Math.hypot(s.x, s.y) <= maxR) { pop += s.pop; jobs += s.jobs; }
    });
    if (pop < 1 || jobs < 1) return null;
    return { popScale: CFG.targetPop / pop, jobScale: CFG.targetJobs / jobs, rawPop: Math.round(pop), rawJobs: Math.round(jobs) };
  }

  /* Blocks for the samples that fall inside bounds {x0,y0,x1,y1} (game pixels). May return an empty list. */
  function buildChunkBlocks(elements, proj, mpp, bounds, scales) {
    var ps = scales && scales.popScale || CFG.defaultScale, js = scales && scales.jobScale || CFG.defaultScale;
    var samples = collectSamples(elements, proj, mpp).filter(function (s) {
      return s.x >= bounds.x0 && s.x < bounds.x1 && s.y >= bounds.y0 && s.y < bounds.y1;
    });
    if (!samples.length) return [];
    var blocks = [];
    for (var ci = 0; ci < CFG.cellSizesM.length; ci++) {
      var cellPx = CFG.cellSizesM[ci] / mpp, cells = new Map();
      samples.forEach(function (s) {
        var key = Math.floor(s.x / cellPx) + ',' + Math.floor(s.y / cellPx);
        var c = cells.get(key);
        if (!c) { c = { pop: 0, jobs: 0, wx: 0, wy: 0, w: 0 }; cells.set(key, c); }
        var w = s.pop * ps + s.jobs * js;
        c.pop += s.pop; c.jobs += s.jobs; c.wx += s.x * w; c.wy += s.y * w; c.w += w;
      });
      blocks = [];
      cells.forEach(function (c) {
        var pop = c.pop * ps, jobs = c.jobs * js;
        if (pop + jobs < 6 || c.w <= 0) return;
        blocks.push({ x: c.wx / c.w, y: c.wy / c.w, pop: Math.round(pop), jobs: Math.round(jobs) });
      });
      if (blocks.length <= CFG.maxCells) break;
    }
    return blocks;
  }

  var api = {
    CFG: CFG, bboxFor: bboxFor, buildQuery: buildQuery, chunkAt: chunkAt, chunkBox: chunkBox, chunksIn: chunksIn, unionBox: unionBox,
    collectSamples: collectSamples, calibrate: calibrate, buildChunkBlocks: buildChunkBlocks
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TGOsm = api;
})(typeof window !== 'undefined' ? window : globalThis);
