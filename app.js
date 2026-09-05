import {
  GAME_MODES,
  MODE_NAMES,
  ROLE_NAMES,
  TEAM_ORDER,
  TEAMS,
  answerTimeWithCarry,
  buildGame,
  calculatePlacements,
  configSignature,
  createGameConfig,
  createGameCode,
  getGamePreset,
  nextActiveTurn,
  normalizeSeed,
  teamsForCount
} from "./game-core.js";

const view = document.body.dataset.view;
const DEFAULT_TIMER_SECONDS = Object.freeze({ prep: 120, clue: 30, guess: 60 });
const FONT_SIZE_KEY = "codenames-four-teams:font-size-v3";
const DEFAULT_FONT_SIZE_PRESET = "large";
const FONT_SIZE_PRESETS = Object.freeze({ small: 13, standard: 14, large: 15, huge: 18 });
const FONT_SIZE_NAMES = Object.freeze({ small: "小", standard: "标准", large: "大", huge: "超大" });
let fontSizePreset = loadFontSizePreset();
const timerPresets = {
  prep: { label: "全体队长思考" },
  clue: { label: "当前队长思考" },
  guess: { label: "当前队伍答题" }
};

function storageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function storageRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Local files can run even when a browser disables persistent storage.
  }
}

function copyText(text) {
  if (window.location.protocol !== "file:" && navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.append(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  return copied ? Promise.resolve() : Promise.reject(new Error("copy failed"));
}

function loadFontSizePreset() {
  try {
    const saved = storageGet(FONT_SIZE_KEY);
    return Object.prototype.hasOwnProperty.call(FONT_SIZE_PRESETS, saved) ? saved : DEFAULT_FONT_SIZE_PRESET;
  } catch {
    return DEFAULT_FONT_SIZE_PRESET;
  }
}

function applyFontSizePreset(preset, persist = true) {
  fontSizePreset = Object.prototype.hasOwnProperty.call(FONT_SIZE_PRESETS, preset) ? preset : DEFAULT_FONT_SIZE_PRESET;
  document.documentElement.style.fontSize = FONT_SIZE_PRESETS[fontSizePreset] + "px";
  document.body.dataset.fontSize = fontSizePreset;
  if (persist) {
    try {
      storageSet(FONT_SIZE_KEY, fontSizePreset);
    } catch {
      // The size still applies for the current session.
    }
  }
  return fontSizePreset;
}

applyFontSizePreset(fontSizePreset, false);

function registerWebTool(tool) {
  const context = document.modelContext;
  if (!context || typeof context.registerTool !== "function") return;
  try {
    Promise.resolve(context.registerTool(tool)).catch(() => {});
  } catch {
    // WebMCP is optional; the visible interface remains fully functional.
  }
}

function assertEmptyInput(input) {
  if (input && Object.keys(input).length > 0) {
    throw new Error("此操作不接受额外参数。");
  }
}

function getSeedFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return normalizeSeed(params.get("game"));
}

function getImageRevisionFromUrl() {
  return getRevisionFromUrl("deck");
}

function getLayoutRevisionFromUrl() {
  return getRevisionFromUrl("layout");
}

function getRevisionFromUrl(name) {
  const rawRevision = new URLSearchParams(window.location.search).get(name);
  if (rawRevision === null || !/^\d+$/.test(rawRevision)) return null;
  return Number(rawRevision);
}

function setRevisionInUrl(url, name, revision) {
  if (Number.isInteger(revision) && revision > 0) {
    url.searchParams.set(name, String(revision));
  } else {
    url.searchParams.delete(name);
  }
}

function gameConfigFromUrl(seed) {
  const params = new URLSearchParams(window.location.search);
  const requestedTeamCount = Number(params.get("teams"));
  const teamCount = [2, 3, 4].includes(requestedTeamCount) ? requestedTeamCount : 4;
  const activeTeams = teamsForCount(teamCount);
  const teamCounts = {};
  for (const team of activeTeams) {
    if (params.has(team)) teamCounts[team] = Number(params.get(team));
  }
  try {
    return createGameConfig({
      teamCount,
      mode: params.get("mode") || "classic",
      gridSize: params.get("size"),
      teamCounts,
      whiteCount: params.get("white"),
      blackCount: params.get("black"),
      firstTeam: params.get("first") || activeTeams[0]
    }, seed);
  } catch {
    return createGameConfig({ teamCount, mode: "classic", firstTeam: params.get("first") || activeTeams[0] }, seed);
  }
}

function writeGameConfigToUrl(url, config) {
  url.searchParams.set("teams", String(config.teamCount));
  url.searchParams.set("mode", config.mode);
  url.searchParams.set("size", String(config.gridSize));
  url.searchParams.set("white", String(config.whiteCount));
  url.searchParams.set("black", String(config.blackCount));
  url.searchParams.set("first", config.firstTeam);
  for (const team of TEAM_ORDER) {
    if (config.activeTeams.includes(team)) url.searchParams.set(team, String(config.teamCounts[team]));
    else url.searchParams.delete(team);
  }
}

function gameModeSummary(config) {
  return config.teamCount + " 队 · " + MODE_NAMES[config.mode] + " · " + config.gridSize + "×" + config.gridSize;
}

function setGameInUrl(seed, imageRevision = 0, layoutRevision = 0, config) {
  const url = new URL(window.location.href);
  url.searchParams.set("game", seed);
  setRevisionInUrl(url, "deck", imageRevision);
  setRevisionInUrl(url, "layout", layoutRevision);
  writeGameConfigToUrl(url, config);
  window.history.replaceState({}, "", url);
}

function playUrl(seed, imageRevision = 0, layoutRevision = 0, config = createGameConfig({}, seed)) {
  const url = new URL("./play.html", window.location.href);
  url.searchParams.set("game", seed);
  setRevisionInUrl(url, "deck", imageRevision);
  setRevisionInUrl(url, "layout", layoutRevision);
  writeGameConfigToUrl(url, config);
  return url;
}

function masterUrl(seed, imageRevision = 0, layoutRevision = 0, config = createGameConfig({}, seed)) {
  const url = new URL("./master.html", window.location.href);
  url.searchParams.set("game", seed);
  setRevisionInUrl(url, "deck", imageRevision);
  setRevisionInUrl(url, "layout", layoutRevision);
  writeGameConfigToUrl(url, config);
  return url;
}

function imageSource(imageId) {
  return "./images/cards/card-" + imageId + ".jpg";
}

function fallbackImageSource(imageId) {
  if (window.location.protocol === "file:") return imageSource(imageId);
  return "https://samdemaeyer.github.io/codenames-pictures/images/cards/card-" + imageId + ".jpg";
}

function loadCardImage(card, container) {
  const image = document.createElement("img");
  image.alt = "图片 " + card.coordinate;
  image.loading = "eager";
  image.src = imageSource(card.imageId);
  image.addEventListener("error", () => {
    if (image.dataset.fallbackUsed) {
      container.classList.add("image-missing");
      return;
    }
    image.dataset.fallbackUsed = "true";
    image.src = fallbackImageSource(card.imageId);
  });
  return image;
}

function masterPictureCard(card) {
  const cardElement = document.createElement("article");
  cardElement.className = "picture-card answer-card is-revealed";
  cardElement.dataset.role = card.role;
  cardElement.setAttribute("aria-label", "图片 " + card.coordinate + "：" + ROLE_NAMES[card.role]);

  const coordinate = document.createElement("span");
  coordinate.className = "picture-coordinate";
  coordinate.textContent = card.coordinate;

  const roleLabel = document.createElement("strong");
  roleLabel.className = "answer-role";
  roleLabel.textContent = ROLE_NAMES[card.role];

  cardElement.append(loadCardImage(card, cardElement), coordinate, roleLabel);
  return cardElement;
}

function setupStart() {
  const form = document.querySelector("#game-setup");
  const startButton = document.querySelector("#start-game");
  const firstTeamSelect = document.querySelector("#custom-first-team");
  const teamCountsContainer = document.querySelector("#custom-team-counts");
  const gridSizeInput = document.querySelector("#custom-grid-size");
  const whiteCountInput = document.querySelector("#custom-white-count");
  const blackCountInput = document.querySelector("#custom-black-count");
  const allocationStatus = document.querySelector("#allocation-status");
  let isCustom = false;

  function selectedTeamCount() {
    return Number(form.elements["team-count"].value);
  }

  function selectedMode() {
    return form.elements["game-mode"].value;
  }

  function presetSummary(teamCount, mode) {
    const preset = getGamePreset(teamCount, mode);
    const colors = teamCount === 2
      ? "先手 " + preset.firstCount + " / 后手 " + preset.secondCount
      : "每队 " + preset.perTeamCount;
    return preset.gridSize + "×" + preset.gridSize + " · " + colors + " · 白 " + preset.whiteCount + " · 黑 " + preset.blackCount;
  }

  function updateModeSummaries() {
    const teamCount = selectedTeamCount();
    for (const mode of GAME_MODES) {
      document.querySelector('[data-mode-summary="' + mode + '"]').textContent = presetSummary(teamCount, mode);
    }
  }

  function rebuildFirstTeamOptions() {
    const activeTeams = teamsForCount(selectedTeamCount());
    const previous = firstTeamSelect.value;
    firstTeamSelect.replaceChildren();
    for (const team of activeTeams) firstTeamSelect.add(new Option(TEAMS[team].name, team));
    firstTeamSelect.value = activeTeams.includes(previous) ? previous : activeTeams[0];
  }

  function countInput(label, value, key) {
    const field = document.createElement("label");
    field.className = "team-count-setting";
    field.innerHTML = '<span>' + label + '</span><input type="number" min="1" max="64" step="1" value="' + value + '" required data-count-key="' + key + '" />';
    return field;
  }

  function rebuildTeamCountInputs(preset) {
    const teamCount = selectedTeamCount();
    if (teamCount === 2) {
      teamCountsContainer.replaceChildren(
        countInput("先手颜色牌", preset.firstCount, "first"),
        countInput("后手颜色牌", preset.secondCount, "second")
      );
      return;
    }
    teamCountsContainer.replaceChildren(...teamsForCount(teamCount).map((team) => (
      countInput(TEAMS[team].name + "颜色牌", preset.perTeamCount, team)
    )));
  }

  function validateAllocation() {
    const gridSize = Number(gridSizeInput.value);
    const target = gridSize * gridSize;
    const colorTotal = [...teamCountsContainer.querySelectorAll("input")]
      .reduce((sum, input) => sum + (Number(input.value) || 0), 0);
    const assigned = colorTotal + (Number(whiteCountInput.value) || 0) + (Number(blackCountInput.value) || 0);
    const valid = Number.isInteger(gridSize) && gridSize >= 3 && gridSize <= 8
      && [...teamCountsContainer.querySelectorAll("input")].every((input) => Number(input.value) >= 1)
      && Number(whiteCountInput.value) >= 0
      && Number(blackCountInput.value) >= 0
      && assigned === target;
    allocationStatus.classList.toggle("is-valid", valid);
    allocationStatus.textContent = valid
      ? "✓ 已分配 " + assigned + " / " + target + " 张"
      : "当前分配 " + assigned + " 张，需要刚好填满 " + target + " 个方格";
    startButton.disabled = !valid;
    return valid;
  }

  function applySelectedPreset() {
    const preset = getGamePreset(selectedTeamCount(), selectedMode());
    gridSizeInput.value = String(preset.gridSize);
    whiteCountInput.value = String(preset.whiteCount);
    blackCountInput.value = String(preset.blackCount);
    rebuildTeamCountInputs(preset);
    isCustom = false;
    validateAllocation();
  }

  function readConfigForSeed(seed) {
    const teamCount = selectedTeamCount();
    const countValues = Object.fromEntries([...teamCountsContainer.querySelectorAll("input")]
      .map((input) => [input.dataset.countKey, Number(input.value)]));
    return createGameConfig({
      teamCount,
      mode: isCustom ? "custom" : selectedMode(),
      gridSize: Number(gridSizeInput.value),
      firstTeam: firstTeamSelect.value,
      firstCount: countValues.first,
      secondCount: countValues.second,
      teamCounts: Object.fromEntries(teamsForCount(teamCount).map((team) => [team, countValues[team]])),
      whiteCount: Number(whiteCountInput.value),
      blackCount: Number(blackCountInput.value)
    }, seed);
  }

  function startNewGame() {
    if (!validateAllocation()) throw new Error("颜色牌数量还没有填满方格。");
    const seed = createGameCode();
    const config = readConfigForSeed(seed);
    window.location.href = playUrl(seed, 0, 0, config).href;
    return { gameCode: seed, config };
  }

  form.elements["team-count"].forEach((input) => input.addEventListener("change", () => {
    updateModeSummaries();
    rebuildFirstTeamOptions();
    applySelectedPreset();
  }));
  form.elements["game-mode"].forEach((input) => input.addEventListener("change", applySelectedPreset));
  document.querySelector("#detailed-settings").addEventListener("input", (event) => {
    if (event.target !== firstTeamSelect) isCustom = true;
    validateAllocation();
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    startNewGame();
  });

  updateModeSummaries();
  rebuildFirstTeamOptions();
  applySelectedPreset();

  registerWebTool({
    name: "start_new_codenames_game",
    title: "开始新游戏",
    description: "按开始页当前选择生成局号，并进入 2 至 4 队的主持人题板。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute(input) {
      assertEmptyInput(input);
      return startNewGame();
    }
  });
}

