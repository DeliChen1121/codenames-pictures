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
  createBoardSeed,
  createGameConfig,
  createGameCode,
  getGamePreset,
  nextActiveTurn,
  normalizeSeed,
  parseBoardSeed,
  teamsForCount
} from "./game-core.js";

const view = document.body.dataset.view;
const DEFAULT_TIMER_SECONDS = Object.freeze({ prep: 120, clue: 30, guess: 60 });
const FONT_SIZE_KEY = "codenames-four-teams:font-size-v3";
const DEFAULT_FONT_SIZE_PRESET = "large";
const FONT_SIZE_PRESETS = Object.freeze({ small: 13, standard: 14, large: 15, huge: 18 });
const FONT_SIZE_NAMES = Object.freeze({ small: "Small", standard: "Standard", large: "Large", huge: "Huge" });
let fontSizePreset = loadFontSizePreset();
const timerPresets = {
  prep: { label: "Captain prep" },
  clue: { label: "Captain thinking" },
  guess: { label: "Team guessing" }
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

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Some browsers deny clipboard access for local files; try selection copying.
    }
  }
  const previousFocus = document.activeElement;
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  field.style.fontSize = "16px";
  // showModal makes the rest of the document inert, including body-level inputs.
  (document.querySelector("dialog[open]") || document.body).append(field);
  try {
    field.focus({ preventScroll: true });
    field.select();
    field.setSelectionRange(0, field.value.length);
    if (!document.execCommand("copy")) throw new Error("copy failed");
  } finally {
    field.remove();
    previousFocus?.focus({ preventScroll: true });
  }
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
    throw new Error("This action does not take extra arguments.");
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
      turnOrder: params.get("order")?.split(","),
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
  url.searchParams.set("order", config.turnOrder.join(","));
  for (const team of TEAM_ORDER) {
    if (config.activeTeams.includes(team)) url.searchParams.set(team, String(config.teamCounts[team]));
    else url.searchParams.delete(team);
  }
}

function gameModeSummary(config) {
  return config.teamCount + " teams · " + MODE_NAMES[config.mode] + " · " + config.gridSize + "×" + config.gridSize;
}

function teamOrderPermutations(teams) {
  if (teams.length <= 1) return [[...teams]];
  return teams.flatMap((team) => teamOrderPermutations(teams.filter((candidate) => candidate !== team))
    .map((rest) => [team, ...rest]));
}

function teamOrderValue(order) {
  return order.join(",");
}

function fillTeamOrderSelect(select, activeTeams, selectedOrder = activeTeams) {
  select.replaceChildren(...teamOrderPermutations(activeTeams).map((order) => (
    new Option(order.map((team) => TEAMS[team].short).join(" → "), teamOrderValue(order))
  )));
  const selectedValue = teamOrderValue(selectedOrder);
  select.value = [...select.options].some((option) => option.value === selectedValue)
    ? selectedValue
    : teamOrderValue(activeTeams);
}

function readTeamOrder(select) {
  return select.value.split(",").filter(Boolean);
}

