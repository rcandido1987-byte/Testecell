
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;

// Aceita tanto "Public" quanto "public".
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

const server = http.createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("ok");
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

  if (requestPath === "/") {
    requestPath = "/index.html";
  }

  const filePath = path.resolve(PUBLIC_DIR, "." + requestPath);
  const publicPath = path.resolve(PUBLIC_DIR);

  // Impede que um endereço acesse arquivos fora da pasta Public.
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
        if (!res.headersSent) {
          res.writeHead(500);
        }
        res.end("Erro ao carregar o arquivo.");
      })
      .pipe(res);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Testecell rodando na porta ${PORT}`);
});
