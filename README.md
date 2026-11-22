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
- **Lines list:** search by name, sort (oldest, newest, name, profit, riders, most crowded, stops, length, vehicles), filter by mode, by country (taken from the stop names, so stops not named yet show as "Country not known yet") and by status (crowded, overloaded, losing money, nearly empty, hit by an event, unfinished). Sort and filters are remembered in this browser, search is not.
- **Look:** homes and jobs are drawn as a heat map (soft orange and blue glows that add up where blocks overlap). Every mode has its own vehicle shape: bus, coach, 2-car tram, 3-car light rail, metro and commuter rail trains, intercity train with a nose, ferry and plane. The coloured fill gets stronger as a vehicle fills up. `drawVehicleShape` in `js/game.js`; `TG.shapeSheet(canvas)` draws all shapes for checking.
- **Menu** (bottom bar, last button): switches for what is drawn on the map (homes and jobs, loaded areas, waiting passengers, station names, vehicles, goal and event markers) and one switch per mode in your network to hide its lines and stops (hidden lines still run and earn money). Nothing switches automatically, and the choices are remembered in this browser (`transit-game-view`). Save and backup sit below the switches.
- **Rename** a line from its panel. **Stats** (bottom bar) shows balance, riders, profit, how much of the population and jobs lie near a stop, history charts, lines ranked by profit and the stops where most people are left behind.
- **Save and backup** (in the Menu) downloads a backup file or loads one. The start screen can also load a backup.
- A scale bar sits bottom left. With Demand on, a legend explains the dots (orange homes, blue jobs, bigger means more) and the loaded and unloaded areas. Close it with the ×.
- Keyboard: Space pauses, Esc cancels.
- Stops can be close together: 40 m apart at minimum, and consecutive stops on a line at least 40 m (bus), 100 m (tram), 300 m (metro and light rail) or 1,200 m (commuter rail).
- Light rail, commuter rail, metro and intercity rail unlock as your network carries more passengers in total. Ferry unlocks at 40,000.
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
- `js/goals.js` seasons, random events and goals
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

- The game does not know about water, so lines can cross rivers for free. Ferries work but are not restricted to water.
- Growth adds generated blocks near existing demand. It does not yet follow real city expansion.
- Everyday trips are local (about 4 km falloff). A separate long-distance component covers trips of 25 km or more between stations.
- Every loaded chunk adds up to a few hundred blocks to the save and to the daily calculation. Very large networks will get slower.
- Ideas: ferries and water crossings, line colours and renaming, per-line profit view, bigger map radius, a second city per save, sounds.
- Map tiles are from CARTO (dark basemap, needs a free key) or OpenStreetMap, data © OpenStreetMap contributors.


## Transport modes (phase 1)
- Bus, Tram, **Light rail** (unlock 50,000 total passengers), Commuter rail (100,000), Metro (300,000), **Intercity rail** (1,500,000, 160 km/h, stops at least 8 km apart).
- **Ferry** (unlock 40,000, 25 km/h, cheap track) is playable, but the game does not know where water is: you place ferry stops on water or shore yourself, and any line can still cross water for free. A real water map (OSM water polygons, coastlines, bridges) enforcing this is a possible phase 2.
- **Coach** (unlock 75,000 total passengers, 70 km/h, 50 seats, stops at least 5 km apart): cheap long-distance road service between towns. Fares and costs are close to bus levels, so it earns mostly from trips of 25 km or more.
- **Plane** (unlock 3,000,000 total passengers, 650 km/h, 180 seats): stops are airports at least 150 km apart. Flights are drawn as dashed straight lines (no 45° bends, not bundled with other lines, no bend flipping). Airports (20M each, 15k/day) and planes (15M, 60k/day) are expensive, the route itself costs almost nothing (3k/km), and fares are 20% of the normal per-km fare (`fareMult` in `MODES.plane`), so planes are a late-game investment that pays back in roughly 50 days on a busy route. Straight lengths come from `edgeLenFor` in `js/sim.js`; `MODES.<mode>.straight` switches routing and distances.
- **Long-distance demand**: trips of 25 km or more between far-apart places appear once stations exist at both ends. Existing mode economics are unchanged.


## Goals, events and seasons (`js/goals.js`)
- **Goals** (dock button): three active at once, paid in money when done. A new one appears as soon as one finishes. Four kinds:
  - *Build*: a line of N km, lines in N separate places (not joined by a line, 15+ km apart), lines in N countries (country comes from the stop names via Nominatim, old stops are filled in on load), N lines at once, open a line of a newly unlocked mode.
  - *Numbers*: total passengers, riders per day, profit per day, savings.
  - *Contracts* (time limited, no penalty if missed): put a stop within 400 m of a marked busy area (gold ring on the map, "Show on map" button), or reach a rider target within 15 days.
  - *Challenges*: a bus-only profit target, riders with no line over 95% full, one star line with a profit target.
  - Missed contracts are listed under "Recently missed" in the Goals sheet (last 5 shown, 25 kept).
  - Every goal has a **Skip** button (free). A different goal takes its place and the skipped type does not return straight away. The no-crowding challenge is not offered while a line is already full at the vehicle cap, and tells you to build a parallel line if that happens later.
  - Targets scale with the current network and rewards scale with daily profit.
- **Seasons**: a game year is 120 days. Summer +6% riders, winter -8%.
- **Events** (about one every 10 days, at most two at once, never two of the same type at once, only once you have a working line). 25 types:
  - *Bad (13):* strike (line stops, 3 days), fuel prices (+50% costs), station closed, storm (-35% demand), flu wave (-20% demand), fare dodging (-15% fares), taxi price war (-12% demand), breakdowns (one line -40% capacity), signal failure (a non-bus line -50% capacity), road works (all bus and tram lines -25% capacity), driver shortage (all lines of one mode -20% capacity), flooding (two stops closed), vandalism (one-off repair bill).
  - *Good (12):* festival, big match, concert, market days, city marathon (all create a rush ring around one of your stops), Christmas market (winter only), beach weather (summer only), tourist boom (+20% demand), back-to-work week (+15% demand), cheap fuel (-20% costs), government subsidy and sponsor deal (one-off cash).
  - One-off cash amounts scale with your daily profit. A bad bill never takes more than 25% of your balance.
- Implementation: the event catalogue is the `CATALOGUE` table in `js/goals.js`, which registers hooks with `setHooks` in `js/sim.js`. `fx(state)` returns today's demand and cost multipliers, striking lines, closed stops and rush areas, which `computeNetwork` and `reachList` use. State is kept in `state.ev` and `state.goals` (old saves get them automatically).


## Loading data in dense cities
- One chunk (about 9 km square) is requested at a time, nearest to the screen centre first.
- Up to three Overpass servers are used. The second joins after 7 seconds if the first has not answered, or at once if the first errors. The first good answer wins and the rest are cancelled. An answer that says the query timed out counts as a failure, so partial data is never saved as a finished chunk.
- If a whole chunk is too heavy for the server (typical for Lisbon, Paris, London), it is cut into four smaller squares, and each of those into four again if needed. Pieces that worked are remembered, so a retry only repeats the pieces that failed. Elements that appear in two pieces are counted once.
- The error toast now says why it failed (server busy, too heavy for the server, timed out). Failed chunks are retried after 90 seconds.
- Not verified against the live servers, only against fake ones that reject large squares.
