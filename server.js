"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = fs.existsSync(path.join(__dirname, "Public"))
  ? path.join(__dirname, "Public")
  : path.join(__dirname, "public");
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const GAME_RULES = {
  "Par ou Ímpar": { min: 2, max: 2 },
  "Jokenpô": { min: 2, max: 6 },
  "Detetive": { min: 4, max: 10 },
  "Jogo da Forca": { min: 2, max: 4 },
  "Stop": { min: 2, max: 4 }
};

const rooms = new Map();
const sockets = new Set();

function sendFrame(socket, opcode, payload) {
  if (socket.destroyed) return;
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  let header;

  if (data.length < 126) {
    header = Buffer.from([0x80 | opcode, data.length]);
  } else if (data.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(data.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(data.length), 2);
  }

  socket.write(Buffer.concat([header, data]));
}

function send(conn, data) {
  if (conn && !conn.socket.destroyed) {
    sendFrame(conn.socket, 1, JSON.stringify(data));
  }
}

function cleanName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 16);
}

function newCode() {
  let code;
  do {
    code = crypto.randomBytes(4).toString("hex").slice(0, 6).toUpperCase();
  } while (rooms.has(code));
  return code;
}

function humans(room) {
  return room.players.filter((player) => !player.bot);
}

function roomView(room) {
  return {
    code: room.code,
    game: room.game,
    mode: room.mode,
    minPlayers: room.minPlayers,
    maxPlayers: room.maxPlayers,
    started: room.started,
    players: room.players.map((player) => ({
      id: player.id,
      name: player.name,
      host: player.host,
      bot: player.bot
    })),
    gameState: room.gameState
  };
}

function sendRoom(room) {
  const message = { t: "room", room: roomView(room) };
  room.players.forEach((player) => {
    if (player.conn) send(player.conn, message);
  });
}

function publicRooms(game) {
  return [...rooms.values()]
    .filter((room) =>
      room.mode === "public" &&
      room.game === game &&
      !room.started &&
      humans(room).length < room.maxPlayers
    )
    .map((room) => ({
      code: room.code,
      game: room.game,
      players: humans(room).map((player) => player.name),
      minPlayers: room.minPlayers
    }));
}

function broadcastPublicRooms(game) {
  const message = { t: "publicRooms", game, rooms: publicRooms(game) };
  sockets.forEach((conn) => send(conn, message));
}

function makeRoom(game, mode) {
  const rules = GAME_RULES[game];
  const room = {
    code: newCode(),
    game,
    mode,
    minPlayers: rules.min,
    maxPlayers: rules.max,
    players: [],
    started: false,
    gameState: null,
    botTimers: []
  };
  rooms.set(room.code, room);
  return room;
}

function addPlayer(room, conn, name, host) {
  const player = {
    id: crypto.randomUUID(),
    name,
    host,
    bot: false,
    conn
  };
  room.players.push(player);
  conn.room = room;
  conn.player = player;
  return player;
}

function removePlayer(conn) {
  const room = conn.room;
  if (!room) return;

  room.players = room.players.filter((player) => player.conn !== conn);
  conn.room = null;
  conn.player = null;

  if (!room.players.length) {
    room.botTimers.forEach(clearTimeout);
    rooms.delete(room.code);
  } else {
    if (!room.players.some((player) => player.host)) {
      const nextHost = humans(room)[0] || room.players[0];
      nextHost.host = true;
    }
    sendRoom(room);
    broadcastPublicRooms(room.game);
  }
}

function roomError(conn, message) {
  send(conn, { t: "error", message });
}

function joinPublic(conn, name, game) {
  if (!GAME_RULES[game]) return roomError(conn, "Esse jogo não está disponível.");
  removePlayer(conn);

  let room = [...rooms.values()].find((candidate) =>
    candidate.game === game &&
    candidate.mode === "public" &&
    !candidate.started &&
    humans(candidate).length < candidate.maxPlayers
  );

  if (!room) room = makeRoom(game, "public");
  addPlayer(room, conn, name, room.players.length === 0);
  sendRoom(room);
  broadcastPublicRooms(game);
}

