/* Turns OpenStreetMap land use and points of interest into "blocks" of homes and jobs.
 * Pure functions, no DOM and no network: game.js does the fetching. */
(function (root) {
  'use strict';

  var CFG = {
    radiusM: 3500,                 // how far from the city centre we load data
    targetPop: 14000,              // the game is scaled so every city has about this many residents...
    targetJobs: 9000,              // ...and this many jobs, which keeps the economy comparable between cities
    maxCells: 450,
    cellSizesM: [300, 400, 550, 800],
    sampleM: 100,                  // spacing used to spread a land use area over the map
    popPerM2: 0.011,               // residents per m2 of residential land use
    jobsPerM2: { commercial: 0.015, retail: 0.012, industrial: 0.004 },
    apartmentPop: 45,              // residents per mapped apartment building
    office: 8, shop: 4,
    amenityJobs: { school: 30, college: 60, university: 120, hospital: 150 }
  };

  function bboxFor(lat, lng, radiusM) {
    var dLat = radiusM / 111320, dLng = radiusM / (111320 * Math.cos(lat * Math.PI / 180));
    return { s: lat - dLat, n: lat + dLat, w: lng - dLng, e: lng + dLng };
  }

  /* Overpass QL: land use outlines with geometry, then points and buildings as centres. */
  function buildQuery(b) {
    var box = '(' + [b.s, b.w, b.n, b.e].map(function (v) { return v.toFixed(5); }).join(',') + ')';
    return '[out:json][timeout:60];\n' +
      '(way["landuse"~"^(residential|commercial|retail|industrial)$"]' + box + ';);\n' +
      'out geom;\n' +
      '(node["office"]' + box + ';node["shop"]' + box + ';' +
      'nwr["amenity"~"^(school|college|university|hospital)$"]' + box + ';' +
      'way["building"="apartments"]' + box + ';);\n' +
      'out center;';
  }

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

  /* elements: Overpass JSON elements. proj({lat,lng}) -> {x,y} game pixels. mpp: metres per pixel.
   * Returns {blocks, info} or null when there is not enough data to play with. */
  function buildBlocks(elements, proj, mpp, opts) {
    var cfg = Object.assign({}, CFG, opts || {});
    var maxR = cfg.radiusM / mpp;
    var samples = [];                       // {x, y, pop, jobs}

    function addSample(x, y, pop, jobs) {
      if (Math.hypot(x, y) <= maxR && (pop > 0 || jobs > 0)) samples.push({ x: x, y: y, pop: pop, jobs: jobs });
    }

    (elements || []).forEach(function (el) {
      var t = el.tags || {};
      if (el.geometry && t.landuse) {
        var pts = el.geometry.map(function (g) { return proj(g.lat, g.lon); });
        if (pts.length < 3) return;
        var areaM2 = polyArea(pts) * mpp * mpp;
        var perM2 = t.landuse === 'residential' ? cfg.popPerM2 : cfg.jobsPerM2[t.landuse];
        if (!perM2) return;
        var total = areaM2 * perM2;
        var isPop = t.landuse === 'residential';
        var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        pts.forEach(function (p) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); });
        var step = Math.max(cfg.sampleM / mpp, Math.sqrt((maxX - minX) * (maxY - minY) / 1500));
        var found = [];
        for (var x = minX + step / 2; x < maxX; x += step) for (var y = minY + step / 2; y < maxY; y += step) {
          if (inPoly(x, y, pts)) found.push({ x: x, y: y });
        }
        if (!found.length) {
          var cx = 0, cy = 0;
          pts.forEach(function (p) { cx += p.x; cy += p.y; });
          found.push({ x: cx / pts.length, y: cy / pts.length });
        }
        found.forEach(function (f) { addSample(f.x, f.y, isPop ? total / found.length : 0, isPop ? 0 : total / found.length); });
        return;
      }
      var lat = el.lat !== undefined ? el.lat : el.center && el.center.lat;
      var lon = el.lon !== undefined ? el.lon : el.center && el.center.lon;
      if (lat === undefined || lon === undefined) return;
      var p = proj(lat, lon);
      if (t.building === 'apartments') addSample(p.x, p.y, cfg.apartmentPop, 0);
      else if (t.amenity && cfg.amenityJobs[t.amenity]) addSample(p.x, p.y, 0, cfg.amenityJobs[t.amenity]);
      else if (t.office) addSample(p.x, p.y, 0, cfg.office);
      else if (t.shop) addSample(p.x, p.y, 0, cfg.shop);
    });

    var rawPop = 0, rawJobs = 0;
    samples.forEach(function (s) { rawPop += s.pop; rawJobs += s.jobs; });
    if (rawPop < 1 || rawJobs < 1) return null;        // need both homes and jobs to play
    var popScale = cfg.targetPop / rawPop;
    var jobScale = cfg.targetJobs / rawJobs;

    var blocks = [], cellM = 0;
    for (var ci = 0; ci < cfg.cellSizesM.length; ci++) {
      cellM = cfg.cellSizesM[ci];
      var cellPx = cellM / mpp, cells = new Map();
      samples.forEach(function (s) {
        var key = Math.floor(s.x / cellPx) + ',' + Math.floor(s.y / cellPx);
        var c = cells.get(key);
        if (!c) { c = { pop: 0, jobs: 0, wx: 0, wy: 0, w: 0 }; cells.set(key, c); }
        var w = s.pop * popScale + s.jobs * jobScale;
        c.pop += s.pop; c.jobs += s.jobs; c.wx += s.x * w; c.wy += s.y * w; c.w += w;
      });
      blocks = [];
      cells.forEach(function (c) {
        var pop = c.pop * popScale, jobs = c.jobs * jobScale;
        if (pop + jobs < 6 || c.w <= 0) return;
        blocks.push({ x: c.wx / c.w, y: c.wy / c.w, pop: Math.round(pop), jobs: Math.round(jobs) });
      });
      if (blocks.length <= cfg.maxCells) break;
    }
    if (blocks.length < 8) return null;
    return { blocks: blocks, info: { cells: blocks.length, cellM: cellM, rawPop: Math.round(rawPop), rawJobs: Math.round(rawJobs) } };
  }

  var api = { CFG: CFG, bboxFor: bboxFor, buildQuery: buildQuery, buildBlocks: buildBlocks };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TGOsm = api;
})(typeof window !== 'undefined' ? window : globalThis);
