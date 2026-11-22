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
- **Rename** a line from its panel. **Stats** (bottom bar) shows balance, riders, profit, how much of the population and jobs lie near a stop, history charts, lines ranked by profit and the stops where most people are left behind.
- **Save** (bottom bar) downloads a backup file or loads one. The start screen can also load a backup.
- A scale bar sits bottom left. With Demand on, a legend explains the dots (orange homes, blue jobs, bigger means more) and the loaded and unloaded areas. Close it with the ×.
- Keyboard: Space pauses, Esc cancels.
- Stops can be close together: 40 m apart at minimum, and consecutive stops on a line at least 40 m (bus), 100 m (tram), 600 m (metro) or 1,200 m (rail).
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
- One big world. You can build anywhere on the map and connect places as far apart as you can afford. There is no limit on the number of lines.
- Real homes and jobs come from OpenStreetMap. The area around the start point is scaled to about 14,000 residents and 9,000 jobs, and every other place uses the same scale, so a village stays small and a big city stays big.

## How it works

- **Map:** Leaflet. CARTO now needs a free API key for its dark tiles. Paste a key into the start screen (stored in this browser only) and the game uses CARTO dark tiles. Without a key it uses plain OpenStreetMap tiles darkened with a CSS filter. Get a key at carto.com/basemaps/apikey (free, no account). A canvas on top draws blocks, catchments, lines, vehicles and stations.
- **Routing (`js/routing.js`):** each segment is a straight leg plus at most one 45° leg. The bend direction is chosen from the previous heading. Parallel lines that share a corridor are bundled and offset. Pure functions.
- **Simulation (`js/sim.js`):** a daily aggregate model, not per-vehicle. Demand between blocks follows a gravity model. Trips are routed with Dijkstra over the network, with transfer and wait penalties. Peak capacity limits how many passengers a line carries. Income is fares, costs are vehicles, track, stations and maintenance. All tuning numbers are at the top of the file in `MODES` and `BAL`.
- **Real demand (`js/osm.js`):** the world is cut into chunks of about 9 km. At the start the chunks around the start point load with one Overpass query (land use areas, offices, shops, schools, universities, hospitals, apartment buildings). The area within 3.5 km sets the scale. As you pan the map at zoom 13 or closer, any chunk in view that is not loaded yet is fetched, one request at a time, and saved with the game. If the first request fails the game falls back to a generated city (no chunk loading in that case). Failed chunks are retried after 90 seconds. With Demand switched on, the map shows which chunks are loaded (dashed outline) and which are not (darkened, with a message). Saves from before the world update are upgraded when opened: true distances are switched on and the wider area around the start is loaded, keeping the old blocks.
- **True distances:** the map is Web Mercator, so a game pixel is a different number of metres at different latitudes. `mScale(state, y)` in `js/sim.js` gives metres per pixel at any y, and all lengths, costs, catchments and trip distances use it.
- **Line colours:** the first eight are fixed, later lines get generated colours and are named Line 9, Line 10 and so on.
- **Station names:** nearest street from Nominatim, one request per second. Only coordinates are sent. If it fails they stay "Stop N".
- **Saves (`js/storage.js`):** IndexedDB, which allows hundreds of MB (it falls back to localStorage, then memory, if the browser blocks it). Per browser and per device. The game autosaves after every change, every 20 seconds, at the end of each day and when you leave the page. It also keeps the last three older copies, taken every five minutes, listed in the Save sheet. Saves from older versions (localStorage key `transit-game-save-v1`) are moved across automatically. Backup files are the same JSON (`exportSave`, `importSave` in `js/game.js`). Changing the save format needs a migration.
- **PWA:** `manifest.webmanifest` and `sw.js` (network first). Bump the `CACHE` name in `sw.js` and add any new file to its `FILES` list whenever files change.

## Files

- `index.html`, `style.css` page and styling
- `js/routing.js` auto-routing and parallel line bundling
- `js/sim.js` rules, costs, demand, growth, daily economy
- `js/storage.js` saving (IndexedDB)
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

Not verified: the live Overpass requests (start and panning). It was tested only with a fake response. If the first real run falls back to a generated city, the query in `js/osm.js` (`buildQuery`) is the first place to look.

## Known limits and ideas for next

- The game does not know about water, so lines can cross rivers for free. No ferries yet.
- Growth adds generated blocks near existing demand. It does not yet follow real city expansion.
- Trips are local: demand falls off steeply with distance (about 4 km), so a very long line only earns from the places near its stops. Long-distance demand is not modelled yet.
- Every loaded chunk adds up to a few hundred blocks to the save and to the daily calculation. Very large networks will get slower.
- Ideas: ferries and water crossings, line colours and renaming, per-line profit view, bigger map radius, a second city per save, sounds.
- Map tiles are from CARTO (dark basemap, needs a free key) or OpenStreetMap, data © OpenStreetMap contributors.
