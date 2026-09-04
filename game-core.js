export const TEAM_ORDER = ["red", "yellow", "blue", "green"];

export const TEAMS = {
  red: { name: "红队", short: "红", color: "#ef4444" },
  yellow: { name: "黄队", short: "黄", color: "#f7c948" },
  blue: { name: "蓝队", short: "蓝", color: "#3b82f6" },
  green: { name: "绿队", short: "绿", color: "#22c55e" }
};

export const ROLE_NAMES = {
  red: "红队",
  yellow: "黄队",
  blue: "蓝队",
  green: "绿队",
  black: "黑色",
  white: "白色"
};

export function normalizeSeed(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 10);
}

export function createGameCode() {
  const buffer = new Uint32Array(2);
  crypto.getRandomValues(buffer);
  return (buffer[0].toString(36) + buffer[1].toString(36))
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8)
    .padEnd(8, "7");
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  return function random() {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(items, random) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }
  return copy;
}

export function buildGame(rawSeed) {
  const seed = normalizeSeed(rawSeed) || "MVP2026";
  const imageRandom = mulberry32(hashString(seed + ":images"));
  const roleRandom = mulberry32(hashString(seed + ":roles"));
  const imagePool = Array.from({ length: 280 }, (_, index) => index);
  const roles = [
    ...Array(5).fill("red"),
    ...Array(5).fill("yellow"),
    ...Array(5).fill("blue"),
    ...Array(5).fill("green"),
    "black",
    ...Array(4).fill("white")
  ];

  const images = shuffle(imagePool, imageRandom).slice(0, 25);
  const shuffledRoles = shuffle(roles, roleRandom);
  return {
    seed,
    cards: images.map((imageId, index) => ({
      index,
      imageId,
      role: shuffledRoles[index],
      coordinate: String.fromCharCode(65 + Math.floor(index / 5)) + String((index % 5) + 1)
    }))
  };
}

export function nextTeam(team) {
  const currentIndex = TEAM_ORDER.indexOf(team);
  return TEAM_ORDER[(currentIndex + 1 + TEAM_ORDER.length) % TEAM_ORDER.length];
}

export function roleCounts(cards) {
  return cards.reduce((counts, card) => {
    counts[card.role] = (counts[card.role] || 0) + 1;
    return counts;
  }, {});
}
