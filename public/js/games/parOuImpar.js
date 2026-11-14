"use strict";

window.GameModules = window.GameModules || {};

window.GameModules["par-ou-impar"] = {
  render(root, state, sendAction) {
    root.replaceChildren();

    const title = document.createElement("h2");
    title.textContent = "Par ou Ímpar";
    root.appendChild(title);

    const score = document.createElement("p");
    score.className = "game-score";
    score.textContent =
      "Você " + state.score[state.myIndex] +
      " × " + state.score[1 - state.myIndex] +
      " " + state.opponent +
      " · até " + state.target + " pontos · rodada " + state.round;
    root.appendChild(score);

    const stage = document.createElement("div");
    stage.className = "game-stage";
    root.appendChild(stage);

    const controls = document.createElement("div");
    controls.className = "game-controls";
    root.appendChild(controls);

    const addButton = (label, action) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.addEventListener("click", () => sendAction(action));
      controls.appendChild(button);
    };

    if (state.phase === "coin") {
      stage.innerHTML = "<div class=\"big-number\">🪙</div><p>Sorteando quem escolhe par ou ímpar…</p>";
      return;
    }

    if (state.phase === "choose") {
      const message = document.createElement("p");
      message.textContent = state.chooser === state.myIndex
        ? "Sua vez: escolha par ou ímpar."
        : state.opponent + " está escolhendo par ou ímpar.";
      stage.appendChild(message);

      if (state.chooser === state.myIndex) {
        addButton("Par", { type: "pick", value: "par" });
        addButton("Ímpar", { type: "pick", value: "impar" });
      }
      return;
    }

    if (state.phase === "numbers") {
      const message = document.createElement("p");
      message.textContent = state.myNumber !== null
        ? "Número enviado. Aguardando " + state.opponent + "…"
        : "Escolha seu número de 0 a 10.";
      stage.appendChild(message);

      if (state.myNumber === null) {
        for (let number = 0; number <= 10; number += 1) {
          addButton(String(number), { type: "number", value: number });
        }
      }
      return;
    }

    if (state.phase === "reveal" && state.result) {
      const otherNumber = state.result.numbers[1 - state.myIndex];
      const ownNumber = state.result.numbers[state.myIndex];

      const numbers = document.createElement("div");
      numbers.className = "big-number";
      numbers.textContent = ownNumber + " + " + otherNumber + " = " + state.result.sum;
      stage.appendChild(numbers);

      const outcome = document.createElement("p");
      outcome.className = "game-result";
      outcome.textContent =
        (state.result.parity === "par" ? "Deu Par" : "Deu Ímpar") +
        (state.result.pointFor === state.myIndex ? " · ponto seu!" : " · ponto do oponente.");
      stage.appendChild(outcome);

      if (state.winner !== null) {
        const winner = document.createElement("p");
        winner.textContent = state.winner === state.myIndex ? "Você venceu a partida!" : "Seu oponente venceu.";
        stage.appendChild(winner);
      }
      return;
    }

    if (state.phase === "end") {
      const won = state.winner === state.myIndex;
      const result = document.createElement("p");
      result.className = won ? "game-result" : "";
      result.textContent = won ? "Você venceu!" : "Você perdeu.";
      stage.appendChild(result);

      const finalScore = document.createElement("p");
      finalScore.textContent =
        "Placar final: " + state.score[state.myIndex] +
        " × " + state.score[1 - state.myIndex];
      stage.appendChild(finalScore);

      if (state.rematchDeclined) {
        const declined = document.createElement("p");
        declined.textContent = "Pedido de revanche recusado.";
        stage.appendChild(declined);
      } else if (state.rematchRequest === null && state.target < 7 && !won) {
        addButton("Pedir revanche", { type: "rematch" });
      } else if (state.rematchRequest === state.myIndex) {
        const waiting = document.createElement("p");
        waiting.textContent = "Pedido de revanche enviado.";
        stage.appendChild(waiting);
      } else if (state.rematchRequest !== null) {
        addButton("Aceitar revanche", { type: "rematchResponse", accept: true });
        addButton("Recusar", { type: "rematchResponse", accept: false });
      }
    }
  }
};
