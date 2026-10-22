# Synergy Way — Take-Home Assignment

This take-home is a slice of the kind of work you'd ship here: a review tool that lets a dispatcher replay exactly where a delivery vehicle went, second by second.

We expect this to take **6 hours of focused work**, with heavy AI assistance. Your clock started when you accepted — **your exact deadline is in the pinned issue in this repo**. The clock is real; document what you cut.

---

## Ground rules

- **Deadline**: hard cutoff 6 hours from the moment you accepted the GitHub invitation — the exact timestamp (UTC) is in the "Welcome" issue in this repo. Your last push to `main` before that timestamp is your submission. Write access is revoked automatically shortly after the cutoff, but the timestamp is what counts, not whether the repo still happens to accept a push: anything that lands after it is not part of what we review.
- **Push often, don't rebase `main`.** Force-pushes to `main` are blocked so the history stays intact. Work on branches if you like; merge to `main`.
- **AI tools**: Allowed and expected. We work this way and you should too. Disclose what you did in `AI-NOTES.md` (see Deliverables).
- **Questions**: We won't answer them during the assignment. Ambiguity is intentional — write down your decisions in `DECISIONS.md`. We grade the reasoning, not just the answer.
- **Submission**: Push to this private repo. No "submit" button — just keep pushing; the state of `main` at the cutoff is what we review.
- **Confidentiality**: This brief and the fixture are ours. Please don't publish them or your solution publicly.

---

## The product

Waypoint is a fleet-telemetry platform. Delivery vehicles stream a position and status sample every second while they're on a trip; dispatchers use the portal afterwards to answer questions like "why was this drop 40 minutes late?".

The domain model:

- A **Carrier** is a delivery company — the tenant. Each carrier owns its own vehicles.
- A **Vehicle** belongs to one carrier and has a plate, a model, and a depot.
- A **Trip** is one shift for one vehicle: a start time, an end time, and a continuous stream of telemetry samples.
- A **TelemetrySample** is one second: `t` (seconds from trip start), `lat`, `lon`, `speedKph`, `fuelPct`.

Two roles:

- `DISPATCHER` — belongs to exactly one carrier, and sees only that carrier's vehicles and trips.
- `PLATFORM_STAFF` — our own support staff; sees every carrier.

## What to build

Multi-tenant with server-enforced access control, and a one-command local run. No infrastructure code required at this level.

1. **Auth — sign-in only.**
   Email + password. Users are created by your seed script (see below). **Do not implement sign-up**, email verification, password reset, or SSO — all explicitly out of scope.

2. **Carrier-scoped permissions, enforced on the server.**
   A `DISPATCHER` sees only their own carrier's vehicles and trips; `PLATFORM_STAFF` sees all of them. Hiding things in the client is not enough — a request for another carrier's vehicle must fail with a 403 or a 404 (your choice, but be consistent and say why in `DECISIONS.md`).

3. **Vehicle list.**
   The landing view is a list of vehicles you have access to, each showing its plate, depot, and how many trips it has. Picking one shows its trips, most recent first.

4. **Trip replay with a scrubbable timeline. ← this is the hard part**
   Open a trip and you get its telemetry: speed over time as a chart, and the route as a path. The user can scrub and zoom **bidirectionally** across the whole trip — back as well as forward — and the data loads on demand, a window at a time. Never hand the whole trip to the view at once.

   Smooth movement over the real data volume is the strongest single signal in this assignment. Your choice of rendering approach and windowing/pagination strategy is the interesting decision; make it deliberately and write it down.

5. **Seed script.**
   One command that resets the database and loads 24 hours per trip (86,400 samples), 8 vehicles across 2 carriers — roughly 690,000 telemetry rows. Build the volume by tiling the fixture (see below). Print the seeded sign-in credentials to stdout so we can log in.

## Tech constraints

**Required**:

- **Python** on the backend.
- A **database** — Postgres, MySQL or MongoDB, whichever you prefer. Say in `DECISIONS.md` why you picked it for these read patterns.
- **React** with **TypeScript**, and no `any` in code you wrote.

