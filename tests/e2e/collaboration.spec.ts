import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * Phase 2: two phones on the same round. Uses separate browser contexts with different
 * acting players (cookie-based actor until auth lands).
 */

async function ensureDemoTrip(page: Page) {
  await page.goto("/");
  const load = page.getByRole("button", { name: /Load demo trip/ });
  if (await load.isVisible()) {
    await load.click();
    await expect(page).toHaveURL(/\/trips\/trip_pinehurst_2026/);
  }
}

async function phoneFor(browser: Browser, playerId: string): Promise<Page> {
  const ctx = await browser.newContext();
  await ctx.addCookies([{ name: "gto_player", value: playerId, domain: "localhost", path: "/" }]);
  return ctx.newPage();
}

const row = (page: Page, name: string) => page.getByRole("region", { name: `${name} hole entry` });

test("a score entered on one phone appears live on another without navigation", async ({ browser, page }) => {
  await ensureDemoTrip(page);
  const matt = await phoneFor(browser, "player_matt");
  const ryan = await phoneFor(browser, "player_ryan");

  await ryan.goto("/rounds/round_pinehurst_r1");
  await expect(ryan.getByTestId("live-status")).toHaveAttribute("data-state", "live");

  await matt.goto("/rounds/round_pinehurst_r1/score?hole=4");
  await row(matt, "Matt").getByRole("button", { name: /Set score to par/ }).click();
  await row(matt, "Matt").getByRole("button", { name: "Minus one stroke" }).click(); // birdie 3 on hole 4
  await expect(row(matt, "Matt").getByText("Synced")).toBeVisible();

  // Ryan's overview re-renders from the SSE event: Matt's birdie shows in highlights.
  await expect(ryan.getByText("Matt · Birdie on 4")).toBeVisible({ timeout: 15_000 });
});

test("concurrent edits of the same hole surface a conflict and the organizer reconciles it", async ({ browser, page }) => {
  await ensureDemoTrip(page);
  const matt = await phoneFor(browser, "player_matt"); // owner: can edit anyone
  const john = await phoneFor(browser, "player_john"); // player: edits own row

  // Both open John's row on hole 5 with the same base version.
  await matt.goto("/rounds/round_pinehurst_r1/score?hole=5");
  await john.goto("/rounds/round_pinehurst_r1/score?hole=5");

  // John saves first: 6.
  await row(john, "John").getByRole("button", { name: /Set score to par/ }).click();
  await row(john, "John").getByRole("button", { name: "Plus one stroke" }).click();
  await row(john, "John").getByRole("button", { name: "Plus one stroke" }).click();
  await expect(row(john, "John").getByText("Synced")).toBeVisible();

  // Matt, unaware, enters 5 for John from the stale version -> conflict.
  await row(matt, "John").getByRole("button", { name: /Set score to par/ }).click();
  await row(matt, "John").getByRole("button", { name: "Plus one stroke" }).click();
  await expect(row(matt, "John").getByText("Someone else saved this hole first.")).toBeVisible();
  await expect(row(matt, "John").getByText(/Theirs: 6 gross/)).toBeVisible();

  // Matt hands it to the organizer instead of guessing.
  await row(matt, "John").getByRole("button", { name: "Ask organizer" }).click();
  await expect(row(matt, "John").getByRole("button", { name: "Score 6" })).toBeVisible(); // adopted theirs locally

  // Organizer (Matt) sees the conflict on the overview and picks the reporter's value (5).
  await matt.goto("/rounds/round_pinehurst_r1");
  const panel = matt.getByTestId("conflict-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByText("John · Hole 5")).toBeVisible();
  await panel.getByRole("button", { name: /Use Matt's/ }).click();
  await expect(panel).toHaveCount(0);

  await matt.goto("/rounds/round_pinehurst_r1/score?hole=5");
  await expect(row(matt, "John").getByRole("button", { name: "Score 5" })).toBeVisible();
});

test("scores entered offline are queued and replayed when the connection returns", async ({ browser, page }) => {
  await ensureDemoTrip(page);
  const ctx = await browser.newContext();
  await ctx.addCookies([{ name: "gto_player", value: "player_matt", domain: "localhost", path: "/" }]);
  const matt = await ctx.newPage();
  await matt.goto("/rounds/round_pinehurst_r1/score?hole=6");

  await ctx.setOffline(true);
  await row(matt, "Ryan").getByRole("button", { name: /Set score to par/ }).click(); // par 3
  await row(matt, "Ryan").getByRole("button", { name: "Minus one stroke" }).click(); // 2
  await expect(row(matt, "Ryan").getByText("Queued offline")).toBeVisible();
  await expect(matt.getByTestId("sync-status")).toContainText(/Offline · 1 change queued/);

  await ctx.setOffline(false);
  await expect(row(matt, "Ryan").getByText("Synced")).toBeVisible({ timeout: 30_000 });
  await expect(matt.getByTestId("sync-status")).toHaveCount(0);

  // Persisted server-side: a fresh load shows the score.
  await matt.goto("/rounds/round_pinehurst_r1/score?hole=6");
  await expect(row(matt, "Ryan").getByRole("button", { name: "Score 2" })).toBeVisible();
});
