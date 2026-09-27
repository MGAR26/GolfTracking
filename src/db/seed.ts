/**
 * Deterministic development seed: Pinehurst Trip 2026 with four players and one live round.
 * Safe to re-run: it no-ops when the seed trip already exists.
 */
import { eq } from "drizzle-orm";
import type { Db } from "./client";
import * as s from "./schema";
import { allocateStrokes, calculateCourseHandicap, calculatePlayingHandicap } from "../domain/handicap";

export const SEED_IDS = {
  user: "user_matt",
  trip: "trip_pinehurst_2026",
  course: "course_example",
  teeSet: "tee_example_blue",
  round1: "round_pinehurst_r1",
  players: { matt: "player_matt", marcus: "player_marcus", ryan: "player_ryan", john: "player_john" },
  games: { stroke: "game_r1_net_stroke", skins: "game_r1_skins", nassau: "game_r1_nassau" },
  sideBet: "sidebet_r1_longest_drive_8",
} as const;

// Par 72, stroke indexes 1-18, plausible yardages.
export const SEED_HOLES = [
  { holeNumber: 1, par: 4, yardage: 401, strokeIndex: 7 },
  { holeNumber: 2, par: 5, yardage: 532, strokeIndex: 3 },
  { holeNumber: 3, par: 3, yardage: 178, strokeIndex: 15 },
  { holeNumber: 4, par: 4, yardage: 438, strokeIndex: 1 },
  { holeNumber: 5, par: 4, yardage: 392, strokeIndex: 11 },
  { holeNumber: 6, par: 3, yardage: 165, strokeIndex: 17 },
  { holeNumber: 7, par: 4, yardage: 412, strokeIndex: 5 },
  { holeNumber: 8, par: 5, yardage: 548, strokeIndex: 9 },
  { holeNumber: 9, par: 4, yardage: 385, strokeIndex: 13 },
  { holeNumber: 10, par: 4, yardage: 421, strokeIndex: 4 },
  { holeNumber: 11, par: 3, yardage: 190, strokeIndex: 16 },
  { holeNumber: 12, par: 5, yardage: 560, strokeIndex: 2 },
  { holeNumber: 13, par: 4, yardage: 377, strokeIndex: 12 },
  { holeNumber: 14, par: 4, yardage: 445, strokeIndex: 6 },
  { holeNumber: 15, par: 5, yardage: 515, strokeIndex: 10 },
  { holeNumber: 16, par: 3, yardage: 152, strokeIndex: 18 },
  { holeNumber: 17, par: 4, yardage: 408, strokeIndex: 8 },
  { holeNumber: 18, par: 4, yardage: 430, strokeIndex: 14 },
];

export const SEED_PLAYERS = [
  { id: SEED_IDS.players.matt, name: "Matt", hi: 5.2 },
  { id: SEED_IDS.players.marcus, name: "Marcus", hi: 11.4 },
  { id: SEED_IDS.players.ryan, name: "Ryan", hi: 8.7 },
  { id: SEED_IDS.players.john, name: "John", hi: 14.1 },
];

