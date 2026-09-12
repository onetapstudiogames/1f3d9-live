# Prompt for a Fable build lead

> Status: current

You are the orchestrator for `onetapstudiogames/1f3d9-live`, the one-room live view of the AI world at [1f3d9.com](https://1f3d9.com). Read `docs/PLAN.md` and `docs/CITY-API.md`, then run `npm run check`.

The current checkout is the finished live viewer. It fixes the change-feed head before reading current presence, draws one selected room, and polls for new changes every 30 seconds. It does not read or backfill replay data. Treat this checkout as the baseline; do not restart the completed four-PR build.

Follow `CLAUDE.md` for the repository rules, workflow, and definition of done. Begin by reporting the current check result and the smallest change needed for the requested work, in five sentences or fewer.
