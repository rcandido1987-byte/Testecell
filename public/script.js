let playerTurn = 1;       
let playerChoiceParImpar = null;  
let player1 = {name: '', color: '', number: null};
let player2 = {name: '', color: '', number: null};
let scores = {1: 0, 2: 0};
let rounds = 0;
const maxRounds = 3;

const fingersMap = {
  1: "☝️",
  2: "✌️",
  3: "🤟",
  4: "✋",
  5: "🖐️",
  6: "🖖",
  7: "🤘",
  8: "👍",
  9: "👆",
  10:"🫱"
};

document.getElementById('start-game-btn').addEventListener('click', () => {
  const p1Name = document.getElementById('player1-name').value.trim();
  const p1Color = document.getElementById('player1-color').value;
  const p2Name = document.getElementById('player2-name').value.trim();
  const p2Color = document.getElementById('player2-color').value;

  if(!p1Name || !p2Name) {
    alert("Por favor, preencha os nomes dos dois jogadores.");
    return;
  }
  player1.name = p1Name;
  player1.color = p1Color;
  player2.name = p2Name;
  player2.color = p2Color;
  scores = {1:0,2:0};
  rounds = 0;
  playerTurn = 1;
  playerChoiceParImpar = null;
  player1.number = null;
  player2.number = null;

  document.getElementById('setup').style.display = 'none';
  document.getElementById('game').style.display = 'block';

  document.getElementById('p1-name-display').textContent = player1.name;
  document.getElementById('p2-name-display').textContent = player2.name;
  document.getElementById('p1-name-score').textContent = player1.name;
  document.getElementById('p2-name-score').textContent = player2.name;

  setAvatars();

  startRound();
});

function setAvatars() {
  const p1Avatar = document.getElementById('player1-avatar');
  const p2Avatar = document.getElementById('player2-avatar');
  p1Avatar.className = 'avatar ' + player1.color;
  p2Avatar.className = 'avatar ' + player2.color;
  p1Avatar.textContent = player1.name[0].toUpperCase();
  p2Avatar.textContent = player2.name[0].toUpperCase();
}

function startRound() {
  playerChoiceParImpar = null;
  player1.number = null;
  player2.number = null;

  showElement('parimpar-section');
  document.getElementById('chooser-player').textContent = playerTurn;
  hideElement('number-selection');
  hideElement('show-hands');
  document.getElementById('message').textContent = '';
  hideElement('player1-number-input');
  hideElement('player2-number-input');

  document.getElementById('info').textContent = `${getPlayerName(playerTurn)} tem que escolher Par ou Ímpar.`;

  document.getElementById('btn-par').focus();
}

function chooseParImpar(choice) {
  playerChoiceParImpar = choice;
  hideElement('parimpar-section');

  document.getElementById('info').textContent = `${getPlayerName(playerTurn)} escolheu ${choice.toUpperCase()}. Agora, escolha os números.`;
  showElement('number-selection');

  // Mostrar input do jogador que escolheu Par ou Ímpar primeiro
  if(playerTurn === 1) {
    showPlayerInput(1);
    hidePlayerInput(2);
  } else {
    showPlayerInput(2);
    hidePlayerInput(1);
  }
}

function getPlayerName(num) {
  return num === 1 ? player1.name : player2.name;
}

function showPlayerInput(playerNum) {
  showElement(`player${playerNum}-number-input`);
  if(playerNum === 1){
    document.getElementById('message').textContent = `Turno de ${player1.name}: escolha um número entre 1 e 10.`;
    document.getElementById('player1-number').focus();
  } else {
    document.getElementById('message').textContent = `Turno de ${player2.name}: escolha um número entre 1 e 10.`;
    document.getElementById('player2-number').focus();
  }
}

function hidePlayerInput(playerNum) {
  hideElement(`player${playerNum}-number-input`);
}

