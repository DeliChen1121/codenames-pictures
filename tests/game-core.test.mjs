import test from "node:test";
import assert from "node:assert/strict";

import { TEAM_ORDER, buildGame, nextTeam, normalizeSeed, roleCounts } from "../game-core.js";

test("the same game code always produces the same board", () => {
  assert.deepEqual(buildGame("SPY2026"), buildGame("spy-2026"));
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
