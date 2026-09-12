# B3 live-view evidence

> Status: historical (2026-09-11)

Every item has a `before` and `after` viewport frame at 1280 and 375 CSS pixels in this directory. The after frames were captured from commit-candidate code on the isolated local preview at port 4313. `final-live-city-after-1280.png` and `final-live-city-after-375.png` are final reads of the public city at place 780; the other after frames use the repository's saved public fixtures so their room contents are repeatable. Files ending in `-causal`, `-failed-read`, or `-pending` were captured inside the matching controlled Playwright state.

The before frames preserve the audit captures under `audit-2026-09/findings/16-shots`: `follow-founder-1280/0310.png` for moves, `0046.png` for speech and delayed art, `0190.png` for recorded-state lag; `place-780-1280-sit/0160.png`, `0170.png`, and `0190.png` for floor/object and failed-read states; and `place-498-375/0100.png`, `0198.png`, `0200.png`, and `0326.png` for phone states. The one exception is `human-9-before-375.png`: it is the required fresh live capture of the longest-named awake resident in place 780 (`olivitolives`, resident 315) after 35 seconds.

| Item | What the after frames establish | Causal check |
| --- | --- | --- |
| human-3 | `human-3-after-*-causal.png` shows the resident walking out under the move caption at both widths. | `e2e/motion.spec.ts` proves the caption survives a departure longer than three seconds and ends at the boundary. |
| human-7 | Labels remain readable at both widths. | `test/scene-activity.test.ts` and `test/room-presentation.test.ts` prove an active caption raises the actor and used-thing label priorities. |
| human-8 | `commonhold-consul` is shortened with `...`; the adjacent full-name card is open by hover at 1280 and tap at 375. | `test/name-label.test.ts`, `test/NameLabel.test.ts`, and `test/name-reveal.test.ts`. |
| human-9 | The place 780 phone frame has no card cut by the wall. The audit symptom did not reproduce, so no edge-rule change was made. | The required fresh before frame and the final 375 frame both exercise the existing hide-at-edge rule. |
| human-10 | `human-10-after-*-causal.png` shows the first painted speech card already containing its first complete character. | `test/BubbleView.test.ts` proves pre-text frames return no card, including speech A followed by speech B before B reveals. |
| human-11 | `human-11-after-*-causal.png` shows an arrival cue beside the resident at both widths. | `test/activity-layer.test.ts` proves every mark gets a dark one-cell outline. |
| human-12 | The public place 780 frames show objects above the reduced-strength floor art. | `test/room-art.test.ts` fixes the floor shade at 34%. |
| accuracy-20 | `accuracy-20-after-*-failed-read.png` shows the retained picture and reserved status line during the failed read itself. | `e2e/live-feed.spec.ts` proves a failed read freezes figures and elapsed time and does not change the app or canvas height; `test/live-presentation.test.ts` fixes the status slot in place. |
| accuracy-21 | `accuracy-21-after-*-pending.png` shows the followed founder and other unresolved residents as neutral gray figures while drawing reads are held. | `test/scene-details.test.ts` proves only visible unresolved IDs are read, the followed ID goes first, complete art is applied once, and failed or pending reads wait 30 seconds before retry. |
| accuracy-23 | Things keep their stable shelf positions. | `test/room-presentation.test.ts` and `test/room-crowding.test.ts` prove ordinary and followed resident-only decorative moves retain a thing's seat, while a current speaker can still take scarce space. |
| accuracy-24 | `accuracy-24-after-*-causal.png` shows the first arrival frame centered on the drawn door at both widths. | `test/room-motion.test.ts` and `e2e/motion.spec.ts` prove the arrival path starts at the door and continues to a free target. |
| accuracy-25 | The final recorded picture has one room, header, and thing set. | `test/BubbleView.test.ts` proves hidden speech clears immediately; `e2e/motion.spec.ts` proves the room id, header, and visible thing count agree on the destination frame. |
