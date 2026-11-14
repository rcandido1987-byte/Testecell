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

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp"
};

const games = new Set([
  "Par ou Ímpar",
  "Jokenpô",
  "Detetive",
  "Jogo da Forca",
  "Stop"
]);
const rooms = new Map();
const connections = new Set();
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

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

function sendJson(conn, data) {
  if (conn && !conn.socket.destroyed) {
    sendFrame(conn.socket, 1, JSON.stringify(data));
  }
}

function roomState(room) {
  return {
    t: "state",
    room: {
      code: room.code,
      game: room.game,
      players: room.players.map((player) => ({
        name: player.name,
        host: player.host
      }))
    }
  };
}

function broadcastRoom(room) {
  const message = roomState(room);
  room.players.forEach((player) => sendJson(player.conn, message));
}

function removeFromRoom(conn) {
  if (!conn.room) return;
  const room = conn.room;
  room.players = room.players.filter((player) => player.conn !== conn);
  conn.room = null;

  if (room.players.length === 0) {
    rooms.delete(room.code);
  } else {
    broadcastRoom(room);
  }
}

function cleanName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 16);
}

function newRoomCode() {
  let code;
  do {
    code = crypto.randomBytes(4).toString("hex").slice(0, 6).toUpperCase();
  } while (rooms.has(code));
  return code;
}

function handleMessage(conn, raw) {
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    sendJson(conn, { t: "error", message: "Mensagem inválida." });
    return;
  }

  if (!message || typeof message !== "object") return;

  if (message.t === "create") {
    const name = cleanName(message.name);
    const game = String(message.game || "");

    if (!name) {
      sendJson(conn, { t: "error", message: "Digite seu nome para criar a sala." });
      return;
    }
    if (!games.has(game)) {
      sendJson(conn, { t: "error", message: "Esse jogo não é válido." });
      return;
    }

    removeFromRoom(conn);
    const code = newRoomCode();
    const room = { code, game, players: [] };
    rooms.set(code, room);
    conn.name = name;
    conn.room = room;
    room.players.push({ name, host: true, conn });
    broadcastRoom(room);
    return;
  }

  if (message.t === "join") {
    const name = cleanName(message.name);
    const code = String(message.code || "").trim().toUpperCase();
    const room = rooms.get(code);

    if (!name) {
      sendJson(conn, { t: "error", message: "Digite seu nome para entrar na sala." });
      return;
    }
    if (!room) {
      sendJson(conn, { t: "error", message: "Essa sala não existe ou já foi encerrada. Peça um novo convite." });
      return;
    }

    removeFromRoom(conn);
    conn.name = name;
    conn.room = room;
    room.players.push({ name, host: false, conn });
    broadcastRoom(room);
    return;
  }

  if (message.t === "leave") {
    removeFromRoom(conn);
  }
}

function createWebSocketConnection(socket, head) {
  const conn = { socket, room: null, name: "" };
  connections.add(conn);

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

      const maskBytes = masked ? 4 : 0;
      if (buffer.length < offset + maskBytes + length) return;

      let payload = Buffer.from(buffer.subarray(offset + maskBytes, offset + maskBytes + length));
      if (masked) {
        const mask = buffer.subarray(offset, offset + 4);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      }
      buffer = buffer.subarray(offset + maskBytes + length);

      if (opcode === 8) {
        sendFrame(socket, 8, Buffer.alloc(0));
        socket.end();
        return;
      }
      if (opcode === 9) {
        sendFrame(socket, 10, payload);
        continue;
      }
      if (opcode === 10) continue;
      if (opcode === 1) handleMessage(conn, payload.toString("utf8"));
    }
  }

  socket.on("data", onData);
  socket.on("close", () => {
    removeFromRoom(conn);
    connections.delete(conn);
  });
  socket.on("error", () => {
    removeFromRoom(conn);
    connections.delete(conn);
  });

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

  let requestPath;
  try {
    requestPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  } catch {
    res.writeHead(400);
    res.end("Endereço inválido.");
    return;
  }

  if (requestPath === "/") requestPath = "/index.html";

  const filePath = path.resolve(PUBLIC_DIR, "." + requestPath);
  const publicPath = path.resolve(PUBLIC_DIR);

  if (filePath !== publicPath && !filePath.startsWith(publicPath + path.sep)) {
    res.writeHead(403);
    res.end("Acesso negado.");
    return;
  }

  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Arquivo não encontrado.");
      return;
    }

    const contentType = MIME_TYPES[path.extname(filePath).toLowerCase()]
      || "application/octet-stream";

    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-cache"
    });

    if (req.method === "HEAD") {
      res.end();
      return;
    }

    fs.createReadStream(filePath)
      .on("error", () => {
        if (!res.headersSent) res.writeHead(500);
        res.end("Erro ao carregar o arquivo.");
      })
      .pipe(res);
  });
});

server.on("upgrade", (req, socket, head) => {
  let requestPath;
  try {
    requestPath = new URL(req.url, "http://localhost").pathname;
  } catch {
    socket.destroy();
    return;
  }

  const key = req.headers["sec-websocket-key"];
  if (requestPath !== "/ws" || !key) {
    socket.destroy();
    return;
  }

  const accept = crypto.createHash("sha1").update(key + GUID).digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "Upgrade: websocket\r\n" +
    "Connection: Upgrade\r\n" +
    "Sec-WebSocket-Accept: " + accept + "\r\n\r\n"
  );
  socket.setNoDelay(true);
  createWebSocketConnection(socket, head);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Diversão com os amigos rodando na porta ${PORT}`);
});
