
"use strict";

const GAMES = [
  { id: "par-ou-impar", name: "Par ou Ímpar", capacity: "1x1", ready: true },
  { id: "forca", name: "Jogo da Forca", capacity: "1x1 ou multiplayer", ready: false },
  { id: "jokenpo", name: "Jokenpô", capacity: "1x1", ready: false },
  { id: "detetive", name: "Detetive", capacity: "4 a 10 jogadores", ready: false },
  { id: "velha", name: "Jogo da Velha", capacity: "1x1", ready: false },
  { id: "xadrez", name: "Xadrez", capacity: "1x1", ready: false }
];

const $ = (id) => document.getElementById(id);
let socket;
let playerName = "";
let selectedGame = null;
let currentRoom = null;
let currentGameModule = null;
let currentGameState = null;
let reconnectTimer;

function showScreen(id) {
  ["entry-screen", "menu-screen", "lobby-screen", "game-screen"].forEach((screen) => {
    $(screen).classList.toggle("hidden", screen !== id);
  });
}

function connect() {
  const protocol = location.protocol === "https:" ? "wss://" : "ws://";
  socket = new WebSocket(protocol + location.host + "/ws");

  socket.onopen = () => {
    clearTimeout(reconnectTimer);
    const room = new URLSearchParams(location.search).get("room");
    const game = new URLSearchParams(location.search).get("game");
    if (room && game && GAMES.some((item) => item.id === game)) {
      selectedGame = GAMES.find((item) => item.id === game);
      showScreen("entry-screen");
      $("entry-error").textContent = "Convite detectado. Informe seu nome para entrar direto na sala.";
    }
  };

  window.gameSocket = socket;
  socket.onmessage = (event) => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }

    if (message.t === "error") {
      $("entry-error").textContent = message.message;
      $("lobby-error").textContent = message.message;
    } else if (message.t === "room") {
      currentRoom = message.room;
      renderRoom();
    } else if (message.t === "game") {
      currentGameState = message.state;
      currentGameModule = window.GameModules[message.game] || null;
      if (currentGameModule) currentGameModule.render(currentGameState);
      showScreen("game-screen");
    }
  };

  socket.onclose = () => {
    reconnectTimer = setTimeout(connect, 1500);
  };
}

function send(message) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function renderCatalog() {
  const grid = $("game-grid");

  GAMES.forEach((game) => {
    const button = document.createElement("button");
    button.className = "game-card";
    button.type = "button";
    button.innerHTML = "<h3>" + game.name + "</h3><p>" + game.capacity +
      (game.ready ? " · disponível" : " · módulo em preparação") + "</p>";

    button.addEventListener("click", () => {
      selectedGame = game;
      $("lobby-title").textContent = game.name;
      $("lobby-capacity").textContent = "Lotação: " + game.capacity;
      $("lobby-error").textContent = "";
      showScreen("lobby-screen");
    });

    grid.appendChild(button);
  });
}

function renderRoom() {
  if (!currentRoom) return;
  $("lobby-title").textContent = GAMES.find((game) => game.id === currentRoom.game)?.name || currentRoom.game;
  $("room-info").classList.remove("hidden");

  const inviteUrl = new URL(location.href);
  inviteUrl.searchParams.set("room", currentRoom.code);
  inviteUrl.searchParams.set("game", currentRoom.game);

  $("room-info").innerHTML =
    "<strong>" + (currentRoom.mode === "private" ? "Sala privada" : "Sala pública") +
    "</strong><br>Código: <b>" + currentRoom.code +
    "</b><br><a href=\"" + inviteUrl.toString() + "\">Link de convite direto</a>";

  $("players-list").replaceChildren();
  currentRoom.players.forEach((player) => {
    const row = document.createElement("div");
    row.className = "player-row";
    row.textContent = player.name + (player.bot ? " · NPC" : "");
    $("players-list").appendChild(row);
  });

  if (currentRoom.started) showScreen("game-screen");
}

$("enter-button").addEventListener("click", () => {
  playerName = $("player-name").value.trim();
  if (!playerName) {
    $("entry-error").textContent = "Digite seu nome.";
    return;
  }

  $("entry-error").textContent = "";
  $("local-games").textContent = localStorage.getItem("local-games-played") || "0";

  const params = new URLSearchParams(location.search);
  const room = params.get("room");
  const invitedGame = params.get("game");

  if (room && invitedGame) {
    selectedGame = GAMES.find((game) => game.id === invitedGame);
    if (!selectedGame) {
      $("entry-error").textContent = "Este convite não corresponde a um jogo disponível.";
      return;
    }
    send({ t: "join", name: playerName, game: selectedGame.id, mode: "private", code: room });
    return;
  }

  showScreen("menu-screen");
});

$("public-button").addEventListener("click", () => {
  if (!selectedGame) return;
  if (!selectedGame.ready) {
    $("lobby-error").textContent = "O módulo deste jogo ainda está em preparação.";
    return;
  }
  send({ t: "join", name: playerName, game: selectedGame.id, mode: "public" });
});

$("solo-button").addEventListener("click", () => {
  if (!selectedGame) return;
  if (!selectedGame.ready) {
    $("lobby-error").textContent = "A IA deste jogo ainda está em preparação.";
    return;
  }
  send({ t: "join", name: playerName, game: selectedGame.id, mode: "solo" });
});

$("private-button").addEventListener("click", () => {
  if (!selectedGame) return;
  if (!selectedGame.ready) {
    $("lobby-error").textContent = "O módulo deste jogo ainda está em preparação.";
    return;
  }
  send({ t: "join", name: playerName, game: selectedGame.id, mode: "private" });
});

$("back-menu").addEventListener("click", () => showScreen("menu-screen"));

$("leave-button").addEventListener("click", () => {
  send({ t: "leave" });
  currentRoom = null;
  currentGameModule = null;
  currentGameState = null;
  showScreen("menu-screen");
});

window.GameModules = window.GameModules || {};
window.GameModules["par-ou-impar"] = window.ParOuImparClient;

renderCatalog();
connect();
