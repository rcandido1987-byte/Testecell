"use strict";

const GAMES = [
  { id: "par-ou-impar", name: "Par ou Ímpar", capacity: "2 jogadores", ready: true },
  { id: "forca", name: "Jogo da Forca", capacity: "2 a 4 jogadores", ready: false },
  { id: "jokenpo", name: "Jokenpô", capacity: "2 a 6 jogadores", ready: false },
  { id: "detetive", name: "Detetive", capacity: "4 a 10 jogadores", ready: false },
  { id: "velha", name: "Jogo da Velha", capacity: "2 jogadores", ready: false },
  { id: "xadrez", name: "Xadrez", capacity: "2 jogadores", ready: false }
];

const $ = (id) => document.getElementById(id);

let socket = null;
let playerName = "";
let selectedGame = null;
let currentRoom = null;
let currentGameState = null;
let gameActionHandler = null;
let toastTimer = null;

function showScreen(id) {
  ["entry-screen", "menu-screen", "lobby-screen", "game-screen"].forEach((screenId) => {
    $(screenId).classList.toggle("hidden", screenId !== id);
  });
}

function setConnection(connected, text) {
  $("connection-label").textContent = text;
  $("connection-dot").style.background = connected ? "#86efac" : "#fda4af";
  $("game-connection-label").textContent = connected ? "Conectado" : "Desconectado";
}

function showError(message, target = "lobby-error") {
  const element = $(target);
  if (element) element.textContent = message || "";
}

function send(message) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    showError("Sem conexão com o servidor. Atualize a página e tente novamente.");
    return false;
  }

  socket.send(JSON.stringify(message));
  return true;
}

function connect() {
  const protocol = location.protocol === "https:" ? "wss://" : "ws://";

  try {
    socket = new WebSocket(protocol + location.host + "/ws");
  } catch {
    setConnection(false, "Falha na conexão");
    return;
  }

  window.gameSocket = socket;

  socket.addEventListener("open", () => {
    setConnection(true, "Conectado");
  });

  socket.addEventListener("message", (event) => {
    let message;

    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }

    if (message.t === "error") {
      const target = $("entry-screen").classList.contains("hidden")
        ? "lobby-error"
        : "entry-error";
      showError(message.message, target);
      return;
    }

    if (message.t === "room") {
      currentRoom = message.room;
      renderRoom();
      return;
    }

    if (message.t === "game") {
      currentGameState = message.state;
      renderGame(message.game, message.state);
    }
  });

  socket.addEventListener("close", () => {
    setConnection(false, "Desconectado");
    if (currentRoom) {
      showError("A conexão com a sala foi encerrada. Atualize a página para voltar a jogar.");
    }
  });

  socket.addEventListener("error", () => {
    setConnection(false, "Falha na conexão");
  });
}

function renderCatalog() {
  const grid = $("game-grid");
  grid.replaceChildren();

  GAMES.forEach((game) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "game-card";
    card.dataset.game = game.id;
    card.setAttribute("aria-label", game.name + ", " + game.capacity);

    const icon = document.createElement("span");
    icon.className = "game-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = {
      "par-ou-impar": "🪙",
      forca: "🔤",
      jokenpo: "✊",
      detetive: "🕵️",
      velha: "▦",
      xadrez: "♞"
    }[game.id];

    const details = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = game.name;

    const capacity = document.createElement("p");
    capacity.className = "game-capacity";
    capacity.textContent = game.capacity;

    const description = document.createElement("p");
    description.textContent = game.ready
      ? "Partida online disponível."
      : "Módulo em preparação.";

    details.append(title, capacity, description);
    card.append(icon, details);

    if (!game.ready) {
      card.disabled = true;
      card.title = "Este jogo ainda está em preparação.";
    } else {
      card.addEventListener("click", () => chooseGame(game));
    }

    grid.appendChild(card);
  });
}

function chooseGame(game) {
  selectedGame = game;
  $("lobby-title").textContent = game.name;
  $("lobby-capacity").textContent = "Lotação: " + game.capacity;
  $("lobby-error").textContent = "";
  $("room-panel").classList.add("hidden");
  $("join-code-form").classList.remove("hidden");
  showScreen("lobby-screen");
}

function displayName() {
  const value = $("player-name").value.trim().replace(/\s+/g, " ").slice(0, 16);

  if (!value) {
    showError("Digite seu nome para continuar.", "entry-error");
    $("player-name").focus();
    return "";
  }

  return value;
}

function enterSelectedMode(mode, code = "") {
  if (!selectedGame) {
    showError("Selecione um jogo primeiro.");
    return;
  }

  if (!selectedGame.ready) {
    showError("Este jogo ainda está em preparação.");
    return;
  }

  if (!playerName) {
    playerName = displayName();
    if (!playerName) return;
  }

  $("lobby-error").textContent = "";
  $("room-panel").classList.remove("hidden");

  send({
    t: "join",
    name: playerName,
    game: selectedGame.id,
    mode,
    code
  });
}