function createPrivate(conn, name, game) {
  if (!GAME_RULES[game]) return roomError(conn, "Esse jogo não está disponível.");
  removePlayer(conn);

  const room = makeRoom(game, "private");
  addPlayer(room, conn, name, true);
  sendRoom(room);
}

function joinPrivate(conn, name, code) {
  const room = rooms.get(String(code || "").trim().toUpperCase());
  if (!room || room.mode !== "private") {
    return roomError(conn, "Sala não encontrada. Confira o código do convite.");
  }
  if (room.started) return roomError(conn, "Esta partida já começou.");
  if (humans(room).length >= room.maxPlayers) {
    return roomError(conn, "A sala já está cheia.");
  }

  removePlayer(conn);
  addPlayer(room, conn, name, false);
  sendRoom(room);
}

function fillWithBots(room) {
  if (room.started) return;

  while (room.players.length < room.minPlayers && room.players.length < room.maxPlayers) {
    room.players.push({
      id: crypto.randomUUID(),
      name: "Bot " + (room.players.filter((player) => player.bot).length + 1),
      host: false,
      bot: true,
      conn: null
    });
  }
  sendRoom(room);
}

const WORDS = ["CELULAR", "JANELA", "ESCOLA", "AMIGOS", "GIRASSOL", "ABACAXI", "BICICLETA"];
const CATEGORIES = ["Nome", "Animal", "Comida", "Cidade", "Objeto"];

function randomLetter() {
  return "ABCDEFGHIJLMNOPRSTV".charAt(Math.floor(Math.random() * 20));
}

function startGame(room) {
  if (room.started || room.players.length < room.minPlayers) return false;
  room.started = true;

  if (room.game === "Stop") {
    room.gameState = {
      phase: "playing",
      round: 1,
      letter: randomLetter(),
      categories: CATEGORIES,
      submissions: {},
      result: null
    };
    scheduleStopBots(room);
  } else if (room.game === "Jogo da Forca") {
    room.gameState = {
      phase: "playing",
      word: WORDS[Math.floor(Math.random() * WORDS.length)],
      guessed: [],
      mistakes: 0,
      maxMistakes: 6,
      turn: 0,
      result: null
    };
    scheduleHangmanBot(room);
  } else if (room.game === "Par ou Ímpar") {
    room.gameState = {
      phase: "playing",
      round: 1,
      submissions: {},
      result: null
    };
  } else {
    room.gameState = {
      phase: "playing",
      round: 1,
      submissions: {},
      result: null
    };
  }

  sendRoom(room);
  return true;
}

function resolveStop(room) {
  const state = room.gameState;
  if (!state || state.phase !== "playing") return;

  const answers = Object.values(state.submissions);
  if (answers.length < room.players.length) return;

  const normalized = new Map();
  answers.forEach((entry) => {
    entry.answers.forEach((answer, index) => {
      const key = String(answer || "").trim().toLocaleLowerCase("pt-BR");
      if (!key) return;
      if (!normalized.has(index)) normalized.set(index, []);
      normalized.get(index).push(key);
    });
  });

  const scores = {};
  answers.forEach((entry) => {
    let score = 0;
    entry.answers.forEach((answer, index) => {
      const key = String(answer || "").trim().toLocaleLowerCase("pt-BR");
      if (!key) return;
      const same = (normalized.get(index) || []).filter((item) => item === key).length;
      score += same > 1 ? 5 : 10;
    });
    scores[entry.playerId] = score;
  });

  state.phase = "result";
  state.result = {
    scores,
    submissions: answers,
    message: "Rodada encerrada. Respostas iguais valem 5 pontos; respostas únicas, 10."
  };
  sendRoom(room);
}

function stopBotAnswers(room) {
  const state = room.gameState;
  const sample = [
    ["Ana", "Anta", "Arroz", "Aracaju", "Abajur"],
    ["Bruno", "Baleia", "Banana", "Brasília", "Bola"],
    ["Clara", "Cavalo", "Cuscuz", "Curitiba", "Caneca"]
  ];

  room.players.filter((player) => player.bot).forEach((bot, index) => {
    const row = sample[index % sample.length];
    const answers = row.map((answer) =>
      answer.toLocaleUpperCase("pt-BR").startsWith(state.letter) ? answer : ""
    );
    state.submissions[bot.id] = { playerId: bot.id, name: bot.name, answers, bot: true };
  });
  resolveStop(room);
}

