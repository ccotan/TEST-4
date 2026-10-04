// QUADRANT - локальный сервер сайта. Без зависимостей: node server.js
// Данные: data/db.json (или Upstash Redis, если заданы KV_REST_API_URL / KV_REST_API_TOKEN).
const http = require("http"), fs = require("fs"), path = require("path");
const { handle, CFG } = require("./lib/core");
const PORT = +process.env.PORT || 3000;
const PUB = path.join(__dirname, "public");
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".webp": "image/webp", ".jpg": "image/jpeg", ".gif": "image/gif", ".woff2": "font/woff2" };
function serveStatic(res, p) {
  let rel; try { rel = decodeURIComponent(p === "/" ? "/index.html" : p); } catch { return false; }
  if (!path.extname(rel)) rel += ".html";
  const file = path.normalize(path.join(PUB, rel));
  if (!file.startsWith(PUB + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  const ext = path.extname(file);
  res.writeHead(200, { "Content-Type": TYPES[ext] || "application/octet-stream", "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600", "X-Content-Type-Options": "nosniff" });
  fs.createReadStream(file).pipe(res); return true;
}
const readBody = req => new Promise(r => { let d = ""; req.on("data", c => { d += c; if (d.length > 6e5) req.destroy(); }); req.on("end", () => { try { r(JSON.parse(d || "{}")); } catch { r({}); } }); req.on("error", () => r({})); });

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x"), p = url.pathname;
  try {
    if (!p.startsWith("/api/")) {
      if (req.method === "GET" && serveStatic(res, p)) return;
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(fs.readFileSync(path.join(PUB, "404.html")));
    }
    const out = await handle({ method: req.method, path: p, query: url.searchParams, headers: req.headers, ip: req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket.remoteAddress,
      body: req.method === "POST" ? await readBody(req) : {}, secure: CFG.publicUrl.startsWith("https") });
    if (out.redirect) { res.writeHead(302, { Location: out.redirect, ...out.headers }); return res.end(); }
    res.writeHead(out.status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...out.headers }); res.end(JSON.stringify(out.json));
  } catch (e) { console.error(e); if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "Внутренняя ошибка" })); }
}).listen(PORT, () => console.log(`QUADRANT: http://localhost:${PORT}  ·  админка: /admin`));