function setGameInUrl(seed, imageRevision = 0, layoutRevision = 0, config) {
  const url = new URL(window.location.href);
  url.searchParams.delete("fresh");
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

function loadCardImage(card, container) {
  const image = document.createElement("img");
  image.alt = "Picture " + card.coordinate;
  image.loading = "eager";
  image.src = imageSource(card.imageId);
  image.addEventListener("error", () => {
    container.classList.add("image-missing");
  });
  return image;
}

function masterPictureCard(card) {
  const cardElement = document.createElement("article");
  cardElement.className = "picture-card answer-card is-revealed";
  cardElement.dataset.role = card.role;
  cardElement.setAttribute("aria-label", "Picture " + card.coordinate + ": " + ROLE_NAMES[card.role]);

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
  const teamCountsContainer = document.querySelector("#custom-team-counts");
  const gridSizeInput = document.querySelector("#custom-grid-size");
  const whiteCountInput = document.querySelector("#custom-white-count");
  const blackCountInput = document.querySelector("#custom-black-count");
  const allocationStatus = document.querySelector("#allocation-status");
  const setupCard = document.querySelector("#setup-card");
  const orderCard = document.querySelector("#order-card");
  const orderForm = document.querySelector("#order-setup");
  const orderPreview = document.querySelector("#order-preview");
  let setupTurnOrder = teamsForCount(4);
  let orderDrag = null;
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
      ? "First " + preset.firstCount + " / second " + preset.secondCount
      : preset.perTeamCount + " each";
    return preset.gridSize + "×" + preset.gridSize + " · " + colors + " · White " + preset.whiteCount + " · Black " + preset.blackCount;
  }

  function updateModeSummaries() {
    const teamCount = selectedTeamCount();
    for (const mode of GAME_MODES) {
      document.querySelector('[data-mode-summary="' + mode + '"]').textContent = presetSummary(teamCount, mode);
    }
  }

  function rebuildTeamOrderOptions() {
    const activeTeams = teamsForCount(selectedTeamCount());
    if (setupTurnOrder.length !== activeTeams.length || setupTurnOrder.some((team) => !activeTeams.includes(team))) {
      setupTurnOrder = activeTeams;
    }
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
        countInput("First team colored cards", preset.firstCount, "first"),
        countInput("Second team colored cards", preset.secondCount, "second")
      );
      return;
    }
    teamCountsContainer.replaceChildren(...teamsForCount(teamCount).map((team) => (
      countInput(TEAMS[team].name + " colored cards", preset.perTeamCount, team)
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
      ? "✓ Assigned " + assigned + " / " + target + " cards"
      : "Assigned " + assigned + " cards; must fill exactly " + target + " spaces";
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
      turnOrder: setupTurnOrder,
      firstCount: countValues.first,
      secondCount: countValues.second,
      teamCounts: Object.fromEntries(teamsForCount(teamCount).map((team) => [team, countValues[team]])),
      whiteCount: Number(whiteCountInput.value),
      blackCount: Number(blackCountInput.value)
    }, seed);
  }

  function startNewGame() {
    if (!validateAllocation()) throw new Error("Colored cards do not fill the grid yet.");
    const seed = createGameCode();
    const config = readConfigForSeed(seed);
    const url = playUrl(seed, 0, 0, config);
    // An explicit start replays the board from the beginning, not a saved result.
    url.searchParams.set("fresh", "1");
    window.location.href = url.href;
    return { gameCode: seed, config };
  }

  function renderOrderPreview() {
    const config = readConfigForSeed("");
    orderPreview.replaceChildren(...config.turnOrder.map((team, index) => {
      const item = document.createElement("li");
      item.dataset.team = team;
      item.tabIndex = 0;
      item.setAttribute("aria-label", TEAMS[team].name + ", position " + (index + 1));
      item.setAttribute("aria-describedby", "order-help");
      item.style.setProperty("--team-color", TEAMS[team].color);
      const position = document.createElement("span");
      position.className = "order-position";
      position.textContent = String(index + 1);
      const name = document.createElement("strong");
      name.textContent = TEAMS[team].name;
      const detail = document.createElement("small");
      detail.textContent = (index === 0 ? "First · " : "") + config.teamCounts[team] + " colored cards";
      const handle = document.createElement("span");
      handle.className = "order-drag-handle";
      handle.textContent = "⠿";
      handle.setAttribute("aria-hidden", "true");
      const actions = document.createElement("span");
      actions.className = "order-move-actions";
      for (const [direction, label, symbol] of [[-1, "Move up ", "↑"], [1, "Move down ", "↓"]]) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = symbol;
        button.setAttribute("aria-label", label + TEAMS[team].name);
        button.disabled = index + direction < 0 || index + direction >= config.turnOrder.length;
        button.addEventListener("click", () => moveTeam(team, index + direction));
        actions.append(button);
      }
      item.append(handle, position, name, detail, actions);
      return item;
    }));
    document.querySelector("#order-summary").textContent = gameModeSummary(config);
  }

  function moveTeam(team, targetIndex) {
    const fromIndex = setupTurnOrder.indexOf(team);
    if (fromIndex < 0 || targetIndex < 0 || targetIndex >= setupTurnOrder.length || fromIndex === targetIndex) return;
    setupTurnOrder.splice(fromIndex, 1);
    setupTurnOrder.splice(targetIndex, 0, team);
    renderOrderPreview();
    orderPreview.querySelector('[data-team="' + team + '"]').focus({ preventScroll: true });
  }

  orderPreview.addEventListener("keydown", (event) => {
    if (event.target.closest("button") || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
    const item = event.target.closest("li[data-team]");
    if (!item) return;
    event.preventDefault();
    moveTeam(item.dataset.team, setupTurnOrder.indexOf(item.dataset.team) + (event.key === "ArrowUp" ? -1 : 1));
  });
  orderPreview.addEventListener("pointerdown", (event) => {
    if (orderDrag || event.button !== 0 || event.target.closest("button")) return;
    const item = event.target.closest("li[data-team]");
    if (!item) return;
    orderDrag = {
      item, team: item.dataset.team, pointerId: event.pointerId,
      startY: event.clientY, offsetY: event.clientY - item.getBoundingClientRect().top,
      initialOrder: [...setupTurnOrder], dragging: false,
      centers: [...orderPreview.children].map((row) => {
        const rect = row.getBoundingClientRect();
        return rect.top + rect.height / 2;
      })
    };
    orderPreview.setPointerCapture(event.pointerId);
  });
  orderPreview.addEventListener("pointermove", (event) => {
    if (!orderDrag || event.pointerId !== orderDrag.pointerId) return;
    if (!orderDrag.dragging && Math.abs(event.clientY - orderDrag.startY) < 5) return;
    event.preventDefault();
    orderDrag.dragging = true;
    orderDrag.item.classList.add("is-dragging");
    const { centers, team, item } = orderDrag;
    const targetIndex = centers.reduce((nearest, center, index) =>
      Math.abs(center - event.clientY) < Math.abs(centers[nearest] - event.clientY) ? index : nearest, 0);
    const fromIndex = setupTurnOrder.indexOf(team);
    if (targetIndex !== fromIndex) {
      setupTurnOrder.splice(fromIndex, 1);
      setupTurnOrder.splice(targetIndex, 0, team);
      const rows = new Map([...orderPreview.children].map((row) => [row.dataset.team, row]));
      orderPreview.append(...setupTurnOrder.map((name) => rows.get(name)));
    }
    item.style.transform = "";
    item.style.transform = "translateY(" + (event.clientY - orderDrag.offsetY - item.getBoundingClientRect().top) + "px)";
  });
  function finishOrderDrag(event) {
    if (!orderDrag || event.pointerId !== orderDrag.pointerId) return;
    const { item, initialOrder, pointerId, dragging } = orderDrag;
    orderDrag = null;
    if (event.type === "pointercancel" || event.type === "lostpointercapture") setupTurnOrder = initialOrder;
    if (orderPreview.hasPointerCapture(pointerId)) orderPreview.releasePointerCapture(pointerId);
    item.style.transform = "";
    item.classList.remove("is-dragging");
    if (dragging) {
      renderOrderPreview();
      orderPreview.querySelector('[data-team="' + item.dataset.team + '"]').focus({ preventScroll: true });
    }
  }
  orderPreview.addEventListener("pointerup", finishOrderDrag);
  orderPreview.addEventListener("pointercancel", finishOrderDrag);
  orderPreview.addEventListener("lostpointercapture", finishOrderDrag);

  function showOrderStep() {
    if (!form.reportValidity() || !validateAllocation()) return;
    renderOrderPreview();
    setupCard.hidden = true;
    orderCard.hidden = false;
    orderPreview.firstElementChild.focus();
    return { stage: "choose_team_order", turnOrder: [...setupTurnOrder] };
  }

  orderForm.addEventListener("submit", (event) => {
    event.preventDefault();
    startNewGame();
  });
  document.querySelector("#back-to-setup").addEventListener("click", () => {
    orderCard.hidden = true;
    setupCard.hidden = false;
    startButton.focus();
  });

  form.elements["team-count"].forEach((input) => input.addEventListener("change", () => {
    updateModeSummaries();
    rebuildTeamOrderOptions();
    applySelectedPreset();
  }));
  form.elements["game-mode"].forEach((input) => input.addEventListener("change", applySelectedPreset));
  document.querySelector("#detailed-settings").addEventListener("input", () => {
    isCustom = true;
    validateAllocation();
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    showOrderStep();
  });

  updateModeSummaries();
  rebuildTeamOrderOptions();
  applySelectedPreset();

  registerWebTool({
    name: "start_new_codenames_game",
    title: "Start a new game",
    description: "From the start page, go to team-order selection; call again after confirming order to deal a new game.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute(input) {
      assertEmptyInput(input);
      return orderCard.hidden ? showOrderStep() : startNewGame();
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
  summary.textContent = gameModeSummary(config) + " · " + TEAMS[config.firstTeam].name + " first";
  board.style.setProperty("--grid-size", String(config.gridSize));
  board.dataset.gridSize = String(config.gridSize);
  board.setAttribute("aria-label", config.gridSize + " by " + config.gridSize + " captain key");
  board.replaceChildren(...game.cards.map(masterPictureCard));
  const legendRoles = [
    ...config.turnOrder.map((team) => [team, TEAMS[team].name, config.teamCounts[team]]),
    ["black", "Black", config.blackCount],
    ["white", "White", config.whiteCount]
  ];
  legend.replaceChildren(...legendRoles.filter(([, , count]) => count > 0).map(([role, name, count]) => {
    const item = document.createElement("span");
    item.innerHTML = '<i class="dot ' + role + '"></i>' + name + " " + count;
    if (role === config.firstTeam) item.append(" · first");
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
  let masterWindow = null;

  function syncMasterWindow() {
    if (!masterWindow || masterWindow.closed) return;
    // Keep the answer window opened by this host on the exact same board.
    masterWindow.location.href = masterUrl(seed, imageRevision, layoutRevision, config).href;
  }

  openMasterWindow.addEventListener("click", (event) => {
    event.preventDefault();
    if (!masterWindow || masterWindow.closed) {
      masterWindow = window.open(masterUrl(seed, imageRevision, layoutRevision, config).href, "_blank");
    } else {
      syncMasterWindow();
      masterWindow.focus();
    }
  });
  const copyMasterFeedback = document.querySelector("#copy-master-feedback");
  const timerSettingsButton = document.querySelector("#timer-settings");
  const timerSettingsModal = document.querySelector("#timer-settings-modal");
  const timerSettingsForm = document.querySelector("#timer-settings-form");
  const prepMinutesInput = document.querySelector("#settings-prep-minutes");
  const clueSecondsInput = document.querySelector("#settings-clue-seconds");
  const guessSecondsInput = document.querySelector("#settings-guess-seconds");
  const fontSizeInput = document.querySelector("#settings-font-size");
  const teamOrderInput = document.querySelector("#settings-team-order");
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
    button.setAttribute("aria-label", "Picture " + card.coordinate + (isRevealed ? ", revealed: " + ROLE_NAMES[card.role] : ", hidden"));

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
    const placements = calculatePlacements(completionRounds, config.activeTeams, eliminatedTeams);
    teamSwitcher.replaceChildren(...config.turnOrder.map((team) => {
      const button = document.createElement("button");
      const remaining = remainingFor(team);
      const isEliminated = Boolean(eliminatedTeams[team]);
      const isComplete = Boolean(completionRounds[team]);
      let status = remaining + " left";
      let badge = String(remaining);
      if (winnerTeam) {
        status = team === winnerTeam ? "Won this game" : (isEliminated ? "Hit black" : "Lost this game");
        badge = team === winnerTeam ? "Win" : "Loss";
      } else if (isEliminated) {
        status = "Hit black in round " + eliminatedTeams[team] + " · last place";
        badge = ordinal(placements[team]);
      } else if (isComplete) {
        status = "Finished in round " + completionRounds[team];
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
      ? "Captains prepare"
      : finished
        ? (winnerTeam ? TEAMS[winnerTeam].name + " wins" : "Game over")
        : TEAMS[currentTeam].name;
    roundLabel.textContent = preparing ? "Prep" : finished ? "Final results" : "Round " + round;

    if (preparing) {
      phaseInstruction.textContent = config.teamCount + " captains look at the key together. Teammates only see the pictures on the left.";
    } else if (finished) {
      phaseInstruction.textContent = winnerTeam
        ? TEAMS[winnerTeam].name + " found all of their pictures first and wins."
        : "Every team has finished or been eliminated. Placements are recorded.";
    } else if (timerPhase === "clue") {
      phaseInstruction.textContent = TEAMS[currentTeam].name + " captain gives a one-word clue plus a number, then guessing can start.";
    } else if (timerRemaining === 0) {
      phaseInstruction.textContent = TEAMS[currentTeam].name + " guessing time is up. Switch to the next team.";
    } else {
      phaseInstruction.textContent = TEAMS[currentTeam].name + " is guessing. Hits on their color can continue.";
    }

    startAnsweringButton.disabled = finished || !currentTeam || !isActive(currentTeam) || timerPhase !== "clue";
    startAnsweringButton.hidden = finished;
    startAnsweringButton.querySelector("span").textContent = "+ " + formatTime(timerSettings.guess);
    nextTeamButton.disabled = finished || !currentTeam || !isActive(currentTeam);
    nextTeamButton.hidden = finished;
    viewResultsButton.hidden = !finished;
    gameCodeLabel.textContent = seed;
    gameModeLabel.textContent = gameModeSummary(config) + " · " + TEAMS[config.firstTeam].short + " first";
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
      timerToggle.textContent = "Pause";
    } else if (timerPhase === "prep" && timerRemaining === timerSettings.prep) {
      timerToggle.textContent = "Start prep";
    } else {
      timerToggle.textContent = "Resume";
    }
    timerToggle.disabled = gameIsFinished() || (timerPhase === "guess" && timerRemaining === 0);
    timerSkip.textContent = timerPhase === "prep" ? "Skip prep" : timerPhase === "clue" ? "Skip thinking" : "Skip guessing";
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
    message.textContent = "Prep is over. It is " + TEAMS[currentTeam].name + "'s turn. The captain has " + formatTime(timerSettings.clue) + " to think.";
    saveState();
  }

  function startAnswering() {
    if (!currentTeam || !isActive(currentTeam) || timerPhase !== "clue") {
      throw new Error("Guessing can start only during the current captain thinking phase.");
    }
    const carriedSeconds = timerRemaining;
    configureTimer("guess", answerTimeWithCarry(carriedSeconds, timerSettings.guess), true);
    message.textContent = TEAMS[currentTeam].name + " starts guessing: keeping " + carriedSeconds + "s and adding " + formatTime(timerSettings.guess) + ".";
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
        message.textContent = TEAMS[currentTeam].name + " guessing time is up. The host should click Next team.";
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
    advanceTeam("The host skipped the guessing countdown.", true);
  }

  function findNextActive(fromTeam) {
    return nextActiveTurn(fromTeam, activeTeams(), round, config.turnOrder);
  }

  function renderFinalRanking() {
    const placements = calculatePlacements(completionRounds, config.activeTeams, eliminatedTeams);
    const orderedTeams = [...config.activeTeams].sort((first, second) => {
      if (winnerTeam) return (first === winnerTeam ? -1 : 1) - (second === winnerTeam ? -1 : 1);
      const firstPlace = placements[first] ?? 99;
      const secondPlace = placements[second] ?? 99;
      return firstPlace - secondPlace || config.turnOrder.indexOf(first) - config.turnOrder.indexOf(second);
    });

    finalResultsTitle.textContent = winnerTeam ? TEAMS[winnerTeam].name + " wins!" : "Final ranking";
    finalResultsCopy.textContent = winnerTeam
      ? "The two-team match is decided. All answers are shown on the board."
      : "All answers are shown on the board.";

    rankingList.replaceChildren(...orderedTeams.map((team) => {
      const row = document.createElement("div");
      const placement = placements[team];
      const eliminatedRound = eliminatedTeams[team];
      row.className = "ranking-row team-" + team + (eliminatedRound ? " is-eliminated" : "");

      const badge = document.createElement("strong");
      badge.className = "ranking-place";
      badge.textContent = winnerTeam ? (team === winnerTeam ? "Win" : "Loss") : ordinal(placement);

      const copy = document.createElement("span");
      const name = document.createElement("b");
      name.textContent = TEAMS[team].name;
      const detail = document.createElement("small");
      detail.textContent = winnerTeam
        ? (team === winnerTeam
          ? (completionRounds[team] ? "Finished first in round " + completionRounds[team] : "Opponent hit black")
          : (eliminatedRound ? "Hit black in round " + eliminatedRound : "Opponent finished first"))
        : (eliminatedRound
          ? "Hit black in round " + eliminatedRound + " and placed last"
          : "Finished in round " + completionRounds[team]);
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
      ? reason + " " + TEAMS[winnerTeam].name + " wins the game."
      : reason + " Every team has finished or been eliminated. The game is over.";
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
    message.textContent = reason + " It is " + TEAMS[currentTeam].name + "'s turn. The captain has " + formatTime(timerSettings.clue) + " to think.";
    saveState();
  }

  function selectTeam(team) {
    if (!isActive(team)) return;
    currentTeam = team;
    round = Math.max(1, round);
    configureTimer("clue", timerSettings.clue, true);
    message.textContent = "The host switched the turn to " + TEAMS[team].name + ".";
    saveState();
  }

  function recordCompletion(team) {
    if (!config.activeTeams.includes(team) || completionRounds[team] || remainingFor(team) !== 0) return false;
    completionRounds[team] = Math.max(1, round);
    return true;
  }

  function completionMessage(team) {
    const placement = calculatePlacements(completionRounds, config.activeTeams)[team];
    return TEAMS[team].name + " found all " + config.teamCounts[team] + " cards in round " + completionRounds[team] + " and is currently " + ordinal(placement) + ".";
  }

  function revealCard(card) {
    if (revealed.has(card.index)) throw new Error("This picture is already revealed.");
    if (!canReveal()) throw new Error("Enter the current team's guessing phase first.");

    const guessingTeam = currentTeam;
    revealed.add(card.index);
    const targetCompleted = config.activeTeams.includes(card.role) && recordCompletion(card.role);

    if (card.role === "black") {
      eliminatedTeams[guessingTeam] = Math.max(1, round);
      stopTimer(false);
      if (config.teamCount === 2) {
        const opponent = config.activeTeams.find((team) => team !== guessingTeam);
        finishGame(TEAMS[guessingTeam].name + " hit black and is out.", opponent);
        return;
      }
      advanceTeam(TEAMS[guessingTeam].name + " hit black and is out.", false);
      if (!gameIsFinished()) {
        message.textContent = TEAMS[guessingTeam].name + " hit black and is out. Next is " + TEAMS[currentTeam].name + ". After this notice, start " + formatTime(timerSettings.clue) + " of captain thinking.";
        eliminationCopy.textContent = TEAMS[guessingTeam].name + " is eliminated. Later turns will skip this team automatically.";
        dismissElimination.textContent = "Start next team";
        eliminationNotice.hidden = false;
      }
    } else if (card.role === guessingTeam) {
      if (targetCompleted) {
        if (config.teamCount === 2) {
          finishGame(TEAMS[guessingTeam].name + " found all of their pictures first.", guessingTeam);
          return;
        }
        const completedCopy = completionMessage(guessingTeam);
        advanceTeam(completedCopy, true);
      } else {
        message.textContent = "Correct! " + TEAMS[guessingTeam].name + " can keep guessing.";
      }
    } else if (config.activeTeams.includes(card.role)) {
      if (targetCompleted && config.teamCount === 2) {
        finishGame("That guess helped " + TEAMS[card.role].name + " find all of their pictures.", card.role);
        return;
      }
      const helpCopy = targetCompleted
        ? "and also helped " + TEAMS[card.role].name + " finish all of their pictures."
        : "and revealed it for them.";
      advanceTeam("Revealed a " + TEAMS[card.role].name + " picture, " + helpCopy, true);
    } else {
      advanceTeam("Revealed white. This turn is over.", true);
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
    syncMasterWindow();
    message.textContent = "Surface pictures refreshed. Hidden colors under all " + config.cardCount + " spaces are unchanged.";
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
    syncMasterWindow();
    message.textContent = "Hidden colors were redistributed. Pictures are unchanged. Send captains the new key link.";
  }

  async function copyMasterLink() {
    const url = masterUrl(seed, imageRevision, layoutRevision, config).href;
    try {
      await copyText(url);
      copyMasterFeedback.textContent = "Captain key link copied";
      copyMasterButton.textContent = "Copied";
      window.setTimeout(() => {
        copyMasterButton.textContent = "Copy captain key link";
        copyMasterFeedback.textContent = "";
      }, 1800);
    } catch {
      copyMasterFeedback.textContent = "Copy failed. Open the captain key page and copy the browser address";
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
    message.textContent = "This game was reset. Start " + formatTime(timerSettings.prep) + " of captain prep.";
    saveState();
    renderBoard();
    renderStatus();
  }

  function fillTimerSettingsForm(settings = timerSettings) {
    prepMinutesInput.value = String(settings.prep / 60);
    clueSecondsInput.value = String(settings.clue);
    guessSecondsInput.value = String(settings.guess);
    fontSizeInput.value = fontSizePreset;
    fillTeamOrderSelect(teamOrderInput, config.activeTeams, config.turnOrder);
  }

  function applyTeamOrder(nextTurnOrder) {
    const normalizedOrder = Array.isArray(nextTurnOrder) ? nextTurnOrder : [];
    if (teamOrderValue(normalizedOrder) === teamOrderValue(config.turnOrder)) return false;
    if (normalizedOrder.length !== config.activeTeams.length
      || normalizedOrder.some((team, index) => !config.activeTeams.includes(team) || normalizedOrder.indexOf(team) !== index)) {
      throw new Error("Turn order must include each playing team once.");
    }
    const teamCounts = { ...config.teamCounts };
    if (config.teamCount === 2 && normalizedOrder[0] !== config.firstTeam) {
      [teamCounts[config.firstTeam], teamCounts[normalizedOrder[0]]] = [teamCounts[normalizedOrder[0]], teamCounts[config.firstTeam]];
    }
    config = createGameConfig({
      teamCount: config.teamCount,
      mode: config.mode,
      gridSize: config.gridSize,
      turnOrder: normalizedOrder,
      teamCounts,
      whiteCount: config.whiteCount,
      blackCount: config.blackCount
    }, seed);
    game = buildGame(seed, imageRevision, layoutRevision, config);
    setGameInUrl(seed, imageRevision, layoutRevision, config);
    syncMasterWindow();
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
        throw new Error("Opening prep must be at least 15 seconds. Other phases must be 5 to 3600 seconds.");
      }
    }
    return normalized;
  }

  function applyTimerSettings(nextSettings, shouldResume = false) {
    timerSettings = normalizeTimerSettings(nextSettings);
    storageSet(timerSettingsKey, JSON.stringify(timerSettings));
    configureTimer(timerPhase, timerSettings[timerPhase], shouldResume && !gameIsFinished());
    message.textContent = "Settings saved: " + FONT_SIZE_NAMES[fontSizePreset] + " font, prep " + formatTime(timerSettings.prep) + ", captain " + formatTime(timerSettings.clue) + ", guessing " + formatTime(timerSettings.guess) + ".";
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
    board.setAttribute("aria-label", config.gridSize + " by " + config.gridSize + " picture board");
    teamSwitcher.setAttribute("aria-label", config.teamCount + " team status and current team");
    if (currentTeam && !isActive(currentTeam)) currentTeam = null;
    if (!currentTeam && round > 0 && !gameIsFinished()) currentTeam = activeTeams()[0];
    setGameInUrl(seed, imageRevision, layoutRevision, config);
    eliminationNotice.hidden = true;
    if (gameIsFinished()) {
      currentTeam = null;
      timerPhase = "guess";
      timerRemaining = 0;
      revealed = new Set(game.cards.map((card) => card.index));
      message.textContent = "Restored the final results. All answers are shown.";
      renderTimer();
      renderBoard();
      renderStatus();
      showFinalResults();
      return;
    }
    if (currentTeam) {
      configureTimer("clue", timerSettings.clue, false);
      message.textContent = "Restored this game. It is " + TEAMS[currentTeam].name + ". Continue the captain thinking timer.";
    } else {
      configureTimer("prep", timerSettings.prep, false);
      message.textContent = restored && gameIsFinished()
        ? "Restored the final results."
        : "Start with " + formatTime(timerSettings.prep) + " of captain prep.";
    }
    renderBoard();
    renderStatus();
  }

  startAnsweringButton.addEventListener("click", () => startAnswering());
  nextTeamButton.addEventListener("click", () => advanceTeam("The host ended the current turn.", true));
  document.querySelector("#refresh-images").addEventListener("click", refreshImages);
  document.querySelector("#refresh-layout").addEventListener("click", refreshLayout);
  copyMasterButton.addEventListener("click", copyMasterLink);
  timerToggle.addEventListener("click", () => timerRunning ? stopTimer() : startTimer());
  timerSkip.addEventListener("click", skipTimerPhase);
  document.querySelector("#timer-reset").addEventListener("click", () => {
    configureTimer(timerPhase, timerSettings[timerPhase], false);
    message.textContent = timerPresets[timerPhase].label + " timer was reset.";
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
    const orderChanged = applyTeamOrder(readTeamOrder(teamOrderInput));
    applyFontSizePreset(fontSizeInput.value);
    applyTimerSettings({
      prep: Number(prepMinutesInput.value) * 60,
      clue: Number(clueSecondsInput.value),
      guess: Number(guessSecondsInput.value)
    }, shouldResume && !orderChanged);
    if (orderChanged) {
      resetGame();
      message.textContent = "Team order is now " + config.turnOrder.map((team) => TEAMS[team].name).join(" → ") + ". This game was reset.";
    }
    timerSettingsModal.hidden = true;
    timerSettingsButton.focus();
  });
  fullscreenButton.addEventListener("click", async () => {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
  });
  document.addEventListener("fullscreenchange", () => {
    fullscreenButton.textContent = document.fullscreenElement ? "Exit fullscreen" : "Fullscreen";
  });
  document.querySelector("#reset-board").addEventListener("click", () => {
    if (!window.confirm("Clear this game's reveals, eliminations, and ranking?")) return;
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
    title: "Reveal a picture",
    description: "Reveal a picture by board number, applying continue, switch-team, help-opponent, or current-team-out rules.",
    inputSchema: {
      type: "object",
      properties: { number: { type: "integer", minimum: 1, maximum: config.cardCount } },
      required: ["number"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute(input) {
      if (!Number.isInteger(input?.number) || input.number < 1 || input.number > config.cardCount) {
        throw new Error("Picture number must be an integer from 1 to " + config.cardCount + ".");
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
    title: "Set current team",
    description: "Let the host switch the turn to a team still in the game and start the configured captain thinking timer.",
    inputSchema: {
      type: "object",
      properties: { team: { type: "string", enum: config.activeTeams } },
      required: ["team"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute(input) {
      if (!config.activeTeams.includes(input?.team)) throw new Error("That team is not in this game.");
      if (!isActive(input.team)) throw new Error("That team has already finished or been eliminated and cannot take a turn.");
      selectTeam(input.team);
      return { currentTeam, round, timerPhase, timerRemaining };
    }
  });

  registerWebTool({
    name: "start_codenames_answering",
    title: "Start guessing",
    description: "End the current captain thinking phase, add leftover seconds to the configured guessing time, and start the timer immediately.",
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
    title: "Next team",
    description: "End the current turn, skip finished or eliminated teams, and start the configured captain thinking timer for the next team.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute(input) {
      assertEmptyInput(input);
      if (!currentTeam) throw new Error("Prep is not over yet, so no team is taking a turn.");
      advanceTeam("The host ended the current turn.", true);
      return { currentTeam, round, timerPhase, timerRemaining };
    }
  });

  registerWebTool({
    name: "refresh_codenames_pictures",
    title: "Refresh surface pictures",
    description: "Replace all surface pictures while keeping the hidden color under each space the same.",
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
    title: "Refresh color layout",
    description: "Keep the current pictures, generate a new hidden color layout, and reset this game.",
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
    title: "Skip current countdown",
    description: "End the current countdown immediately: prep goes to the first team, captain thinking goes to guessing, and guessing goes to the next team.",
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
    title: "Set game",
    description: "Set the three timer phases, interface font size, and full team order. Changing team order resets this game.",
    inputSchema: {
      type: "object",
      properties: {
        prepSeconds: { type: "integer", minimum: 15, maximum: 3600 },
        clueSeconds: { type: "integer", minimum: 5, maximum: 3600 },
        guessSeconds: { type: "integer", minimum: 5, maximum: 3600 },
        fontSize: { type: "string", enum: ["small", "standard", "large", "huge"] },
        teamOrder: {
          type: "array",
          items: { type: "string", enum: config.activeTeams },
          minItems: config.activeTeams.length,
          maxItems: config.activeTeams.length
        }
      },
      required: ["prepSeconds", "clueSeconds", "guessSeconds"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute(input) {
      const wasRunning = timerRunning;
      const orderChanged = input?.teamOrder ? applyTeamOrder(input.teamOrder) : false;
      if (input?.fontSize) applyFontSizePreset(input.fontSize);
      applyTimerSettings({ prep: input?.prepSeconds, clue: input?.clueSeconds, guess: input?.guessSeconds }, wasRunning && !orderChanged);
      if (orderChanged) resetGame();
      return { ...timerSettings, fontSize: fontSizePreset, turnOrder: config.turnOrder, timerPhase, timerRemaining };
    }
  });

  const seedDialog = document.querySelector("#seed-dialog");
  const seedValue = document.querySelector("#board-seed-value");
  const seedFeedback = document.querySelector("#seed-copy-feedback");
  document.querySelector("#show-seed").addEventListener("click", () => {
    seedValue.value = createBoardSeed(game);
    seedValue.setCustomValidity("");
    seedValue.removeAttribute("aria-invalid");
    seedFeedback.textContent = "";
    seedDialog.showModal();
    seedValue.focus();
    seedValue.select();
  });
  document.querySelector("#close-seed").addEventListener("click", () => seedDialog.close());
  seedValue.addEventListener("input", () => {
    seedValue.setCustomValidity("");
    seedValue.removeAttribute("aria-invalid");
    seedFeedback.textContent = "";
  });

  function applyEnteredSeed() {
    let nextGame;
    try {
      const entered = parseBoardSeed(seedValue.value);
      if (!entered) throw new Error("Enter a game code or paste a full seed first.");
      nextGame = buildGame(entered.seed, entered.imageRevision, entered.layoutRevision, entered.config || config);
    } catch (error) {
      seedValue.setCustomValidity(error.message);
      seedValue.setAttribute("aria-invalid", "true");
      seedFeedback.textContent = error.message;
      seedValue.reportValidity();
      return;
    }
    seed = nextGame.seed;
    config = nextGame.config;
    layoutRevision = nextGame.layoutRevision;
    storageRemove(stateKey());
    load(seed, nextGame.imageRevision, layoutRevision);
    saveState();
    syncMasterWindow();
    seedDialog.close();
  }

  document.querySelector("#apply-seed").addEventListener("click", applyEnteredSeed);
  seedValue.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    applyEnteredSeed();
  });
  document.querySelector("#copy-seed").addEventListener("click", async () => {
    const currentSeed = createBoardSeed(game);
    try {
      await copyText(currentSeed);
      seedFeedback.textContent = "Current board seed copied. Paste it in the seed dialog and press Enter to use it.";
    } catch {
      seedValue.value = currentSeed;
      seedValue.setCustomValidity("");
      seedValue.removeAttribute("aria-invalid");
      seedValue.focus();
      seedValue.select();
      seedFeedback.textContent = "Copy the selected full seed above by hand.";
    }
  });

  if (new URLSearchParams(window.location.search).get("fresh") === "1") storageRemove(stateKey());
  load(seed, getImageRevisionFromUrl(), getLayoutRevisionFromUrl());
}

if (view === "start") setupStart();
if (view === "master") setupMaster();
if (view === "play") setupPlay();
