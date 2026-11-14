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

const GAMES = {
  "par-ou-impar": { name: "Par ou Ímpar", min: 2, max: 2, ready: true, bot: true },
  forca: { name: "Jogo da Forca", min: 2, max: 4, ready: false, bot: false },
  jokenpo: { name: "Jokenpô", min: 2, max: 6, ready: false, bot: false },
  detetive: { name: "Detetive", min: 4, max: 10, ready: false, bot: false },
  velha: { name: "Jogo da Velha", min: 2, max: 2, ready: false, bot: false },
  xadrez: { name: "Xadrez", min: 2, max: 2, ready: false, bot: false }
};

const rooms = new Map();
const clients = new Set();

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon"
};

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

function send(client, message) {
  if (!client || client.socket.destroyed) return;

  try {
    sendFrame(client.socket, 1, JSON.stringify(message));
  } catch {
    client.socket.destroy();
  }
}

function cleanName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 16);
}

function newRoomCode() {
  let value;

  do {
    value = crypto.randomBytes(4).toString("hex").slice(0, 6).toUpperCase();
  } while (rooms.has(value));

  return value;
}

function makeRoom(game, mode) {
  const rules = GAMES[game];

  const room = {
    code: newRoomCode(),
    game,
    mode,
    min: rules.min,
    max: rules.max,
    players: [],
    started: false,
    state: null
  };

  rooms.set(room.code, room);
  return room;
}

function isHost(room, player) {
  return !!player && room.players.find((item) => item.host) === player;
}

function roomMessage(room) {
  return {
    t: "room",
    room: {
      code: room.code,
      game: room.game,
      mode: room.mode,
      started: room.started,
      min: room.min,
      max: room.max,
      host: room.players.find((player) => player.host)?.id || null,
      players: room.players.map((player) => ({
        id: player.id,
        name: player.name,
        host: player.host,
        bot: player.bot
      }))
    }
  };
}

function sendRoom(room) {
  if (!room) return;

  const message = roomMessage(room);

  room.players.forEach((player) => {
    if (player.client) send(player.client, message);
  });

  if (room.started && room.game === "par-ou-impar" && room.state) {
    room.players.forEach((player, index) => {
      if (!player.client) return;

      send(player.client, {
        t: "game",
        game: room.game,
        state: paritySnapshot(room.state, index)
      });
    });
  }
}

/* Motor de Par ou Ímpar mantido no servidor, sem pasta games/ na raiz. */

function later(state, delay, callback) {
  const timer = setTimeout(() => {
    state.timers.delete(timer);
    if (!state.disposed) callback();
  }, delay);

  state.timers.add(timer);
  return timer;
}

function clearGameTimers(state) {
  if (!state) return;
  state.timers.forEach(clearTimeout);
  state.timers.clear();
}

function disposeGame(state) {
  if (!state) return;
  state.disposed = true;
  clearGameTimers(state);
}

function gameChanged(room) {
  if (!room.state || room.state.disposed) return;
  sendRoom(room);
}

