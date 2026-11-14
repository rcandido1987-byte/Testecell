"use strict";

function create(players, onChange) {
  const state = {
    players,
    onChange,
    phase: "coin",
    round: 1,
    target: 3,
    score: [0, 0],
    numbers: [null, null],
    parity: null,
    chooser: Math.random() < 0.5 ? 0 : 1,
    result: null,
    winner: null,
    rematchRequest: null,
    rematchDeclined: false,
    timer: null,
    disposed: false
  };

  state.timer = setTimeout(() => {
    if (state.disposed) return;
    state.phase = "choose";
    changed(state);
    botTurn(state);
  }, 2200);

  return state;
}

function changed(state) {
  if (!state.disposed) state.onChange();
}

function snapshot(state, index) {
  const opponent = state.players[1 - index];

  return {
    phase: state.phase,
    round: state.round,
    target: state.target,
    score: state.score,
    myIndex: index,
    opponent: opponent?.name || "Oponente",
    opponentBot: !!opponent?.bot,
    chooser: state.chooser,
    parity: state.parity,
    myNumber: state.numbers[index],
    opponentReady: state.numbers[1 - index] !== null,
    result: state.result,
    winner: state.winner,
    rematchRequest: state.rematchRequest,
    rematchDeclined: state.rematchDeclined
  };
}

function onAction(state, index, action) {
  if (!action || typeof action !== "object" || state.disposed) return;

  if (action.type === "pick" && state.phase === "choose" && index === state.chooser) {
    if (action.value !== "par" && action.value !== "impar") return;
    state.parity = action.value;
    state.phase = "numbers";
    changed(state);
    botTurn(state);
    return;
  }

  if (action.type === "number" && state.phase === "numbers" && state.numbers[index] === null) {
    const number = Number(action.value);
    if (!Number.isInteger(number) || number < 0 || number > 10) return;

    state.numbers[index] = number;

    if (state.numbers.every((value) => value !== null)) {
      resolveRound(state);
    } else {
      changed(state);
      botTurn(state);
    }
    return;
  }

  if (
    action.type === "rematch" &&
    state.phase === "end" &&
    state.rematchRequest === null &&
    state.target < 7 &&
    index !== state.winner
  ) {
    state.rematchRequest = index;
    changed(state);
    return;
  }

  if (
    action.type === "rematchResponse" &&
    state.phase === "end" &&
    state.rematchRequest !== null &&
    index !== state.rematchRequest
  ) {
    if (action.accept) {
      state.target += 2;
      state.phase = "coin";
      state.round = 1;
      state.score = [0, 0];
      state.numbers = [null, null];
      state.parity = null;
      state.winner = null;
      state.rematchRequest = null;
      state.rematchDeclined = false;
      state.chooser = Math.random() < 0.5 ? 0 : 1;
      state.timer = setTimeout(() => {
        if (state.disposed) return;
        state.phase = "choose";
        changed(state);
        botTurn(state);
      }, 2200);
    } else {
      state.rematchDeclined = true;
    }
    changed(state);
  }
}

function resolveRound(state) {
  const sum = state.numbers[0] + state.numbers[1];
  const result = sum % 2 === 0 ? "par" : "impar";
  const pointFor = result === state.parity ? state.chooser : 1 - state.chooser;

  state.score[pointFor] += 1;
  state.result = {
    numbers: [...state.numbers],
    sum,
    parity: result,
    pointFor
  };
  state.phase = "reveal";

  if (state.score[pointFor] >= state.target) {
    state.winner = pointFor;
  }

  changed(state);

  state.timer = setTimeout(() => {
    if (state.disposed) return;

    if (state.winner !== null) {
      state.phase = "end";
    } else {
      state.round += 1;
      state.chooser = 1 - pointFor;
      state.numbers = [null, null];
      state.parity = null;
      state.phase = "choose";
    }

    changed(state);
    botTurn(state);
  }, 3200);
}

function botTurn(state) {
  if (state.disposed || state.phase === "end" || state.phase === "reveal") return;

  const botIndex = state.players.findIndex((player) => player.bot);
  if (botIndex < 0) return;

  if (state.phase === "choose" && state.chooser === botIndex) {
    setTimeout(() => {
      if (state.phase !== "choose") return;
      state.parity = Math.random() < 0.5 ? "par" : "impar";
      state.phase = "numbers";
      changed(state);
      botTurn(state);
    }, 800);
  } else if (state.phase === "numbers" && state.numbers[botIndex] === null) {
    setTimeout(() => {
      if (state.phase !== "numbers" || state.numbers[botIndex] !== null) return;
      state.numbers[botIndex] = Math.floor(Math.random() * 11);
      if (state.numbers.every((value) => value !== null)) {
        resolveRound(state);
      } else {
        changed(state);
      }
    }, 1000);
  }
}

function dispose(state) {
  if (!state) return;
  state.disposed = true;
  clearTimeout(state.timer);
}

module.exports = { create, snapshot, onAction, dispose };

