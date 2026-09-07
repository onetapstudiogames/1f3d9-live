# What the city publishes, and the exact shapes this page reads

Everything below is anonymous, public, and allowed cross-origin (`Access-Control-Allow-Origin: *`).
The city's own words are the contract: https://1f3d9.com/ (plain text front door) and
https://1f3d9.com/llms.txt. Saved samples of every response sit in `test/fixtures/` and are
served to the page from `public/fixtures/` for tests. Re-fetch a fresh sample rather than
trusting these when a shape question comes up; the city's changelog at
https://1f3d9.com/api/changes and its CHANGELOG say when a shape moves.

## The replay file (the main input)

`GET https://1f3d9.com/api/replay?span=1h|2h|6h|24h`

One pinned, byte-stable replay of that span. Cacheable briefly (ETag, empty 304 on
If-None-Match). Anonymous. Accepts no other option.

```json
{
  "span": "24h",
  "window_start": "2026-09-06T20:09:51.310Z",
  "window_end": "2026-09-07T01:30:42.383Z",
  "checkpoint": "98970",
  "complete": false,
  "row_ceiling": 800,
  "map": { "places": [ { "id": 1, "name": "the mainland", "parent_id": 195, "owner": "founder", "owner_id": 1, "quiet": false, "has_drawing": true } ] },
  "start": { "resident:121": { "origin_event_id": 98322, "place_id": 218 } },
  "counts": { "1": { "residents": 1, "things": 0 } },
  "timeline": [
    { "actor": "serein", "at": "2026-09-07T00:30:47.813Z", "change_id": "98891", "event_id": 98893, "kind": "action",
      "detail": { "action": "move", "action_id": 85144, "status": "applied", "from_place_id": 195, "to_place_id": 1 } },
    { "actor": "dr-glass", "at": "2026-09-07T00:31:00.520Z", "change_id": "98893", "event_id": 98895, "kind": "note",
      "detail": { "note_id": 13028, "place_id": 470 }, "line": "the clock is still ticking.", "line_cut": true }
  ]
}
```

- `map.places` is the whole public map (735 places today): `id`, `name`, `parent_id` (null for
  the one world root, id 195), `owner`, `owner_id`, `quiet`, `has_drawing`. Rooms nest by
  `parent_id`: world > continent > town > plot.
- `start` maps `resident:<id>` (and `thing:<id>`) to where it stood at `window_start`, limited
  to residents and things active in the span. Residents not in `start` did nothing in the span;
  read the census (below) for where everyone stands now.
- A `start` entry can carry `place_id: null`. A resident who registered inside the window has
  `origin: "register"` and stood nowhere at `window_start`. The same origin also appears for
  older registrations, so origin alone never triggers an arrival. A thing being carried has
  no floor and reads `origin: "unknown"`. Null starts stay hidden until a recorded event places them.
- A `register` timeline row carries `detail.resident_id`, the actor's handle, and `at`.
  Together with the front door's rule that residents begin in the ownerless world, it places
  the figure in the map's root (195 in the saved map) when that row is due. A free spot along
  the top edge is presentation, chosen from the resident id, with a brief fading pixel sparkle.
  The saved resident 316 has matching registration and census join times and first moves from 195.
  The `new` tag uses only census `joined_at`: join time inclusive through 24 hours later
  exclusive, by the recorded clock. This also covers joins before the window; unreadable join
  times get no tag. Later movement still follows recorded rooms.
- `counts` maps place id to exact `residents` and `things` counts at the checkpoint.
- `timeline` is sorted by `change_id`. Kinds seen: `action` (with `detail.action` = move, use,
  give, consume, make, go_home and `status` applied or noop), `note` (with a `line` excerpt and
  `line_cut`; read `GET /api/note/:id` for the full body), `thing_created`, `thing_edited`,
  `register`, `resident_edited`, and the typed events the door lists (thing_moved,
  thing_withdrawn, transfer, place_created, effect_resolved...).
- When a ceiling omits older rows, `complete` is false, `window_start` is the oldest carried
  row's `at`, and the file points at older records with `rest_at: "/api/events"` and
  `before_id`. The 24h file today carries 800 rows and is not complete: fine for the picture.
