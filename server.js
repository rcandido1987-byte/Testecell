"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const parity = require("./games/parOuImpar");

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const CATALOG = {
  "par-ou-impar": { name: "Par ou Ímpar", min: 2, max: 2, module: parity },
  forca: { name: "Jogo da Forca", min: 2, max: 2 },
  jokenpo: { name: "Jokenpô", min: 2, max: 2 },
  detetive: { name: "Detetive", min: 4, max: 10 },
  velha: { name: "Jogo da Velha", min: 2, max: 2 },
  xadrez: { name: "Xadrez", min: 2, max: 2 }
};

const rooms = new Map();
const clients = new Set();
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function frame(socket, opcode, body) {
  if (socket.destroyed) return;
  const data = Buffer.isBuffer(body) ? body : Buffer.from(body);
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
  if (client && !client.socket.destroyed) {
    frame(client.socket, 1, JSON.stringify(message));
  }
}

function code() {
  let value;
  do {
    value = crypto.randomBytes(3).toString("hex").toUpperCase();
  } while (rooms.has(value));
  return value;
}

function sendRoom(room) {
  const publicState = {
    t: "room",
    room: {
      code: room.code,
      game: room.game,
      mode: room.mode,
      started: room.started,
      min: room.min,
      max: room.max,
      host: room.players[0]?.id,
      players: room.players.map(({ id, name, bot }) => ({ id, name, bot }))
    }
  };

  room.players.forEach((player) => {
    if (player.client) send(player.client, publicState);
  });

  if (room.started && room.game === "par-ou-impar") {
    room.players.forEach((player, index) => {
      if (player.client) {
        send(player.client, {
          t: "game",
          game: room.game,
          state: parity.snapshot(room.state, index)
        });
      }
    });
  }
}

function removeClient(client) {
  const room = client.room;
  clients.delete(client);
  if (!room) return;

  room.players = room.players.filter((player) => player.client !== client);
  client.room = null;

  if (!room.players.length) {
    if (room.state && room.game === "par-ou-impar") parity.dispose(room.state);
    rooms.delete(room.code);
    return;
  }

  if (!room.started && room.players.length >= room.min) startRoom(room);
  else sendRoom(room);
}

function startRoom(room) {
  if (room.started || room.players.length < room.min) return;

  if (room.game !== "par-ou-impar") {
    room.players.forEach((player) => {
      if (player.client) {
        send(player.client, {
          t: "error",
          message: "Este jogo está cadastrado, mas seu módulo de partida ainda não foi conectado."
        });
      }
    });
    return;
  }

  room.started = true;
  room.state = parity.create(room.players, () => sendRoom(room));
  sendRoom(room);
}

function joinRoom(client, message) {
  const game = String(message.game || "");
  const config = CATALOG[game];
  const name = String(message.name || "").trim().replace(/\s+/g, " ").slice(0, 16);

  if (!config) return send(client, { t: "error", message: "Selecione um jogo válido." });
  if (!name) return send(client, { t: "error", message: "Digite seu nome." });

  let room;
  const mode = message.mode;

  if (mode === "private") {
    const requestedCode = String(message.code || "").trim().toUpperCase();

    if (requestedCode) {
      room = rooms.get(requestedCode);
      if (!room || room.mode !== "private" || room.game !== game) {
        return send(client, { t: "error", message: "Convite inválido, expirado ou de outro jogo." });
      }
      if (room.started || room.players.length >= room.max) {
        return send(client, { t: "error", message: "A sala já começou ou está cheia." });
      }
    } else {
      room = {
        code: code(),
        game,
        mode: "private",
        min: config.min,
        max: config.max,
        players: [],
        started: false,
        state: null
      };
      rooms.set(room.code, room);
    }
  } else if (mode === "solo") {
    room = {
      code: code(),
      game,
      mode: "solo",
      min: config.min,
      max: config.max,
      players: [],
      started: false,
      state: null
    };
    rooms.set(room.code, room);
  } else {
    room = [...rooms.values()].find((candidate) =>
      candidate.mode === "public" &&
      candidate.game === game &&
      !candidate.started &&
      candidate.players.length < candidate.max
    );

    if (!room) {
      room = {
        code: code(),
        game,
        mode: "public",
        min: config.min,
        max: config.max,
        players: [],
        started: false,
        state: null
      };
      rooms.set(room.code, room);
    }
  }

  const player = {
    id: crypto.randomUUID(),
    name,
    bot: false,
    client
  };

  room.players.push(player);
  client.room = room;
  client.player = player;

  if (mode === "solo" && game === "par-ou-impar") {
    room.players.push({
      id: "npc-" + crypto.randomUUID(),
      name: "Máquina",
      bot: true,
      client: null
    });
  }

  if (room.players.length >= room.min) startRoom(room);
  else sendRoom(room);
}

function handle(client, raw) {
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    return send(client, { t: "error", message: "Mensagem inválida." });
  }

  if (!message || typeof message !== "object") return;

  if (message.t === "join") {
    return joinRoom(client, message);
  }

  if (message.t === "completeBots") {
    const room = client.room;
    if (!room || room.started || room.game !== "detetive") return;

    while (room.players.length < room.min) {
      room.players.push({
        id: "npc-" + crypto.randomUUID(),
        name: "NPC " + (room.players.filter((player) => player.bot).length + 1),
        bot: true,
        client: null
      });
    }
    startRoom(room);
    return;
  }

  if (message.t === "action") {
    const room = client.room;
    if (!room || !room.started || room.game !== "par-ou-impar") return;
    const index = room.players.findIndex((player) => player.id === client.player?.id);
    if (index < 0) return;

    parity.onAction(room.state, index, message.action);
    return;
  }

  if (message.t === "leave") {
    removeClient(client);
  }
}

function attachWebSocket(socket, head) {
  const client = { socket, room: null, player: null };
  clients.add(client);
  let buffer = Buffer.alloc(0);

  function onData(chunk) {
    buffer = Buffer.concat([buffer, chunk]);

    while (buffer.length >= 2) {
      const first = buffer[0];
      const second = buffer[1];
      const opcode = first & 0x0f;
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

      const masked = (second & 0x80) !== 0;
      const maskLength = masked ? 4 : 0;
      if (length > 16384) return socket.destroy();
      if (buffer.length < offset + maskLength + length) return;

      const payload = Buffer.from(buffer.subarray(offset + maskLength, offset + maskLength + length));
      if (masked) {
        const mask = buffer.subarray(offset, offset + 4);
        for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
      }

      buffer = buffer.subarray(offset + maskLength + length);

      if (opcode === 8) {
        frame(socket, 8, Buffer.alloc(0));
        socket.end();
        return;
      }
      if (opcode === 9) {
        frame(socket, 10, payload);
        continue;
      }
      if (opcode === 1) handle(client, payload.toString("utf8"));
    }
  }

  socket.on("data", onData);
  socket.on("close", () => removeClient(client));
  socket.on("error", () => removeClient(client));
  if (head?.length) onData(head);
}

const server = http.createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("ok");
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  } catch {
    res.writeHead(400);
    return res.end("URL inválida.");
  }

  if (pathname === "/") pathname = "/index.html";
  const filePath = path.resolve(PUBLIC_DIR, "." + pathname);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
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
    fs.createReadStream(filePath).pipe(res);
  });
});

server.on("upgrade", (req, socket, head) => {
  const key = req.headers["sec-websocket-key"];
  if (req.url.split("?")[0] !== "/ws" || !key) return socket.destroy();

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
  console.log("Diversão com os amigos online na porta " + PORT);
});
