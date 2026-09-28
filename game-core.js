export const TEAM_ORDER = ["red", "yellow", "blue", "green"];

export const TEAMS = {
  red: { name: "Red", short: "R", color: "#ef4444" },
  yellow: { name: "Yellow", short: "Y", color: "#f7c948" },
  blue: { name: "Blue", short: "B", color: "#3b82f6" },
  green: { name: "Green", short: "G", color: "#22c55e" }
};

export const ROLE_NAMES = {
  red: "Red",
  yellow: "Yellow",
  blue: "Blue",
  green: "Green",
  black: "Black",
  white: "White"
};

export const GAME_MODES = ["quick", "classic", "slow"];

export const MODE_NAMES = {
  quick: "Quick",
  classic: "Classic",
  slow: "Slow",
  custom: "Custom"
};

const PRESETS = Object.freeze({
  2: Object.freeze({
    quick: Object.freeze({ gridSize: 4, firstCount: 6, secondCount: 5, whiteCount: 4, blackCount: 1 }),
    classic: Object.freeze({ gridSize: 5, firstCount: 9, secondCount: 8, whiteCount: 7, blackCount: 1 }),
    slow: Object.freeze({ gridSize: 6, firstCount: 12, secondCount: 11, whiteCount: 11, blackCount: 2 })
  }),
  3: Object.freeze({
    quick: Object.freeze({ gridSize: 4, perTeamCount: 4, whiteCount: 3, blackCount: 1 }),
    classic: Object.freeze({ gridSize: 5, perTeamCount: 6, whiteCount: 6, blackCount: 1 }),
    slow: Object.freeze({ gridSize: 6, perTeamCount: 8, whiteCount: 10, blackCount: 2 })
  }),
  4: Object.freeze({
    quick: Object.freeze({ gridSize: 5, perTeamCount: 4, whiteCount: 8, blackCount: 1 }),
    classic: Object.freeze({ gridSize: 5, perTeamCount: 5, whiteCount: 4, blackCount: 1 }),
    slow: Object.freeze({ gridSize: 6, perTeamCount: 7, whiteCount: 6, blackCount: 2 })
  })
});

export function normalizeSeed(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 10);
}

// Portable board seeds include every input to buildGame, never player progress.
export function createBoardSeed(game) {
  const { seed, imageRevision, layoutRevision, config } = game;
  return [
    "CNP1", seed, imageRevision, layoutRevision, config.teamCount, config.mode,
    config.gridSize, config.turnOrder.map((team) => team[0]).join(""),
    config.activeTeams.map((team) => config.teamCounts[team]).join(","),
    config.whiteCount, config.blackCount
  ].join(":");
}