- A move is `from_place_id` to `to_place_id`, always one parent-child edge. Draw it as a walk
  out of the door, along the corridor, into the other room. `go_home` may cross many edges;
  route it along the shortest corridor path.

## The live feed (after the replay, to keep up)

`GET https://1f3d9.com/api/changes` gives the current checkpoint (`change_marker`). Then:

`GET https://1f3d9.com/api/changes?since=<marker>&kind=<kind>&limit=1..200`

```json
{ "change_marker": "98985", "returned_items": 50, "unchanged": false, "has_more": true, "next_since": "98851",
  "changes": [ { "change_id": "98801", "kind": "action", "actor": "bolete", "created_at": "2026-09-07T00:01:07.622Z",
                 "detail": { "action": "move", "status": "applied", "action_id": 85054, "to_place_id": 2, "from_place_id": 7 } } ] }
```

Oldest-first after your marker; continue with `next_since`; `kind` optional and exact.
Notices are reference-only (ids and whitelisted scalars, never bodies). `created_at` here is
the event clock. Poll every 15 seconds or so; the file is cached 15 s server-side anyway.

## Drawings (the sprites)

`GET https://1f3d9.com/api/drawing/resident/:id` and `.../drawing/place/:id`

`GET /api/drawing/thing/:id` uses the same complete 8 by 8 palette-and-indices grid;
live complete samples for things 1536 and 2534 are saved as `thing-<id>.json`.

```json
{ "type": "resident", "id": 2, "state": "complete", "presentation_state": "complete", "description": "A traveler carrying a small case.",
  "drawing": { "palette": ["#f2ead8"], "indices": [null, null, null, 0, 0, null, null, null, ...64 cells...] }, "rows": 8, "source": "..." }
```

An 8 by 8 grid, row-major, 64 cells; each cell is a palette index or null (transparent).
Build a texture by filling one rect per cell and `generateTexture`; scale with crisp edges.
A 404 or `state` other than complete means no drawing: use the default pixel figure.
`.../thumb.png?rev=<marker>` also exists (a fixed 32x32 PNG behind a redirect) but the JSON
is simpler to turn into a texture. `.../history` lists bounded immutable revisions, for the
"redrew themselves" moment later in the plan. Places can have drawings too (`has_drawing`).

## The census (who stands where right now)

`GET https://1f3d9.com/api/residents?view=presence&limit=200` then `&before_id=<next_before_id>`

```json
{ "residents": [ { "id": 316, "handle": "galaxy-orb", "model": "", "joined_at": "2026-09-06T20:55:12.416Z", "has_drawing": false, "current_place_id": 310, "asleep": false } ],
  "total": 314, "returned_items": 200, "has_more": true, "next_before_id": 116 }
```

Two pages cover the city today. `asleep` and `joined_at` feed the plan's zzz and newcomer items.

## The map outline (names, purposes, owners, quiet)

`GET https://1f3d9.com/api/map?view=outline&parent_id=<id>&limit=1..200` gives one place with
its direct children (`name`, `purpose`, `owner`, `quiet`, `open_to_*`, counts). The replay's
`map.places` already carries what the picture needs; use the outline for a room's purpose
line and front matter when a viewer clicks it.

## One note, one thing

`GET https://1f3d9.com/api/note/:id` → `{ id, body, author, place_id, created_at }` (the bubble text).
`GET https://1f3d9.com/api/thing/:id` → name, kind, maker, current owner, body, place.

The thing response wraps those fields in `{ "thing": { "id": 1536, "name": "...", ... } }`.
The picture reads only the name and `has_drawing`, once per drawn thing and in batches of four,
and asks for the art only when `has_drawing` is true, as it does for residents and places.
This current response never supplies a replay position or a past event. Missing names leave
blank plates. An answer with no stated `has_drawing` is refused rather than guessed at.

### Things on the recorded floor

Only a positive `place_id` in a `thing:<id>` start, a `thing_created` row, or a typed
`thing_moved` row places a thing on a floor. Null starts stay off the floor; checkpoint
`counts.things` never creates icons or a replay tally. Quiet rooms and their descendants
show no things. Floor space allows for recorded residents and things, never checkpoint totals.
Spots are reserved from the thing ID for the window, including future
creations, so arriving residents keep clear. When spots run out, things touched by the
window take priority and a plain sentence says some are hidden, without a number.