function scheduleStopBots(room) {
  setTimeout(() => {
    if (room.started && room.game === "Stop" && room.gameState.phase === "playing") {
      stopBotAnswers(room);
      sendRoom(room);
    }
  }, 5000);
}

function nextHangmanTurn(room) {
  const state = room.gameState;
  if (!state || state.phase !== "playing") return;

  for (let attempts = 0; attempts < room.players.length; attempts += 1) {
    state.turn = (state.turn + 1) % room.players.length;
    const player = room.players[state.turn];
    if (!player.bot) {
      sendRoom(room);
      return;
    }
    const remaining = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("")
      .filter((letter) => !state.guessed.includes(letter));
    if (remaining.length) {
      const letter = remaining[Math.floor(Math.random() * remaining.length)];
      applyHangmanGuess(room, player, letter);
    }
    if (state.phase !== "playing") return;
  }
}

function applyHangmanGuess(room, player, letter) {
  const state = room.gameState;
  if (!state || state.phase !== "playing" || state.guessed.includes(letter)) return;

  state.guessed.push(letter);
  if (!state.word.includes(letter)) state.mistakes += 1;

  const won = [...state.word].every((character) => state.guessed.includes(character));
  if (won) {
    state.phase = "result";
    state.result = { winner: player.name, word: state.word, message: player.bot ? "O bot venceu!" : player.name + " descobriu a palavra!" };
  } else if (state.mistakes >= state.maxMistakes) {
    state.phase = "result";
    state.result = { winner: null, word: state.word, message: "Fim de jogo: a palavra não foi descoberta." };
  } else {
    state.turn = (room.players.indexOf(player) + 1) % room.players.length;
  }

  sendRoom(room);
  if (state.phase === "playing") scheduleHangmanBot(room);
}

function scheduleHangmanBot(room) {
  const state = room.gameState;
  if (!state || state.phase !== "playing") return;
  const player = room.players[state.turn];
  if (!player || !player.bot) return;

  const timer = setTimeout(() => {
    if (room.started && room.gameState && room.gameState.phase === "playing") {
      const remaining = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("")
        .filter((letter) => !room.gameState.guessed.includes(letter));
      if (remaining.length) {
        const letter = remaining[Math.floor(Math.random() * remaining.length)];
        applyHangmanGuess(room, player, letter);
      }
    }
  }, 1200);
  room.botTimers.push(timer);
}

function handleMessage(conn, raw) {
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    return roomError(conn, "Mensagem inválida.");
  }
  if (!message || typeof message !== "object") return;

  if (message.t === "publicRooms") {
    if (GAME_RULES[message.game]) {
      send(conn, { t: "publicRooms", game: message.game, rooms: publicRooms(message.game) });
    }
    return;
  }

  if (message.t === "joinPublic" || message.t === "createPrivate" || message.t === "joinPrivate") {
    const name = cleanName(message.name);
    if (!name) return roomError(conn, "Digite seu nome.");
    if (message.t === "joinPublic") return joinPublic(conn, name, message.game);
    if (message.t === "createPrivate") return createPrivate(conn, name, message.game);
    return joinPrivate(conn, name, message.code);
  }

  const room = conn.room;
  const player = conn.player;
  if (!room || !player) return;

  if (message.t === "leave") {
    removePlayer(conn);
    return;
  }

  if (message.t === "completeWithBots") {
    if (!player.host || room.started) return;
    fillWithBots(room);
    return;
  }

  if (message.t === "start") {
    if (!player.host) return roomError(conn, "Somente o anfitrião pode iniciar.");
    if (room.players.length < room.minPlayers) {
      return roomError(conn, "Faltam jogadores. Complete as vagas com bots ou aguarde alguém entrar.");
    }
    if (!startGame(room)) return roomError(conn, "Não foi possível iniciar a partida.");
    return;
  }

  if (!room.started || !room.gameState || room.gameState.phase !== "playing") return;

  if (message.t === "stopSubmit" && room.game === "Stop") {
    if (room.gameState.submissions[player.id]) return;
    const answers = Array.isArray(message.answers)
      ? message.answers.slice(0, room.gameState.categories.length).map((value) => String(value || "").trim().slice(0, 40))
      : [];
    room.gameState.submissions[player.id] = { playerId: player.id, name: player.name, answers, bot: false };
    resolveStop(room);
    sendRoom(room);
    return;
  }

  if (message.t === "hangmanGuess" && room.game === "Jogo da Forca") {
    const letter = String(message.letter || "").toUpperCase().slice(0, 1);
    if (!/^[A-Z]$/.test(letter) || room.players[room.gameState.turn] !== player) return;
    applyHangmanGuess(room, player, letter);
    return;
  }

  if (message.t === "parityPlay" && room.game === "Par ou Ímpar") {
    if (room.gameState.submissions[player.id]) return;
    const number = Number(message.number);
    if (!Number.isInteger(number) || number < 1 || number > 9) return;
    room.gameState.submissions[player.id] = { playerId: player.id, name: player.name, number };
    const entries = Object.values(room.gameState.submissions);
    if (entries.length >= room.players.length) {
      const sum = entries.reduce((total, entry) => total + entry.number, 0);
      room.gameState.phase = "result";
      room.gameState.result = { entries, sum, parity: sum % 2 ? "Ímpar" : "Par" };
    }
    sendRoom(room);
  }
}

