"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = fs.existsSync(path.join(ROOT, "Public"))
  ? path.join(ROOT, "Public")
  : path.join(ROOT, "public");
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const GAMES = {
  "par-impar": { name: "Par ou Ímpar", min: 2, max: 2 },
  forca: { name: "Jogo da Forca", min: 2, max: 4 },
  jokenpo: { name: "Jokenpô", min: 2, max: 6 },
  detetive: { name: "Detetive", min: 4, max: 10 },
  velha: { name: "Jogo da Velha", min: 2, max: 2 },
  xadrez: { name: "Xadrez", min: 2, max: 2 }
};

const rooms = new Map();

const MIME = {
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

function sendFrame(socket, opcode, value) {
  if (socket.destroyed) return;

  const payload = Buffer.isBuffer(value) ? value : Buffer.from(value);
  let header;

  if (payload.length < 126) {
    header = Buffer.from([0x80 | opcode, payload.length]);
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }

  socket.write(Buffer.concat([header, payload]));
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
  let code;
  do {
    code = crypto.randomBytes(4).toString("hex").slice(0, 6).toUpperCase();
  } while (rooms.has(code));
  return code;
}

function roomView(room) {
  return {
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
      bot: false
    }))
  };
}

function sendRoom(room) {
  const message = { t: "room", room: roomView(room) };
  room.players.forEach((player) => send(player.client, message));

  if (room.started && room.game === "par-impar" && room.gameState) {
    room.players.forEach((player, index) => {
      send(player.client, {
        t: "game",
        game: room.game,
        state: gameSnapshot(room, index)
      });
    });
  }
}

function sendError(client, message) {
  send(client, { t: "error", message });
}

function clearRoomTimers(room) {
  if (!room || !room.timers) return;
  room.timers.forEach(clearTimeout);
  room.timers.clear();
}

function schedule(room, delay, callback) {
  const timer = setTimeout(() => {
    room.timers.delete(timer);
    if (rooms.get(room.code) === room) callback();
  }, delay);

  room.timers.add(timer);
}

function createGameState() {
  return {
    phase: "choose",
    round: 1,
    target: 3,
    score: [0, 0],
    numbers: [null, null],
    parity: null,
    chooser: Math.random() < 0.5 ? 0 : 1,
    result: null,
    winner: null
  };
}

function gameSnapshot(room, playerIndex) {
  const state = room.gameState;

  return {
    phase: state.phase,
    round: state.round,
    target: state.target,
    score: [...state.score],
    myIndex: playerIndex,
    opponent: room.players[1 - playerIndex]?.name || "Oponente",
    chooser: state.chooser,
    myNumber: state.numbers[playerIndex],
    opponentReady: state.numbers[1 - playerIndex] !== null,
    result: state.result,
    winner: state.winner
  };
}

function resolveRound(room) {
  const state = room.gameState;
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

  sendRoom(room);

  schedule(room, 2600, () => {
    if (state.winner !== null) {
      state.phase = "end";
    } else {
      state.round += 1;
      state.chooser = 1 - pointFor;
      state.numbers = [null, null];
      state.parity = null;
      state.result = null;
      state.phase = "choose";
    }
    sendRoom(room);
  });
}

function handleGameAction(room, playerIndex, action) {
  const state = room.gameState;
  if (!state || !action || typeof action !== "object") return;

  if (
    action.type === "pick" &&
    state.phase === "choose" &&
    playerIndex === state.chooser &&
    (action.value === "par" || action.value === "impar")
  ) {
    state.parity = action.value;
    state.phase = "numbers";
    sendRoom(room);
    return;
  }

  if (
    action.type === "number" &&
    state.phase === "numbers" &&
    state.numbers[playerIndex] === null
  ) {
    const number = Number(action.value);
    if (!Number.isInteger(number) || number < 0 || number > 10) return;

    state.numbers[playerIndex] = number;

    if (state.numbers.every((value) => value !== null)) {
      resolveRound(room);
    } else {
      sendRoom(room);
    }
  }
}

function removeClient(client) {
  const room = client.room;
  client.room = null;
  client.player = null;

  if (!room) return;

  room.players = room.players.filter((player) => player.client !== client);

  if (room.players.length === 0) {
    clearRoomTimers(room);
    rooms.delete(room.code);
    return;
  }

  if (!room.players.some((player) => player.host)) {
    room.players[0].host = true;
  }

  if (room.started) {
    clearRoomTimers(room);
    room.started = false;
    room.gameState = null;
  }

  sendRoom(room);
}

