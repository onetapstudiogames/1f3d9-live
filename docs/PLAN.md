# One-room live viewer

The page is a quiet, live window into one recorded room. The residents' and places' own pixel drawings provide its character. It reads public city facts anonymously and never writes anything back. The eight points below describe the finished page; the four PRs below name what is delivered at each step.

## The eight-point shape

1. **One room fills the view.** The place's 8×8 drawing tiles the floor with only a light dim. An undrawn place has one warm plain floor. Resident drawings stand about 48–64 screen pixels tall; things are smaller. Names stay at one readable screen size beneath figures.
2. **The viewer chooses a resident or a place.** Following a resident changes rooms only when that resident leaves. Choosing a place keeps that room on screen as residents come and go. The initial room has the most recorded activity in the last thirty minutes, counting a move at its destination. Headcount breaks ties or chooses when that window is empty. Places with child places are skipped while a public room without children is available. The page never changes rooms on its own.
3. **The page is live only.** It seeds from the current public state and follows the public change feed. Recorded moves use one linear, honest walking pace of about 120–160 screen pixels per second. Arrivals enter through a door. Small, safe idle steps inside a room are presentation and happen about every ten seconds.
4. **Speech stays beside its speaker and remains readable.** A warm cream bubble types the complete recorded note at one fixed screen size. It grows as lines arrive, holds the finished note for a few seconds, and never cuts or scrolls the words. A room shows one bubble at a time. Pause completes the current sentence before holding later activity.
5. **On-screen words stay sparse.** The page shows the room name, names under figures, the current bubble, and one quiet line describing the latest recorded activity in this room. It shows no other-room activity, counts, clock, legend, or log.
6. **Controls stay small.** There is one resident picker, one place picker, and Pause. Sleepers remain visible. A sound control may remain only as one small corner toggle if sound is kept. There is no map, camera control, Focus, replay, rewind, speed control, or UI-hiding control.
7. **Night is soft and warm.** The recorded time may tint the room after dark, but the tint preserves the drawings' colors. Recorded thing-use glow and lit windows remain.
8. **Desktop and phone share the same room.** The canvas uses all available space. Desktop keeps the pickers and Pause in one compact footer row. At 375 pixels wide, the pickers stack at the bottom and the room-name header stays tiny.

## Rules that always hold

- Draw only recorded facts. Figures leave rooms, speech appears, and objects react only when the public record says they did.
- Positions within a room are presentation. PR one allocates the current 32-pixel figures and things against the displayed room's standing band, with space for their bob. It hides colliding name plates and occupants that cannot fit, preferring the followed resident and recorded activity. The picture can therefore summarise a crowded room; it is not a census. PR two owns larger art and complete speech layout; PR three owns collision-safe walking and idle paths through those spots.
- Quiet rooms show their name and no residents, things, speech, or activity. A short status explains why the room is empty, including when following a resident there.
- All city access is anonymous and read-only. The viewer has no key, wallet, credential, or city write path.
- If a city read fails, keep the last successfully read state, let its already recorded walks and bubbles finish, retry politely, and state the read failure honestly in `#live-status`. Clear that status after a successful read. A window too small to draw the room has its own status and recovers when enlarged; it never claims the public record failed.
- Exact counts belong in the city's other pages. This view never claims a number it did not read.

## Four pull requests

1. **Page and live-room skeleton.** Replace the old page shell with one room, the resident and place pickers, Pause, the room activity line, and honest read status. Seed the picture from current public data and the line from the loaded day's activity. Replay live changes only when recorded strictly after the census finished reading. Allocate standing figures and things in the displayed room, resolve name collisions, and use the same positions for activity cues, invention bulbs, handovers, and agreements. Recover from small windows and failed reads without freezing known animation. Remove the old controls from the screen. Floor art, bubble growth, and walking pace remain for the following PRs.
2. **Art and readable words.** Tile place drawings across floors, add the warm undrawn-room floor, size resident and thing art, keep names and complete speech crisp at a fixed screen size, and soften night. Add pure, tested bubble-growth and night-tint functions.
3. **Recorded motion.** Add the single honest walk pace, door departures and arrivals, safe idle steps, one-bubble queues, and pause-after-sentence behavior. Keep motion and timing in pure functions with unit tests.
4. **Remove the old viewer.** Delete the files used only by the whole-city map, camera movement, minimap, replay UI, rewind, speeds, director, Focus, and activity log. Keep and update the recorded scene fixture and fake-clock test tooling.

Each pull request runs `npm run check` and includes real-city screenshots at 1280 pixels and 375 pixels wide. New pure behavior gets unit coverage. Browser checks cover only the small user flows. No pull request adds a runtime dependency without explaining why, edits `playwright.config.ts` to change browsers, or commits `dist/`.
