"use strict";

window.GameModules = window.GameModules || {};

window.GameModules["Par ou Ímpar"] = {
  init(root, api) {
    let scoreHost = 0;
    let scoreGuest = 0;
    let submitted = false;

    root.innerHTML = `
      <h3 style="margin-top:0">Par ou Ímpar</h3>
      <p id="pi-role"></p>
      <p id="pi-score">Placar: 0 × 0</p>
      <p id="pi-status">Escolha um número de 0 a 5.</p>
      <div id="pi-buttons" style="display:flex;flex-wrap:wrap;gap:8px"></div>
      <p id="pi-result" aria-live="polite"></p>
    `;

    const role = api.host ? "Par" : "Ímpar";
    const roleLabel = root.querySelector("#pi-role");
    const scoreLabel = root.querySelector("#pi-score");
    const status = root.querySelector("#pi-status");
    const result = root.querySelector("#pi-result");
    const buttons = root.querySelector("#pi-buttons");

    roleLabel.textContent = "Você joga no time " + role + ". O anfitrião fica com Par.";
    for (let number = 0; number <= 5; number += 1) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = String(number);
      button.style.cssText = "padding:12px 18px;border:0;border-radius:10px;background:#8b5cf6;color:white;font-weight:800;cursor:pointer";
      button.addEventListener("click", () => {
        if (submitted) return;
        submitted = true;
        buttons.querySelectorAll("button").forEach((item) => { item.disabled = true; });
        status.textContent = "Número enviado. Aguardando o outro jogador...";
        api.sendAction({ number });
      });
      buttons.appendChild(button);
    }

    return {
      onActions(message) {
        if (!message.actions || message.actions.length !== 2) return;

        const hostAction = message.actions.find((item) => item.host);
        const guestAction = message.actions.find((item) => !item.host);
        if (!hostAction || !guestAction) return;

        const hostNumber = Number(hostAction.action.number);
        const guestNumber = Number(guestAction.action.number);
        if (!Number.isInteger(hostNumber) || !Number.isInteger(guestNumber)) return;

        const sum = hostNumber + guestNumber;
        const winner = sum % 2 === 0 ? "Par" : "Ímpar";
        if (winner === "Par") scoreHost += 1;
        else scoreGuest += 1;

        scoreLabel.textContent = "Placar — Par: " + scoreHost + " · Ímpar: " + scoreGuest;
        result.textContent =
          "Rodada " + message.round + ": " + hostNumber + " + " + guestNumber +
          " = " + sum + ". Deu " + winner + "!";

        status.textContent = "Próxima rodada em instantes.";
        window.setTimeout(() => {
          submitted = false;
          buttons.querySelectorAll("button").forEach((item) => { item.disabled = false; });
          status.textContent = "Escolha um número de 0 a 5.";
        }, 2200);
      }
    };
  }
};