Anything not explicitly required above is your call. That includes the web framework, the ORM or query builder, and the migration tool; the build tooling, the state and data-fetching layer, any table or charting library, and styling; and your test runners. We have deliberately not named a framework: pick what you would actually reach for, and tell us why in `DECISIONS.md`.

**Versions**: use whatever is current and supported at the time you build this. We review against what is current then — not against a version this brief happened to name.

**Local run**: a reviewer must be able to go from `git clone` to a working app in under 5 minutes with the commands in your README. `docker compose up` is the usual way to get there; anything equally simple is fine.

## Fixture

`fixtures/fleet-sample.json` — 900 samples — 15 minutes of 1 Hz telemetry for one van driving a closed delivery loop:

```json
{
  "sampleRateHz": 1,
  "durationSeconds": 900,
  "fields": ["t", "lat", "lon", "speedKph", "fuelPct"],
  "units": { "lat": "deg", "lon": "deg", "speedKph": "km/h", "fuelPct": "percent" },
  "samples": [[0, 52.3702, 4.8952, 0, 100.0], [1, 52.3702, 4.8953, 4.2, 100.0], "..."]
}
```

The loop is closed — the van ends where it started — so you can tile the sample end-to-end and get a plausible continuous shift. Tile it **96×** to reach 24 hours per trip (86,400 samples), 8 vehicles across 2 carriers — roughly 690,000 telemetry rows.

Tiling leaves a visible seam every 15 minutes (fuel jumps back to full, the route restarts). That's expected. If you decide to smooth it, say so in `DECISIONS.md`; if you leave it, say that too.

## Deliverables checklist

In the root of your repo:

- [ ] **Working app** — frontend, backend and database, running locally from a clean clone.
- [ ] **`README.md`** — how to run the whole thing locally from a clean clone in **under 5 minutes**, and how to seed the data. Assume the reviewer has Python, Docker and Node and an otherwise empty machine.
- [ ] **Formatting, linting and type checking that pass** — configured in the repo, runnable with one command you document, and clean when we run it. Which tools is entirely your choice; that you set them up at all is the point. If your language has a type checker, it belongs in that command — an untyped codebase is a maintenance cost somebody else pays.
- [ ] **`DECISIONS.md`** — 5–10 bullets. Key tradeoffs you made, what you'd do with two more days, anything you cut.
- [ ] **`AI-NOTES.md`** — which parts AI wrote versus you wrote or edited, which prompts worked, where AI failed you. Honest is better than impressive.

## How we evaluate

Three criteria, equal weight (1/3 each):

1. **Product / UI quality**
   - Does scrubbing back and forth through a day of vehicle telemetry feel smooth at the stated data volume?
   - Does the UI look like something we could put in front of a real user?
   - Is the navigation flow clean and obvious?

2. **Deployability**
   - From a clean clone, can a reviewer run the full stack in <5 minutes following only the README?
   - Does the seed work? Does the app load the seeded data?
   - Are the setup steps reproducible, with no undocumented manual fixes?

3. **Code / Architecture**
   - How is the code organized, and how is the system designed?
   - Would another developer want to maintain this?
   - Are the tests where they pay for themselves?

We read `DECISIONS.md` before we read the code. It will not buy back a deliverable you did not ship — a gap you explained and a gap you did not score the same on the item that is missing — but the quality of that file is itself scored, and a considered tradeoff reads very differently from an oversight. Cut what you must, say why, and expect the missing part to count as missing.

Anything we cannot get running from your README counts as not done. Not "we could not tell" — not done. Make the path from clean clone to working app short, documented and true.

## Tips

- **Shipping a clean 80% beats over-engineering.** Tell us what you cut in `DECISIONS.md`.
- Get something end-to-end running early, then deepen it. A half-finished vertical slice reviews far better than three disconnected layers.
- The fixture is small on purpose. Generating realistic volume from it is part of the task.

Good luck.
