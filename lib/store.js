// Хранилище данных: Upstash Redis (Vercel) или JSON-файл (локально / VPS).
const fs = require("fs"), path = require("path");

function redisStore(url, token) {
  const cmd = async (...c) => {
    const r = await fetch(url.replace(/\/$/, ""), { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify(c) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error("Redis: " + (j.error || r.status));
    return j.result;
  };
  const P = v => { if (v == null) return null; try { return JSON.parse(v); } catch { return null; } };
  return {
    kind: "redis",
    get: async k => P(await cmd("GET", k)),
    set: (k, v, ttl) => ttl ? cmd("SET", k, JSON.stringify(v), "EX", String(Math.ceil(ttl))) : cmd("SET", k, JSON.stringify(v)),
    del: k => cmd("DEL", k),
    hget: async (h, f) => P(await cmd("HGET", h, f)),
    hset: (h, f, v) => cmd("HSET", h, f, JSON.stringify(v)),
    hdel: (h, f) => cmd("HDEL", h, f),
    hall: async h => { const a = await cmd("HGETALL", h) || [], o = {}; if (Array.isArray(a)) for (let i = 0; i < a.length; i += 2) o[a[i]] = P(a[i + 1]); else for (const k in a) o[k] = P(a[k]); return o; },
    incr: (k, ttl) => cmd("INCR", k).then(async n => { if (n === 1 && ttl) await cmd("EXPIRE", k, String(ttl)); return n; }),
  };
}

function fileStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "db.json");
  let db;
  try { db = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch {
    db = { kv: {}, h: { users: {} } };
    // перенос старых файлов (users.json, orders.json ...)
    const old = f => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { return null; } };
    const u = old("users.json"); if (u) db.h.users = u;
    for (const [f, k] of [["orders.json", "orders"], ["products.json", "products"], ["state.json", "state"]]) { const v = old(f); if (v) db.kv[k] = { v }; }
  }
  db.kv = db.kv || {}; db.h = db.h || {};
  let t = null;
  const save = () => { clearTimeout(t); t = setTimeout(flush, 200); };
  const flush = () => { clearTimeout(t); const now = Date.now(); for (const k in db.kv) if (db.kv[k].exp && db.kv[k].exp < now) delete db.kv[k]; fs.writeFileSync(file + ".tmp", JSON.stringify(db)); fs.renameSync(file + ".tmp", file); };
  process.on("exit", () => { try { flush(); } catch {} });
  const live = k => { const e = db.kv[k]; if (!e) return null; if (e.exp && e.exp < Date.now()) { delete db.kv[k]; return null; } return e; };
  const clone = v => v == null ? null : JSON.parse(JSON.stringify(v));
  return {
    kind: "file", flush,
    get: async k => clone(live(k)?.v),
    set: async (k, v, ttl) => { db.kv[k] = { v: clone(v), exp: ttl ? Date.now() + ttl * 1000 : 0 }; save(); },
    del: async k => { delete db.kv[k]; save(); },
    hget: async (h, f) => clone((db.h[h] || {})[f]),
    hset: async (h, f, v) => { (db.h[h] = db.h[h] || {})[f] = clone(v); save(); },
    hdel: async (h, f) => { if (db.h[h]) delete db.h[h][f]; save(); },
    hall: async h => clone(db.h[h] || {}),
    incr: async (k, ttl) => { const e = live(k); const n = (e ? e.v : 0) + 1; db.kv[k] = { v: n, exp: e ? e.exp : ttl ? Date.now() + ttl * 1000 : 0 }; return n; },
  };
}

function makeStore(env, dataDir) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL, token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return redisStore(url, token);
  if (env.VERCEL) return null; // на Vercel файлы не сохраняются - нужна база
  return fileStore(dataDir);
}
module.exports = { makeStore };
