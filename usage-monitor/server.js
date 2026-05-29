import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildUsageReport } from "./lib/usage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const port = Number(process.env.PORT || 8765);
const host = process.env.HOST || "127.0.0.1";

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/api/usage") {
    const days = Number(url.searchParams.get("days") || process.env.USAGE_MONITOR_DAYS || 30);
    const report = await buildUsageReport({ days, pricingPath: path.join(__dirname, "data", "pricing.json") });
    sendJson(res, report);
    return;
  }

  const filePath = safePublicPath(url.pathname);
  if (!filePath) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  streamFile(res, filePath);
});

server.listen(port, host, () => {
  console.log(`Agent usage monitor running at http://${host}:${port}`);
});

function safePublicPath(pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const resolved = path.resolve(publicDir, `.${requested}`);
  if (!resolved.startsWith(publicDir)) return null;
  return fs.existsSync(resolved) ? resolved : null;
}

function streamFile(res, filePath) {
  const ext = path.extname(filePath);
  const type = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8"
  }[ext] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": type });
  fs.createReadStream(filePath).pipe(res);
}

function sendJson(res, data) {
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(data));
}
