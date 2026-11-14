"use strict";

const games = [
  { id: "par-ou-impar", name: "Par ou Ímpar", players: "1 × 1", icon: "◉", color: "#9d7aff", description: "O clássico duelo de números." },
  { id: "forca", name: "Jogo da Forca", players: "1 × 1 · grupo", icon: "⌁", color: "#72e0c0", description: "Descubra a palavra antes das tentativas acabarem." },
  { id: "jokenpo", name: "Jokenpô", players: "1 × 1", icon: "✊", color: "#ffc578", description: "Pedra, papel e tesoura. Escolha sua jogada." },
  { id: "detetive", name: "Detetive", players: "4+ jogadores", icon: "⌕", color: "#82b8ff", description: "Descubra quem está por trás do mistério." },
  { id: "velha", name: "Jogo da Velha", players: "1 × 1", icon: "▦", color: "#ff91a8", description: "Uma disputa rápida de estratégia." },
  { id: "xadrez", name: "Xadrez", players: "1 × 1", icon: "♞", color: "#d8c4ff", description: "Um duelo de estratégia, movimento a movimento." }
];

let playerName = "";
let selectedGame = null;
let toastTimer = null;
let roomSocket = null;
let roomCode = "";
let roomStarted = false;

const byId = (id) => document.getElementById(id);
const params = new URLSearchParams(window.location.search);
const inviteCode = params.get("room") || params.get("sala");
const inviteGameParam = params.get("game") || params.get("jogo");

function setScreen(screen) {
  document.querySelectorAll(".screen").forEach((item) => {
    item.classList.remove("active");
  });

  const target = byId("screen-" + screen);
  if (target) target.classList.add("active");

  const current = screen === "entry" ? 1 : screen === "games" ? 2 : 3;

  ["step-1", "step-2", "step-3"].forEach((id, index) => {
    const step = byId(id);
    if (!step) return;
    step.classList.toggle("active", index + 1 === current);
    step.classList.toggle("done", index + 1 < current);
  });

  const title = byId("hero-title");
  const copy = byId("hero-copy");

  if (!title || !copy) return;

  if (screen === "entry") {
    title.innerHTML = "Sua próxima diversão<br>começa aqui.";
    copy.textContent = "Escolha um nome, encontre seu jogo e chame seus amigos. É só entrar e jogar.";
  } else if (screen === "games") {
    title.textContent = "Escolha sua próxima partida.";
    copy.textContent = "Jogos rápidos para desafiar os amigos ou jogar contra a máquina.";
  } else {
    title.textContent = "Sala do jogo";
    copy.textContent = "Confira quem entrou. A partida começa quando houver jogadores suficientes.";
  }
}

function showToast(message) {
  const toast = byId("toast");
  if (!toast) {
    console.info(message);
    return;
  }

  toast.textContent = message;
  toast.classList.remove("hidden");

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 3000);
}

function renderGames() {
  const grid = byId("games-grid");
  if (!grid) return;

  grid.replaceChildren();

  games.forEach((game) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "game-card";
    card.style.setProperty("--game-color", game.color);
    card.setAttribute("aria-label", game.name + ", " + game.players);

    const icon = document.createElement("span");
    icon.className = "game-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = game.icon;

    const title = document.createElement("span");
    title.className = "game-title";
    title.textContent = game.name;

    const description = document.createElement("span");
    description.className = "game-description";
    description.textContent = game.description;

    const meta = document.createElement("span");
    meta.className = "game-meta";
    meta.textContent = game.players;

    card.append(icon, title, description, meta);
    card.addEventListener("click", () => chooseGame(game));
    grid.appendChild(card);
  });
}

function chooseGame(game) {
  selectedGame = game;

  if (byId("lobby-icon")) {
    byId("lobby-icon").textContent = game.icon;
    byId("lobby-icon").style.setProperty("--game-color", game.color);
  }

  if (byId("selected-title")) {
    byId("selected-title").textContent = game.name;
  }

  if (byId("selected-description")) {
    byId("selected-description").textContent =
      game.description + " · " + game.players;
  }

  byId("public-room")?.classList.add("hidden");
  byId("invite-room")?.classList.add("hidden");
  byId("lobby-options")?.classList.remove("hidden");

  setScreen("lobby");
}

function findGame(value) {
  if (!value) return null;

  const normalized = value.toLocaleLowerCase("pt-BR");

  return games.find((game) =>
    game.id.toLocaleLowerCase("pt-BR") === normalized ||
    game.name.toLocaleLowerCase("pt-BR") === normalized
  ) || null;
}