function renderRoom() {
  if (!currentRoom) return;

  const game = GAMES.find((item) => item.id === currentRoom.game);
  if (game) selectedGame = game;

  $("room-panel").classList.remove("hidden");
  $("join-code-form").classList.toggle("hidden", currentRoom.mode === "solo");
  $("room-mode-label").textContent =
    currentRoom.mode === "private" ? "Sala privada" :
    currentRoom.mode === "solo" ? "Contra a máquina" : "Sala pública";

  $("room-status").textContent = currentRoom.started
    ? "Partida iniciada."
    : "Jogadores: " + currentRoom.players.length + "/" + currentRoom.max +
      " · mínimo para iniciar: " + currentRoom.min + ".";

  $("room-info").classList.remove("hidden");
  $("room-info").replaceChildren();

  const codeLine = document.createElement("p");
  codeLine.textContent = "Código da sala: " + currentRoom.code;

  const link = document.createElement("a");
  const inviteUrl = new URL(location.href);
  inviteUrl.searchParams.set("room", currentRoom.code);
  inviteUrl.searchParams.set("game", currentRoom.game);
  link.href = inviteUrl.toString();
  link.textContent = "Abrir link de convite";
  link.target = "_blank";
  link.rel = "noopener noreferrer";

  $("room-info").append(codeLine, link);

  const list = $("players-list");
  list.replaceChildren();

  currentRoom.players.forEach((player) => {
    const row = document.createElement("div");
    row.className = "player-row";
    row.textContent = player.name +
      (player.host ? " · anfitrião" : "") +
      (player.bot ? " · máquina" : "");
    list.appendChild(row);
  });

  const myPlayer = currentRoom.players.find((player) => player.name === playerName && !player.bot);
  const isHost = !!myPlayer?.host;
  const needsBot = currentRoom.players.length < currentRoom.min;
  const canFillBots = currentRoom.game === "par-ou-impar" && isHost && needsBot && !currentRoom.started;

  $("complete-bots-button").classList.toggle("hidden", !canFillBots);
  $("share-button").classList.toggle("hidden", currentRoom.mode !== "private");
  $("leave-room-button").classList.remove("hidden");

  showScreen(currentRoom.started ? "game-screen" : "lobby-screen");
}

function renderGame(gameId, state) {
  const module = window.GameModules && window.GameModules[gameId];
  const root = $("game-root");

  if (!module || typeof module.render !== "function") {
    root.textContent = "A interface deste jogo ainda está em preparação.";
    showScreen("game-screen");
    return;
  }

  gameActionHandler = (action) => send({ t: "action", action });
  module.render(root, state, gameActionHandler);
  showScreen("game-screen");
}

async function shareInvite() {
  if (!currentRoom) return;

  const inviteUrl = new URL(location.href);
  inviteUrl.searchParams.set("room", currentRoom.code);
  inviteUrl.searchParams.set("game", currentRoom.game);

  const message = "Vamos jogar " +
    (GAMES.find((game) => game.id === currentRoom.game)?.name || currentRoom.game) +
    "? Entre na minha sala: " + inviteUrl.toString() +
    " (código: " + currentRoom.code + ")";

  try {
    if (navigator.share) {
      await navigator.share({
        title: "Convite para jogar",
        text: message,
        url: inviteUrl.toString()
      });
      return;
    }
  } catch (error) {
    if (error && error.name === "AbortError") return;
  }

  window.open(
    "https://wa.me/?text=" + encodeURIComponent(message),
    "_blank",
    "noopener,noreferrer"
  );
}

$("entry-form").addEventListener("submit", (event) => {
  event.preventDefault();

  playerName = displayName();
  if (!playerName) return;

  $("entry-error").textContent = "";
  $("welcome-name").textContent = playerName;

  const params = new URLSearchParams(location.search);
  const roomCode = params.get("room");
  const invitedGameId = params.get("game");

  if (roomCode && invitedGameId) {
    const invitedGame = GAMES.find((game) => game.id === invitedGameId);

    if (!invitedGame || !invitedGame.ready) {
      showError("Este convite não corresponde a um jogo disponível.", "entry-error");
      return;
    }

    selectedGame = invitedGame;
    $("lobby-title").textContent = invitedGame.name;
    $("lobby-capacity").textContent = "Lotação: " + invitedGame.capacity;
    showScreen("lobby-screen");
    enterSelectedMode("private", roomCode);
    return;
  }

  showScreen("menu-screen");
});

$("change-name").addEventListener("click", () => {
  showScreen("entry-screen");
  $("player-name").focus();
});

$("public-button").addEventListener("click", () => enterSelectedMode("public"));
$("solo-button").addEventListener("click", () => enterSelectedMode("solo"));
$("private-button").addEventListener("click", () => enterSelectedMode("private"));

$("join-code-form").addEventListener("submit", (event) => {
  event.preventDefault();

  const code = $("room-code-input").value.trim().toUpperCase();
  if (!code) {
    $("room-code-input").focus();
    showError("Digite o código da sala.");
    return;
  }

  enterSelectedMode("private", code);
});

$("complete-bots-button").addEventListener("click", () => {
  send({ t: "completeBots" });
});

$("share-button").addEventListener("click", shareInvite);

function leaveRoomAndReturn() {
  send({ t: "leave" });
  currentRoom = null;
  currentGameState = null;
  gameActionHandler = null;
  $("room-panel").classList.add("hidden");
  $("lobby-error").textContent = "";
  showScreen("menu-screen");
}

$("back-menu").addEventListener("click", () => {
  if (currentRoom) {
    leaveRoomAndReturn();
    return;
  }

  showScreen("menu-screen");
});

$("leave-room-button").addEventListener("click", leaveRoomAndReturn);
$("leave-game-button").addEventListener("click", leaveRoomAndReturn);

window.GameModules = window.GameModules || {};
renderCatalog();
connect();