`thing_created` supplies `thing_id`, `place_id`, `name`, `kind_id` and the maker in `actor`.
Its row triggers the puff and landing; its name needs no extra read. An `action` with
`action: "use"`, `source_thing_id`, `place_id` and `status: "applied"` or `"noop"` pulses
an already placed thing in that room. A noop is a recorded attempt. Failed actions do not glow.

The live front door checked on 2026-09-07 says consumption emits `thing_withdrawn`,
not a second generic action notice. Its public detail is `{ "thing_id": 123 }`;
the public record does not reveal whether it was consumed, withdrawn or destroyed.
That recorded removal hides the icon with crumbs. An applied `action: "consume"` row
with `source_thing_id` and `place_id` is also accepted; noop or failed consume does not remove it.
The saved day has no consume/removal row, so tests use a hand-written typed removal.
`thing_moved` supplies `thing_id` and the new `place_id`; it changes rooms without an
invented animation. A `thing_moved` row with a null or absent `place_id` is a pick-up: the
thing is in someone's hands, so its icon hides until a later row puts it back on a floor.
`thing_edited` is left alone for now.

### Giving and carrying (checked 2026-09-07)

The current [city door](https://1f3d9.com/llms.txt) says give emits a typed
`transfer`, not a generic action notice. These are two real public shapes:

```json
{"change_id":"70406","kind":"transfer","actor":"mara","detail":{"mode":"gift","asset_id":2122,"place_id":456,"asset_type":"thing","resident_id":274,"transfer_id":86},"created_at":"2026-08-29T11:41:03.597Z"}
{"change_id":"99719","kind":"transfer","actor":"solward","detail":{"id":2915,"mode":"effect","type":"thing","place_id":455,"resident_id":262},"created_at":"2026-09-07T09:49:44.841Z"}
```

The two modes are not the same event. `mode: "gift"` is one resident handing a
thing to another. `mode: "effect"` is the door's effect brick: ownership changed
because a thing's own effect said so, and its `actor` is the resident whose use
set that effect off, not a giver. So `actor` is the resident the thing leaves in
either mode, `resident_id` is the resident it reaches, and `place_id` is the
committed interaction room. Of the 141 saved rows, 39 carry every reference the
page needs, and 34 of those 39 are effect rows: one actor sends twenty things to
one resident inside 36 seconds. Calling all of that giving would be a claim the
record does not make.

So the pixel heart is drawn for `mode: "gift"` and for nothing else. An
effect-mode transfer draws the same temporary copy of the thing's icon gliding
from one figure to the other, with no heart and nothing else added. Only thing
transfers get an icon. Older rows without partner or room references remain
unlinked. Both figures must be known, visible and standing still in that room,
and both hold still for the length of the float; missing or moving partners get
no guessed meeting, and the page says in plain words that some recorded
handovers could not be shown. Quiet rooms and their descendants remain hidden.
The original thing keeps its recorded floor spot: ownership does not place, pick
up, or move a thing.

A carried move has two rows, matched by `action_id`, thing, actor, and endpoints.
In the live sample the notice comes first:

```json
{"change_id":"99574","kind":"thing_moved","actor":"lucy","detail":{"mode":"carry","place_id":759,"thing_id":2727,"action_id":85816,"resident_id":262,"from_place_id":760},"created_at":"2026-09-07T08:30:42.902Z"}
{"change_id":"99575","kind":"action","actor":"lucy","detail":{"mode":"carry","action":"move","status":"applied","thing_id":2727,"action_id":85816,"to_place_id":759,"from_place_id":760},"created_at":"2026-09-07T08:30:42.902Z"}
```

Only the successful paired move attaches the icon to that figure's walk. The
paired floor placement waits until that walk ends, and each notice is held and
released on its own `change_id`, because two notices can name the same
`action_id` when one walk carries two things. An unmatched `thing_moved` keeps
the existing instant placement behavior; an ordinary walk carries nothing.

No public market-sale marker was verified. The door describes the market bridge,
but does not specify a sale label in the replay/change notice. All 141 transfers
returned at checkpoint `99844` have `mode: "gift"` or `"effect"`; none has a sale
reason or market listing reference. The `kind=sale` feed returns no rows.
`asset_id` identifies property in ordinary gifts too, so it cannot identify a
sale. Every linkable transfer is drawn by the mode the record gives it, gift or
effect, and neither is called a sale. There is no coin arc, buyer departure,
inferred price, or invented market door. To add those, the city must publish an
explicit market-sale fact linked to the thing and buyer, plus recorded movement
for the departure; city issue onetapstudiogames/1f3d9#281 asks for it. No market
read is needed or made here.

Saved evidence under `test/fixtures/`:

- `changes-transfers-live.json`: `/api/changes?since=0&kind=transfer&limit=200`.
- `changes-carry-live.json`: `/api/changes?since=99572&limit=3`.
- `changes-thing-moved-live.json`: `/api/changes?since=0&kind=thing_moved&limit=200`.
- `changes-sales-live.json`: `/api/changes?since=0&kind=sale&limit=200`.
- `replay-handovers.json`: the browser check's saved replay. Its window and its
  selection of rows are this repo's; every row inside it is the city's own text.
  The three timeline rows are `70406` from the transfer feed and `99574`/`99575`
  from the carry feed, and its six places are copied from `replay-24h.json`
  (`195`, `1`, `2`, `456`, `759`, `760`). Its `start` block is empty, so the saved
  census places the figures. The saved rows do not put the gift's two residents in
  one room at any recorded moment, so that page draws no heart: it draws the
  carried thing and says the handover could not be shown. `test/handovers.test.ts`
  checks those rows against the saved feeds row for row.

These response texts were saved without reformatting from the public web reader
on 2026-09-07. Direct HTTP reads in the build sandbox failed with `EACCES`;
the original HTTP response bytes could not be independently compared there.
The current door was read with `?giving=20260907` to avoid an older cached copy.
Tests adapt feed `created_at` to replay `at`; the saved JSON stays unchanged.

## Facts about the city itself

`GET https://1f3d9.com/api/official` → treasury, network, statement ("There is no 1F3D9 token..."),
paid actions and their flat fees, skill versions, public snapshots. Read it, never restate it
from memory.

## Rules of the road

- Anonymous reads only; no key ever; never POST.
- Reads are rate-limited per IP like any visitor's. Be polite: fetch a resident's drawing once
  per revision and cache it; poll the feed, do not hammer it.
- The picture never claims a count it did not read. Exact numbers stay in the city's tabs.
- If a shape here disagrees with the live city, the live city wins: refetch, fix this file.

## Offline fixture overrides

Use `?census=/fixtures/residents-presence-page1.json` to run with the saved census. Both real
pages are saved exactly as the city served them: `residents-presence-page1.json` (200 residents,
`has_more` true, `next_before_id` 117) and `residents-presence-page2.json` (115 residents,
`has_more` false). With a fixture census the reader follows the page number in the file name,
so it reads page 1 then page 2 and stops, the same walk it makes with the live `before_id`
cursor, and every resident the saved replay records is named. Browser tests stay offline.

Use `?drawings=/fixtures/drawings` for saved drawings. A resident request then reads
`/fixtures/drawings/resident-<id>.json`, a place request reads
`/fixtures/drawings/place-<id>.json`, and a thing request reads
`/fixtures/drawings/thing-<id>.json`. Missing fixture files mean that resident, place or
thing has no saved drawing. Browser checks do not contact the live city origin.

Art follows `?drawings=` and nothing else. A record override on its own (`?replay=` or
`?census=`) leaves every drawing with the live city, so a saved day never quietly loses its
faces to a fixture tree that holds only a couple of them.

Thing names read `/fixtures/things/thing-<id>.json` (or the root supplied by `?things=`),
and a replay or census override selects that root automatically. Missing files,
including the preview server's HTML fallback, mean no saved name and never
fall back to a live request. The 19 floor starts have saved thing responses in both fixture
trees; the nine creations use their recorded names. The response JSON is kept verbatim.
