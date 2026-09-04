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
const timerPresets = {
  prep: { label: "全体队长思考", seconds: 120 },
  clue: { label: "当前队长思考", seconds: 30 },
  guess: { label: "当前队伍答题", seconds: 60 }
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
  const rawRevision = new URLSearchParams(window.location.search).get("deck");
  if (rawRevision === null || !/^\d+$/.test(rawRevision)) return null;
  return Number(rawRevision);
}

function setGameInUrl(seed, imageRevision = null) {
  const url = new URL(window.location.href);
  url.searchParams.set("game", seed);
  if (Number.isInteger(imageRevision) && imageRevision > 0) {
    url.searchParams.set("deck", String(imageRevision));
  } else {
    url.searchParams.delete("deck");
  }
  window.history.replaceState({}, "", url);
}

function playUrl(seed) {
  const url = new URL("./play.html", window.location.href);
  url.searchParams.set("game", seed);
  url.searchParams.delete("deck");
  return url;
}

function masterUrl(seed) {
  const url = new URL("./index.html", window.location.href);
  url.searchParams.set("game", seed);
  url.searchParams.delete("deck");
  return url;
}

function fillSeedForm(seed) {
  const input = document.querySelector("#game-code");
  if (input) input.value = seed;
}

function wireSeedForm(onSeed) {
  const form = document.querySelector("#seed-form");
  if (!form) return;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = form.querySelector("#game-code");
    const seed = normalizeSeed(input.value);
    if (!seed) {
      input.focus();
      return;
    }
    onSeed(seed);
  });
}

function roleCell(card) {
  const cell = document.createElement("div");
  cell.className = "master-cell role-" + card.role;
  cell.dataset.role = card.role;
  cell.innerHTML = '<span class="cell-coordinate">' + card.coordinate + '</span><strong>' + ROLE_NAMES[card.role] + "</strong>";
  return cell;
}

function setupMaster() {
  let seed = getSeedFromUrl() || createGameCode();
  let game = buildGame(seed);
  let revealed = false;

  const board = document.querySelector("#master-board");
  const codeLabel = document.querySelector("#master-code-label");
  const playLink = document.querySelector("#open-play");
  const masterToggle = document.querySelector("#reveal-master");
  const copyButton = document.querySelector("#copy-link");
  const copyFeedback = document.querySelector("#copy-feedback");

  function render() {
    setGameInUrl(seed);
    fillSeedForm(seed);
    codeLabel.textContent = seed;
    playLink.href = playUrl(seed).href;
    board.replaceChildren(...game.cards.map(roleCell));
    board.classList.toggle("is-hidden", !revealed);
    masterToggle.setAttribute("aria-pressed", String(revealed));
    masterToggle.innerHTML = revealed
      ? '<span aria-hidden="true">◌</span> 隐藏答案'
      : '<span aria-hidden="true">◉</span> 显示答案';
  }

  function load(nextSeed) {
    seed = nextSeed;
    game = buildGame(seed);
    revealed = false;
    copyFeedback.textContent = "";
    render();
  }

  document.querySelector("#new-game").addEventListener("click", () => load(createGameCode()));
  masterToggle.addEventListener("click", () => {
    revealed = !revealed;
    render();
  });
  copyButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(playUrl(seed).href);
      copyFeedback.textContent = "玩家题板链接已复制";
    } catch {
      copyFeedback.textContent = "复制失败，请直接打开玩家题板后复制地址";
    }
  });
  wireSeedForm(load);
  render();

  registerWebTool({
    name: "create_new_codenames_game",
    title: "生成新的代号局",
    description: "生成新的局号、答案卡和对应玩家题板链接，并更新当前页面。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute(input) {
      assertEmptyInput(input);
      load(createGameCode());
      return { gameCode: seed, playerBoardUrl: playUrl(seed).href };
    }
  });
}

