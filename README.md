# Golf Trip OS

Mobile-first golf trip operating system: scoring, handicaps, games, side bets, statistics and settlement, built around the **trip** rather than a single scorecard. This repo covers Phase 0 (foundation), the Phase 1 vertical slice, Phase 2 live collaboration (realtime, offline queue, conflict reconciliation), the six V1 game engines and the side-bet / ledger loop from the build spec.

## Stack

| Layer | Choice |
| --- | --- |
| UI | Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 with a small token layer |
| Domain | Framework-agnostic TypeScript in `src/domain` (no React / DB imports) |
| Database | Postgres via Drizzle ORM. Local default is embedded Postgres (PGlite); set `DATABASE_URL` for Supabase / hosted Postgres. Same migrations either way. |
| Validation | Zod (game rules, service inputs) |
| Tests | Vitest (domain) · Playwright (mobile happy path) |

## Quick start

```bash
npm install
npm run db:seed      # creates .data/pglite and loads the Pinehurst Trip 2026 demo (idempotent)
npm run dev          # http://localhost:3000
```

No external services are needed. The first request runs migrations against the embedded database. The home page also offers "Load demo trip" if the database is empty.

Other scripts:

```bash
npm test             # domain unit tests (handicap, allocation, games, ledger, settlement, stats, side bets)
npm run test:e2e     # Playwright: full round from one phone, two-phone live updates + conflict reconciliation, offline replay
npm run check        # lint + typecheck + unit tests
npm run db:generate  # regenerate SQL migrations in ./drizzle after editing src/db/schema.ts
npm run db:reset     # delete the local embedded database
npm run prototype    # build the clickable browser prototype into prototype/dist (real domain logic, in-memory store)
```

Local Playwright note: if your machine ships its own Chromium, point at it with `PW_CHROMIUM_PATH=/path/to/chrome npm run test:e2e`.

### Using Supabase / hosted Postgres

```bash
DATABASE_URL=postgres://... npm run dev
```

Migrations in `./drizzle` run automatically on first connection. Auth is not wired yet (see "Known gaps"); the acting player is chosen from the header dropdown and stored in a cookie so the scoring-mode permissions can be exercised.

## Routes

| Route | Purpose |
| --- | --- |
| `/` | Trip list, new trip, demo loader |
| `/trips/new` | Create trip: name, destination, dates, players + Handicap Index |
| `/trips/[tripId]` | Trip command center: live/next round CTA, standings (locked, counting rounds only), rounds, players, money |
| `/trips/[tripId]/rounds/new` | Add round: saved or manual course/tee/18 holes, players (HI snapshot → Course Handicap preview), counts-toward-trip, scoring mode, games |
| `/trips/[tripId]/money` | Net positions, settlement plan, itemized ledger (with reversals) |
| `/rounds/[roundId]` | Round overview: "what matters now", your line, leaderboard, games, money position, highlights |
| `/rounds/[roundId]/score?hole=N` | Live hole entry: score stepper, fairway, GIR, putts, penalty, more stats, quick side bet |
| `/rounds/[roundId]/scorecard` | Traditional card: OUT / IN / TOTAL, stroke dots, circles/squares, net under gross |
| `/rounds/[roundId]/games` | Live game summaries + side bets (propose / accept / decline / resolve) |
| `/rounds/[roundId]/stats` | Per-player stats; missing data stays unknown |
| `/rounds/[roundId]/finish` | Finish checks, recap, ledger preview, lock |

## Architecture

**The score is the primary event.** `hole_scores` rows are the only scoring source of truth. Everything else (gross/net totals, leaderboards, game state, projected settlements, stats, "what matters now") is recomputed on read by `loadRoundSnapshot()` in `src/server/services/roundProjection.ts`. Changing one hole score therefore recalculates every dependent output with no cache to invalidate.

**Money is append-only.** Locking a round writes `game_results` and one immutable `ledger_entries` row per settlement. Reopening a round for correction never deletes; it marks entries `REVERSED`, appends matching `REVERSAL` rows and an `audit_events` row, and finishing again re-posts. Net balances and the settlement plan are derived from the ledger.

**Games are plug-ins.** Each game in `src/domain/games/*` implements `GameDefinition` (validate rules → initialize → onHoleFinalized → live summary → finalize to settlements). `runGame()` replays finalized holes deterministically. Teams belong to a game, not the round.

### Domain API (`src/domain`)

