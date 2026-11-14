"use strict";

const games = [
  {
    name: "Par ou Ímpar",
    players: "1x1",
    icon: "🪙",
    description: "Desafie outro jogador neste clássico."
  },
  {
    name: "Jokenpô",
    players: "2 a 6 jogadores",
    icon: "✊",
    description: "Pedra, papel e tesoura em grupo."
  },
  {
    name: "Detetive",
    players: "8 a 10 jogadores",
    icon: "🕵️",
    description: "Investigue e descubra o mistério."
  },
  {
    name: "Jogo da Forca",
    players: "1 a 4 jogadores",
    icon: "🔤",
    description: "Adivinhe a palavra antes que o tempo acabe."
  },
  {
    name: "Stop",
    players: "2 a 10 jogadores",
    icon: "📝",
    description: "Pense rápido e complete as categorias."
  }
];

const nameScreen = document.getElementById("name-screen");
const gamesScreen = document.getElementById("games-screen");
const nameInput = document.getElementById("player-name");
const welcomeName = document.getElementById("welcome-name");
const gameList = document.getElementById("game-list");
const chooseButton = document.getElementById("choose-game");
const selectionMessage = document.getElementById("selection-message");

let playerName = "";
let selectedGame = "";

function renderGames() {
  games.forEach((game) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "game-card";
    card.dataset.game = game.name;

    const icon = document.createElement("span");
    icon.className = "game-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = game.icon;

    const title = document.createElement("h3");
    title.textContent = game.name;

    const players = document.createElement("p");
    players.className = "players";
    players.textContent = game.players;

    const description = document.createElement("p");
    description.className = "description";
    description.textContent = game.description;

    card.append(icon, title, players, description);
    card.addEventListener("click", () => selectGame(game.name, card));

    gameList.appendChild(card);
  });
}

function selectGame(name, selectedCard) {
  document.querySelectorAll(".game-card").forEach((card) => {
    card.classList.remove("selected");
  });

  selectedCard.classList.add("selected");
  selectedGame = name;
  chooseButton.disabled = false;
  chooseButton.textContent = "Continuar com " + name;
  selectionMessage.classList.add("hidden");
}

document.getElementById("name-form").addEventListener("submit", (event) => {
  event.preventDefault();

  playerName = nameInput.value.trim();

  if (!playerName) {
    nameInput.focus();
    return;
  }

  welcomeName.textContent = playerName;
  nameScreen.classList.add("hidden");
  gamesScreen.classList.remove("hidden");
});

document.getElementById("change-name").addEventListener("click", () => {
  gamesScreen.classList.add("hidden");
  nameScreen.classList.remove("hidden");
  nameInput.focus();
});

chooseButton.addEventListener("click", () => {
  if (!selectedGame) return;

  selectionMessage.textContent =
    selectedGame + " foi selecionado. A dinâmica desse jogo será adicionada depois.";

  selectionMessage.classList.remove("hidden");
});

renderGames();
