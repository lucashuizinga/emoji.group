// Local preview server for the generated site.
//   npm run serve   (override the port with PORT=...)
// Mirrors the vercel.json behaviour: clean URLs (/blue serves blue.html,
// /blue.json serves the data) and the custom 404, so localhost behaves like
// production.

import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { ROOT, log } from "../lib/util.js";

const OUT = `${ROOT}/site/public`;
const PORT = Number(process.env.PORT) || 4319;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".xml": "application/xml; charset=utf-8",
  ".png": "image/png",
};

function serveFile(res, file, status = 200) {
  const ext = file.slice(file.lastIndexOf("."));
  const headers = { "content-type": TYPES[ext] || "application/octet-stream" };
  if (ext === ".json") headers["access-control-allow-origin"] = "*"; // matches vercel.json
  res.writeHead(status, headers);
  res.end(readFileSync(file));
}

const server = createServer((req, res) => {
  const pathname = decodeURIComponent(req.url.split("?")[0]);
  let file = `${OUT}${pathname}`;
  if (pathname.endsWith("/")) file = `${OUT}${pathname}index.html`;
  else if (existsSync(file) && statSync(file).isDirectory()) file = `${file}/index.html`;
  else if (!existsSync(file) && existsSync(`${file}.html`)) file = `${file}.html`; // clean URLs

  if (!existsSync(file) || statSync(file).isDirectory()) {
    const notFound = `${OUT}/404.html`;
    if (existsSync(notFound)) return serveFile(res, notFound, 404);
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
    return;
  }
  serveFile(res, file);
});

server.listen(PORT, () => {
  log(`emoji.group preview at http://localhost:${PORT}  (override with PORT=...)`);
  log("  try /  ·  /blue  ·  /kid-safe  ·  /emojis.json  ·  curl -H 'accept: application/json' /blue");
});