function player1Play() {
  const val = parseInt(document.getElementById('player1-number').value);
  if(!val || val < 1 || val > 10) {
    alert(`Escolha um número entre 1 e 10 para ${player1.name}.`);
    return;
  }
  player1.number = val;
  hidePlayerInput(1);
  // Se playerTurn é 1, o outro jogador é 2, então mostra input de 2, senão já mostra resultado
  if(playerTurn === 1) {
    showPlayerInput(2);
  } else {
    // Jogador 1 não é quem escolheu par/impar, então vamos esperar o outro jogador
    if(player2.number !== null) {
      showHandsAndResult();
    }
  }
}

function player2Play() {
  const val = parseInt(document.getElementById('player2-number').value);
  if(!val || val < 1 || val > 10) {
    alert(`Escolha um número entre 1 e 10 para ${player2.name}.`);
    return;
  }
  player2.number = val;
  hidePlayerInput(2);
  // Se playerTurn é 2, o outro jogador é 1, então mostra input de 1, senão já mostra resultado
  if(playerTurn === 2) {
    showPlayerInput(1);
  } else {
    // Jogador 2 não é quem escolheu par/impar, então vamos esperar o outro jogador
    if(player1.number !== null) {
      showHandsAndResult();
    }
  }
}

function showHandsAndResult() {
  const showHandsDiv = document.getElementById('show-hands');
  const p1HandNumDiv = document.getElementById('player1-hand-number');
  const p2HandNumDiv = document.getElementById('player2-hand-number');

  p1HandNumDiv.className = "hand-number";
  p2HandNumDiv.className = "hand-number";

  p1HandNumDiv.textContent = fingersMap[player1.number] || player1.number;
  p2HandNumDiv.textContent = fingersMap[player2.number] || player2.number;

  showElement('show-hands');

  void p1HandNumDiv.offsetWidth;
  void p2HandNumDiv.offsetWidth;
  
  p1HandNumDiv.classList.add('fade-zoom-in');
  p2HandNumDiv.classList.add('fade-zoom-in');

  document.getElementById('message').textContent = 'Calculando resultado...';

  setTimeout(() => {
    const sum = player1.number + player2.number;
    const isEven = sum % 2 === 0;

    let chooserPlayer = playerTurn;
    let otherPlayer = chooserPlayer === 1 ? 2 : 1;

    let winner;
    if ((isEven && playerChoiceParImpar === 'par') || (!isEven && playerChoiceParImpar === 'impar')) {
      winner = chooserPlayer;
    } else {
      winner = otherPlayer;
    }

    rounds++;
    scores[winner]++;
    document.getElementById('message').textContent =
      `${player1.name} escolheu ${player1.number}, ${player2.name} escolheu ${player2.number}. ` +
      `Soma: ${sum} (${isEven ? 'Par' : 'Ímpar'}). ${winner === 1 ? player1.name : player2.name} venceu a rodada!`;

    document.getElementById('score1').textContent = scores[1];
    document.getElementById('score2').textContent = scores[2];
    document.getElementById('rounds').textContent = rounds;

    hideElement('show-hands');

    if (scores[winner] > Math.floor(maxRounds / 2)) {
      alert(`${winner === 1 ? player1.name : player2.name} venceu o jogo!`);
      resetGame();
      return;
    }

    playerTurn = winner === 1 ? 2 : 1;
    document.getElementById('info').textContent = `${getPlayerName(playerTurn)} tem que escolher Par ou Ímpar.`;
    
    setTimeout(() => {
      startRound();
    }, 2500);
  }, 3000);
}

function resetGame() {
  scores = {1: 0, 2: 0};
  rounds = 0;
  playerChoiceParImpar = null;
  player1.number = null;
  player2.number = null;

  document.getElementById('message').textContent = '';
  hideElement('show-hands');
  document.getElementById('info').textContent = '';
  document.getElementById('score1').textContent = '0';
  document.getElementById('score2').textContent = '0';
  document.getElementById('rounds').textContent = '0';

  document.getElementById('game').style.display = 'none';
  document.getElementById('setup').style.display = 'block';
}

function showElement(id) {
  document.getElementById(id).style.display = 'block';
}

function hideElement(id) {
  document.getElementById(id).style.display = 'none';
}
