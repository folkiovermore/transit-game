# Transit Game

A Mini Metro style public transport game on a real OpenStreetMap map, anywhere in the world. You build the whole network yourself: connect where people live to where they work, keep your balance above zero, and watch the city grow around your lines.

Personal project, single player. Plain HTML, CSS and JavaScript, no build step. Version 0.3.

## Play it

Open the page, type a city, press **New game**. The game saves in the browser automatically.

- **Lines > New line > Bus**, then tap the map to place stops. Each tap adds a stop and the line routes itself with 45° and 90° bends, no curves.
- Tap an existing station to join it into the line (this is how you make interchanges).
- Lines can be extended from **both ends**. Select a line, tap an end ring, then tap the map.
- **Done** finishes the line. Two vehicles are bought for you. Add more in the line panel.
- Tap a segment of the selected line to flip its bend.
- **Station** tool places stand-alone stations. **Demand** shows homes (orange) and jobs (blue).
- **Save** (bottom bar) downloads a backup file or loads one. The start screen can also load a backup.
- Keyboard: Space pauses, Esc cancels.
- Tram, rail and metro unlock as your network carries more passengers in total. Ferries are not built yet.
- You lose if your balance stays below zero for 3 days.

## Design decisions (settled)

- Whole world, any city, picked by search (Nominatim).
- All modes eventually: bus, tram, rail, metro, ferry later.
- No timetables, no signalling, no double tracks. Lines are simple chains of stops.
- Lines auto-connect with 45° and 90° bends only.
- The player builds the whole network. Nothing is imported from real transit data.
- Modern day only. The city grows over time. Lose when money runs out. Modes unlock as you grow.
- Dark theme, matching the five mockups. Touch and desktop equally.
- Hosted on GitHub Pages, installable as a PWA, online only is fine.
- Real homes and jobs come from OpenStreetMap, rescaled so every city has about 14,000 residents and 9,000 jobs at the start. That keeps the economy comparable between cities.

## How it works

- **Map:** Leaflet with CARTO dark tiles. A canvas on top draws blocks, catchments, lines, vehicles and stations.
- **Routing (`js/routing.js`):** each segment is a straight leg plus at most one 45° leg. The bend direction is chosen from the previous heading. Parallel lines that share a corridor are bundled and offset. Pure functions.
- **Simulation (`js/sim.js`):** a daily aggregate model, not per-vehicle. Demand between blocks follows a gravity model. Trips are routed with Dijkstra over the network, with transfer and wait penalties. Peak capacity limits how many passengers a line carries. Income is fares, costs are vehicles, track, stations and maintenance. All tuning numbers are at the top of the file in `MODES` and `BAL`.
- **Real demand (`js/osm.js`):** one Overpass query for land use areas (residential, commercial, retail, industrial), offices, shops, schools, universities, hospitals and apartment buildings within 3.5 km. Areas are sampled to points, grouped into cells, then rescaled to the target totals. If the request fails, the game falls back to a generated city and shows a message.
- **Station names:** nearest street from Nominatim, one request per second. Only coordinates are sent. If it fails they stay "Stop N".
- **Saves:** `localStorage`, key `transit-game-save-v1`, per browser and per device. Backup files are the same JSON, via the Save sheet (`exportSave`, `importSave` in `js/game.js`). Changing the save format needs a migration or a new key.
- **PWA:** `manifest.webmanifest` and `sw.js` (network first). Bump the `CACHE` name in `sw.js` and add any new file to its `FILES` list whenever files change.

## Files

- `index.html`, `style.css` page and styling
- `js/routing.js` auto-routing and parallel line bundling
- `js/sim.js` rules, costs, demand, growth, daily economy
- `js/osm.js` converts OpenStreetMap data into homes and jobs
- `js/game.js` map, drawing, input, interface, saving, start screen
- `tests/test.js` run with `node tests/test.js` (routing, bundling, economy over 40 days, extending lines, bankruptcy, OpenStreetMap conversion)
- `vendor/leaflet` the map library (BSD licence)
- `manifest.webmanifest`, `sw.js`, `icons/`, `.nojekyll` PWA and hosting

## Put it on GitHub Pages

1. Upload everything in this folder to the root of the repo (the files themselves, not a folder containing them).
2. Repo **Settings > Pages**, set the source to the `main` branch, folder `/ (root)`.
3. After a minute the game is live at `https://<username>.github.io/<repo>/`.
4. On a phone or desktop Chrome, use **Install** or **Add to Home Screen** to get it as an app.

If a new version does not show up, close and reopen the app once, or clear site data.

## Test build in Claude

A single-file copy of the game is published as an artifact for quick testing. It cannot reach the internet from inside the preview, so it uses a grid instead of map tiles, a generated city, and no station names. Real data and the real map only work on the GitHub version.

## Status

Done: auto-routing and bundling, economy, unlocks, growth, saves, PWA, mobile layout, OSM station names, extending lines at both ends, real homes and jobs from OpenStreetMap.

Not verified: the live Overpass request. It was tested only with a fake response. If the first real run falls back to a generated city, the query in `js/osm.js` (`buildQuery`) is the first place to look.

## Known limits and ideas for next

- The game does not know about water, so lines can cross rivers for free. No ferries yet.
- Growth adds generated blocks near existing demand. It does not yet follow real city expansion.
- Real data covers a 3.5 km radius around the chosen point. Larger cities are cut off at the edge.
- Ideas: ferries and water crossings, line colours and renaming, per-line profit view, bigger map radius, a second city per save, sounds.
- Map tiles are from CARTO (dark basemap), data © OpenStreetMap contributors.