function buildRoomPanel() {
  const panel = byId("invite-room");
  if (!panel) return;

  panel.replaceChildren();

  const header = document.createElement("div");
  header.className = "room-header";

  const heading = document.createElement("h3");
  heading.textContent = "Sala particular";

  const status = document.createElement("span");
  status.className = "room-status";
  status.id = "room-connection-status";
  status.textContent = "Conectando...";

  header.append(heading, status);

  const players = document.createElement("div");
  players.className = "player-list";
  players.id = "room-players";

  const note = document.createElement("p");
  note.className = "room-note";
  note.id = "room-message";
  note.setAttribute("aria-live", "polite");
  note.textContent = "Aguardando a conexão com a sala.";

  const inviteRow = document.createElement("div");
  inviteRow.className = "invite-row";

  const linkInput = document.createElement("input");
  linkInput.id = "room-invite-link";
  linkInput.readOnly = true;
  linkInput.setAttribute("aria-label", "Link do convite");
  linkInput.placeholder = "O link aparecerá após criar a sala";

  const shareButton = document.createElement("button");
  shareButton.type = "button";
  shareButton.id = "share-whatsapp";
  shareButton.className = "primary";
  shareButton.textContent = "Enviar pelo WhatsApp";
  shareButton.disabled = true;
  shareButton.addEventListener("click", shareWhatsApp);

  inviteRow.append(linkInput, shareButton);

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.id = "copy-room-link";
  copyButton.className = "secondary";
  copyButton.textContent = "Copiar link";
  copyButton.disabled = true;
  copyButton.style.width = "100%";
  copyButton.style.marginTop = "9px";
  copyButton.addEventListener("click", copyInviteLink);

  const startNote = document.createElement("p");
  startNote.className = "room-note";
  startNote.textContent =
    "A partida começa automaticamente quando entrarem jogadores suficientes.";

  panel.append(header, players, note, inviteRow, copyButton, startNote);
}

function makeInviteUrl() {
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set("room", roomCode);
  url.searchParams.set("game", selectedGame.id);
  return url.toString();
}

function shareWhatsApp() {
  if (!roomCode || !selectedGame) {
    showToast("Aguarde a criação da sala para compartilhar o convite.");
    return;
  }

  const url = makeInviteUrl();
  const text =
    "Oi! Vamos jogar " + selectedGame.name +
    "? Entre direto na minha sala pelo link: " + url +
    " (código: " + roomCode + ").";

  window.open(
    "https://wa.me/?text=" + encodeURIComponent(text),
    "_blank",
    "noopener,noreferrer"
  );
}

async function copyInviteLink() {
  const input = byId("room-invite-link");
  if (!input || !input.value) return;

  try {
    await navigator.clipboard.writeText(input.value);
  } catch {
    input.focus();
    input.select();
    document.execCommand("copy");
  }

  showToast("Link do convite copiado.");
}

function updateRoom(message) {
  const room = message.room;
  if (!room) return;

  roomCode = room.code || roomCode;
  roomStarted = Boolean(room.started);

  const players = Array.isArray(room.players) ? room.players : [];
  const me = players.find((player) => player.name === playerName);
  const isHost = Boolean(me && me.host);
  const privateRoom = room.mode === "private";

  const status = byId("room-connection-status");
  const note = byId("room-message");
  const list = byId("room-players");

  if (status) status.textContent = "Conectado";

  if (note) {
    if (roomStarted) {
      note.textContent = "A partida começou.";
    } else if (players.length >= 2) {
      note.textContent = isHost
        ? "Seu convidado entrou. A partida começará automaticamente."
        : "Você entrou na sala. Aguardando o início da partida.";
    } else {
      note.textContent = "Sala criada. Aguardando seu convidado entrar.";
    }
  }

  if (list) {
    list.replaceChildren();

    players.forEach((player) => {
      const chip = document.createElement("span");
      chip.className = "player-chip";

      const avatar = document.createElement("span");
      avatar.className = "avatar";
      avatar.textContent = (player.name || "J").slice(0, 1).toUpperCase();

      const label = document.createElement("span");
      label.textContent =
        (player.name || "Jogador") +
        (player.host ? " · anfitrião" : "") +
        (player.bot ? " · máquina" : "");

      chip.append(avatar, label);
      list.appendChild(chip);
    });
  }

  if (roomCode && privateRoom) {
    const input = byId("room-invite-link");
    const share = byId("share-whatsapp");
    const copy = byId("copy-room-link");

    if (input) input.value = makeInviteUrl();
    if (share) share.disabled = false;
    if (copy) copy.disabled = false;
  }

  if (roomStarted) showToast("A partida foi iniciada.");
}

function sendGameAction(action) {
  if (roomSocket?.readyState === WebSocket.OPEN) {
    roomSocket.send(JSON.stringify({ t: "action", action }));
  }
}

