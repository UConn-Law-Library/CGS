#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

const root = path.resolve("dist");
const mime = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"]
]);

const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost");
  const requested = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
  let file = path.resolve(root, requested);
  if (!file.startsWith(`${root}${path.sep}`) && file !== root) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  const info = await stat(file).catch(() => null);
  if (info?.isDirectory()) file = path.join(file, "index.html");
  const finalInfo = await stat(file).catch(() => null);
  if (!finalInfo?.isFile()) file = path.join(root, "404.html");
  response.writeHead(finalInfo?.isFile() ? 200 : 404, { "content-type": mime.get(path.extname(file)) ?? "application/octet-stream" });
  createReadStream(file).pipe(response);
});

server.listen(4173, "127.0.0.1", () => console.log("Serving http://localhost:4173"));
