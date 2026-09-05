import test from "node:test";
import assert from "node:assert/strict";

import {
  GAME_MODES,
  TEAM_ORDER,
  answerTimeWithCarry,
  buildGame,
  calculatePlacements,
  createGameConfig,
  getGamePreset,
  nextActiveTurn,
  nextTeam,
  normalizeSeed,
  roleCounts,
  teamsForCount
} from "../game-core.js";

test("the same game code always produces the same board", () => {
  assert.deepEqual(buildGame("SPY2026"), buildGame("spy-2026"));
});

test("refreshing pictures does not change the hidden color layout", () => {
  const firstDeck = buildGame("REFRESH", 0, 4);
  const secondDeck = buildGame("REFRESH", 1, 4);
  assert.deepEqual(firstDeck.cards.map((card) => card.role), secondDeck.cards.map((card) => card.role));
  assert.equal(
    firstDeck.cards.some((card, index) => card.imageId === secondDeck.cards[index].imageId),
    false
  );
});

test("refreshing the color layout keeps the same pictures", () => {
  const firstLayout = buildGame("LAYOUT", 3, 0);
  const secondLayout = buildGame("LAYOUT", 3, 1);
  assert.deepEqual(firstLayout.cards.map((card) => card.imageId), secondLayout.cards.map((card) => card.imageId));
  assert.notDeepEqual(firstLayout.cards.map((card) => card.role), secondLayout.cards.map((card) => card.role));
});

test("a board contains 25 unique image cards", () => {
  const game = buildGame("PICTURES");
  const ids = game.cards.map((card) => card.imageId);
  assert.equal(game.cards.length, 25);
  assert.equal(new Set(ids).size, 25);
  assert.ok(ids.every((id) => id >= 0 && id < 280));
});

test("a board contains the required four-team color distribution", () => {
  const counts = roleCounts(buildGame("COLORS").cards);
  assert.deepEqual(counts, {
    red: 5,
    yellow: 5,
    blue: 5,
    green: 5,
    black: 1,
    white: 4
  });
});

test("turn order cycles red, yellow, blue, green", () => {
  assert.deepEqual(TEAM_ORDER.map(nextTeam), ["yellow", "blue", "green", "red"]);
});

test("game codes are normalized for sharing", () => {
  assert.equal(normalizeSeed(" ab-c 12!? "), "ABC12");
});

test("cards use the visible numbers 1 through 25", () => {
  assert.deepEqual(
    buildGame("NUMBERS").cards.map((card) => card.coordinate),
    Array.from({ length: 25 }, (_, index) => String(index + 1))
  );
});

test("rankings use competition ranking and skip places after ties", () => {
  assert.deepEqual(
    calculatePlacements({ red: 3, yellow: 3, blue: 4, green: 5 }),
    { red: 1, yellow: 1, blue: 3, green: 4 }
  );
  assert.deepEqual(
    calculatePlacements({ red: 3, yellow: 3, blue: 4, green: 4 }),
    { red: 1, yellow: 1, blue: 3, green: 3 }
  );
});

test("teams eliminated by black cards are always assigned last place", () => {
  assert.deepEqual(
    calculatePlacements(
      { red: 3, yellow: 4 },
      ["red", "yellow", "blue", "green"],
      { blue: 1, green: 3 }
    ),
    { red: 1, yellow: 2, blue: 4, green: 4 }
  );
});

test("starting answers carries the unused clue seconds into the next minute", () => {
  assert.equal(answerTimeWithCarry(30), 90);
  assert.equal(answerTimeWithCarry(17), 77);
  assert.equal(answerTimeWithCarry(0), 60);
  assert.equal(answerTimeWithCarry(12, 75), 87);
});

test("turns skip inactive teams and increment the round only after wrapping", () => {
  assert.deepEqual(nextActiveTurn("red", ["red", "blue", "green"], 3), { team: "blue", round: 3 });
  assert.deepEqual(nextActiveTurn("green", ["blue", "green"], 3), { team: "blue", round: 4 });
  assert.deepEqual(nextActiveTurn("blue", ["blue"], 4), { team: "blue", round: 5 });
  assert.equal(nextActiveTurn("red", [], 2), null);
});

