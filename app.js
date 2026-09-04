import {
  ROLE_NAMES,
  TEAM_ORDER,
  TEAMS,
  buildGame,
  createGameCode,
  nextTeam,
  normalizeSeed
} from "./game-core.js";

const view = document.body.dataset.view;
const timerPresets = {
  prep: { label: "开局思考", seconds: 120 },
  clue: { label: "队长思考", seconds: 30 },
  guess: { label: "队员作答", seconds: 60 }
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

function setSeedInUrl(seed) {
  const url = new URL(window.location.href);
  url.searchParams.set("game", seed);
  window.history.replaceState({}, "", url);
}

function playUrl(seed) {
  const url = new URL("./play.html", window.location.href);
  url.searchParams.set("game", seed);
  return url;
}

function masterUrl(seed) {
  const url = new URL("./index.html", window.location.href);
  url.searchParams.set("game", seed);
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
    setSeedInUrl(seed);
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
  let game = buildGame(seed);
  let revealed = new Set();
  let currentTeam = "red";
  let gameEnded = false;
  let timerPhase = "prep";
  let timerRemaining = timerPresets.prep.seconds;
  let timerRunning = false;
  let timerHandle = null;

  const board = document.querySelector("#game-board");
  const teamSwitcher = document.querySelector("#team-switcher");
  const scoreStrip = document.querySelector("#score-strip");
  const message = document.querySelector("#game-message");
  const timerPhaseLabel = document.querySelector("#timer-phase");
  const timerDisplay = document.querySelector("#timer-display");
  const timerToggle = document.querySelector("#timer-toggle");
  const gameOver = document.querySelector("#game-over");
  const gameOverCopy = document.querySelector("#game-over-copy");

  function stateKey() {
    return "codenames-four-teams:" + seed;
  }

  function saveState() {
    localStorage.setItem(stateKey(), JSON.stringify({
      revealed: [...revealed],
      currentTeam,
      gameEnded
    }));
  }

  function loadState() {
    revealed = new Set();
    currentTeam = "red";
    gameEnded = false;
    try {
      const stored = JSON.parse(localStorage.getItem(stateKey()) || "null");
      if (stored && Array.isArray(stored.revealed)) {
        revealed = new Set(stored.revealed.filter((index) => Number.isInteger(index) && index >= 0 && index < 25));
      }
      if (stored && TEAM_ORDER.includes(stored.currentTeam)) currentTeam = stored.currentTeam;
      if (stored) gameEnded = Boolean(stored.gameEnded);
    } catch {
      localStorage.removeItem(stateKey());
    }
  }

  function imageSource(imageId) {
    return "./images/cards/card-" + imageId + ".jpg";
  }

  function fallbackImageSource(imageId) {
    return "https://samdemaeyer.github.io/codenames-pictures/images/cards/card-" + imageId + ".jpg";
  }

  function createCard(card) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "picture-card";
    button.dataset.index = String(card.index);
    button.dataset.role = card.role;
    button.setAttribute("aria-label", card.coordinate + (revealed.has(card.index) ? "，已翻开：" + ROLE_NAMES[card.role] : "，未翻开"));

    const image = document.createElement("img");
    image.alt = "图片 " + card.coordinate;
    image.loading = card.index < 10 ? "eager" : "lazy";
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
    button.classList.toggle("is-revealed", revealed.has(card.index));
    button.disabled = revealed.has(card.index) || gameEnded;
    button.addEventListener("click", () => revealCard(card));
    return button;
  }

  function remainingFor(team) {
    return game.cards.filter((card) => card.role === team && !revealed.has(card.index)).length;
  }

  function renderTeams() {
    teamSwitcher.replaceChildren(...TEAM_ORDER.map((team) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "team-chip team-" + team;
      button.dataset.team = team;
      button.setAttribute("aria-pressed", String(team === currentTeam));
      button.innerHTML = "<span>" + TEAMS[team].short + "</span>" + TEAMS[team].name;
      button.addEventListener("click", () => {
        currentTeam = team;
        setTimer("clue", true);
        message.textContent = "主持人已将回合切换到" + TEAMS[team].name + "。";
        saveState();
        renderStatus();
      });
      return button;
    }));
  }

  function renderScores() {
    scoreStrip.replaceChildren(...TEAM_ORDER.map((team) => {
      const item = document.createElement("div");
      const remaining = remainingFor(team);
      item.className = "score-item team-" + team + (remaining === 0 ? " is-complete" : "");
      item.innerHTML = '<span class="score-team">' + TEAMS[team].name + '</span><strong>' + remaining + '</strong><small>张待找</small>';
      return item;
    }));
  }

  function renderStatus() {
    document.querySelector("#turn-console").dataset.team = currentTeam;
    renderTeams();
    renderScores();
    document.querySelector("#master-link").href = masterUrl(seed).href;
  }

  function renderBoard() {
    board.replaceChildren(...game.cards.map(createCard));
  }

  function announceTeamCompletion(team) {
    if (remainingFor(team) === 0) {
      message.textContent = TEAMS[team].name + "已找齐 5 张！请让本轮其他队完成后判定是否平手。";
      return true;
    }
    return false;
  }

  function advanceTeam(reason) {
    currentTeam = nextTeam(currentTeam);
    setTimer("clue", true);
    message.textContent = reason + " 现在轮到" + TEAMS[currentTeam].name + "，队长有 30 秒思考。";
    saveState();
    renderStatus();
  }

  function revealCard(card) {
    if (revealed.has(card.index) || gameEnded) return;
    const guessingTeam = currentTeam;
    revealed.add(card.index);

    if (card.role === "black") {
      gameEnded = true;
      stopTimer();
      message.textContent = TEAMS[guessingTeam].name + "翻到黑色，游戏结束。";
      gameOverCopy.textContent = TEAMS[guessingTeam].name + "触发了刺客牌。";
      gameOver.hidden = false;
    } else if (card.role === guessingTeam) {
      if (!announceTeamCompletion(guessingTeam)) {
        message.textContent = "答对！" + TEAMS[guessingTeam].name + "可以继续选择。";
      }
    } else if (TEAM_ORDER.includes(card.role)) {
      advanceTeam("翻到了" + TEAMS[card.role].name + "的图片，已替对方翻面。");
    } else {
      advanceTeam("翻到白色，本回合结束。");
    }

    saveState();
    renderBoard();
    renderStatus();
  }

  function formatTime(seconds) {
    const mins = Math.floor(seconds / 60).toString().padStart(2, "0");
    const secs = (seconds % 60).toString().padStart(2, "0");
    return mins + ":" + secs;
  }

  function renderTimer() {
    timerPhaseLabel.textContent = timerPresets[timerPhase].label;
    timerDisplay.textContent = formatTime(timerRemaining);
    timerToggle.textContent = timerRunning ? "暂停" : "开始";
    document.querySelector(".timer").classList.toggle("is-urgent", timerRemaining <= 10);
  }

  function stopTimer() {
    timerRunning = false;
    if (timerHandle) window.clearInterval(timerHandle);
    timerHandle = null;
    renderTimer();
  }

  function startTimer() {
    if (timerRunning || gameEnded) return;
    timerRunning = true;
    timerHandle = window.setInterval(() => {
      timerRemaining -= 1;
      if (timerRemaining <= 0) {
        timerRemaining = 0;
        stopTimer();
        if (timerPhase === "prep" || timerPhase === "clue") {
          setTimer("guess", true);
          message.textContent = TEAMS[currentTeam].name + "队员开始作答，限时 1 分钟。";
        } else {
          message.textContent = TEAMS[currentTeam].name + "答题时间到，主持人可切换下一队伍。";
        }
      }
      renderTimer();
    }, 1000);
    renderTimer();
  }

  function setTimer(phase, autoStart = false) {
    stopTimer();
    timerPhase = phase;
    timerRemaining = timerPresets[phase].seconds;
    renderTimer();
    if (autoStart) startTimer();
  }

  function load(nextSeed) {
    stopTimer();
    seed = nextSeed;
    game = buildGame(seed);
    setSeedInUrl(seed);
    fillSeedForm(seed);
    loadState();
    setTimer("prep");
    gameOver.hidden = true;
    message.textContent = "新题板已载入。开局时队长有 2 分钟思考时间。";
    renderBoard();
    renderStatus();
  }

  document.querySelector("#next-team").addEventListener("click", () => advanceTeam("主持人结束了当前回合。"));
  document.querySelector("#timer-toggle").addEventListener("click", () => timerRunning ? stopTimer() : startTimer());
  document.querySelector("#timer-reset").addEventListener("click", () => setTimer(timerPhase));
  document.querySelector("#fullscreen").addEventListener("click", async () => {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
  });
  document.querySelector("#reset-board").addEventListener("click", () => {
    if (!window.confirm("确定要清除这局所有已翻开的图片吗？")) return;
    revealed = new Set();
    currentTeam = "red";
    gameEnded = false;
    gameOver.hidden = true;
    setTimer("prep");
    message.textContent = "本局揭牌记录已重置。";
    saveState();
    renderBoard();
    renderStatus();
  });
  document.querySelector("#dismiss-game-over").addEventListener("click", () => {
    gameOver.hidden = true;
  });
  wireSeedForm(load);
  window.addEventListener("storage", (event) => {
    if (event.key !== stateKey()) return;
    loadState();
    renderBoard();
    renderStatus();
  });

  registerWebTool({
    name: "reveal_codenames_picture",
    title: "翻开图片",
    description: "按题板坐标翻开一张图片，并应用继续作答、换队或游戏结束规则。",
    inputSchema: {
      type: "object",
      properties: { coordinate: { type: "string", pattern: "^[A-Ea-e][1-5]$" } },
      required: ["coordinate"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute(input) {
      const coordinate = String(input?.coordinate || "").toUpperCase();
      const card = game.cards.find((item) => item.coordinate === coordinate);
      if (!card) throw new Error("坐标必须是 A1 到 E5。");
      if (revealed.has(card.index)) throw new Error("这张图片已经翻开。");
      if (gameEnded) throw new Error("游戏已经结束。");
      const previousTeam = currentTeam;
      revealCard(card);
      return { coordinate, color: card.role, previousTeam, currentTeam, gameEnded };
    }
  });

  registerWebTool({
    name: "set_codenames_current_team",
    title: "设置当前队伍",
    description: "由主持人把当前回合切换到指定队伍，并启动 30 秒队长思考计时。",
    inputSchema: {
      type: "object",
      properties: { team: { type: "string", enum: TEAM_ORDER } },
      required: ["team"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute(input) {
      if (!TEAM_ORDER.includes(input?.team)) throw new Error("队伍必须是 red、yellow、blue 或 green。");
      currentTeam = input.team;
      setTimer("clue", true);
      message.textContent = "主持人已将回合切换到" + TEAMS[currentTeam].name + "。";
      saveState();
      renderStatus();
      return { currentTeam, timerPhase, timerRemaining };
    }
  });

  registerWebTool({
    name: "advance_codenames_turn",
    title: "切换下一队伍",
    description: "结束当前回合，按红、黄、蓝、绿的顺序切换到下一队并启动队长思考计时。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute(input) {
      assertEmptyInput(input);
      advanceTeam("主持人结束了当前回合。");
      return { currentTeam, timerPhase, timerRemaining };
    }
  });

  load(seed);
}

if (view === "master") setupMaster();
if (view === "play") setupPlay();
