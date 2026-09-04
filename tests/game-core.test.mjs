import test from "node:test";
import assert from "node:assert/strict";

import {
  TEAM_ORDER,
  answerTimeWithCarry,
  buildGame,
  calculatePlacements,
  nextActiveTurn,
  nextTeam,
  normalizeSeed,
  roleCounts
} from "../game-core.js";

test("the same game code always produces the same board", () => {
  assert.deepEqual(buildGame("SPY2026"), buildGame("spy-2026"));
});

test("refreshing pictures does not change the hidden color layout", () => {
  const firstDeck = buildGame("REFRESH", 0);
  const secondDeck = buildGame("REFRESH", 1);
  assert.deepEqual(firstDeck.cards.map((card) => card.role), secondDeck.cards.map((card) => card.role));
  assert.equal(
    firstDeck.cards.some((card, index) => card.imageId === secondDeck.cards[index].imageId),
    false
  );
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

test("rankings follow completion rounds and preserve fourth place", () => {
  assert.deepEqual(
    calculatePlacements({ red: 3, yellow: 3, blue: 4, green: 5 }),
    { red: 1, yellow: 1, blue: 2, green: 4 }
  );
});

test("starting answers carries the unused clue seconds into the next minute", () => {
  assert.equal(answerTimeWithCarry(30), 90);
  assert.equal(answerTimeWithCarry(17), 77);
  assert.equal(answerTimeWithCarry(0), 60);
});

test("turns skip inactive teams and increment the round only after wrapping", () => {
  assert.deepEqual(nextActiveTurn("red", ["red", "blue", "green"], 3), { team: "blue", round: 3 });
  assert.deepEqual(nextActiveTurn("green", ["blue", "green"], 3), { team: "blue", round: 4 });
  assert.deepEqual(nextActiveTurn("blue", ["blue"], 4), { team: "blue", round: 5 });
  assert.equal(nextActiveTurn("red", [], 2), null);
});