export async function seedDatabase(db: Db): Promise<{ seeded: boolean }> {
  const existing = await db.select({ id: s.trips.id }).from(s.trips).where(eq(s.trips.id, SEED_IDS.trip));
  if (existing.length > 0) return { seeded: false };

  await db.transaction(async (tx) => {
    await tx.insert(s.users).values({ id: SEED_IDS.user, displayName: "Matt" });
    await tx.insert(s.playerProfiles).values(
      SEED_PLAYERS.map((p) => ({
        id: p.id,
        userId: p.id === SEED_IDS.players.matt ? SEED_IDS.user : null,
        displayName: p.name,
        guestName: p.id === SEED_IDS.players.matt ? null : p.name,
        handicapIndex: p.hi,
        handicapUpdatedAt: new Date("2026-09-01T00:00:00Z"),
      })),
    );
    await tx.insert(s.trips).values({
      id: SEED_IDS.trip,
      ownerId: SEED_IDS.user,
      name: "Pinehurst Trip 2026",
      destination: "Pinehurst, NC",
      startDate: "2026-10-09",
      endDate: "2026-10-11",
    });
    await tx.insert(s.tripMembers).values(
      SEED_PLAYERS.map((p, i) => ({
        tripId: SEED_IDS.trip,
        playerProfileId: p.id,
        role: i === 0 ? "OWNER" : "PLAYER",
        orderIndex: i,
      })),
    );
    await tx.insert(s.tripCompetitions).values([
      { id: "comp_total_net", tripId: SEED_IDS.trip, type: "TOTAL_NET", name: "Total Net", orderIndex: 0 },
      { id: "comp_total_gross", tripId: SEED_IDS.trip, type: "TOTAL_GROSS", name: "Total Gross", orderIndex: 1 },
      { id: "comp_money", tripId: SEED_IDS.trip, type: "MONEY", name: "Money", orderIndex: 2 },
    ]);
    await tx.insert(s.courses).values({ id: SEED_IDS.course, name: "Example Course", city: "Pinehurst", state: "NC", country: "US" });
    await tx.insert(s.teeSets).values({
      id: SEED_IDS.teeSet,
      courseId: SEED_IDS.course,
      name: "Blue",
      par: 72,
      courseRating: 72.4,
      slopeRating: 135,
      yardage: SEED_HOLES.reduce((a, h) => a + h.yardage, 0),
    });
    await tx.insert(s.holes).values(SEED_HOLES.map((h) => ({ id: `${SEED_IDS.teeSet}_h${h.holeNumber}`, teeSetId: SEED_IDS.teeSet, ...h })));

    await tx.insert(s.rounds).values({
      id: SEED_IDS.round1,
      tripId: SEED_IDS.trip,
      courseId: SEED_IDS.course,
      teeSetId: SEED_IDS.teeSet,
      name: "Round 1",
      startsAt: new Date("2026-10-09T13:20:00Z"),
      countsTowardTrip: true,
      scoringMode: "HYBRID",
      status: "LIVE",
    });
    await tx.insert(s.roundPlayers).values(
      SEED_PLAYERS.map((p, i) => {
        const ch = calculateCourseHandicap({ handicapIndex: p.hi, slopeRating: 135, courseRating: 72.4, par: 72 });
        return {
          roundId: SEED_IDS.round1,
          playerId: p.id,
          teeSetId: SEED_IDS.teeSet,
          handicapIndexSnapshot: p.hi,
          courseHandicapRaw: ch.raw,
          courseHandicap: ch.courseHandicap,
          playingHandicap: calculatePlayingHandicap(ch.courseHandicap, 100),
          orderIndex: i,
        };
      }),
    );

    const ids = SEED_IDS.players;
    await tx.insert(s.games).values([
      { id: SEED_IDS.games.stroke, roundId: SEED_IDS.round1, type: "STROKE_PLAY", name: "Net Stroke Play", rulesJson: { basis: "NET", stakeCents: 0 }, orderIndex: 0 },
      { id: SEED_IDS.games.skins, roundId: SEED_IDS.round1, type: "SKINS", name: "$5 Skins", rulesJson: { basis: "NET", skinValueCents: 500, carryover: true, voidUnclaimed: true }, orderIndex: 1 },
      { id: SEED_IDS.games.nassau, roundId: SEED_IDS.round1, type: "NASSAU", name: "$20 Nassau", rulesJson: { basis: "NET", amountCents: 2000, sideA: [ids.matt, ids.ryan], sideB: [ids.marcus, ids.john], presses: false }, orderIndex: 2 },
    ]);
    await tx.insert(s.gameParticipants).values([
      ...SEED_PLAYERS.map((p, i) => ({ gameId: SEED_IDS.games.stroke, playerId: p.id, orderIndex: i })),
      ...SEED_PLAYERS.map((p, i) => ({ gameId: SEED_IDS.games.skins, playerId: p.id, orderIndex: i })),
      ...SEED_PLAYERS.map((p, i) => ({ gameId: SEED_IDS.games.nassau, playerId: p.id, orderIndex: i })),
    ]);

    await tx.insert(s.sideBets).values({
      id: SEED_IDS.sideBet,
      roundId: SEED_IDS.round1,
      holeNumber: 8,
      creatorId: ids.matt,
      type: "LONGEST_DRIVE_IN_FAIRWAY",
      description: "Longest Drive in Fairway - Hole 8",
      amountCents: 2000,
      basis: "GROSS",
      holeNumbersJson: [8],
      status: "PROPOSED",
    });
    await tx.insert(s.sideBetParticipants).values([
      { sideBetId: SEED_IDS.sideBet, playerId: ids.matt, side: "A", acceptedAt: new Date("2026-10-09T13:00:00Z") },
      { sideBetId: SEED_IDS.sideBet, playerId: ids.marcus, side: "B", acceptedAt: null },
    ]);

    // A few holes already scored so the dashboard has something to show.
    const scored: Record<string, [number, number | null, boolean | null, string | null][]> = {
      // gross, putts, gir, fairway
      [ids.matt]: [[4, 2, true, "HIT"], [5, 2, true, "HIT"], [3, 1, true, null]],
      [ids.marcus]: [[5, 2, false, "LEFT"], [6, 3, false, "HIT"], [4, 2, false, null]],
      [ids.ryan]: [[4, 1, false, "RIGHT"], [5, 2, true, "HIT"], [3, 2, true, null]],
      [ids.john]: [[6, 2, false, "LEFT"], [7, 3, false, "RIGHT"], [4, 2, false, null]],
    };
    const rows = Object.entries(scored).flatMap(([playerId, arr]) =>
      arr.map(([grossScore, putts, gir, fairwayResult], i) => ({
        roundId: SEED_IDS.round1,
        playerId,
        holeNumber: i + 1,
        grossScore,
        putts,
        gir,
        fairwayResult,
        updatedBy: ids.matt,
      })),
    );
    await tx.insert(s.holeScores).values(rows);
  });

  // Sanity: allocation must be derivable for every seed player.
  for (const p of SEED_PLAYERS) {
    const ch = calculateCourseHandicap({ handicapIndex: p.hi, slopeRating: 135, courseRating: 72.4, par: 72 });
    allocateStrokes(ch.courseHandicap, SEED_HOLES);
  }
  return { seeded: true };
}