function setupMaster() {
  let seed = getSeedFromUrl() || createGameCode();
  const imageRevision = getImageRevisionFromUrl() ?? 0;
  const layoutRevision = getLayoutRevisionFromUrl() ?? 0;
  const requestedConfig = gameConfigFromUrl(seed);
  const game = buildGame(seed, imageRevision, layoutRevision, requestedConfig);
  const config = game.config;

  const board = document.querySelector("#master-board");
  const codeLabel = document.querySelector("#master-code-label");
  const playLink = document.querySelector("#open-play");
  const summary = document.querySelector("#master-game-summary");
  const legend = document.querySelector("#master-legend");

  setGameInUrl(seed, imageRevision, layoutRevision, config);
  codeLabel.textContent = seed;
  playLink.href = playUrl(seed, imageRevision, layoutRevision, config).href;
  summary.textContent = gameModeSummary(config) + " · " + TEAMS[config.firstTeam].name + "先手";
  board.style.setProperty("--grid-size", String(config.gridSize));
  board.dataset.gridSize = String(config.gridSize);
  board.setAttribute("aria-label", config.gridSize + "乘" + config.gridSize + "队长答案卡");
  board.replaceChildren(...game.cards.map(masterPictureCard));
  const legendRoles = [
    ...config.turnOrder.map((team) => [team, TEAMS[team].name, config.teamCounts[team]]),
    ["black", "黑色", config.blackCount],
    ["white", "白色", config.whiteCount]
  ];
  legend.replaceChildren(...legendRoles.filter(([, , count]) => count > 0).map(([role, name, count]) => {
    const item = document.createElement("span");
    item.innerHTML = '<i class="dot ' + role + '"></i>' + name + " " + count;
    if (role === config.firstTeam) item.append(" · 先手");
    return item;
  }));
}

