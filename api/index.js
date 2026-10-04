// Vercel Serverless Function: все запросы /api/* попадают сюда (см. vercel.json)
const { handle } = require("../lib/core");

const readBody = req => new Promise(r => {
  if (req.body !== undefined) { if (typeof req.body === "string") { try { return r(JSON.parse(req.body || "{}")); } catch { return r({}); } } return r(req.body || {}); }
  let d = ""; req.on("data", c => { d += c; if (d.length > 6e5) req.destroy(); }); req.on("end", () => { try { r(JSON.parse(d || "{}")); } catch { r({}); } }); req.on("error", () => r({}));
});

module.exports = async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    const q = url.searchParams, sub = q.get("__path");
    q.delete("__path");
    const p = sub != null ? "/api/" + sub.replace(/^\/+/, "") : url.pathname;
    const out = await handle({ method: req.method, path: p, query: q, headers: req.headers,
      ip: String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress,
      body: req.method === "POST" ? await readBody(req) : {}, secure: String(req.headers["x-forwarded-proto"] || "https").startsWith("https") });
    if (out.redirect) { res.writeHead(302, { Location: out.redirect, ...out.headers }); return res.end(); }
    res.writeHead(out.status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...out.headers });
    res.end(JSON.stringify(out.json));
  } catch (e) {
    console.error(e);
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Ошибка сервера: " + e.message }));
  }
};