function renderGame(message) {
  const root = byId("game-root");
  const module = window.GameModules?.[message.game];

  if (!root || !module || typeof module.render !== "function") return;

  module.render(root, message.state, sendGameAction);

  const gameScreen = byId("screen-game");
  if (gameScreen) setScreen("game");
}

function connectRoom(mode, code = "") {
  if (!selectedGame) {
    showToast("Não foi possível identificar o jogo deste convite.");
    return;
  }

  if (window.location.protocol === "file:") {
    const status = byId("room-connection-status");
    const note = byId("room-message");
    if (status) status.textContent = "Servidor necessário";
    if (note) {
      note.textContent =
        "Abra o jogo pelo endereço HTTPS publicado para conectar à sala.";
    }
    return;
  }

  if (roomSocket) {
    roomSocket.onclose = null;
    roomSocket.close();
  }

  byId("lobby-options")?.classList.add("hidden");
  byId("public-room")?.classList.add("hidden");
  byId("invite-room")?.classList.remove("hidden");

  if (!byId("room-connection-status")) buildRoomPanel();

  const status = byId("room-connection-status");
  const note = byId("room-message");
  const players = byId("room-players");

  if (status) status.textContent = "Conectando...";
  if (note) note.textContent = "Conectando à sala do jogo...";
  if (players) players.replaceChildren();

  const protocol = window.location.protocol === "https:" ? "wss://" : "ws://";

  try {
    roomSocket = new WebSocket(protocol + window.location.host + "/ws");
  } catch {
    if (status) status.textContent = "Falha na conexão";
    if (note) note.textContent = "Não foi possível conectar ao servidor.";
    return;
  }

  roomSocket.onopen = () => {
    const payload = {
      t: "join",
      name: playerName,
      game: selectedGame.id,
      mode,
      code
    };

    roomSocket.send(JSON.stringify(payload));
  };

  roomSocket.onmessage = (event) => {
    let message;

    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }

    if (message.t === "error") {
      if (status) status.textContent = "Não foi possível entrar";
      if (note) {
        note.textContent = message.message || "O servidor recusou a entrada na sala.";
      }
      return;
    }

    if (message.t === "room") {
      updateRoom(message);
      return;
    }

    if (message.t === "game") {
      renderGame(message);
    }
  };

  roomSocket.onerror = () => {
    if (status) status.textContent = "Falha na conexão";
    if (note) {
      note.textContent = "Confira se o servidor WebSocket está ativo.";
    }
  };

  roomSocket.onclose = () => {
    if (status) status.textContent = "Desconectado";

    if (!roomStarted && note) {
      note.textContent = "A conexão com a sala foi encerrada.";
    }
  };
}

function enterInviteAfterName() {
  const game = findGame(inviteGameParam);
  if (!inviteCode || !game) return false;

  selectedGame = game;

  if (byId("lobby-icon")) {
    byId("lobby-icon").textContent = game.icon;
    byId("lobby-icon").style.setProperty("--game-color", game.color);
  }

  if (byId("selected-title")) {
    byId("selected-title").textContent = game.name;
  }

  if (byId("selected-description")) {
    byId("selected-description").textContent =
      game.description + " · " + game.players;
  }

  setScreen("lobby");
  buildRoomPanel();
  connectRoom("private", inviteCode);
  return true;
}

const nameForm = byId("name-form");

if (nameForm) {
  nameForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const input = byId("player-name");
    const name = input?.value.trim();

    if (!name) {
      if (byId("name-error")) {
        byId("name-error").textContent = "Digite seu nome para continuar.";
      }
      input?.focus();
      return;
    }

    playerName = name.slice(0, 16);

    if (byId("name-error")) byId("name-error").textContent = "";
    if (byId("welcome-name")) byId("welcome-name").textContent = playerName;
    if (byId("lobby-player")) byId("lobby-player").textContent = playerName;

    if (enterInviteAfterName()) return;
    setScreen("games");
  });
}

byId("back-games")?.addEventListener("click", () => {
  if (roomSocket) {
    roomSocket.onclose = null;
    roomSocket.close();
    roomSocket = null;
  }
  setScreen("games");
});

document.querySelectorAll("[data-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    if (!selectedGame) {
      showToast("Selecione um jogo primeiro.");
      return;
    }

    if (!playerName) {
      showToast("Informe seu nome antes de criar ou entrar em uma sala.");
      return;
    }

    const mode = button.dataset.mode;

    if (mode === "public") {
      connectRoom("public");
      return;
    }

    if (mode === "bot") {
      connectRoom("solo");
      return;
    }

    if (mode === "invite") {
      roomCode = "";
      buildRoomPanel();
      connectRoom("private");
    }
  });
});

renderGames();
