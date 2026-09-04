import {
  ROLE_NAMES,
  TEAM_ORDER,
  TEAMS,
  answerTimeWithCarry,
  buildGame,
  calculatePlacements,
  createGameCode,
  nextActiveTurn,
  normalizeSeed
} from "./game-core.js";

const view = document.body.dataset.view;
const DEFAULT_TIMER_SECONDS = Object.freeze({ prep: 120, clue: 30, guess: 60 });
const timerPresets = {
  prep: { label: "全体队长思考" },
  clue: { label: "当前队长思考" },
  guess: { label: "当前队伍答题" }
};

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

function setGameInUrl(seed, imageRevision = 0, layoutRevision = 0) {
  const url = new URL(window.location.href);
  url.searchParams.set("game", seed);
  setRevisionInUrl(url, "deck", imageRevision);
  setRevisionInUrl(url, "layout", layoutRevision);
  window.history.replaceState({}, "", url);
}

function playUrl(seed, imageRevision = 0, layoutRevision = 0) {
  const url = new URL("./play.html", window.location.href);
  url.searchParams.set("game", seed);
  setRevisionInUrl(url, "deck", imageRevision);
  setRevisionInUrl(url, "layout", layoutRevision);
  return url;
}

function masterUrl(seed, imageRevision = 0, layoutRevision = 0) {
  const url = new URL("./master.html", window.location.href);
  url.searchParams.set("game", seed);
  setRevisionInUrl(url, "deck", imageRevision);
  setRevisionInUrl(url, "layout", layoutRevision);
  return url;
}

function imageSource(imageId) {
  return "./images/cards/card-" + imageId + ".jpg";
}