function setupPlay() {
  let seed = getSeedFromUrl() || createGameCode();
  let imageRevision = 0;
  let game = buildGame(seed, imageRevision);
  let revealed = new Set();
  let currentTeam = null;
  let round = 0;
  let eliminatedTeams = {};
  let completionRounds = {};
  let timerPhase = "prep";
  let timerRemaining = timerPresets.prep.seconds;
  let timerRunning = false;
  let timerHandle = null;

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
  const startAnsweringButton = document.querySelector("#start-answering");
  const nextTeamButton = document.querySelector("#next-team");
  const fullscreenButton = document.querySelector("#fullscreen");
  const eliminationNotice = document.querySelector("#elimination-notice");
  const eliminationCopy = document.querySelector("#elimination-copy");
  const dismissElimination = document.querySelector("#dismiss-elimination");

  function stateKey() {
    return "codenames-four-teams:" + seed;
  }

  function saveState() {
    localStorage.setItem(stateKey(), JSON.stringify({
      version: 2,
      revealed: [...revealed],
      currentTeam,
      round,
      eliminatedTeams,
      completionRounds,
      imageRevision
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
      const stored = JSON.parse(localStorage.getItem(stateKey()) || "null");
      if (!stored || stored.version !== 2) return false;
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

  function imageSource(imageId) {
    return "./images/cards/card-" + imageId + ".jpg";
  }

  function fallbackImageSource(imageId) {
    return "https://samdemaeyer.github.io/codenames-pictures/images/cards/card-" + imageId + ".jpg";
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

    const image = document.createElement("img");
    image.alt = "图片 " + card.coordinate;
    image.loading = "eager";
    image.src = imageSource(card.imageId);
    image.addEventListener("error", () => {
      if (image.dataset.fallbackUsed) {
        button.classList.add("image-missing");
        return;
      }
      image.dataset.fallbackUsed = "true";
      image.src = fallbackImageSource(card.imageId);
    });

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
    nextTeamButton.disabled = finished || !currentTeam || !isActive(currentTeam);
    document.querySelector("#master-link").href = masterUrl(seed).href;
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
    } else if (timerPhase === "prep" && timerRemaining === timerPresets.prep.seconds) {
      timerToggle.textContent = "开始准备";
    } else {
      timerToggle.textContent = "继续";
    }
    timerToggle.disabled = gameIsFinished() || (timerPhase === "guess" && timerRemaining === 0);
    timer.classList.toggle("is-urgent", timerRemaining <= 10);
  }

  function stopTimer(shouldRender = true) {
    timerRunning = false;
    if (timerHandle) window.clearInterval(timerHandle);
    timerHandle = null;
    if (shouldRender) renderTimer();
  }

  function configureTimer(phase, seconds = timerPresets[phase].seconds, autoStart = false) {
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
    configureTimer("clue", timerPresets.clue.seconds, true);
    message.textContent = "准备时间结束。现在轮到" + TEAMS[currentTeam].name + "，队长有 30 秒思考。";
    saveState();
  }

  function startAnswering() {
    if (!currentTeam || !isActive(currentTeam) || timerPhase !== "clue") {
      throw new Error("只有在当前队长思考阶段才能开始答题。");
    }
    const carriedSeconds = timerRemaining;
    configureTimer("guess", answerTimeWithCarry(carriedSeconds), true);
    message.textContent = TEAMS[currentTeam].name + "开始答题：保留 " + carriedSeconds + " 秒，并增加 1 分钟。";
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
    configureTimer("clue", timerPresets.clue.seconds, autoStart);
    message.textContent = reason + " 现在轮到" + TEAMS[currentTeam].name + "，队长有 30 秒思考。";
    saveState();
  }

  function selectTeam(team) {
    if (!isActive(team)) return;
    currentTeam = team;
    round = Math.max(1, round);
    configureTimer("clue", timerPresets.clue.seconds, true);
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
        ? "下一队是" + TEAMS[currentTeam].name + "；关闭提示后开始 30 秒队长思考。"
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
    game = buildGame(seed, imageRevision);
    setGameInUrl(seed, imageRevision);
    saveState();
    renderBoard();
    renderStatus();
    message.textContent = "表面图片已刷新；25 个位置下方的答案颜色完全不变。";
  }

  function resetGame() {
    revealed = new Set();
    currentTeam = null;
    round = 0;
    eliminatedTeams = {};
    completionRounds = {};
    eliminationNotice.hidden = true;
    configureTimer("prep", timerPresets.prep.seconds, false);
    message.textContent = "本局进度已重置。请开始 2 分钟的全体队长准备时间。";
    saveState();
    renderBoard();
    renderStatus();
  }

  function load(nextSeed, requestedImageRevision = null) {
    stopTimer(false);
    seed = nextSeed;
    const restored = loadState();
    if (Number.isInteger(requestedImageRevision) && requestedImageRevision >= 0) {
      imageRevision = requestedImageRevision;
    }
    game = buildGame(seed, imageRevision);
    if (currentTeam && !isActive(currentTeam)) currentTeam = null;
    if (!currentTeam && round > 0 && !gameIsFinished()) currentTeam = activeTeams()[0];
    setGameInUrl(seed, imageRevision);
    fillSeedForm(seed);
    eliminationNotice.hidden = true;
    if (currentTeam) {
      configureTimer("clue", timerPresets.clue.seconds, false);
      message.textContent = "已恢复本局进度。当前为" + TEAMS[currentTeam].name + "，请继续队长思考计时。";
    } else {
      configureTimer("prep", timerPresets.prep.seconds, false);
      message.textContent = restored && gameIsFinished()
        ? "已恢复最终结果。"
        : "先开始 2 分钟的全体队长准备时间。";
    }
    renderBoard();
    renderStatus();
  }

  startAnsweringButton.addEventListener("click", () => startAnswering());
  nextTeamButton.addEventListener("click", () => advanceTeam("主持人结束了当前回合。", true));
  document.querySelector("#refresh-images").addEventListener("click", refreshImages);
  timerToggle.addEventListener("click", () => timerRunning ? stopTimer() : startTimer());
  document.querySelector("#timer-reset").addEventListener("click", () => {
    configureTimer(timerPhase, timerPresets[timerPhase].seconds, false);
    message.textContent = timerPresets[timerPhase].label + "已重新计时。";
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
  wireSeedForm((nextSeed) => load(nextSeed));
  window.addEventListener("storage", (event) => {
    if (event.key !== stateKey()) return;
    load(seed);
  });

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
    description: "由主持人把当前回合切换到仍在比赛中的指定队伍，并启动 30 秒队长思考计时。",
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
    description: "结束当前队长思考阶段，把剩余秒数与 60 秒相加，并立即开始队伍答题计时。",
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
    description: "结束当前回合，跳过已完成或出局的队伍，并为下一队启动 30 秒队长思考计时。",
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

  load(seed, getImageRevisionFromUrl());
}

if (view === "master") setupMaster();
if (view === "play") setupPlay();