function setupPlay() {
  const timerSettingsKey = "codenames-four-teams:timer-settings-v1";
  let timerSettings = loadTimerSettings();
  let seed = getSeedFromUrl() || createGameCode();
  let imageRevision = getImageRevisionFromUrl() ?? 0;
  let layoutRevision = getLayoutRevisionFromUrl() ?? 0;
  const requestedConfig = gameConfigFromUrl(seed);
  let game = buildGame(seed, imageRevision, layoutRevision, requestedConfig);
  let config = game.config;
  let revealed = new Set();
  let currentTeam = null;
  let round = 0;
  let eliminatedTeams = {};
  let completionRounds = {};
  let winnerTeam = null;
  let timerPhase = "prep";
  let timerRemaining = timerSettings.prep;
  let timerRunning = false;
  let timerHandle = null;
  let resumeTimerAfterSettings = false;

  const board = document.querySelector("#game-board");
  const turnConsole = document.querySelector("#turn-console");
  const teamSwitcher = document.querySelector("#team-switcher");
  const message = document.querySelector("#game-message");
  const currentTeamName = document.querySelector("#current-team-name");
  const roundLabel = document.querySelector("#round-label");
  const phaseInstruction = document.querySelector("#phase-instruction");
  const timer = document.querySelector(".timer");
  const timerPhaseLabel = document.querySelector("#timer-phase");
  const timerDisplay = document.querySelector("#timer-display");
  const timerToggle = document.querySelector("#timer-toggle");
  const timerSkip = document.querySelector("#timer-skip");
  const startAnsweringButton = document.querySelector("#start-answering");
  const nextTeamButton = document.querySelector("#next-team");
  const fullscreenButton = document.querySelector("#fullscreen");
  const gameCodeLabel = document.querySelector("#game-code-label");
  const gameModeLabel = document.querySelector("#game-mode-label");
  const copyMasterButton = document.querySelector("#copy-master-link");
  const openMasterWindow = document.querySelector("#open-master-window");
  const copyMasterFeedback = document.querySelector("#copy-master-feedback");
  const timerSettingsButton = document.querySelector("#timer-settings");
  const timerSettingsModal = document.querySelector("#timer-settings-modal");
  const timerSettingsForm = document.querySelector("#timer-settings-form");
  const prepMinutesInput = document.querySelector("#settings-prep-minutes");
  const clueSecondsInput = document.querySelector("#settings-clue-seconds");
  const guessSecondsInput = document.querySelector("#settings-guess-seconds");
  const fontSizeInput = document.querySelector("#settings-font-size");
  const priorityTeamInput = document.querySelector("#settings-priority-team");
  const eliminationNotice = document.querySelector("#elimination-notice");
  const eliminationCopy = document.querySelector("#elimination-copy");
  const dismissElimination = document.querySelector("#dismiss-elimination");
  const viewResultsButton = document.querySelector("#view-results");
  const finalResults = document.querySelector("#final-results");
  const finalResultsTitle = document.querySelector("#final-results-title");
  const finalResultsCopy = document.querySelector("#final-results-copy");
  const rankingList = document.querySelector("#ranking-list");
  const dismissResults = document.querySelector("#dismiss-results");
  const celebrationCanvas = document.querySelector("#celebration-canvas");
  let celebrationFrame = null;

  function stateKey() {
    return "codenames-pictures:" + seed + ":" + configSignature(config) + ":layout:" + layoutRevision;
  }

  function loadTimerSettings() {
    try {
      const stored = JSON.parse(storageGet(timerSettingsKey) || "null");
      if (!stored) return { ...DEFAULT_TIMER_SECONDS };
      return {
        prep: validTimerSeconds(stored.prep, DEFAULT_TIMER_SECONDS.prep, 15),
        clue: validTimerSeconds(stored.clue, DEFAULT_TIMER_SECONDS.clue),
        guess: validTimerSeconds(stored.guess, DEFAULT_TIMER_SECONDS.guess)
      };
    } catch {
      storageRemove(timerSettingsKey);
      return { ...DEFAULT_TIMER_SECONDS };
    }
  }

  function validTimerSeconds(value, fallback, minimum = 5) {
    return Number.isInteger(value) && value >= minimum && value <= 3600 ? value : fallback;
  }

  function saveState() {
    storageSet(stateKey(), JSON.stringify({
      version: 4,
      revealed: [...revealed],
      currentTeam,
      round,
      eliminatedTeams,
      completionRounds,
      winnerTeam,
      imageRevision,
      layoutRevision
    }));
  }

  function restoreTeamRounds(value) {
    const restored = {};
    for (const team of config.activeTeams) {
      if (Number.isInteger(value?.[team]) && value[team] >= 1) restored[team] = value[team];
    }
    return restored;
  }

  function loadState() {
    revealed = new Set();
    currentTeam = null;
    round = 0;
    eliminatedTeams = {};
    completionRounds = {};
    winnerTeam = null;
    imageRevision = 0;
    try {
      const stored = JSON.parse(storageGet(stateKey()) || "null");
      if (!stored || stored.version !== 4) return false;
      if (Array.isArray(stored.revealed)) {
        revealed = new Set(stored.revealed.filter((index) => Number.isInteger(index) && index >= 0 && index < config.cardCount));
      }
      completionRounds = restoreTeamRounds(stored.completionRounds);
      eliminatedTeams = restoreTeamRounds(stored.eliminatedTeams);
      if (config.activeTeams.includes(stored.currentTeam)) currentTeam = stored.currentTeam;
      if (config.teamCount === 2 && config.activeTeams.includes(stored.winnerTeam)) winnerTeam = stored.winnerTeam;
      if (Number.isInteger(stored.round) && stored.round >= 0) round = stored.round;
      if (Number.isInteger(stored.imageRevision) && stored.imageRevision >= 0) imageRevision = stored.imageRevision;
      return true;
    } catch {
      storageRemove(stateKey());
      return false;
    }
  }

  function isActive(team) {
    return config.activeTeams.includes(team) && !eliminatedTeams[team] && !completionRounds[team];
  }

  function activeTeams() {
    return config.turnOrder.filter(isActive);
  }

  function gameIsFinished() {
    return Boolean(winnerTeam) || activeTeams().length === 0;
  }

  function canReveal() {
    return Boolean(currentTeam) && isActive(currentTeam) && timerPhase === "guess" && timerRemaining > 0;
  }

  function remainingFor(team) {
    return game.cards.filter((card) => card.role === team && !revealed.has(card.index)).length;
  }

  function createCard(card) {
    const button = document.createElement("button");
    const isRevealed = revealed.has(card.index);
    button.type = "button";
    button.className = "picture-card";
    button.dataset.index = String(card.index);
    button.dataset.role = card.role;
    button.setAttribute("aria-label", "图片 " + card.coordinate + (isRevealed ? "，已翻开：" + ROLE_NAMES[card.role] : "，未翻开"));

    const image = loadCardImage(card, button);

    const coordinate = document.createElement("span");
    coordinate.className = "picture-coordinate";
    coordinate.textContent = card.coordinate;

    const cover = document.createElement("span");
    cover.className = "card-cover role-" + card.role;
    cover.innerHTML = "<strong>" + ROLE_NAMES[card.role] + "</strong><small>" + card.coordinate + "</small>";

    button.append(image, coordinate, cover);
    button.classList.toggle("is-revealed", isRevealed);
    button.disabled = isRevealed || !canReveal();
    button.addEventListener("click", () => revealCard(card));
    return button;
  }

  function renderBoard() {
    board.replaceChildren(...game.cards.map(createCard));
  }

  function updateBoardAvailability() {
    for (const button of board.querySelectorAll(".picture-card")) {
      button.disabled = revealed.has(Number(button.dataset.index)) || !canReveal();
    }
  }

  function ordinal(place) {
    return ({ 1: "1st", 2: "2nd", 3: "3rd", 4: "4th" })[place] || String(place);
  }

  function renderTeams() {
    const placements = calculatePlacements(completionRounds, config.activeTeams);
    teamSwitcher.replaceChildren(...config.turnOrder.map((team) => {
      const button = document.createElement("button");
      const remaining = remainingFor(team);
      const isEliminated = Boolean(eliminatedTeams[team]);
      const isComplete = Boolean(completionRounds[team]);
      let status = "剩余 " + remaining + " 张";
      let badge = String(remaining);
      if (winnerTeam) {
        status = team === winnerTeam ? "本局获胜" : (isEliminated ? "触发黑色" : "本局落败");
        badge = team === winnerTeam ? "胜利" : "失败";
      } else if (isEliminated) {
        status = "第 " + eliminatedTeams[team] + " 轮出局";
        badge = "出局";
      } else if (isComplete) {
        status = "第 " + completionRounds[team] + " 轮完成";
        badge = ordinal(placements[team]);
      }

      button.type = "button";
      button.className = "team-chip team-" + team;
      if (isEliminated) button.classList.add("is-eliminated");
      if (isComplete) button.classList.add("is-complete");
      button.dataset.team = team;
      button.setAttribute("aria-pressed", String(team === currentTeam));
      button.setAttribute("aria-label", TEAMS[team].name + "，" + status);
      button.disabled = currentTeam === null || !isActive(team);
      button.innerHTML =
        '<span class="team-symbol">' + TEAMS[team].short + '</span>' +
        '<span class="team-copy"><strong>' + TEAMS[team].name + "</strong><small>" + status + "</small></span>" +
        '<span class="team-badge">' + badge + "</span>";
      button.addEventListener("click", () => selectTeam(team));
      return button;
    }));
  }

  function renderStatus() {
    const finished = gameIsFinished();
    const preparing = currentTeam === null && round === 0 && !finished;
    turnConsole.dataset.team = currentTeam || (preparing ? "prep" : "finished");
    currentTeamName.textContent = preparing
      ? "全体队长准备"
      : finished
        ? (winnerTeam ? TEAMS[winnerTeam].name + "胜利" : "本局已结束")
        : TEAMS[currentTeam].name;
    roundLabel.textContent = preparing ? "准备阶段" : finished ? "最终结果" : "第 " + round + " 轮";

    if (preparing) {
      phaseInstruction.textContent = config.teamCount + " 位队长一起查看答案；队友只看左侧图片。";
    } else if (finished) {
      phaseInstruction.textContent = winnerTeam
        ? TEAMS[winnerTeam].name + "率先找齐全部图片，本局获胜。"
        : "所有队伍均已完成或出局，名次已记录。";
    } else if (timerPhase === "clue") {
      phaseInstruction.textContent = TEAMS[currentTeam].name + "队长用“一个词 + 一个数字”给提示；说完即可开始答题。";
    } else if (timerRemaining === 0) {
      phaseInstruction.textContent = TEAMS[currentTeam].name + "答题时间到，请切换下一队。";
    } else {
      phaseInstruction.textContent = TEAMS[currentTeam].name + "正在答题；猜中本队颜色可以继续。";
    }

    startAnsweringButton.disabled = finished || !currentTeam || !isActive(currentTeam) || timerPhase !== "clue";
    startAnsweringButton.hidden = finished;
    startAnsweringButton.querySelector("span").textContent = "+ " + formatTime(timerSettings.guess);
    nextTeamButton.disabled = finished || !currentTeam || !isActive(currentTeam);
    nextTeamButton.hidden = finished;
    viewResultsButton.hidden = !finished;
    gameCodeLabel.textContent = seed;
    gameModeLabel.textContent = gameModeSummary(config) + " · " + TEAMS[config.firstTeam].short + "先";
    openMasterWindow.hidden = window.location.protocol !== "file:";
    openMasterWindow.href = masterUrl(seed, imageRevision, layoutRevision, config).href;
    renderTeams();
    updateBoardAvailability();
  }

  function formatTime(seconds) {
    const mins = Math.floor(seconds / 60).toString().padStart(2, "0");
    const secs = (seconds % 60).toString().padStart(2, "0");
    return mins + ":" + secs;
  }

  function renderTimer() {
    timerPhaseLabel.textContent = timerPresets[timerPhase].label;
    timerDisplay.textContent = formatTime(timerRemaining);
    if (timerRunning) {
      timerToggle.textContent = "暂停";
    } else if (timerPhase === "prep" && timerRemaining === timerSettings.prep) {
      timerToggle.textContent = "开始准备";
    } else {
      timerToggle.textContent = "继续";
    }
    timerToggle.disabled = gameIsFinished() || (timerPhase === "guess" && timerRemaining === 0);
    timerSkip.textContent = timerPhase === "prep" ? "跳过准备" : timerPhase === "clue" ? "跳过思考" : "跳过答题";
    timerSkip.disabled = gameIsFinished();
    timer.classList.toggle("is-urgent", timerRemaining <= 10);
  }

  function stopTimer(shouldRender = true) {
    timerRunning = false;
    if (timerHandle) window.clearInterval(timerHandle);
    timerHandle = null;
    if (shouldRender) renderTimer();
  }

  function configureTimer(phase, seconds = timerSettings[phase], autoStart = false) {
    stopTimer(false);
    timerPhase = phase;
    timerRemaining = Math.max(0, seconds);
    renderTimer();
    renderStatus();
    if (autoStart) startTimer();
  }

  function startFirstTurn() {
    const firstTeam = config.turnOrder.find(isActive);
    if (!firstTeam) {
      currentTeam = null;
      renderStatus();
      return;
    }
    currentTeam = firstTeam;
    round = Math.max(1, round);
    configureTimer("clue", timerSettings.clue, true);
    message.textContent = "准备时间结束。现在轮到" + TEAMS[currentTeam].name + "，队长有 " + formatTime(timerSettings.clue) + " 思考。";
    saveState();
  }

  function startAnswering() {
    if (!currentTeam || !isActive(currentTeam) || timerPhase !== "clue") {
      throw new Error("只有在当前队长思考阶段才能开始答题。");
    }
    const carriedSeconds = timerRemaining;
    configureTimer("guess", answerTimeWithCarry(carriedSeconds, timerSettings.guess), true);
    message.textContent = TEAMS[currentTeam].name + "开始答题：保留 " + carriedSeconds + " 秒，并增加 " + formatTime(timerSettings.guess) + "。";
  }

  function startTimer() {
    if (timerRunning || gameIsFinished()) return;
    if (timerPhase === "guess" && timerRemaining === 0) return;
    timerRunning = true;
    timerHandle = window.setInterval(() => {
      timerRemaining -= 1;
      if (timerRemaining <= 0) {
        timerRemaining = 0;
        stopTimer(false);
        if (timerPhase === "prep") {
          startFirstTurn();
          return;
        }
        if (timerPhase === "clue") {
          startAnswering();
          return;
        }
        message.textContent = TEAMS[currentTeam].name + "答题时间到，请主持人点击“下一个队伍”。";
        renderTimer();
        renderStatus();
        updateBoardAvailability();
        return;
      }
      renderTimer();
    }, 1000);
    renderTimer();
  }

  function skipTimerPhase() {
    if (gameIsFinished()) return;
    stopTimer(false);
    timerRemaining = 0;
    renderTimer();
    if (timerPhase === "prep") {
      startFirstTurn();
      return;
    }
    if (timerPhase === "clue") {
      startAnswering();
      return;
    }
    advanceTeam("主持人跳过了答题倒计时。", true);
  }

  function findNextActive(fromTeam) {
    return nextActiveTurn(fromTeam, activeTeams(), round, config.turnOrder);
  }

  function renderFinalRanking() {
    const placements = calculatePlacements(completionRounds, config.activeTeams);
    const orderedTeams = [...config.activeTeams].sort((first, second) => {
      if (winnerTeam) return (first === winnerTeam ? -1 : 1) - (second === winnerTeam ? -1 : 1);
      const firstPlace = placements[first] ?? 99;
      const secondPlace = placements[second] ?? 99;
      return firstPlace - secondPlace || config.turnOrder.indexOf(first) - config.turnOrder.indexOf(second);
    });

    finalResultsTitle.textContent = winnerTeam ? TEAMS[winnerTeam].name + "胜利！" : "本局排名";
    finalResultsCopy.textContent = winnerTeam
      ? "两队对抗已决出胜负，所有答案已经显示在题板上。"
      : "所有答案已经显示在题板上。";

    rankingList.replaceChildren(...orderedTeams.map((team) => {
      const row = document.createElement("div");
      const placement = placements[team];
      const eliminatedRound = eliminatedTeams[team];
      row.className = "ranking-row team-" + team + (eliminatedRound ? " is-eliminated" : "");

      const badge = document.createElement("strong");
      badge.className = "ranking-place";
      badge.textContent = winnerTeam ? (team === winnerTeam ? "胜利" : "失败") : (placement ? ordinal(placement) : "出局");

      const copy = document.createElement("span");
      const name = document.createElement("b");
      name.textContent = TEAMS[team].name;
      const detail = document.createElement("small");
      detail.textContent = winnerTeam
        ? (team === winnerTeam
          ? (completionRounds[team] ? "第 " + completionRounds[team] + " 轮率先完成" : "对手触发黑色")
          : (eliminatedRound ? "第 " + eliminatedRound + " 轮触发黑色" : "对手率先完成"))
        : (placement ? "第 " + completionRounds[team] + " 轮完成" : "第 " + eliminatedRound + " 轮触发黑色");
      copy.append(name, detail);
      row.append(badge, copy);
      return row;
    }));
  }

  function stopCelebration() {
    if (celebrationFrame) window.cancelAnimationFrame(celebrationFrame);
    celebrationFrame = null;
    const context = celebrationCanvas.getContext("2d");
    context?.clearRect(0, 0, celebrationCanvas.width, celebrationCanvas.height);
  }

  function startCelebration() {
    stopCelebration();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
    const width = window.innerWidth;
    const height = window.innerHeight;
    celebrationCanvas.width = Math.round(width * pixelRatio);
    celebrationCanvas.height = Math.round(height * pixelRatio);
    celebrationCanvas.style.width = width + "px";
    celebrationCanvas.style.height = height + "px";
    const context = celebrationCanvas.getContext("2d");
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

    const colors = ["#ef4444", "#f7c948", "#3b82f6", "#22c55e", "#ffffff"];
    const particles = Array.from({ length: 150 }, (_, index) => ({
      x: Math.random() * width,
      y: -20 - Math.random() * height * 0.55,
      width: 6 + Math.random() * 9,
      height: 4 + Math.random() * 6,
      speed: 2.6 + Math.random() * 4.8,
      drift: -1.2 + Math.random() * 2.4,
      rotation: Math.random() * Math.PI,
      spin: -0.12 + Math.random() * 0.24,
      color: colors[index % colors.length]
    }));
    const startedAt = performance.now();

    function draw(now) {
      context.clearRect(0, 0, width, height);
      for (const particle of particles) {
        particle.y += particle.speed;
        particle.x += particle.drift;
        particle.rotation += particle.spin;
        if (particle.y > height + 20) particle.y = -30;
        context.save();
        context.translate(particle.x, particle.y);
        context.rotate(particle.rotation);
        context.fillStyle = particle.color;
        context.fillRect(-particle.width / 2, -particle.height / 2, particle.width, particle.height);
        context.restore();
      }
      if (now - startedAt < 5200) celebrationFrame = window.requestAnimationFrame(draw);
      else stopCelebration();
    }

    celebrationFrame = window.requestAnimationFrame(draw);
  }

  function showFinalResults() {
    renderFinalRanking();
    finalResults.hidden = false;
    window.requestAnimationFrame(startCelebration);
    dismissResults.focus();
  }

  function hideFinalResults() {
    finalResults.hidden = true;
    stopCelebration();
    viewResultsButton.focus();
  }

  function finishGame(reason, winner = null) {
    if (winner && config.activeTeams.includes(winner)) winnerTeam = winner;
    currentTeam = null;
    stopTimer(false);
    timerPhase = "guess";
    timerRemaining = 0;
    revealed = new Set(game.cards.map((card) => card.index));
    message.textContent = winnerTeam
      ? reason + " " + TEAMS[winnerTeam].name + "赢得本局。"
      : reason + " 所有队伍均已完成或出局，本局结束。";
    saveState();
    renderTimer();
    renderBoard();
    renderStatus();
    showFinalResults();
  }

  function advanceTeam(reason, autoStart = true) {
    if (!currentTeam) {
      startFirstTurn();
      return;
    }
    const next = findNextActive(currentTeam);
    if (!next) {
      finishGame(reason);
      return;
    }
    round = next.round;
    currentTeam = next.team;
    configureTimer("clue", timerSettings.clue, autoStart);
    message.textContent = reason + " 现在轮到" + TEAMS[currentTeam].name + "，队长有 " + formatTime(timerSettings.clue) + " 思考。";
    saveState();
  }

  function selectTeam(team) {
    if (!isActive(team)) return;
    currentTeam = team;
    round = Math.max(1, round);
    configureTimer("clue", timerSettings.clue, true);
    message.textContent = "主持人已将回合切换到" + TEAMS[team].name + "。";
    saveState();
  }

  function recordCompletion(team) {
    if (!config.activeTeams.includes(team) || completionRounds[team] || remainingFor(team) !== 0) return false;
    completionRounds[team] = Math.max(1, round);
    return true;
  }

  function completionMessage(team) {
    const placement = calculatePlacements(completionRounds, config.activeTeams)[team];
    return TEAMS[team].name + "已在第 " + completionRounds[team] + " 轮找齐 " + config.teamCounts[team] + " 张，当前排名 " + ordinal(placement) + "。";
  }

  function revealCard(card) {
    if (revealed.has(card.index)) throw new Error("这张图片已经翻开。");
    if (!canReveal()) throw new Error("请先进入当前队伍的答题阶段。");

    const guessingTeam = currentTeam;
    revealed.add(card.index);
    const targetCompleted = config.activeTeams.includes(card.role) && recordCompletion(card.role);

    if (card.role === "black") {
      eliminatedTeams[guessingTeam] = Math.max(1, round);
      stopTimer(false);
      if (config.teamCount === 2) {
        const opponent = config.activeTeams.find((team) => team !== guessingTeam);
        finishGame(TEAMS[guessingTeam].name + "翻到黑色并出局。", opponent);
        return;
      }
      advanceTeam(TEAMS[guessingTeam].name + "翻到黑色并出局。", false);
      if (!gameIsFinished()) {
        message.textContent = TEAMS[guessingTeam].name + "翻到黑色并出局。下一队是" + TEAMS[currentTeam].name + "；关闭提示后开始 " + formatTime(timerSettings.clue) + " 队长思考。";
        eliminationCopy.textContent = TEAMS[guessingTeam].name + "已被淘汰，之后的回合会自动跳过该队。";
        dismissElimination.textContent = "开始下一队";
        eliminationNotice.hidden = false;
      }
    } else if (card.role === guessingTeam) {
      if (targetCompleted) {
        if (config.teamCount === 2) {
          finishGame(TEAMS[guessingTeam].name + "率先找齐全部图片。", guessingTeam);
          return;
        }
        const completedCopy = completionMessage(guessingTeam);
        advanceTeam(completedCopy, true);
      } else {
        message.textContent = "答对！" + TEAMS[guessingTeam].name + "可以继续选择。";
      }
    } else if (config.activeTeams.includes(card.role)) {
      if (targetCompleted && config.teamCount === 2) {
        finishGame("这次选择帮助" + TEAMS[card.role].name + "找齐了全部图片。", card.role);
        return;
      }
      const helpCopy = targetCompleted
        ? "还帮助" + TEAMS[card.role].name + "完成了全部图片。"
        : "已替对方翻面。";
      advanceTeam("翻到了" + TEAMS[card.role].name + "的图片，" + helpCopy, true);
    } else {
      advanceTeam("翻到白色，本回合结束。", true);
    }

    saveState();
    renderBoard();
    renderStatus();
  }

  function refreshImages() {
    imageRevision += 1;
    game = buildGame(seed, imageRevision, layoutRevision, config);
    setGameInUrl(seed, imageRevision, layoutRevision, config);
    saveState();
    renderBoard();
    renderStatus();
    message.textContent = "表面图片已刷新；" + config.cardCount + " 个位置下方的答案颜色完全不变。";
  }

  function refreshLayout() {
    layoutRevision += 1;
    game = buildGame(seed, imageRevision, layoutRevision, config);
    revealed = new Set();
    currentTeam = null;
    round = 0;
    eliminatedTeams = {};
    completionRounds = {};
    winnerTeam = null;
    eliminationNotice.hidden = true;
    finalResults.hidden = true;
    stopCelebration();
    setGameInUrl(seed, imageRevision, layoutRevision, config);
    configureTimer("prep", timerSettings.prep, false);
    saveState();
    renderBoard();
    renderStatus();
    message.textContent = "隐藏颜色已重新分布，图片保持不变；请把新的队长答案链接发给队长。";
  }

  async function copyMasterLink() {
    const url = masterUrl(seed, imageRevision, layoutRevision, config).href;
    try {
      await copyText(url);
      copyMasterFeedback.textContent = "队长答案链接已复制";
      copyMasterButton.textContent = "已复制";
      window.setTimeout(() => {
        copyMasterButton.textContent = "复制队长答案链接";
        copyMasterFeedback.textContent = "";
      }, 1800);
    } catch {
      copyMasterFeedback.textContent = "复制失败，请打开队长答案页后复制浏览器地址";
    }
    return url;
  }

  function resetGame() {
    revealed = new Set();
    currentTeam = null;
    round = 0;
    eliminatedTeams = {};
    completionRounds = {};
    winnerTeam = null;
    eliminationNotice.hidden = true;
    finalResults.hidden = true;
    stopCelebration();
    configureTimer("prep", timerSettings.prep, false);
    message.textContent = "本局进度已重置。请开始 " + formatTime(timerSettings.prep) + " 的全体队长准备时间。";
    saveState();
    renderBoard();
    renderStatus();
  }

  function fillTimerSettingsForm(settings = timerSettings) {
    prepMinutesInput.value = String(settings.prep / 60);
    clueSecondsInput.value = String(settings.clue);
    guessSecondsInput.value = String(settings.guess);
    fontSizeInput.value = fontSizePreset;
    priorityTeamInput.replaceChildren(...config.activeTeams.map((team) => new Option(TEAMS[team].name, team)));
    priorityTeamInput.value = config.firstTeam;
  }

  function applyTeamPriority(nextFirstTeam) {
    if (!config.activeTeams.includes(nextFirstTeam) || nextFirstTeam === config.firstTeam) return false;
    const teamCounts = { ...config.teamCounts };
    if (config.teamCount === 2) {
      const previousFirstTeam = config.firstTeam;
      [teamCounts[previousFirstTeam], teamCounts[nextFirstTeam]] = [teamCounts[nextFirstTeam], teamCounts[previousFirstTeam]];
    }
    config = createGameConfig({
      teamCount: config.teamCount,
      mode: config.mode,
      gridSize: config.gridSize,
      firstTeam: nextFirstTeam,
      teamCounts,
      whiteCount: config.whiteCount,
      blackCount: config.blackCount
    }, seed);
    game = buildGame(seed, imageRevision, layoutRevision, config);
    setGameInUrl(seed, imageRevision, layoutRevision, config);
    return true;
  }

  function normalizeTimerSettings(nextSettings) {
    const normalized = {
      prep: Math.round(Number(nextSettings.prep)),
      clue: Math.round(Number(nextSettings.clue)),
      guess: Math.round(Number(nextSettings.guess))
    };
    for (const phase of Object.keys(normalized)) {
      const minimum = phase === "prep" ? 15 : 5;
      if (!Number.isInteger(normalized[phase]) || normalized[phase] < minimum || normalized[phase] > 3600) {
        throw new Error("开场时间至少 15 秒；其他阶段必须设置为 5 到 3600 秒。");
      }
    }
    return normalized;
  }

  function applyTimerSettings(nextSettings, shouldResume = false) {
    timerSettings = normalizeTimerSettings(nextSettings);
    storageSet(timerSettingsKey, JSON.stringify(timerSettings));
    configureTimer(timerPhase, timerSettings[timerPhase], shouldResume && !gameIsFinished());
    message.textContent = "设置已更新：字号" + FONT_SIZE_NAMES[fontSizePreset] + "，开场 " + formatTime(timerSettings.prep) + "，队长 " + formatTime(timerSettings.clue) + "，答题 " + formatTime(timerSettings.guess) + "。";
  }

  function openTimerSettings() {
    resumeTimerAfterSettings = timerRunning;
    stopTimer();
    fillTimerSettingsForm();
    timerSettingsModal.hidden = false;
    prepMinutesInput.focus();
  }

  function closeTimerSettings() {
    timerSettingsModal.hidden = true;
    if (resumeTimerAfterSettings) startTimer();
    resumeTimerAfterSettings = false;
    timerSettingsButton.focus();
  }

  function load(nextSeed, requestedImageRevision = null, requestedLayoutRevision = null) {
    stopTimer(false);
    finalResults.hidden = true;
    stopCelebration();
    seed = nextSeed;
    layoutRevision = Number.isInteger(requestedLayoutRevision) && requestedLayoutRevision >= 0 ? requestedLayoutRevision : 0;
    const restored = loadState();
    if (Number.isInteger(requestedImageRevision) && requestedImageRevision >= 0) {
      imageRevision = requestedImageRevision;
    }
    game = buildGame(seed, imageRevision, layoutRevision, config);
    board.style.setProperty("--grid-size", String(config.gridSize));
    board.dataset.gridSize = String(config.gridSize);
    board.setAttribute("aria-label", config.gridSize + "乘" + config.gridSize + "图片题板");
    teamSwitcher.setAttribute("aria-label", config.teamCount + "队状态与当前队伍");
    if (currentTeam && !isActive(currentTeam)) currentTeam = null;
    if (!currentTeam && round > 0 && !gameIsFinished()) currentTeam = activeTeams()[0];
    setGameInUrl(seed, imageRevision, layoutRevision, config);
    eliminationNotice.hidden = true;
    if (gameIsFinished()) {
      currentTeam = null;
      timerPhase = "guess";
      timerRemaining = 0;
      revealed = new Set(game.cards.map((card) => card.index));
      message.textContent = "已恢复最终结果；所有答案均已显示。";
      renderTimer();
      renderBoard();
      renderStatus();
      showFinalResults();
      return;
    }
    if (currentTeam) {
      configureTimer("clue", timerSettings.clue, false);
      message.textContent = "已恢复本局进度。当前为" + TEAMS[currentTeam].name + "，请继续队长思考计时。";
    } else {
      configureTimer("prep", timerSettings.prep, false);
      message.textContent = restored && gameIsFinished()
        ? "已恢复最终结果。"
        : "先开始 " + formatTime(timerSettings.prep) + " 的全体队长准备时间。";
    }
    renderBoard();
    renderStatus();
  }

  startAnsweringButton.addEventListener("click", () => startAnswering());
  nextTeamButton.addEventListener("click", () => advanceTeam("主持人结束了当前回合。", true));
  document.querySelector("#refresh-images").addEventListener("click", refreshImages);
  document.querySelector("#refresh-layout").addEventListener("click", refreshLayout);
  copyMasterButton.addEventListener("click", copyMasterLink);
  timerToggle.addEventListener("click", () => timerRunning ? stopTimer() : startTimer());
  timerSkip.addEventListener("click", skipTimerPhase);
  document.querySelector("#timer-reset").addEventListener("click", () => {
    configureTimer(timerPhase, timerSettings[timerPhase], false);
    message.textContent = timerPresets[timerPhase].label + "已重新计时。";
  });
  timerSettingsButton.addEventListener("click", openTimerSettings);
  document.querySelector("#timer-settings-close").addEventListener("click", closeTimerSettings);
  document.querySelector("#timer-settings-defaults").addEventListener("click", () => {
    fillTimerSettingsForm(DEFAULT_TIMER_SECONDS);
    fontSizeInput.value = DEFAULT_FONT_SIZE_PRESET;
  });
  timerSettingsModal.addEventListener("click", (event) => {
    if (event.target === timerSettingsModal) closeTimerSettings();
  });
  timerSettingsModal.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeTimerSettings();
  });
  timerSettingsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const shouldResume = resumeTimerAfterSettings;
    resumeTimerAfterSettings = false;
    const priorityChanged = applyTeamPriority(priorityTeamInput.value);
    applyFontSizePreset(fontSizeInput.value);
    applyTimerSettings({
      prep: Number(prepMinutesInput.value) * 60,
      clue: Number(clueSecondsInput.value),
      guess: Number(guessSecondsInput.value)
    }, shouldResume && !priorityChanged);
    if (priorityChanged) {
      resetGame();
      message.textContent = TEAMS[config.firstTeam].name + "已设为优先队伍；本局已重置，顺序为 " + config.turnOrder.map((team) => TEAMS[team].name).join(" → ") + "。";
    }
    timerSettingsModal.hidden = true;
    timerSettingsButton.focus();
  });
  fullscreenButton.addEventListener("click", async () => {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
  });
  document.addEventListener("fullscreenchange", () => {
    fullscreenButton.textContent = document.fullscreenElement ? "退出全屏" : "全屏";
  });
  document.querySelector("#reset-board").addEventListener("click", () => {
    if (!window.confirm("确定要清除这局的揭牌、出局和排名记录吗？")) return;
    resetGame();
  });
  dismissElimination.addEventListener("click", () => {
    eliminationNotice.hidden = true;
    if (currentTeam && isActive(currentTeam)) startTimer();
  });
  viewResultsButton.addEventListener("click", showFinalResults);
  dismissResults.addEventListener("click", hideFinalResults);
  finalResults.addEventListener("click", (event) => {
    if (event.target === finalResults) hideFinalResults();
  });
  finalResults.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideFinalResults();
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== stateKey()) return;
    load(seed, imageRevision, layoutRevision);
  });
  registerWebTool({
    name: "reveal_codenames_picture",
    title: "翻开图片",
    description: "按题板编号翻开图片，并应用继续、换队、帮助对方或当前队出局的规则。",
    inputSchema: {
      type: "object",
      properties: { number: { type: "integer", minimum: 1, maximum: config.cardCount } },
      required: ["number"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute(input) {
      if (!Number.isInteger(input?.number) || input.number < 1 || input.number > config.cardCount) {
        throw new Error("图片编号必须是 1 到 " + config.cardCount + " 的整数。");
      }
      const card = game.cards[input.number - 1];
      const previousTeam = currentTeam;
      revealCard(card);
      return {
        number: input.number,
        color: card.role,
        previousTeam,
        currentTeam,
        round,
        eliminated: Boolean(eliminatedTeams[previousTeam]),
        completedTeam: config.activeTeams.includes(card.role) && Boolean(completionRounds[card.role]) ? card.role : null
      };
    }
  });

  registerWebTool({
    name: "set_codenames_current_team",
    title: "设置当前队伍",
    description: "由主持人把当前回合切换到仍在比赛中的指定队伍，并启动已设置的队长思考计时。",
    inputSchema: {
      type: "object",
      properties: { team: { type: "string", enum: config.activeTeams } },
      required: ["team"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute(input) {
      if (!config.activeTeams.includes(input?.team)) throw new Error("该队不在本局配置中。");
      if (!isActive(input.team)) throw new Error("该队已经完成或出局，不能再获得回合。");
      selectTeam(input.team);
      return { currentTeam, round, timerPhase, timerRemaining };
    }
  });

  registerWebTool({
    name: "start_codenames_answering",
    title: "开始答题",
    description: "结束当前队长思考阶段，把剩余秒数与已设置的答题时间相加，并立即开始计时。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute(input) {
      assertEmptyInput(input);
      startAnswering();
      return { currentTeam, round, timerPhase, timerRemaining };
    }
  });

  registerWebTool({
    name: "advance_codenames_turn",
    title: "切换下一队伍",
    description: "结束当前回合，跳过已完成或出局的队伍，并为下一队启动已设置的队长思考计时。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute(input) {
      assertEmptyInput(input);
      if (!currentTeam) throw new Error("准备阶段尚未结束，当前没有队伍回合。");
      advanceTeam("主持人结束了当前回合。", true);
      return { currentTeam, round, timerPhase, timerRemaining };
    }
  });

  registerWebTool({
    name: "refresh_codenames_pictures",
    title: "刷新表面图片",
    description: "更换全部表面图片，同时保持每个位置下方的答案颜色不变。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute(input) {
      assertEmptyInput(input);
      const previousRevision = imageRevision;
      refreshImages();
      return { gameCode: seed, previousRevision, imageRevision, hiddenColorsUnchanged: true };
    }
  });

  registerWebTool({
    name: "refresh_codenames_layout",
    title: "刷新颜色分布",
    description: "保持当前图片不变，生成新的隐藏颜色分布并重置本局进度。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute(input) {
      assertEmptyInput(input);
      const previousRevision = layoutRevision;
      refreshLayout();
      return {
        gameCode: seed,
        previousRevision,
        layoutRevision,
        imagesUnchanged: true,
        masterCardUrl: masterUrl(seed, imageRevision, layoutRevision, config).href
      };
    }
  });

  registerWebTool({
    name: "skip_codenames_timer",
    title: "跳过当前倒计时",
    description: "立即结束当前倒计时：准备阶段进入本局先手队，队长思考进入答题，答题阶段进入下一队。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute(input) {
      assertEmptyInput(input);
      const skippedPhase = timerPhase;
      skipTimerPhase();
      return { skippedPhase, currentTeam, round, timerPhase, timerRemaining };
    }
  });

  registerWebTool({
    name: "set_codenames_timer_settings",
    title: "设置游戏",
    description: "设置三个计时阶段、界面字号和优先队伍。更改优先队伍会重置本局。",
    inputSchema: {
      type: "object",
      properties: {
        prepSeconds: { type: "integer", minimum: 15, maximum: 3600 },
        clueSeconds: { type: "integer", minimum: 5, maximum: 3600 },
        guessSeconds: { type: "integer", minimum: 5, maximum: 3600 },
        fontSize: { type: "string", enum: ["small", "standard", "large", "huge"] },
        priorityTeam: { type: "string", enum: config.activeTeams }
      },
      required: ["prepSeconds", "clueSeconds", "guessSeconds"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute(input) {
      const wasRunning = timerRunning;
      const priorityChanged = input?.priorityTeam ? applyTeamPriority(input.priorityTeam) : false;
      if (input?.fontSize) applyFontSizePreset(input.fontSize);
      applyTimerSettings({ prep: input?.prepSeconds, clue: input?.clueSeconds, guess: input?.guessSeconds }, wasRunning && !priorityChanged);
      if (priorityChanged) resetGame();
      return { ...timerSettings, fontSize: fontSizePreset, priorityTeam: config.firstTeam, turnOrder: config.turnOrder, timerPhase, timerRemaining };
    }
  });

  load(seed, getImageRevisionFromUrl(), getLayoutRevisionFromUrl());
}

if (view === "start") setupStart();
if (view === "master") setupMaster();
if (view === "play") setupPlay();