function createPrivateRoom(client, message) {
  if (client.room) removeClient(client);

  const game = String(message.game || "");
  const config = GAMES[game];
  const name = cleanName(message.name);

  if (!config) return sendError(client, "Jogo inválido.");
  if (!name) return sendError(client, "Digite seu nome para criar a sala.");

  const room = {
    code: newRoomCode(),
    game,
    mode: "private",
    min: config.min,
    max: config.max,
    players: [],
    started: false,
    gameState: null,
    timers: new Set()
  };

  const player = {
    id: crypto.randomUUID(),
    name,
    host: true,
    client
  };

  room.players.push(player);
  rooms.set(room.code, room);
  client.room = room;
  client.player = player;
  sendRoom(room);
}

function joinPrivateRoom(client, message) {
  if (client.room) removeClient(client);

  const code = String(message.code || "").trim().toUpperCase();
  const game = String(message.game || "");
  const name = cleanName(message.name);
  const room = rooms.get(code);

  if (!name) return sendError(client, "Digite seu nome para entrar na sala.");
  if (!room || room.mode !== "private" || room.game !== game) {
    return sendError(client, "Convite inválido ou sala encerrada. Peça um novo link.");
  }
  if (room.started || room.players.length >= room.max) {
    return sendError(client, "A sala já começou ou está cheia.");
  }
  if (room.players.some((player) => player.name.toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR"))) {
    return sendError(client, "Esse nome já está sendo usado nesta sala.");
  }

  const player = {
    id: crypto.randomUUID(),
    name,
    host: false,
    client
  };

  room.players.push(player);
  client.room = room;
  client.player = player;
  sendRoom(room);
}

function startRoom(client) {
  const room = client.room;
  const player = client.player;

  if (!room || !player || !player.host) {
    return sendError(client, "Somente o anfitrião pode iniciar a partida.");
  }
  if (room.started) return;
  if (room.players.length < room.min) {
    return sendError(client, "Ainda faltam jogadores para iniciar.");
  }
  if (room.game !== "par-impar") {
    return sendError(client, "A partida desse jogo ainda não está implementada. Por enquanto, Par ou Ímpar é jogável.");
  }

  clearRoomTimers(room);
  room.started = true;
  room.gameState = createGameState();
  sendRoom(room);
}

function handleMessage(client, raw) {
  let message;

  try {
    message = JSON.parse(raw);
  } catch {
    return sendError(client, "Mensagem inválida.");
  }

  if (!message || typeof message !== "object" || Array.isArray(message)) return;

  if (message.t === "createPrivate") return createPrivateRoom(client, message);
  if (message.t === "joinPrivate") return joinPrivateRoom(client, message);
  if (message.t === "start") return startRoom(client);
  if (message.t === "leave") return removeClient(client);

  if (message.t === "action") {
    const room = client.room;
    if (!room || !room.started || room.game !== "par-impar") return;

    const index = room.players.findIndex((player) => player.id === client.player?.id);
    if (index >= 0) handleGameAction(room, index, message.action);
  }
}

function attachWebSocket(socket, head) {
  const client = { socket, room: null, player: null };
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

      if (length === 126) {
        if (buffer.length < 4) return;
        length = buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buffer.length < 10) return;
        const largeLength = buffer.readBigUInt64BE(2);
        if (largeLength > 16384n) return socket.destroy();
        length = Number(largeLength);
        offset = 10;
      }

      if (!masked || length > 16384) return socket.destroy();

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

      if (opcode === 1) handleMessage(client, payload.toString("utf8"));
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
    return res.end("ok");
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Método não permitido.");
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  } catch {
    res.writeHead(400);
    return res.end("URL inválida.");
  }

  if (pathname === "/") pathname = "/index.html";

  const basePath = path.resolve(PUBLIC_DIR);
  const filePath = path.resolve(basePath, "." + pathname);

  if (filePath !== basePath && !filePath.startsWith(basePath + path.sep)) {
    res.writeHead(403);
    return res.end("Acesso negado.");
  }

  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      res.writeHead(404);
      return res.end("Arquivo não encontrado.");
    }

    res.writeHead(200, {
      "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-cache"
    });

    if (req.method === "HEAD") return res.end();

    fs.createReadStream(filePath)
      .on("error", () => {
        if (!res.headersSent) res.writeHead(500);
        res.end("Erro ao carregar o arquivo.");
      })
      .pipe(res);
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
  if (pathname !== "/ws" || !key || String(req.headers.upgrade).toLowerCase() !== "websocket") {
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