function fallbackImageSource(imageId) {
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
  function startNewGame() {
    const seed = createGameCode();
    window.location.href = playUrl(seed).href;
    return { gameCode: seed };
  }

  document.querySelector("#start-game").addEventListener("click", startNewGame);

  registerWebTool({
    name: "start_new_codenames_game",
    title: "开始新游戏",
    description: "生成新的局号并进入 25 张图片的主持人题板。",
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
  const game = buildGame(seed, imageRevision, layoutRevision);

  const board = document.querySelector("#master-board");
  const codeLabel = document.querySelector("#master-code-label");
  const playLink = document.querySelector("#open-play");

  setGameInUrl(seed, imageRevision, layoutRevision);
  codeLabel.textContent = seed;
  playLink.href = playUrl(seed, imageRevision, layoutRevision).href;
  board.replaceChildren(...game.cards.map(masterPictureCard));
}

function setupPlay() {
  const timerSettingsKey = "codenames-four-teams:timer-settings-v1";
  const sidebarWidthKey = "codenames-four-teams:sidebar-width-v1";
  let timerSettings = loadTimerSettings();
  let seed = getSeedFromUrl() || createGameCode();
  let imageRevision = getImageRevisionFromUrl() ?? 0;
  let layoutRevision = getLayoutRevisionFromUrl() ?? 0;
  let game = buildGame(seed, imageRevision, layoutRevision);
  let revealed = new Set();
  let currentTeam = null;
  let round = 0;
  let eliminatedTeams = {};
  let completionRounds = {};
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
  const copyMasterButton = document.querySelector("#copy-master-link");
  const copyMasterFeedback = document.querySelector("#copy-master-feedback");
  const gameLayout = document.querySelector(".game-layout");
  const sidebarResizer = document.querySelector("#sidebar-resizer");
  const timerSettingsButton = document.querySelector("#timer-settings");
  const timerSettingsModal = document.querySelector("#timer-settings-modal");
  const timerSettingsForm = document.querySelector("#timer-settings-form");
  const prepMinutesInput = document.querySelector("#settings-prep-minutes");
  const clueSecondsInput = document.querySelector("#settings-clue-seconds");
  const guessSecondsInput = document.querySelector("#settings-guess-seconds");
  const eliminationNotice = document.querySelector("#elimination-notice");
  const eliminationCopy = document.querySelector("#elimination-copy");
  const dismissElimination = document.querySelector("#dismiss-elimination");

  function stateKey() {
    return "codenames-four-teams:" + seed + ":layout:" + layoutRevision;
  }

  function legacyStateKey() {
    return "codenames-four-teams:" + seed;
  }

  function loadTimerSettings() {
    try {
      const stored = JSON.parse(localStorage.getItem(timerSettingsKey) || "null");
      if (!stored) return { ...DEFAULT_TIMER_SECONDS };
      return {
        prep: validTimerSeconds(stored.prep, DEFAULT_TIMER_SECONDS.prep, 15),
        clue: validTimerSeconds(stored.clue, DEFAULT_TIMER_SECONDS.clue),
        guess: validTimerSeconds(stored.guess, DEFAULT_TIMER_SECONDS.guess)
      };
    } catch {
      localStorage.removeItem(timerSettingsKey);
      return { ...DEFAULT_TIMER_SECONDS };
    }
  }

  function validTimerSeconds(value, fallback, minimum = 5) {
    return Number.isInteger(value) && value >= minimum && value <= 3600 ? value : fallback;
  }

  function saveState() {
    localStorage.setItem(stateKey(), JSON.stringify({
      version: 3,
      revealed: [...revealed],
      currentTeam,
      round,
      eliminatedTeams,
      completionRounds,
      imageRevision,
      layoutRevision
    }));
  }

  function restoreTeamRounds(value) {
    const restored = {};
    for (const team of TEAM_ORDER) {
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
    imageRevision = 0;
    try {
      const stored = JSON.parse(localStorage.getItem(stateKey()) || (layoutRevision === 0 ? localStorage.getItem(legacyStateKey()) : "") || "null");
      if (!stored || ![2, 3].includes(stored.version)) return false;
      if (Array.isArray(stored.revealed)) {
        revealed = new Set(stored.revealed.filter((index) => Number.isInteger(index) && index >= 0 && index < 25));
      }
      completionRounds = restoreTeamRounds(stored.completionRounds);
      eliminatedTeams = restoreTeamRounds(stored.eliminatedTeams);
      if (TEAM_ORDER.includes(stored.currentTeam)) currentTeam = stored.currentTeam;
      if (Number.isInteger(stored.round) && stored.round >= 0) round = stored.round;
      if (Number.isInteger(stored.imageRevision) && stored.imageRevision >= 0) imageRevision = stored.imageRevision;
      return true;
    } catch {
      localStorage.removeItem(stateKey());
      return false;
    }
  }

  function isActive(team) {
    return TEAM_ORDER.includes(team) && !eliminatedTeams[team] && !completionRounds[team];
  }

  function activeTeams() {
    return TEAM_ORDER.filter(isActive);
  }

  function gameIsFinished() {
    return activeTeams().length === 0;
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
    const placements = calculatePlacements(completionRounds, Object.keys(eliminatedTeams));
    teamSwitcher.replaceChildren(...TEAM_ORDER.map((team) => {
      const button = document.createElement("button");
      const remaining = remainingFor(team);
      const isEliminated = Boolean(eliminatedTeams[team]);
      const isComplete = Boolean(completionRounds[team]);
      let status = "剩余 " + remaining + " 张";
      let badge = String(remaining);
      if (isEliminated) {
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
        ? "本局已结束"
        : TEAMS[currentTeam].name;
    roundLabel.textContent = preparing ? "准备阶段" : finished ? "最终结果" : "第 " + round + " 轮";

    if (preparing) {
      phaseInstruction.textContent = "四位队长一起查看答案；队友只看左侧图片。";
    } else if (finished) {
      phaseInstruction.textContent = "所有队伍均已完成或出局，名次已记录。";
    } else if (timerPhase === "clue") {
      phaseInstruction.textContent = TEAMS[currentTeam].name + "队长用“一个词 + 一个数字”给提示；说完即可开始答题。";
    } else if (timerRemaining === 0) {
      phaseInstruction.textContent = TEAMS[currentTeam].name + "答题时间到，请切换下一队。";
    } else {
      phaseInstruction.textContent = TEAMS[currentTeam].name + "正在答题；猜中本队颜色可以继续。";
    }

    startAnsweringButton.disabled = finished || !currentTeam || !isActive(currentTeam) || timerPhase !== "clue";
    startAnsweringButton.querySelector("span").textContent = "+ " + formatTime(timerSettings.guess);
    nextTeamButton.disabled = finished || !currentTeam || !isActive(currentTeam);
    gameCodeLabel.textContent = seed;
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
    const firstTeam = TEAM_ORDER.find(isActive);
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
    return nextActiveTurn(fromTeam, activeTeams(), round);
  }

  function advanceTeam(reason, autoStart = true) {
    if (!currentTeam) {
      startFirstTurn();
      return;
    }
    const next = findNextActive(currentTeam);
    if (!next) {
      currentTeam = null;
      stopTimer(false);
      timerRemaining = 0;
      renderTimer();
      message.textContent = reason + " 所有队伍均已完成或出局，本局结束。";
      saveState();
      renderStatus();
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
    if (!TEAM_ORDER.includes(team) || completionRounds[team] || remainingFor(team) !== 0) return false;
    completionRounds[team] = Math.max(1, round);
    return true;
  }

  function completionMessage(team) {
    const placement = calculatePlacements(completionRounds, Object.keys(eliminatedTeams))[team];
    return TEAMS[team].name + "已在第 " + completionRounds[team] + " 轮找齐 5 张，当前排名 " + ordinal(placement) + "。";
  }

  function revealCard(card) {
    if (revealed.has(card.index)) throw new Error("这张图片已经翻开。");
    if (!canReveal()) throw new Error("请先进入当前队伍的答题阶段。");

    const guessingTeam = currentTeam;
    revealed.add(card.index);
    const targetCompleted = TEAM_ORDER.includes(card.role) && recordCompletion(card.role);

    if (card.role === "black") {
      eliminatedTeams[guessingTeam] = Math.max(1, round);
      stopTimer(false);
      advanceTeam(TEAMS[guessingTeam].name + "翻到黑色并出局。", false);
      const nextCopy = currentTeam
        ? "下一队是" + TEAMS[currentTeam].name + "；关闭提示后开始 " + formatTime(timerSettings.clue) + " 队长思考。"
        : "没有仍在比赛中的队伍。";
      message.textContent = TEAMS[guessingTeam].name + "翻到黑色并出局。" + nextCopy;
      eliminationCopy.textContent = TEAMS[guessingTeam].name + "已被淘汰，之后的回合会自动跳过该队。";
      dismissElimination.textContent = currentTeam ? "开始下一队" : "查看最终结果";
      eliminationNotice.hidden = false;
    } else if (card.role === guessingTeam) {
      if (targetCompleted) {
        const completedCopy = completionMessage(guessingTeam);
        advanceTeam(completedCopy, true);
      } else {
        message.textContent = "答对！" + TEAMS[guessingTeam].name + "可以继续选择。";
      }
    } else if (TEAM_ORDER.includes(card.role)) {
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
    game = buildGame(seed, imageRevision, layoutRevision);
    setGameInUrl(seed, imageRevision, layoutRevision);
    saveState();
    renderBoard();
    renderStatus();
    message.textContent = "表面图片已刷新；25 个位置下方的答案颜色完全不变。";
  }

  function refreshLayout() {
    layoutRevision += 1;
    game = buildGame(seed, imageRevision, layoutRevision);
    revealed = new Set();
    currentTeam = null;
    round = 0;
    eliminatedTeams = {};
    completionRounds = {};
    eliminationNotice.hidden = true;
    setGameInUrl(seed, imageRevision, layoutRevision);
    configureTimer("prep", timerSettings.prep, false);
    saveState();
    renderBoard();
    renderStatus();
    message.textContent = "隐藏颜色已重新分布，图片保持不变；请把新的队长答案链接发给队长。";
  }

  async function copyMasterLink() {
    const url = masterUrl(seed, imageRevision, layoutRevision).href;
    try {
      await navigator.clipboard.writeText(url);
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
    eliminationNotice.hidden = true;
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
    localStorage.setItem(timerSettingsKey, JSON.stringify(timerSettings));
    configureTimer(timerPhase, timerSettings[timerPhase], shouldResume && !gameIsFinished());
    message.textContent = "时间安排已更新：开场 " + formatTime(timerSettings.prep) + "，队长 " + formatTime(timerSettings.clue) + "，答题 " + formatTime(timerSettings.guess) + "。";
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

  function sidebarWidthBounds() {
    return {
      min: 288,
      max: Math.max(288, Math.min(520, window.innerWidth - 520))
    };
  }

  function setSidebarWidth(nextWidth, persist = true) {
    const bounds = sidebarWidthBounds();
    const width = Math.round(Math.min(bounds.max, Math.max(bounds.min, Number(nextWidth) || 352)));
    gameLayout.style.setProperty("--sidebar-width", width + "px");
    sidebarResizer.setAttribute("aria-valuemin", String(bounds.min));
    sidebarResizer.setAttribute("aria-valuemax", String(bounds.max));
    sidebarResizer.setAttribute("aria-valuenow", String(width));
    if (persist) localStorage.setItem(sidebarWidthKey, String(width));
    return width;
  }

  function setupSidebarResize() {
    setSidebarWidth(Number(localStorage.getItem(sidebarWidthKey)) || turnConsole.getBoundingClientRect().width, false);

    sidebarResizer.addEventListener("pointerdown", (event) => {
      if (window.innerWidth <= 900) return;
      event.preventDefault();
      const rightEdge = turnConsole.getBoundingClientRect().right;
      sidebarResizer.setPointerCapture(event.pointerId);
      document.body.classList.add("is-resizing-sidebar");

      const onMove = (moveEvent) => setSidebarWidth(rightEdge - moveEvent.clientX);
      const onEnd = () => {
        document.body.classList.remove("is-resizing-sidebar");
        sidebarResizer.removeEventListener("pointermove", onMove);
        sidebarResizer.removeEventListener("pointerup", onEnd);
        sidebarResizer.removeEventListener("pointercancel", onEnd);
      };

      sidebarResizer.addEventListener("pointermove", onMove);
      sidebarResizer.addEventListener("pointerup", onEnd);
      sidebarResizer.addEventListener("pointercancel", onEnd);
    });

    sidebarResizer.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const bounds = sidebarWidthBounds();
      const current = turnConsole.getBoundingClientRect().width;
      if (event.key === "Home") setSidebarWidth(bounds.min);
      else if (event.key === "End") setSidebarWidth(bounds.max);
      else setSidebarWidth(current + (event.key === "ArrowLeft" ? 20 : -20));
    });

    window.addEventListener("resize", () => setSidebarWidth(turnConsole.getBoundingClientRect().width, false));
  }

  function load(nextSeed, requestedImageRevision = null, requestedLayoutRevision = null) {
    stopTimer(false);
    seed = nextSeed;
    layoutRevision = Number.isInteger(requestedLayoutRevision) && requestedLayoutRevision >= 0 ? requestedLayoutRevision : 0;
    const restored = loadState();
    if (Number.isInteger(requestedImageRevision) && requestedImageRevision >= 0) {
      imageRevision = requestedImageRevision;
    }
    game = buildGame(seed, imageRevision, layoutRevision);
    if (currentTeam && !isActive(currentTeam)) currentTeam = null;
    if (!currentTeam && round > 0 && !gameIsFinished()) currentTeam = activeTeams()[0];
    setGameInUrl(seed, imageRevision, layoutRevision);
    eliminationNotice.hidden = true;
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
  document.querySelector("#timer-settings-defaults").addEventListener("click", () => fillTimerSettingsForm(DEFAULT_TIMER_SECONDS));
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
    applyTimerSettings({
      prep: Number(prepMinutesInput.value) * 60,
      clue: Number(clueSecondsInput.value),
      guess: Number(guessSecondsInput.value)
    }, shouldResume);
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
  window.addEventListener("storage", (event) => {
    if (event.key !== stateKey()) return;
    load(seed, imageRevision, layoutRevision);
  });
  setupSidebarResize();

  registerWebTool({
    name: "reveal_codenames_picture",
    title: "翻开图片",
    description: "按题板上的 1 至 25 编号翻开图片，并应用继续、换队、帮助对方或当前队出局的规则。",
    inputSchema: {
      type: "object",
      properties: { number: { type: "integer", minimum: 1, maximum: 25 } },
      required: ["number"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute(input) {
      if (!Number.isInteger(input?.number) || input.number < 1 || input.number > 25) {
        throw new Error("图片编号必须是 1 到 25 的整数。");
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
        completedTeam: TEAM_ORDER.includes(card.role) && Boolean(completionRounds[card.role]) ? card.role : null
      };
    }
  });

  registerWebTool({
    name: "set_codenames_current_team",
    title: "设置当前队伍",
    description: "由主持人把当前回合切换到仍在比赛中的指定队伍，并启动已设置的队长思考计时。",
    inputSchema: {
      type: "object",
      properties: { team: { type: "string", enum: TEAM_ORDER } },
      required: ["team"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute(input) {
      if (!TEAM_ORDER.includes(input?.team)) throw new Error("队伍必须是 red、yellow、blue 或 green。");
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
    description: "更换全部 25 张表面图片，同时保持每个位置下方的答案颜色不变。",
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
    description: "保持当前 25 张图片不变，生成新的隐藏颜色分布并重置本局进度。",
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
        masterCardUrl: masterUrl(seed, imageRevision, layoutRevision).href
      };
    }
  });

  registerWebTool({
    name: "skip_codenames_timer",
    title: "跳过当前倒计时",
    description: "立即结束当前倒计时：准备阶段进入红队，队长思考进入答题，答题阶段进入下一队。",
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
    title: "设置游戏时间",
    description: "设置开场准备、队长思考和队员答题三个阶段的秒数，并按新设置重置当前阶段。",
    inputSchema: {
      type: "object",
      properties: {
        prepSeconds: { type: "integer", minimum: 15, maximum: 3600 },
        clueSeconds: { type: "integer", minimum: 5, maximum: 3600 },
        guessSeconds: { type: "integer", minimum: 5, maximum: 3600 }
      },
      required: ["prepSeconds", "clueSeconds", "guessSeconds"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute(input) {
      const wasRunning = timerRunning;
      applyTimerSettings({ prep: input?.prepSeconds, clue: input?.clueSeconds, guess: input?.guessSeconds }, wasRunning);
      return { ...timerSettings, timerPhase, timerRemaining };
    }
  });

  load(seed, getImageRevisionFromUrl(), getLayoutRevisionFromUrl());
}

if (view === "start") setupStart();
if (view === "master") setupMaster();
if (view === "play") setupPlay();