function paritySnapshot(state, index) {
  const opponent = state.players[1 - index];

  return {
    phase: state.phase,
    round: state.round,
    target: state.target,
    score: [...state.score],
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

function createParityGame(room) {
  const state = {
    room,
    players: room.players,
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
    timers: new Set(),
    disposed: false
  };

  later(state, 1800, () => {
    state.phase = "choose";
    gameChanged(room);
    parityBotTurn(state);
  });

  return state;
}

function parityBotTurn(state) {
  if (!state || state.disposed || state.phase === "end" || state.phase === "reveal") return;

  const botIndex = state.players.findIndex((player) => player.bot);
  if (botIndex < 0) return;

  if (state.phase === "choose" && state.chooser === botIndex) {
    later(state, 700, () => {
      if (state.phase !== "choose" || state.chooser !== botIndex) return;

      state.parity = Math.random() < 0.5 ? "par" : "impar";
      state.phase = "numbers";
      gameChanged(state.room);
      parityBotTurn(state);
    });
    return;
  }

  if (state.phase === "numbers" && state.numbers[botIndex] === null) {
    later(state, 900, () => {
      if (state.phase !== "numbers" || state.numbers[botIndex] !== null) return;

      state.numbers[botIndex] = Math.floor(Math.random() * 11);

      if (state.numbers.every((number) => number !== null)) {
        resolveParityRound(state);
      } else {
        gameChanged(state.room);
      }
    });
  }
}

function resolveParityRound(state) {
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

  gameChanged(state.room);

  later(state, 2800, () => {
    if (state.winner !== null) {
      state.phase = "end";
      gameChanged(state.room);
      return;
    }

    state.round += 1;
    state.chooser = 1 - pointFor;
    state.numbers = [null, null];
    state.parity = null;
    state.result = null;
    state.phase = "choose";
    gameChanged(state.room);
    parityBotTurn(state);
  });
}

function resetParitySeries(state) {
  clearGameTimers(state);
  state.target += 2;
  state.phase = "coin";
  state.round = 1;
  state.score = [0, 0];
  state.numbers = [null, null];
  state.parity = null;
  state.result = null;
  state.winner = null;
  state.rematchRequest = null;
  state.rematchDeclined = false;
  state.chooser = Math.random() < 0.5 ? 0 : 1;

  later(state, 1800, () => {
    state.phase = "choose";
    gameChanged(state.room);
    parityBotTurn(state);
  });
}

function parityAction(state, index, action) {
  if (!state || state.disposed || !action || typeof action !== "object") return;

  if (action.type === "pick" && state.phase === "choose" && index === state.chooser) {
    if (action.value !== "par" && action.value !== "impar") return;

    state.parity = action.value;
    state.phase = "numbers";
    gameChanged(state.room);
    parityBotTurn(state);
    return;
  }

  if (action.type === "number" && state.phase === "numbers" && state.numbers[index] === null) {
    const number = Number(action.value);
    if (!Number.isInteger(number) || number < 0 || number > 10) return;

    state.numbers[index] = number;

    if (state.numbers.every((value) => value !== null)) {
      resolveParityRound(state);
    } else {
      gameChanged(state.room);
      parityBotTurn(state);
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
    gameChanged(state.room);
    return;
  }

  if (
    action.type === "rematchResponse" &&
    state.phase === "end" &&
    state.rematchRequest !== null &&
    index !== state.rematchRequest
  ) {
    if (action.accept) {
      resetParitySeries(state);
    } else {
      state.rematchDeclined = true;
    }

    gameChanged(state.room);
  }
}

function startRoom(room) {
  if (room.started || room.players.length < room.min) return false;

  if (room.game !== "par-ou-impar") {
    room.players.forEach((player) => {
      if (player.client) {
        send(player.client, {
          t: "error",
          message: "Este jogo ainda está em preparação."
        });
      }
    });
    return false;
  }

  room.started = true;
  room.state = createParityGame(room);
  sendRoom(room);
  return true;
}

function promoteHost(room) {
  if (!room.players.some((player) => player.host)) {
    const nextHost = room.players.find((player) => !player.bot) || room.players[0];
    if (nextHost) nextHost.host = true;
  }
}

function removeClient(client) {
  clients.delete(client);

  const room = client.room;
  if (!room) return;

  const wasStarted = room.started;
  room.players = room.players.filter((player) => player.client !== client);
  client.room = null;
  client.player = null;

  if (wasStarted) {
    disposeGame(room.state);
    room.state = null;
    room.started = false;
    room.players = room.players.filter((player) => !player.bot);
  }

  const humans = room.players.filter((player) => !player.bot);

  if (humans.length === 0) {
    disposeGame(room.state);
    rooms.delete(room.code);
    return;
  }

  promoteHost(room);
  sendRoom(room);
}

function joinRoom(client, message) {
  if (client.room) {
    send(client, { t: "error", message: "Você já está em uma sala. Saia dela antes de entrar em outra." });
    return;
  }

  const game = String(message.game || "");
  const config = GAMES[game];
  const name = cleanName(message.name);
  const mode = String(message.mode || "public");

  if (!config) {
    send(client, { t: "error", message: "Selecione um jogo válido." });
    return;
  }

  if (!config.ready) {
    send(client, { t: "error", message: "Este jogo aparece no catálogo, mas ainda está em preparação." });
    return;
  }

  if (!name) {
    send(client, { t: "error", message: "Digite seu nome para continuar." });
    return;
  }

  let room;

  if (mode === "private") {
    const requestedCode = String(message.code || "").trim().toUpperCase();

    if (requestedCode) {
      room = rooms.get(requestedCode);

      if (!room || room.mode !== "private" || room.game !== game) {
        send(client, { t: "error", message: "Convite inválido, expirado ou de outro jogo." });
        return;
      }

      if (room.started || room.players.length >= room.max) {
        send(client, { t: "error", message: "A sala já começou ou está cheia." });
        return;
      }
    } else {
      room = makeRoom(game, "private");
    }
  } else if (mode === "solo") {
    if (!config.bot) {
      send(client, { t: "error", message: "O modo contra a máquina ainda não está disponível para este jogo." });
      return;
    }

    room = makeRoom(game, "solo");
  } else if (mode === "public") {
    room = [...rooms.values()].find((candidate) =>
      candidate.mode === "public" &&
      candidate.game === game &&
      !candidate.started &&
      candidate.players.length < candidate.max
    );

    if (!room) room = makeRoom(game, "public");
  } else {
    send(client, { t: "error", message: "Modo de sala inválido." });
    return;
  }

  const duplicateName = room.players.some(
    (player) => player.name.toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR")
  );

  if (duplicateName) {
    send(client, { t: "error", message: "Esse nome já está sendo usado nesta sala." });
    return;
  }

  const player = {
    id: crypto.randomUUID(),
    name,
    host: room.players.length === 0,
    bot: false,
    client
  };

  room.players.push(player);
  client.room = room;
  client.player = player;

  if (mode === "solo") {
    room.players.push({
      id: "bot-" + crypto.randomUUID(),
      name: "Máquina",
      host: false,
      bot: true,
      client: null
    });
  }

  if (room.players.length >= room.min) {
    startRoom(room);
  } else {
    sendRoom(room);
  }
}

function handleMessage(client, raw) {
  let message;

  try {
    message = JSON.parse(raw);
  } catch {
    send(client, { t: "error", message: "Mensagem inválida." });
    return;
  }

  if (!message || typeof message !== "object" || Array.isArray(message)) return;

  if (message.t === "join") {
    joinRoom(client, message);
    return;
  }

  if (message.t === "leave") {
    removeClient(client);
    return;
  }

  const room = client.room;
  const player = client.player;

  if (!room || !player) return;

  if (message.t === "completeBots") {
    if (room.started || room.game !== "par-ou-impar" || !GAMES[room.game].bot || !isHost(room, player)) {
      return;
    }

    while (room.players.length < room.min && room.players.length < room.max) {
      room.players.push({
        id: "bot-" + crypto.randomUUID(),
        name: "Máquina",
        host: false,
        bot: true,
        client: null
      });
    }

    startRoom(room);
    return;
  }

  if (message.t === "action") {
    if (!room.started || room.game !== "par-ou-impar") return;

    const index = room.players.findIndex((item) => item.id === player.id);
    if (index < 0) return;

    parityAction(room.state, index, message.action);
  }
}

function attachWebSocket(socket, head) {
  const client = { socket, room: null, player: null };
  clients.add(client);

  let buffer = Buffer.alloc(0);
  let closed = false;

  function cleanup() {
    if (closed) return;
    closed = true;
    removeClient(client);
  }

  function onData(chunk) {
    buffer = Buffer.concat([buffer, chunk]);

    while (buffer.length >= 2) {
      const first = buffer[0];
      const second = buffer[1];
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let length = second & 0x7f;
      let offset = 2;

      if (!masked) {
        socket.destroy();
        return;
      }

      if (length === 126) {
        if (buffer.length < 4) return;
        length = buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buffer.length < 10) return;
        const largeLength = buffer.readBigUInt64BE(2);
        if (largeLength > 16384n) {
          socket.destroy();
          return;
        }
        length = Number(largeLength);
        offset = 10;
      }

      if (length > 16384) {
        socket.destroy();
        return;
      }

      const frameLength = offset + 4 + length;
      if (buffer.length < frameLength) return;

      const mask = buffer.subarray(offset, offset + 4);
      const payload = Buffer.from(buffer.subarray(offset + 4, frameLength));

      for (let index = 0; index < payload.length; index += 1) {
        payload[index] ^= mask[index % 4];
      }

      buffer = buffer.subarray(frameLength);

      if (opcode === 8) {
        sendFrame(socket, 8, Buffer.alloc(0));
        socket.end();
        cleanup();
        return;
      }

      if (opcode === 9) {
        sendFrame(socket, 10, payload);
        continue;
      }

      if (opcode === 10) continue;

      if (opcode === 1) {
        handleMessage(client, payload.toString("utf8"));
      }
    }
  }

  socket.on("data", onData);
  socket.on("close", cleanup);
  socket.on("error", cleanup);

  if (head && head.length) onData(head);
}

const server = http.createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("ok");
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Método não permitido.");
    return;
  }

  let pathname;

  try {
    pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  } catch {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("URL inválida.");
    return;
  }

  if (pathname === "/") pathname = "/index.html";

  const basePath = path.resolve(PUBLIC_DIR);
  const filePath = path.resolve(basePath, "." + pathname);

  if (filePath !== basePath && !filePath.startsWith(basePath + path.sep)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Acesso negado.");
    return;
  }

  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Arquivo não encontrado.");
      return;
    }

    res.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-cache"
    });

    if (req.method === "HEAD") {
      res.end();
      return;
    }

    const stream = fs.createReadStream(filePath);
    stream.on("error", () => {
      if (!res.headersSent) res.writeHead(500);
      res.end("Erro ao carregar o arquivo.");
    });
    stream.pipe(res);
  });
});

server.on("upgrade", (req, socket, head) => {
  let pathname;

  try {
    pathname = new URL(req.url, "http://localhost").pathname;
  } catch {
    socket.destroy();
    return;
  }

  const key = req.headers["sec-websocket-key"];
  const upgrade = String(req.headers.upgrade || "").toLowerCase();

  if (pathname !== "/ws" || !key || upgrade !== "websocket") {
    socket.destroy();
    return;
  }

  const accept = crypto.createHash("sha1")
    .update(key + GUID)
    .digest("base64");

  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "Upgrade: websocket\r\n" +
    "Connection: Upgrade\r\n" +
    "Sec-WebSocket-Accept: " + accept + "\r\n\r\n"
  );

  socket.setNoDelay(true);
  attachWebSocket(socket, head);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("Diversão com os amigos rodando na porta " + PORT);
});
