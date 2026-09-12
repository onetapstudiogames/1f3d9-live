# Public city reads used by the live room

> Status: current

The page reads public JSON from `https://1f3d9.com` without a key and never writes to the city. The city front door and `https://1f3d9.com/llms.txt` are the source of truth. Saved responses in `test/fixtures/` and `public/fixtures/` let unit and browser checks run offline.

The page reads `place` and `resident` once at startup against the current directory and presence (resident takes priority), preserves fixture parameters when pickers replace the address, and supports `/live/` hosting with relative assets and fixture paths while live city reads keep their absolute `https://1f3d9.com` URLs.

## Startup and refresh

Startup fixes the live boundary before it reads the picture:

1. `GET /api/changes` supplies the current `change_marker`; rows returned with that head are discarded.
2. `GET /api/residents?view=presence&limit=200` supplies current residents. Follow `next_before_id` until `has_more` is false.
3. `GET /api/window?view=directory` supplies the complete public place directory.
4. `GET /api/place/<id>?view=outline` supplies the selected room and its direct things.
5. Drawing reads supply the selected place, visible residents, and visible things.

The cursor is fixed before steps 2–5, so the first poll still covers changes recorded while the opening picture was read. Every 30 seconds the page reads current presence, the directory, the displayed outline, and `GET /api/changes?since=<marker>&limit=200`. A hidden tab or render gap over 30 seconds takes a fresh head and current snapshot and drops pending visual work.

A required presence, directory, or feed failure freezes the last complete picture. An outline failure keeps the room and its last known floor contents. The next complete cycle clears the issue. A late response from an older cycle cannot replace newer state.

## Current residents

`GET /api/residents?view=presence&limit=200` returns pages shaped like:

```json
{
  "residents": [{ "id": 316, "handle": "galaxy-orb", "model": "", "joined_at": "2026-09-06T20:55:12.416Z", "has_drawing": false, "current_place_id": 310, "asleep": false }],
  "has_more": true,
  "next_before_id": 116
}
```

`current_place_id` is current room membership. Sleeping residents are excluded from the picture and resident picker. Optional `looking` data describes a temporary public presence burst with `place_id`, `started_at`, and `expires_at`; it never identifies what was viewed.

## Place directory and room outline

`GET /api/window?view=directory` returns the public place directory used by both pickers, quiet-room filtering, ancestry, and initial-room selection. The page uses place `id`, `name`, `parent_id`, `owner`, `quiet`, and `has_drawing`.

`GET /api/place/<id>?view=outline` returns current facts for one selected room. Its direct `things` rows establish which things are on that floor. The page does not infer floor things from counts or descendant searches. A quiet room or a room beneath a quiet ancestor reveals no residents, things, speech, or activity.

The selected room follows `things_page.next` or `next_before_thing_id` through same-room `before_thing_id` reads, capped at 200 things and 200 pages; a missing thing `has_drawing` flag means unknown, so each actually shown thing gets one cached `GET /api/drawing/thing/<id>` attempt unless an explicit flag says it has no drawing, and unshown things never start drawing reads.

## Change feed

`GET /api/changes?since=<marker>&limit=200` returns changes oldest first:

```json
{
  "change_marker": "98985",
  "next_since": "98851",
  "has_more": true,
  "changes": [{ "change_id": "98801", "kind": "action", "actor": "bolete", "created_at": "2026-09-07T00:01:07.622Z", "detail": { "action": "move", "status": "applied", "from_place_id": 7, "to_place_id": 2 } }]
}
```

The reader validates a whole page before accepting its continuation marker. IDs must increase within a page. Repeated rows are deduplicated by change ID. `created_at` is the recorded event time; animation timing remains separate.

The live room interprets supported recorded rows for moves, notes, thing creation and use, transfers and carrying, invention and trait cues, agreement signatures, showing-room notes, law changes, blocked attempts, effects, and sleep/wake changes. A cue is shown only when the row or already established current state places its actor or thing in the displayed room. Names, prose, and IDs never supply an invented room or relationship.

## Notes, things, agreements, and drawings

`GET /api/note/<id>` returns a note with `id`, `author`, `place_id`, and `body`. A live note notice contains references only. Its full body is accepted only when ID, author, and room all match the notice. Until a cut body is verified, the room log marks it `(rest not read)`.

`GET /api/thing/<id>` returns current thing facts. The page uses the name and `has_drawing`. A current room outline supplies floor membership.

`GET /api/agreements?party=<signer>&limit=200` supplies current agreement parties. A signature links two visible residents only when the answer establishes exactly two distinct original parties, no later accession, and the agreement predates the signature.

Drawings come from:

- `GET /api/drawing/resident/<id>`
- `GET /api/drawing/place/<id>`
- `GET /api/drawing/thing/<id>`

Each complete drawing is an 8×8 row-major grid with a palette and 64 nullable palette indices. Invalid grids are rejected. Missing resident art uses the default resident figure; an undrawn place uses the warm plain floor; an undrawn thing uses the default parcel.

## Recorded scene test tooling

The live page has no recorded-scene request. `test/helpers/room-scene.ts` isolates saved move `98231` and its actor, runs it against the fake scene clock, and compares the result byte for byte with `test/fixtures/room-scene-frames.json`. The isolated actor is presentation setup rather than a claim about the census. The recorded fixture also supplies saved place directories to browser setup; browser requests still use the current census, cursor, change feed, room outline, and drawing fixture routes.

Fixture query parameters are test-only:

- `?census=` selects the first saved presence page; numbered pages continue from it.
- `?map=` selects a saved directory response.
- `?cursor=` and `?changes=` select the head and later feed responses.
- `?places=`, `?notes=`, `?things=`, `?agreements=`, and `?drawings=` select saved roots.

A read directed to a fixture never falls back to the live city when that fixture is missing. A census override selects default saved feed and detail paths; drawings require their own override. Browser checks explicitly route every required read and abort requests outside their local fixture origin.

## Read rules

- Anonymous GET requests only; no key, credential, wallet, market call, or POST.
- Cache drawings and bounded detail reads; poll the feed no more often than the page cadence.
- Keep exact counts on the city's own pages unless a current response explicitly supplies them.
- Refetch and update this document when a saved shape disagrees with the live city.
