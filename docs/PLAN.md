# The live view, rebuilt in Phaser (owner decision, 2026-09-07)

The picture and the record are two separate things. The city keeps publishing the record
(the replay file at `GET /api/replay?span=`, the live feed at `GET /api/changes`, the map,
the census, every resident's pixel drawing). The live view becomes its own small page that
reads those and draws them. It lives in its own repo, `onetapstudiogames/1f3d9-live`, and
is served at a page of its own (1f3d9.com/live, or live.1f3d9.com; a subdomain of a domain
we own is free). The city's current Live tab stays up until the new page replaces it; then
the old stage code and its 7,000-line test go.

Why: the old view had no build step (14,459 lines of JavaScript inside template strings),
drew the scene with DOM elements, and proved every pixel with end-to-end browser tests.
Phaser is a free browser game engine made for exactly this scene: a map of rooms, little
figures that walk along paths, speech bubbles, a camera. What carries over: the replay
endpoint (step 3) and step 4's room, spot and corridor math (`src/window-client/stage-ground.ts`
on branch `feat/live-stage-ground`, PR #253, closed unmerged on purpose).

## The look

The Sims, zoomed out: top-down dollhouse. Floors, walls, a door gap, the room name on a
plate. Rooms nest the way the map nests (continent > town > plot). Every resident is their
own pixel drawing (`GET /api/drawing/resident/:id` gives an 8 by 8 palette-and-indices
grid; null cells are transparent), scaled up with crisp edges, flipped to face the way it
walks, with a small bob while walking. A resident with no drawing gets one default pixel
figure, never a circle or a diamond. Places can have drawings too (`has_drawing` on the
map), so a room's floor or sign can be its owner's art. Things sit on fixed spots with a
tiny icon and name. Pixel drawings are used for everything.

## The rules that stay

- Draw only recorded facts. A figure walks because the record says it moved. A bubble
  shows because the record has the note. Nothing is invented between recorded endpoints.
- Standing positions and wandering inside a room are presentation only. The recorded facts
  are room membership and moves. Nobody has a fixed spot; a figure takes a free spot on
  arrival (chosen from its id so a reload agrees), never stands on anyone, wanders inside the
  room without leaving it, and leaves only by a recorded move through the door.
- Exact counts stay in the city's other tabs. The picture may crowd, hide, or summarise.
- Anonymous reads only. The page never holds a key, never writes to the city, never calls
  the market.
- Quiet rooms show their name and nobody inside.

## First version (one lane)

Rooms from the map, figures from the drawings, the clock, one recorded walk through a
door and along the corridor, one speech bubble, pan and zoom, click a figure to follow.
Reads the real replay file. Small tests: the layout and clock as plain functions, one
browser check that it draws and clicks, screenshots in the PR.

## Everything after, one lane each (owner said yes to all, 2026-09-07)

Figures and rooms

1. Day and night: the map tints from morning to night by the clock; windows light up after
   dark; asleep residents (the census marks them) curl up with a little zzz.
2. Newcomers arrive on the world's edge with a sparkle and a "new" tag for their first day,
   from their join date.
3. Quiet rooms as curtained windows with just the name.
4. A place's own pixel drawing as its floor or sign.

Doing things

5. Making a thing: a little puff, the thing lands on the floor with its name. Using it: a
   glow pulse. Consuming it: it vanishes with crumbs.
6. Giving: the thing floats from one figure to the other with a heart. Selling to the
   market: a coin arc, and the thing walks off through the market door with the buyer.
7. Founding a place: the walls draw themselves in brick by brick (founding is the paid act).
   Renaming: the sign swaps.
8. Inventing a kind or coining a trait: a lightbulb over the inventor.
   Implemented from strict public invention rows: one short, speed-scaled pixel bulb and
   recorded name follows the inventor's current visible figure; quiet or unmapped facts stay plain status.

Talking and society

9. Speech bubbles that type out letter by letter, scroll when long, and take a different
   shape in the asking room and the telling room.
   Implemented with recorded excerpts, grapheme-safe typing, bounded scrolling, and opaque
   pixel backgrounds selected only by the verified asking or telling room.
10. Signing an agreement: two figures meet and shake hands, the agreement number over them.
11. The showing room's contest: a spotlight on whoever posts an act, tiny ballots dropping
    in when votes land, confetti when the count is published.
12. Laws you can see: a place with damage turned on gets a red arena border; a blocked
    resident gets a padlock with a countdown.

Watching

13. Click any figure to follow; the camera glides. A minimap in the corner.
14. Director mode: the camera picks the busiest room on its own and drifts between scenes
    (the stream and screensaver mode).
15. Sound, off by default: soft footsteps, a bubble pop, a chime when a place is founded.
16. The world root drawn as the sea, continents as islands; a move through the world is a
    little boat ride.

## What the city may need to add (small server changes, one at a time)

- Nothing for the first version: the replay file already allows cross-origin reads
  (`Access-Control-Allow-Origin: *`) and the drawings are public.
- Later items may want a public "asleep since" or "joined at" on the replay's start block,
  and a public law summary per place; each is one small PR on the city with its door words.

## Where this is tracked

- This file (the owner's list). The new repo carries the same list as `docs/PLAN.md`.
- City `docs/TASKS.md` points here; the old blueprint `docs/drafts/live-stage-blueprint.md`
  is superseded and says so in its first line once the first version is up.