function createConnection(socket, head) {
  const conn = { socket, room: null, player: null };
  sockets.add(conn);
  let buffer = Buffer.alloc(0);

  function onData(chunk) {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 2) {
      const first = buffer[0];
      const second = buffer[1];
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let length = second & 0x7f;
      let offset = 2;

      if (length === 126) {
        if (buffer.length < 4) return;
        length = buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buffer.length < 10) return;
        const large = buffer.readBigUInt64BE(2);
        if (large > 16384n) return socket.destroy();
        length = Number(large);
        offset = 10;
      }

      if (length > 16384) return socket.destroy();
      const maskLength = masked ? 4 : 0;
      if (buffer.length < offset + maskLength + length) return;

      const payload = Buffer.from(buffer.subarray(offset + maskLength, offset + maskLength + length));
      if (masked) {
        const mask = buffer.subarray(offset, offset + 4);
        for (let index = 0; index < payload.length; index += 1) {
          payload[index] ^= mask[index % 4];
        }
      }
      buffer = buffer.subarray(offset + maskLength + length);

      if (opcode === 8) {
        sendFrame(socket, 8, Buffer.alloc(0));
        socket.end();
        return;
      }
      if (opcode === 9) {
        sendFrame(socket, 10, payload);
        continue;
      }
      if (opcode === 1) handleMessage(conn, payload.toString("utf8"));
    }
  }

  socket.on("data", onData);
  socket.on("close", () => {
    removePlayer(conn);
    sockets.delete(conn);
  });
  socket.on("error", () => {
    removePlayer(conn);
    sockets.delete(conn);
  });

  if (head && head.length) onData(head);
}

const server = http.createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("ok");
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  } catch {
    res.writeHead(400);
    res.end("URL inválida.");
    return;
  }

  if (pathname === "/") pathname = "/index.html";
  const filePath = path.resolve(PUBLIC_DIR, "." + pathname);
  const basePath = path.resolve(PUBLIC_DIR);

  if (filePath !== basePath && !filePath.startsWith(basePath + path.sep)) {
    res.writeHead(403);
    res.end("Acesso negado.");
    return;
  }

  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      res.writeHead(404);
      res.end("Arquivo não encontrado.");
      return;
    }
    res.writeHead(200, {
      "Content-Type": filePath.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream",
      "Cache-Control": "no-cache"
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.on("upgrade", (req, socket, head) => {
  if (new URL(req.url, "http://localhost").pathname !== "/ws" || !req.headers["sec-websocket-key"]) {
    socket.destroy();
    return;
  }

  const accept = crypto.createHash("sha1")
    .update(req.headers["sec-websocket-key"] + GUID)
    .digest("base64");

  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "Upgrade: websocket\r\n" +
    "Connection: Upgrade\r\n" +
    "Sec-WebSocket-Accept: " + accept + "\r\n\r\n"
  );
  socket.setNoDelay(true);
  createConnection(socket, head);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("Diversão com os amigos rodando na porta " + PORT);
});