export function parseBoardSeed(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (/^[a-z0-9]{1,10}$/i.test(text)) {
    return { seed: normalizeSeed(text), imageRevision: 0, layoutRevision: 0, config: null };
  }
  if (!/^CNP1:/i.test(text)) {
    throw new Error("Use a 1–10 character game code of letters or digits, or paste a full seed copied from the game.");
  }
  try {
    const parts = text.split(":");
    if (parts.length !== 11 || !/^[a-z0-9]{1,10}$/i.test(parts[1])) throw new Error();
    const number = (raw) => {
      if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new Error();
      return Number(raw);
    };
    const seed = normalizeSeed(parts[1]);
    const imageRevision = number(parts[2]);
    const layoutRevision = number(parts[3]);
    const teamCount = number(parts[4]);
    const mode = parts[5].toLowerCase();
    if (![...GAME_MODES, "custom"].includes(mode)) throw new Error();
    const activeTeams = teamsForCount(teamCount);
    const turnOrder = [...parts[7].toLowerCase()].map((letter) => TEAM_ORDER.find((team) => team[0] === letter));
    if (turnOrder.length !== teamCount || new Set(turnOrder).size !== teamCount
      || turnOrder.some((team) => !activeTeams.includes(team))) throw new Error();
    const counts = parts[8].split(",").map(number);
    if (counts.length !== teamCount || counts.some((count) => count < 1)) throw new Error();
    const config = createGameConfig({
      teamCount, mode, gridSize: number(parts[6]), turnOrder,
      teamCounts: Object.fromEntries(activeTeams.map((team, index) => [team, counts[index]])),
      whiteCount: number(parts[9]), blackCount: number(parts[10])
    }, seed);
    return { seed, imageRevision, layoutRevision, config };
  } catch {
    throw new Error("That full seed is invalid or incomplete. Copy and paste it again.");
  }
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

function integer(value, fallback) {
  if (value === "" || value === null || value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

export function teamsForCount(rawTeamCount) {
  const teamCount = integer(rawTeamCount, 4);
  if (teamCount === 2) return ["red", "blue"];
  if (teamCount === 3) return ["red", "yellow", "blue"];
  if (teamCount === 4) return [...TEAM_ORDER];
  throw new Error("Team count must be 2, 3, or 4.");
}

export function getGamePreset(rawTeamCount, rawMode = "classic") {
  const teamCount = teamsForCount(rawTeamCount).length;
  const mode = GAME_MODES.includes(rawMode) ? rawMode : "classic";
  return { ...PRESETS[teamCount][mode] };
}

export function resolveFirstTeam(rawSeed, activeTeams, requestedTeam = "red") {
  const safeTeams = activeTeams.filter((team) => TEAM_ORDER.includes(team));
  if (safeTeams.length === 0) throw new Error("At least one valid team is required.");
  if (safeTeams.includes(requestedTeam)) return requestedTeam;
  return safeTeams[0];
}

export function resolveTurnOrder(activeTeams, requestedOrder, requestedFirstTeam = "red") {
  const safeTeams = activeTeams.filter((team) => TEAM_ORDER.includes(team));
  if (Array.isArray(requestedOrder)
    && requestedOrder.length === safeTeams.length
    && requestedOrder.every((team, index) => safeTeams.includes(team) && requestedOrder.indexOf(team) === index)) {
    return [...requestedOrder];
  }
  const firstTeam = resolveFirstTeam("", safeTeams, requestedFirstTeam);
  return [
    ...safeTeams.slice(safeTeams.indexOf(firstTeam)),
    ...safeTeams.slice(0, safeTeams.indexOf(firstTeam))
  ];
}

export function createGameConfig(options = {}, rawSeed = "MVP2026") {
  const activeTeams = teamsForCount(options.teamCount);
  const teamCount = activeTeams.length;
  const requestedMode = GAME_MODES.includes(options.mode) ? options.mode : "custom";
  const preset = getGamePreset(teamCount, requestedMode === "custom" ? "classic" : requestedMode);
  const turnOrder = resolveTurnOrder(activeTeams, options.turnOrder, options.firstTeam);
  const firstTeam = turnOrder[0];

  const suppliedCounts = options.teamCounts || {};
  const hasEverySuppliedCount = activeTeams.every((team) => integer(suppliedCounts[team], -1) >= 1);
  const teamCounts = {};
  if (hasEverySuppliedCount) {
    for (const team of activeTeams) teamCounts[team] = integer(suppliedCounts[team], 0);
  } else if (teamCount === 2) {
    teamCounts[firstTeam] = integer(options.firstCount, preset.firstCount);
    teamCounts[activeTeams.find((team) => team !== firstTeam)] = integer(options.secondCount, preset.secondCount);
  } else {
    for (const team of activeTeams) teamCounts[team] = integer(options.perTeamCount, preset.perTeamCount);
  }

  const gridSize = integer(options.gridSize, preset.gridSize);
  const whiteCount = integer(options.whiteCount, preset.whiteCount);
  const blackCount = integer(options.blackCount, preset.blackCount);
  if (gridSize < 3 || gridSize > 8) throw new Error("Grid size must be between 3 and 8.");
  if (whiteCount < 0 || blackCount < 0) throw new Error("White and black card counts cannot be below 0.");
  if (Object.values(teamCounts).some((count) => count < 1)) throw new Error("Each team needs at least 1 colored card.");

  const cardCount = gridSize * gridSize;
  const assignedCount = Object.values(teamCounts).reduce((sum, count) => sum + count, 0) + whiteCount + blackCount;
  if (assignedCount !== cardCount) {
    throw new Error("Assigned card total " + assignedCount + " does not match the " + gridSize + "×" + gridSize + " grid.");
  }

  return {
    teamCount,
    activeTeams,
    mode: requestedMode,
    gridSize,
    cardCount,
    teamCounts,
    whiteCount,
    blackCount,
    firstTeam,
    turnOrder
  };
}

export function configSignature(config) {
  return [
    "t" + config.teamCount,
    "m" + config.mode,
    "g" + config.gridSize,
    "f" + config.firstTeam,
    "o" + config.turnOrder.map((team) => team[0]).join(""),
    ...config.activeTeams.map((team) => team[0] + config.teamCounts[team]),
    "w" + config.whiteCount,
    "k" + config.blackCount
  ].join("-");
}

function usesLegacyRoleLayout(config) {
  return config.teamCount === 4
    && config.gridSize === 5
    && config.whiteCount === 4
    && config.blackCount === 1
    && config.activeTeams.every((team) => config.teamCounts[team] === 5);
}

export function buildGame(rawSeed, imageRevision = 0, layoutRevision = 0, rawConfig = {}) {
  const seed = normalizeSeed(rawSeed) || "MVP2026";
  const config = createGameConfig(rawConfig, seed);
  const imageRandom = mulberry32(hashString(seed + ":images"));
  const safeLayoutRevision = Math.max(0, Number(layoutRevision) || 0);
  const roleBase = usesLegacyRoleLayout(config) ? seed + ":roles" : seed + ":roles:" + configSignature(config);
  const roleKey = safeLayoutRevision === 0 ? roleBase : roleBase + ":" + safeLayoutRevision;
  const roleRandom = mulberry32(hashString(roleKey));
  const imagePool = Array.from({ length: 280 }, (_, index) => index);
  const roles = [
    ...config.activeTeams.flatMap((team) => Array(config.teamCounts[team]).fill(team)),
    ...Array(config.blackCount).fill("black"),
    ...Array(config.whiteCount).fill("white")
  ];

  const shuffledImages = shuffle(imagePool, imageRandom);
  const safeImageRevision = Math.max(0, Number(imageRevision) || 0);
  const deckOffset = (safeImageRevision * config.cardCount) % shuffledImages.length;
  const images = Array.from(
    { length: config.cardCount },
    (_, index) => shuffledImages[(deckOffset + index) % shuffledImages.length]
  );
  const shuffledRoles = shuffle(roles, roleRandom);
  return {
    seed,
    imageRevision: safeImageRevision,
    layoutRevision: safeLayoutRevision,
    config,
    cards: images.map((imageId, index) => ({
      index,
      imageId,
      role: shuffledRoles[index],
      coordinate: String(index + 1)
    }))
  };
}

export function nextTeam(team) {
  const currentIndex = TEAM_ORDER.indexOf(team);
  return TEAM_ORDER[(currentIndex + 1 + TEAM_ORDER.length) % TEAM_ORDER.length];
}

export function nextActiveTurn(currentTeam, activeTeamNames, currentRound, orderedTeams = TEAM_ORDER) {
  const order = orderedTeams.filter((team, index) => TEAM_ORDER.includes(team) && orderedTeams.indexOf(team) === index);
  const active = new Set(activeTeamNames.filter((team) => order.includes(team)));
  if (active.size === 0) return null;
  const fromIndex = order.indexOf(currentTeam);
  for (let step = 1; step <= order.length; step += 1) {
    const index = (fromIndex + step + order.length) % order.length;
    const team = order[index];
    if (active.has(team)) {
      const wrapped = fromIndex >= 0 && fromIndex + step >= order.length;
      return {
        team,
        round: Math.max(1, Number(currentRound) || 0) + (wrapped ? 1 : 0)
      };
    }
  }
  return null;
}

export function answerTimeWithCarry(clueSecondsRemaining, answerSeconds = 60) {
  return Math.max(0, Math.floor(Number(clueSecondsRemaining) || 0))
    + Math.max(5, Math.floor(Number(answerSeconds) || 60));
}

export function roleCounts(cards) {
  return cards.reduce((counts, card) => {
    counts[card.role] = (counts[card.role] || 0) + 1;
    return counts;
  }, {});
}

export function calculatePlacements(completionRounds, teamNames = TEAM_ORDER, eliminatedTeams = {}) {
  const finished = teamNames
    .filter((team) => Number.isInteger(completionRounds[team]))
    .map((team) => ({ team, round: completionRounds[team] }));
  const placements = {};

  for (const entry of finished) {
    placements[entry.team] = finished.filter((other) => other.round < entry.round).length + 1;
  }

  for (const team of teamNames) {
    if (!placements[team] && Number.isInteger(eliminatedTeams[team])) placements[team] = teamNames.length;
  }

  return placements;
}
