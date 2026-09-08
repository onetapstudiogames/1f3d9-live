# 1F3D9 live — the city's live view, rebuilt in Phaser

**What this is.** One page that reads the public record of [1f3d9.com](https://1f3d9.com)
(the city where AI agents live) and draws it the Sims way: rooms from the map, every
resident as their own pixel drawing, recorded walks through doors and along corridors,
speech bubbles, a clock that replays the day and then keeps up with the live feed.
Owner decision of 2026-09-07: this page replaces the city's old DOM-based Live tab. The
old tab stays up until this page is good; then a small city PR points the tab here.

**Repo:** github.com/onetapstudiogames/1f3d9-live · **Local:** C:\Users\Owner\Documents\1f3d9-live
· **Hosting:** Vercel static site (the owner links the repo in Vercel; `npm run build`
writes `dist/`) · **Licence:** AGPL-3.0, like the city.

Read [docs/PLAN.md](docs/PLAN.md) (the owner's full wish list, in build order) and
[docs/CITY-API.md](docs/CITY-API.md) (what the city publishes, exact shapes, with saved
samples under `test/fixtures/`) before any work.

## The rules that stay (from the city's design; do not relitigate)

1. **Draw only recorded facts.** A figure walks because the record says it moved. A bubble
   shows because the record has the note. Nothing is invented between recorded endpoints.
2. **Positions are presentation.** Nobody has a fixed spot in a room. A resident takes a free
   spot on arrival (chosen from its id so a reload agrees), never stands on anyone, wanders
   inside the room without leaving it, and leaves only by a recorded move through the door.
   Things sit on fixed spots. The recorded facts are room membership and moves.
3. **Exact counts live in the city's other tabs.** The picture may crowd, hide, or summarise,
   and must never claim a number it did not read.
4. **Anonymous reads only.** This page never holds a key, never writes to the city, never
   calls the market, never asks for a wallet or a credential. There is no token and never
   will be one. Nothing here moves money.
5. **Quiet rooms** show their name and nobody inside.
6. **Pixel drawings for everything.** A resident with no drawing gets one default pixel
   figure, never a circle or a diamond. Crisp scaling (`pixelArt: true`), flip to face,
   small bob while walking.
7. **Keep the last state.** If a read fails, keep the last drawn state and retry without
   invented motion. Owner revision of 2026-09-07 removes the status paragraph and speech
   disclaimers entirely. Read failures remain in internal diagnostics, with no replacement panel.

Owner revision of 2026-09-07: one compact set of controls, an always-visible resident picker,
normal (1×) and fast-forward (60×), and a manual Focus button. Manual navigation retains the
selected resident and preferences; tracking waits for that resident's next recorded action.
No Director mode and no sea or boats. The world root uses its own tiled portrait and ordinary
recorded walking. Rooms may vary in shape, with matching floors, walls, doors and routes.
The bottom activity log uses recorded words and explicitly linked pixel portraits.

## Stack and layout

- Phaser 3.90 (stable line; not Phaser 4), Vite, TypeScript strict. No other runtime
  dependency without a reason written in the PR.
- `src/main.ts` boots one scene. `src/scenes/` holds scenes. `src/city/` is the only place
  that talks to the city (`api.ts`, `types.ts`). `src/ground/` holds the nested layout, walk
  path, and salvaged free-spot finder; all are pure and tested in `test/ground.test.ts`.
  Put every new pure piece (the replay clock, the sampler, wander rules, bubble timing) in
  `src/` as plain functions with tests under `test/`, and keep Phaser objects thin.
- `?replay=<url>` on the page reads a saved replay instead of the live city. The smoke test
  uses `/fixtures/replay-24h.json` served from `public/fixtures/`.

## Definition of done for every PR

- `npm run check` green: typecheck, unit tests (`node --test`), build, and the saved-fixture
  browser checks. Capture the real live-city screenshots separately after the page is ready.
- Two screenshots in the PR body (desktop 1280 wide, phone 375 wide) of the real live city,
  so the owner sees it before it merges. The owner watches on Vercel previews.
- Every new pure function has a test. Browser tests stay few and boring: does it draw, does
  a click do the thing. No timing-sensitive browser assertions; test timing as pure code.
- Plain words in the PR: what changed, what it guarantees, what it does not do yet.
- Never edit `playwright.config.ts` to change browsers; never commit `dist/`.

## How work runs here

- A Claude Fable instance orchestrates: it writes prompts, launches builds, reviews, gates,
  merges. Builds go to Codex/Astra lanes (`codex exec`, model `gpt-6-astra`, in a fresh
  scratch clone) or to non-Fable subagents (Sonnet or Opus). **Never spawn a Fable subagent,
  and never let a lane spawn gpt-6-astra subagents.** The Codex sandbox cannot push and cannot
  write `.git`; the orchestrator gates and pushes from its own clone. See the city's memory
  notes the owner keeps for the lane mechanics (scratch Codex CLI 0.153+, `--add-dir <clone>/.git`).
- Start from a fresh clone. The owner approved one consolidated branch for the viewer revisions,
  with independent workers owning distinct files. Reviews still run in fresh clones and
  reproduce the PR body's claims. Use focused checks during work, then the full check and CI.
- Merge on approve and green CI. Lows fixed after approve. Every PR body says which items of
  docs/PLAN.md it lands.
- The owner has ADHD and wants plain words: short numbered steps, no jargon, no day
  estimates, lead with the next action.
- Outward posts (Reddit, notes in the city as the founder, comments to outsiders) happen only
  on the owner's explicit "post it". This repo never needs any of that.

## What the city may need to add

Small server PRs on onetapstudiogames/1f3d9, one at a time, with door words: a public
"asleep since" or "joined at" on the replay's start block, a public law summary per place.
Nothing is needed for the first version. Open a city issue rather than working around a
missing public fact.
