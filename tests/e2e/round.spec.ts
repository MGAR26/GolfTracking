import { expect, test, type Page } from "@playwright/test";

/**
 * Happy path for the vertical slice: demo trip -> live round -> score every hole for four
 * players from one phone -> accept + resolve a side bet -> lock the round -> standings + ledger.
 */

/** Seeds the demo trip once; later tests reuse it. */
async function ensureDemoTrip(page: Page) {
  await page.goto("/");
  const load = page.getByRole("button", { name: /Load demo trip/ });
  if (await load.isVisible()) {
    await load.click();
    await expect(page).toHaveURL(/\/trips\/trip_pinehurst_2026/);
  }
}

async function scoreHole(page: Page, hole: number, scores: Record<string, number>) {
  await page.goto(`/rounds/round_pinehurst_r1/score?hole=${hole}`);
  await expect(page.getByText(`Hole ${hole}`, { exact: true })).toBeVisible();
  for (const [name, target] of Object.entries(scores)) {
    const row = page.getByRole("region", { name: `${name} hole entry` });
    const plus = row.getByRole("button", { name: "Plus one stroke" });
    const minus = row.getByRole("button", { name: "Minus one stroke" });
    const parButton = row.getByRole("button", { name: /Set score to par/ });
    const par = Number((await parButton.getAttribute("aria-label"))!.match(/par (\d+)/)![1]);
    await parButton.click();
    const diff = target - par;
    for (let i = 0; i < Math.abs(diff); i++) await (diff > 0 ? plus : minus).click();
    await expect(row.getByRole("button", { name: `Score ${target}` })).toBeVisible();
  }
  // Wait for every row to report a completed save before leaving the hole.
  for (const name of Object.keys(scores)) {
    await expect(page.getByRole("region", { name: `${name} hole entry` }).getByText("Synced")).toBeVisible();
  }
}

test("four players complete a round from one phone and lock it into trip standings", async ({ page }) => {
  await ensureDemoTrip(page);
  await page.goto("/trips/trip_pinehurst_2026");
  await expect(page.getByRole("heading", { name: "Pinehurst Trip 2026" })).toBeVisible();

  await page.getByRole("link", { name: "Continue scoring" }).click();
  await expect(page).toHaveURL(/\/rounds\/round_pinehurst_r1\/score/);
  // Seed data already has holes 1-3; the page should land on hole 4.
  await expect(page.getByText("Hole 4", { exact: true })).toBeVisible();

  // Matt is owner + scorer, so he can enter for everyone (hybrid mode).
  const pars: Record<number, number> = { 4: 4, 5: 4, 6: 3, 7: 4, 8: 5, 9: 4, 10: 4, 11: 3, 12: 5, 13: 4, 14: 4, 15: 5, 16: 3, 17: 4, 18: 4 };
  for (let hole = 4; hole <= 18; hole++) {
    const par = pars[hole];
    await scoreHole(page, hole, {
      Matt: par + (hole === 8 ? -1 : 0), // birdie on 8
      Marcus: par + 1,
      Ryan: par + (hole % 3 === 0 ? 1 : 0),
      John: par + 2,
    });
  }

  // Scorecard shows totals and net figures.
  await page.goto("/rounds/round_pinehurst_r1/scorecard");
  await expect(page.getByRole("heading", { name: "Scorecard" })).toBeVisible();

  // Games tab: skins/nassau/stroke play summaries present; side bet awaits Marcus.
  await page.goto("/rounds/round_pinehurst_r1/games");
  await expect(page.getByText("$5 Skins")).toBeVisible();
  await expect(page.getByText("$20 Nassau")).toBeVisible();
  await expect(page.getByText("Longest Drive in Fairway - Hole 8")).toBeVisible();
  await expect(page.getByText("Waiting on Marcus")).toBeVisible();

  // Switch to Marcus and accept the bet -> terms lock.
  await page.getByLabel("Acting as player").selectOption("player_marcus");
  await expect(page.getByRole("button", { name: "Accept" })).toBeVisible();
  await page.getByRole("button", { name: "Accept" }).click();
  await expect(page.getByText("Accepted", { exact: true })).toBeVisible();

  // Longest drive is manual: Marcus (a participant) records Marcus as the winner.
  await page.getByRole("button", { name: "Marcus won" }).click();
  await expect(page.getByText("Winner: Marcus")).toBeVisible();

  // Finish + lock (Matt is the organizer).
  await page.getByLabel("Acting as player").selectOption("player_matt");
  await page.goto("/rounds/round_pinehurst_r1/finish");
  const lock = page.getByRole("button", { name: "Lock round & post results" });
  await expect(lock).toBeEnabled();
  await lock.click();

  await expect(page).toHaveURL(/\/trips\/trip_pinehurst_2026$/);
  await expect(page.getByText("Net · counted rounds")).toBeVisible();
  await expect(page.getByText("Final", { exact: true }).first()).toBeVisible();

  // Money page: side bet + game entries are itemized and the settlement plan nets to zero.
  await page.goto("/trips/trip_pinehurst_2026/money");
  await expect(page.getByText("Side bet · Longest Drive in Fairway - Hole 8")).toBeVisible();
  await expect(page.getByText(/Fewest payments that clear every balance\./)).toBeVisible();
  await expect(page.getByText(/Residual/)).toHaveCount(0);

  // Locked round is read-only.
  await page.goto("/rounds/round_pinehurst_r1/score?hole=1");
  await expect(page.getByText("This round is locked. Scores are read-only.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Matt hole entry" }).getByRole("button", { name: "Plus one stroke" })).toBeDisabled();
});

test("individual mode blocks editing another player's row", async ({ page }) => {
  await ensureDemoTrip(page);
  await page.goto("/trips/trip_pinehurst_2026/rounds/new");
  await page.getByRole("button", { name: "Individual" }).click();
  await page.getByRole("button", { name: "Start round" }).click();
  await expect(page).toHaveURL(/\/rounds\/[^/]+\/score/);
  // Acting as Matt (owner) he can still edit everyone; switch to Ryan (plain player).
  await page.getByLabel("Acting as player").selectOption("player_ryan");
  await expect(page.getByRole("region", { name: "Ryan hole entry" }).getByRole("button", { name: "Plus one stroke" })).toBeEnabled();
  await expect(page.getByRole("region", { name: "Matt hole entry" }).getByRole("button", { name: "Plus one stroke" })).toBeDisabled();
});