test("all nine team and speed presets exactly fill their grids", () => {
  for (const teamCount of [2, 3, 4]) {
    for (const mode of GAME_MODES) {
      const config = createGameConfig({ teamCount, mode }, "PRESETS");
      const counts = roleCounts(buildGame("PRESETS", 0, 0, config).cards);
      assert.equal(config.cardCount, config.gridSize ** 2);
      assert.equal(Object.values(config.teamCounts).reduce((sum, count) => sum + count, 0)
        + config.whiteCount + config.blackCount, config.cardCount);
      for (const team of config.activeTeams) assert.equal(counts[team], config.teamCounts[team]);
      assert.equal(counts.white, config.whiteCount);
      assert.equal(counts.black, config.blackCount);
    }
  }
});

test("preset values match the requested rules", () => {
  assert.deepEqual(getGamePreset(2, "quick"), { gridSize: 4, firstCount: 6, secondCount: 5, whiteCount: 4, blackCount: 1 });
  assert.deepEqual(getGamePreset(2, "classic"), { gridSize: 5, firstCount: 9, secondCount: 8, whiteCount: 7, blackCount: 1 });
  assert.deepEqual(getGamePreset(2, "slow"), { gridSize: 6, firstCount: 12, secondCount: 11, whiteCount: 11, blackCount: 2 });
  assert.deepEqual(getGamePreset(3, "classic"), { gridSize: 5, perTeamCount: 6, whiteCount: 6, blackCount: 1 });
  assert.deepEqual(getGamePreset(4, "slow"), { gridSize: 6, perTeamCount: 7, whiteCount: 6, blackCount: 2 });
});

test("two-team mode contains only red and blue and gives the first team the extra card", () => {
  const config = createGameConfig({ teamCount: 2, mode: "classic", firstTeam: "blue" }, "DUEL");
  assert.deepEqual(config.activeTeams, ["red", "blue"]);
  assert.deepEqual(config.turnOrder, ["blue", "red"]);
  assert.equal(config.teamCounts.blue, 9);
  assert.equal(config.teamCounts.red, 8);
  assert.deepEqual(teamsForCount(3), ["red", "yellow", "blue"]);
});

test("every team-count mode defaults to the canonical red-first order", () => {
  assert.deepEqual(createGameConfig({ teamCount: 2, mode: "classic" }, "ANY-SEED").turnOrder, ["red", "blue"]);
  assert.deepEqual(createGameConfig({ teamCount: 3, mode: "classic" }, "ANY-SEED").turnOrder, ["red", "yellow", "blue"]);
  assert.deepEqual(createGameConfig({ teamCount: 4, mode: "classic" }, "ANY-SEED").turnOrder, ["red", "yellow", "blue", "green"]);
});

test("a complete custom team order is preserved and determines the first team", () => {
  const order = ["yellow", "green", "red", "blue"];
  const config = createGameConfig({ teamCount: 4, mode: "classic", turnOrder: order }, "ORDER");
  assert.deepEqual(config.turnOrder, order);
  assert.equal(config.firstTeam, "yellow");

  const duel = createGameConfig({ teamCount: 2, mode: "classic", turnOrder: ["blue", "red"] }, "DUEL-ORDER");
  assert.deepEqual(duel.turnOrder, ["blue", "red"]);
  assert.equal(duel.teamCounts.blue, 9);
  assert.equal(duel.teamCounts.red, 8);
});

test("custom rules produce a deterministic dynamic grid", () => {
  const custom = createGameConfig({
    teamCount: 3,
    mode: "custom",
    gridSize: 4,
    firstTeam: "yellow",
    teamCounts: { red: 3, yellow: 5, blue: 4 },
    whiteCount: 3,
    blackCount: 1
  }, "CUSTOM");
  const game = buildGame("CUSTOM", 2, 1, custom);
  assert.equal(game.cards.length, 16);
  assert.deepEqual(game.cards.map((card) => card.coordinate), Array.from({ length: 16 }, (_, index) => String(index + 1)));
  assert.deepEqual(roleCounts(game.cards), { red: 3, yellow: 5, blue: 4, black: 1, white: 3 });
  assert.deepEqual(game, buildGame("CUSTOM", 2, 1, custom));
});

test("custom rules reject allocations that do not fill the grid", () => {
  assert.throws(() => createGameConfig({
    teamCount: 3,
    mode: "custom",
    gridSize: 4,
    teamCounts: { red: 4, yellow: 4, blue: 4 },
    whiteCount: 2,
    blackCount: 1
  }, "INVALID"), /不一致/);
});

test("turn advancement follows the configured team order", () => {
  const order = ["blue", "red"];
  assert.deepEqual(nextActiveTurn("blue", order, 1, order), { team: "red", round: 1 });
  assert.deepEqual(nextActiveTurn("red", order, 1, order), { team: "blue", round: 2 });
});