- `handicap`: `calculateCourseHandicap`, `calculatePlayingHandicap`, `relativeHandicaps`, `allocateStrokes` (positive, >18, negative with policy), `netHoleScore`, `roundHalfUp`
- `scoring`: `computePlayerRoundTotals` (per-hole lines, OUT/IN/TOTAL gross+net), `buildLeaderboard`, `classifyScore`, `formatToPar`
- `games`: `runGame`, `GAME_REGISTRY` with `STROKE_PLAY`, `MATCH_PLAY`, `NASSAU`, `SKINS`, `STABLEFORD`, `BEST_BALL`
- `side-bets`: presets, acceptance / lock invariants, deterministic `autoResolve`, `settlementsForSideBet`
- `ledger`: `computeNetBalances`, `computePairwiseObligations`
- `settlement`: `optimizeSettlement` (creditor/debtor matching, zero residual)
- `stats`: `computeRoundStats`

### Schema (`src/db/schema.ts`, migration in `drizzle/0000_init.sql`)

`users`, `player_profiles`, `trips`, `trip_members`, `trip_days`, `courses`, `tee_sets`, `holes`, `rounds`, `round_players` (HI snapshot, raw + rounded Course Handicap, playing handicap, scorer), `hole_scores` (versioned, `updated_by`, `client_event_id`), `games`, `game_teams`, `game_participants`, `game_results`, `trip_competitions`, `side_bets`, `side_bet_participants`, `side_bet_resolutions`, `ledger_entries`, `audit_events`.

### Live collaboration (Phase 2)

- **Realtime:** services publish to an in-process bus after each commit (`src/server/realtime/bus.ts`); `/api/rounds/[roundId]/events` streams them as server-sent events and `RoundLive` refreshes the round views on other phones. Hole entry adopts newer server state for rows with no local edits in progress. The bus is per Node instance; multi-instance deployments swap `publishRoundChange` for Supabase Realtime / Postgres NOTIFY.
- **Offline queue:** a failed or offline save is coalesced per hole into a localStorage queue (`src/lib/offlineQueue.ts`) with a `client_event_id`; `SyncManager` replays in order on reconnect and every 15s, and the row shows *Queued offline → Synced*. Replays are idempotent server-side.
- **Conflicts:** a stale-version save returns the accepted edit; the phone offers *Keep theirs / Use mine / Ask organizer*. Escalated (or offline-replay) conflicts land in `score_conflicts`, and the organizer reconciles them from the round overview with an audit trail.

### Permissions

`src/server/services/permissions.ts`: trip owner / organizer can edit anyone; `GROUP_SCORER` → designated scorer only; `INDIVIDUAL` → own row only; `HYBRID` → own row or scorer. Scores are versioned; a save with a stale version returns a conflict and the UI offers *Keep theirs* / *Use mine*.

## Assumptions made where the spec was open

- **Rounding:** WHS "round half up" (`12.5 → 13`, `-2.5 → -2`) via a tested helper.
- **Plus handicaps:** strokes are given back starting from the highest stroke index (WHS); a `LOWEST_STROKE_INDEX_FIRST` policy exists as an option.
- **Skins value:** the configured amount is paid by *each* other player to the skin winner; unclaimed carryover at the end of the round is void.
- **Match / Nassau sides:** sides can have 1+ players (best ball per hole); losers each pay the amount, split across winners. No presses yet (rules key reserved).
- **Stroke play / Stableford / Best ball money:** optional stake per player to the winner(s); ties split in integer cents.
- **Side bet acceptance:** the creator implicitly accepts; every opponent must accept before terms lock and a bet can settle. Only hole-winner / low-score bets auto-resolve from scores; everything else needs a manual winner.
- **Trip standings** count only rounds that are `LOCKED` and flagged `counts_toward_trip`.

## Known gaps (next phases)

- **Auth:** no Supabase Auth / Clerk yet; the acting player is a cookie. `getActor()` in `src/server/actor.ts` is the single swap point.
- **Multi-instance realtime:** the change bus is in-process; hosted deployments with more than one server need Supabase Realtime or Postgres NOTIFY behind `publishRoundChange`.
- **Course provider:** manual entry and saved courses only; the `CourseProvider` adapter has not been added.
- **Trip competitions:** total gross / net / money are shown; placement points, Ryder Cup points and per-competition round selection are not configurable yet.
- **Presses**, Wolf, Vegas, greenies and the Phase 2 game library.
- PWA install prompt / service worker (manifest is in place).

## Recommended next prompt (auth + Phase 5 trip OS)

> Golf Trip OS: 1) Add Supabase Auth (email magic link + Google). Map sessions to `player_profiles` (guest profiles stay claimable by invite link), replace the cookie actor in `src/server/actor.ts`, and gate mutations by trip membership. 2) Add trip invites: owner generates a link; a signed-in user claims a guest seat. 3) Trip competitions: make `trip_competitions` configurable (placement points, Ryder Cup team points, skins won, birdies, CTP) with per-competition round inclusion, and show the prominent ones on the trip dashboard. 4) Trip days: group rounds by day with pairings/tee times, and make "Start today's round" pick the next unplayed round. Keep the domain layer pure and add Vitest coverage for placement/team points.
