// QUADRANT - API сайта. Работает и в node server.js, и как функция Vercel (api/index.js).
const fs = require("fs"), path = require("path"), net = require("net"), crypto = require("crypto");
const { makeStore } = require("./store");
const env = process.env;
const CFG = {
  publicUrl: (env.PUBLIC_URL || (env.VERCEL_PROJECT_PRODUCTION_URL ? "https://" + env.VERCEL_PROJECT_PRODUCTION_URL : `http://localhost:${+env.PORT || 3000}`)).replace(/\/$/, ""),
  ip: env.SERVER_IP || "",
  mcHost: env.MC_HOST || "", mcPort: +env.MC_PORT || 25565,
  rconHost: env.RCON_HOST || env.MC_HOST || "127.0.0.1", rconPort: +env.RCON_PORT || 25575, rconPass: env.RCON_PASSWORD || "",
  whitelistFile: env.WHITELIST_FILE || "",
  autoWhitelist: env.AUTO_WHITELIST === "1",
  adminToken: env.ADMIN_TOKEN || "",
  // владельцы: этот ник + этот email автоматически получают роль администратора
  owners: (env.OWNERS || "ccotan:ccotanno@gmail.com").split(",").map(s => s.trim().split(":")).filter(x => x[0] && x[1]).map(([n, e]) => [n.toLowerCase(), e.toLowerCase()]),
  mapUrl: env.MAP_URL || "", mapEngine: env.MAP_ENGINE || "",
  statsDir: env.STATS_DIR || "",
  discord: { id: env.DISCORD_CLIENT_ID || "", secret: env.DISCORD_CLIENT_SECRET || "", guild: env.DISCORD_GUILD_ID || "", bot: env.DISCORD_BOT_TOKEN || "", invite: env.DISCORD_INVITE || "https://discord.gg/HnuYyrVPmS" },
};
const discordOn = () => !!(CFG.discord.id && CFG.discord.secret && CFG.discord.guild);
const db = makeStore(env, path.join(__dirname, "..", "data"));

const DEFAULT_PRODUCTS = [
  { id: "plus1", cat: "Подписки", title: "QUADRANT+ · 1 мес", desc: "Цветной ник в Discord, значок на сайте и приоритет в очереди заявок.", price: 149, skin: "jeb_", color: "#21A038" },
  { id: "plus3", cat: "Подписки", title: "QUADRANT+ · 3 мес", desc: "Всё из подписки на месяц, но на три месяца и дешевле.", price: 399, old: 447, badge: "Выгодно", skin: "Dinnerbone", color: "#0FA8E0" },
  { id: "twink", cat: "Аккаунт", title: "Твинк-аккаунт", desc: "Второй аккаунт в вайтлисте, привязанный к основному.", price: 129, old: 259, skin: "Alex", color: "#E9A23B" },
  { id: "rename", cat: "Аккаунт", title: "Смена аккаунта", desc: "Перенос прогресса и места в вайтлисте на новый ник.", price: 99, skin: "Grumm", color: "#3CC6C9" },
  { id: "warn", cat: "Ограничения", title: "Снятие варна", desc: "Снимает одно предупреждение с аккаунта.", price: 79, skin: "Notch", color: "#D9822B" },
  { id: "unban", cat: "Ограничения", title: "Разблокировка", desc: "Досрочная разблокировка. Не действует на баны за читы и гриферство.", price: 499, skin: "Steve", color: "#7A3FC2" },
  { id: "badge", cat: "Поддержка", title: "Значок сезона", desc: "Памятный значок «Сезон 1» в профиле на сайте и роль в Discord.", price: 59, skin: "Technoblade", color: "#E5578A" },
  { id: "donate", cat: "Поддержка", title: "Поддержать сервер", desc: "Помощь в оплате хостинга. Спасибо от всей команды!", price: 100, badge: "Спасибо", skin: "Herobrine", color: "#7DBE2E" },
];

// ---------- данные ----------
const getUser = k => k ? db.hget("users", String(k).toLowerCase()) : null;
const putUser = u => db.hset("users", u.nick.toLowerCase(), u);
const allUsers = async () => Object.values(await db.hall("users")).filter(Boolean);
const getState = async () => (await db.get("state")) || { announcement: { enabled: false, text: "", type: "info" }, log: [] };
const getProducts = async () => (await db.get("products")) || DEFAULT_PRODUCTS;
const getOrders = async () => (await db.get("orders")) || [];
async function audit(who, action, target, details = "") { const s = await getState(); s.log = [{ t: new Date().toISOString(), who, action, target, details }, ...(s.log || [])].slice(0, 300); await db.set("state", s); }

const TTL = 30 * 86400;
async function startSession(k) { const t = crypto.randomBytes(32).toString("hex"); await db.set("s:" + t, { nick: k }, TTL); const l = ((await db.get("us:" + k)) || []).slice(-19); l.push(t); await db.set("us:" + k, l, TTL); return t; }
async function killSessions(k, except) { const l = (await db.get("us:" + k)) || []; for (const t of l) if (t !== except) await db.del("s:" + t); await db.set("us:" + k, except && l.includes(except) ? [except] : [], TTL); }

const hash = (pw, salt = crypto.randomBytes(16).toString("hex")) => salt + ":" + crypto.scryptSync(pw, salt, 64).toString("hex");
const verify = (pw, stored) => { try { const [salt, h] = String(stored || "").split(":"); const a = Buffer.from(h || "", "hex"); return a.length === 64 && crypto.timingSafeEqual(a, crypto.scryptSync(pw, salt, 64)); } catch { return false; } };
const statusOf = u => u.banned ? "banned" : !(u.discord && u.discord.inGuild) ? "need_discord" : u.whitelisted ? "approved" : u.rejected ? "rejected" : "pending";
const isOwner = u => CFG.owners.some(([n, e]) => u.nick.toLowerCase() === n && String(u.email).toLowerCase() === e);
const plusOf = u => !!(u.plusUntil && new Date(u.plusUntil) > new Date());
const pub = u => ({ nick: u.nick, email: u.email, created: u.created, whitelisted: !!u.whitelisted, rejected: !!u.rejected, banned: !!u.banned, banReason: u.banReason || "", bio: u.bio || "", cover: u.cover || 0, coverImg: u.coverImg || "", plus: plusOf(u), plusUntil: u.plusUntil || null, role: u.role || "player", balance: Math.max(0, Math.round(+u.balance || 0)), discord: u.discord ? { username: u.discord.username || "", inGuild: !!u.discord.inGuild } : null });
// то, что видят другие игроки (без email, Discord и т.п.)
const publicView = (u, full) => ({ nick: u.nick, created: u.created, role: u.role || "player", plus: plusOf(u), banned: !!u.banned, bio: u.bio || "", cover: u.cover || 0, ...(full ? { coverImg: u.coverImg || "", whitelisted: !!u.whitelisted } : {}) });
const adminView = u => ({ ...pub(u), coverImg: undefined, status: statusOf(u), note: u.note || "", lastLogin: u.lastLogin || null, lastIp: u.lastIp || "", discord: u.discord || null });

const hits = new Map();
function limited(key, max = 10) { const now = Date.now(), a = (hits.get(key) || []).filter(t => now - t < 60000); a.push(now); hits.set(key, a); if (hits.size > 5000) hits.clear(); return a.length > max; }

// ---------- RCON ----------
function rcon(cmd) {
  return new Promise((resolve, reject) => {
    if (!CFG.rconPass) return reject(new Error("RCON не настроен (RCON_PASSWORD)"));
    const s = net.connect(CFG.rconPort, CFG.rconHost); let buf = Buffer.alloc(0), authed = false;
    const pkt = (id, type, body) => { const b = Buffer.from(body, "utf8"), p = Buffer.alloc(14 + b.length); p.writeInt32LE(10 + b.length, 0); p.writeInt32LE(id, 4); p.writeInt32LE(type, 8); b.copy(p, 12); return p; };
    s.setTimeout(4000, () => { s.destroy(); reject(new Error("RCON: таймаут")); });
    s.on("error", e => reject(new Error("RCON: " + e.message)));
    s.on("connect", () => s.write(pkt(1, 3, CFG.rconPass)));
    s.on("data", d => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 4) {
        const len = buf.readInt32LE(0); if (buf.length < len + 4) break;
        const id = buf.readInt32LE(4), body = buf.slice(12, len + 2).toString("utf8"); buf = buf.slice(len + 4);
        if (!authed) { if (id === -1) { s.destroy(); return reject(new Error("RCON: неверный пароль")); } authed = true; s.write(pkt(2, 2, cmd)); }
        else { s.end(); return resolve(body.replace(/§./g, "")); }
      }
    });
  });
}
async function mojangUUID(nick) {
  try { const r = await fetch("https://api.mojang.com/users/profiles/minecraft/" + encodeURIComponent(nick)); if (r.ok) return (await r.json()).id.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5"); } catch {}
  return null;
}
async function whitelist(nick, add) {
  if (CFG.rconPass) { await rcon(`whitelist ${add ? "add" : "remove"} ${nick}`); return true; }
  if (!CFG.whitelistFile) return false;
  let list = []; try { list = JSON.parse(fs.readFileSync(CFG.whitelistFile, "utf8")); } catch {}
  list = list.filter(e => e.name.toLowerCase() !== nick.toLowerCase());
  if (add) { const uuid = await mojangUUID(nick); if (uuid) list.push({ uuid, name: nick }); }
  fs.writeFileSync(CFG.whitelistFile, JSON.stringify(list, null, 2));
  return true;
}
async function playerStats(u) {
  if (!CFG.statsDir) return null;
  if (!u.uuid) { u.uuid = await mojangUUID(u.nick); if (u.uuid) await putUser(u); }
  if (!u.uuid) return null;
  const f = path.join(CFG.statsDir, u.uuid + ".json");
  let j; try { j = JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; }
  const c = (j.stats || {})["minecraft:custom"] || {}, k = (j.stats || {})["minecraft:killed"] || {};
  const ticks = c["minecraft:play_time"] || c["minecraft:play_one_minute"] || 0;
  const cm = ["walk_one_cm", "sprint_one_cm", "swim_one_cm", "fly_one_cm", "boat_one_cm", "horse_one_cm", "minecart_one_cm", "aviate_one_cm", "crouch_one_cm"].reduce((a, x) => a + (c["minecraft:" + x] || 0), 0);
  const h = Math.floor(ticks / 72000), m = Math.floor(ticks % 72000 / 1200);
  return { playTime: h ? `${h} ч ${m} мин` : `${m} мин`, deaths: c["minecraft:deaths"] || 0, mobKills: Object.values(k).reduce((a, b) => a + b, 0), distance: (cm / 100000).toFixed(1) + " км", lastSeen: fs.statSync(f).mtime.toISOString() };
}

// ---------- статус сервера (Server List Ping) ----------
const varint = n => { const b = []; do { let x = n & 0x7f; n >>>= 7; if (n) x |= 0x80; b.push(x); } while (n); return Buffer.from(b); };
const packet = (...p) => { const body = Buffer.concat(p); return Buffer.concat([varint(body.length), body]); };
function readVarint(buf, off) { let n = 0, s = 0, b; do { if (off >= buf.length) return null; b = buf[off++]; n |= (b & 0x7f) << s; s += 7; } while (b & 0x80); return [n, off]; }
let statusCache = { t: 0, v: null };
function pingMC() {
  return new Promise(resolve => {
    const sock = net.connect(CFG.mcPort, CFG.mcHost); let buf = Buffer.alloc(0);
    const done = v => { sock.destroy(); resolve(v); };
    sock.setTimeout(3000, () => done({ online: false })); sock.on("error", () => done({ online: false }));
    sock.on("connect", () => { const host = Buffer.from(CFG.mcHost), port = Buffer.alloc(2); port.writeUInt16BE(CFG.mcPort);
      sock.write(packet(varint(0), varint(767), varint(host.length), host, port, varint(1))); sock.write(packet(varint(0))); });
    sock.on("data", d => { buf = Buffer.concat([buf, d]); const len = readVarint(buf, 0); if (!len || buf.length < len[1] + len[0]) return;
      const id = readVarint(buf, len[1]), sl = readVarint(buf, id[1]);
      try { const j = JSON.parse(buf.slice(sl[1], sl[1] + sl[0]).toString("utf8"));
        done({ online: true, players: j.players.online, max: j.players.max, sample: (j.players.sample || []).map(p => p.name).filter(n => /^[A-Za-z0-9_]{3,16}$/.test(n)) }); }
      catch { done({ online: false }); } });
  });
}
async function serverStatus() { if (!CFG.mcHost) return { unknown: true }; if (Date.now() - statusCache.t > 30000) statusCache = { t: Date.now(), v: await pingMC() }; return statusCache.v; }

// ---------- Discord ----------
async function discordCallback(code, k) {
  const u = await getUser(k); if (!u) return "err";
  const tr = await fetch("https://discord.com/api/oauth2/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CFG.discord.id, client_secret: CFG.discord.secret, grant_type: "authorization_code", code, redirect_uri: CFG.publicUrl + "/api/discord/callback" }) });
  if (!tr.ok) return "err";
  const tok = await tr.json(), auth = { Authorization: "Bearer " + tok.access_token };
  const me = await (await fetch("https://discord.com/api/users/@me", { headers: auth })).json();
  if (!me.id) return "err";
  if ((await allUsers()).some(x => x.nick.toLowerCase() !== k && x.discord && x.discord.id === me.id)) return "taken";
  let inGuild = false;
  if (CFG.discord.bot) {
    const r = await fetch("https://discord.com/api/guilds/" + CFG.discord.guild + "/members/" + me.id, { method: "PUT", headers: { Authorization: "Bot " + CFG.discord.bot, "Content-Type": "application/json" }, body: JSON.stringify({ access_token: tok.access_token }) });
    inGuild = r.status === 201 || r.status === 204;
  }
  if (!inGuild) { const g = await (await fetch("https://discord.com/api/users/@me/guilds", { headers: auth })).json(); inGuild = Array.isArray(g) && g.some(x => x.id === CFG.discord.guild); }
  u.discord = { id: me.id, username: me.username, inGuild, linkedAt: new Date().toISOString() };
  if (inGuild && CFG.autoWhitelist && !u.banned && !u.rejected) { try { if (await whitelist(u.nick, true)) u.whitelisted = true; } catch {} }
  await putUser(u); await audit(u.nick, "discord_link", u.nick, `@${u.discord.username} ${inGuild ? "на сервере" : "не на сервере"}`);
  return inGuild ? "ok" : "notin";
}

// ---------- личные сообщения ----------
const pair = (a, b) => "dm:" + [a, b].sort().join("|");
async function unreadCount(k) { const ib = (await db.get("inbox:" + k)) || {}; return Object.values(ib).reduce((a, c) => a + (c.unread || 0), 0); }

// ---------- ответы ----------
const J = (status, json, headers = {}) => ({ status, json, headers });
const R = (to, headers = {}) => ({ status: 302, redirect: to, headers });

/**
 * req: { method, path, query: URLSearchParams, headers, ip, body, secure }
 * -> { status, json?, redirect?, headers }
 */
async function handle(req) {
  if (!db) return J(503, { error: "База данных не подключена. В Vercel: Storage → Upstash Redis → Connect, затем Redeploy." });
  const p = req.path, ip = req.ip || "?", q = req.query, b = req.body || {}, M = req.method;
  const cookie = t => `sid=${t}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${TTL}${req.secure ? "; Secure" : ""}`;
  const clear = { "Set-Cookie": "sid=; Path=/; Max-Age=0" };
  const tok = (String(req.headers.cookie || "").split(/;\s*/).map(c => c.split("=")).find(([k]) => k === "sid") || [])[1] || "";
  let meKey = null, U = null;
  if (/^[a-f0-9]{64}$/.test(tok)) { const s = await db.get("s:" + tok); if (s) { U = await getUser(s.nick); if (U && !U.banned) meKey = s.nick; else U = null; } }
  if (U && isOwner(U) && U.role !== "admin") { U.role = "admin"; await putUser(U); }
  const needAuth = () => J(401, { error: "Войдите в аккаунт" });

  // ===== админ-панель: админ по сессии или по ADMIN_TOKEN =====
  if (p.startsWith("/api/admin/")) {
    const t = String(req.headers["x-admin-token"] || "");
    const byToken = CFG.adminToken && t.length === CFG.adminToken.length && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(CFG.adminToken));
    const bySession = U && U.role === "admin";
    if (!byToken && !bySession) { if (t) limited("adm:" + ip, 5); return J(401, { error: U ? "Нет доступа: вы не администратор" : "Войдите как администратор" }); }
    return adminApi(p.slice(11), M, b, bySession ? U.nick : "admin", ip);
  }

  if (M === "GET") {
    if (p === "/api/config") { const s = await getState(); return J(200, { discordEnabled: discordOn(), discordInvite: CFG.discord.invite, ip: CFG.ip, mapUrl: CFG.mapUrl, mapEngine: CFG.mapEngine, announcement: s.announcement, db: db.kind }); }
    if (p === "/api/shop") return J(200, { products: (await getProducts()).filter(x => !x.hidden) });
    if (p === "/api/status") return J(200, await serverStatus());
    if (p === "/api/me") return J(200, { user: U ? { ...pub(U), unread: await unreadCount(meKey) } : null });
    if (p === "/api/stats") { if (!U) return needAuth(); return J(200, { stats: await playerStats(U).catch(() => null) }); }
    if (p === "/api/orders") { if (!U) return needAuth(); return J(200, { orders: (await getOrders()).filter(o => o.nick.toLowerCase() === meKey) }); }
    if (p === "/api/players") {
      const s = String(q.get("q") || "").toLowerCase().trim();
      const list = (await allUsers()).filter(u => !u.banned && (!s || u.nick.toLowerCase().includes(s)))
        .sort((a, b) => (b.role === "admin") - (a.role === "admin") || String(b.lastLogin || b.created).localeCompare(String(a.lastLogin || a.created)));
      return J(200, { total: list.length, players: list.slice(0, 200).map(u => publicView(u)) });
    }
    if (p === "/api/player") { const u = await getUser(String(q.get("nick") || "")); if (!u) return J(404, { error: "Игрок не найден" }); return J(200, { player: publicView(u, true) }); }
    if (p === "/api/messages") {
      if (!U) return needAuth();
      const ib = (await db.get("inbox:" + meKey)) || {};
      const convs = Object.entries(ib).map(([k, c]) => ({ nick: c.nick || k, last: c.last || "", mine: !!c.mine, at: c.at, unread: c.unread || 0 })).sort((a, b) => String(b.at).localeCompare(String(a.at)));
      return J(200, { convs });
    }
    if (p === "/api/messages/thread") {
      if (!U) return needAuth();
      const o = await getUser(String(q.get("with") || "")); if (!o) return J(404, { error: "Игрок не найден" });
      const ok = o.nick.toLowerCase(), msgs = (await db.get(pair(meKey, ok))) || [];
      const ib = (await db.get("inbox:" + meKey)) || {};
      if (ib[ok] && ib[ok].unread) { ib[ok].unread = 0; await db.set("inbox:" + meKey, ib); }
      return J(200, { with: publicView(o), messages: msgs.map(m => ({ from: m.f, text: m.x, at: m.t })) });
    }
    if (p === "/api/discord/login") {
      if (!U || !discordOn()) return R("/?discord=err");
      const st = crypto.randomBytes(16).toString("hex"); await db.set("oa:" + st, { k: meKey }, 600);
      const scope = CFG.discord.bot ? "identify guilds guilds.join" : "identify guilds";
      return R("https://discord.com/oauth2/authorize?" + new URLSearchParams({ client_id: CFG.discord.id, redirect_uri: CFG.publicUrl + "/api/discord/callback", response_type: "code", scope, state: st, prompt: "none" }));
    }
    if (p === "/api/discord/callback") {
      const sk = "oa:" + String(q.get("state") || "").replace(/[^a-f0-9]/g, ""), st = await db.get(sk); await db.del(sk);
      if (!st || !q.get("code")) return R("/?discord=err");
      return R("/?discord=" + await discordCallback(q.get("code"), st.k).catch(() => "err"));
    }
    return J(404, { error: "Not found" });
  }
  if (M !== "POST") return J(405, { error: "Method not allowed" });

  if (p === "/api/register") {
    if (limited("auth:" + ip)) return J(429, { error: "Слишком много попыток, подождите минуту" });
    const nick = String(b.nick || "").trim(), email = String(b.email || "").trim().toLowerCase(), pw = String(b.password || "");
    if (!/^[A-Za-z0-9_]{3,16}$/.test(nick)) return J(400, { error: "Некорректный ник" });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) return J(400, { error: "Некорректный email" });
    if (pw.length < 8 || pw.length > 200) return J(400, { error: "Пароль должен быть от 8 символов" });
    const k = nick.toLowerCase();
    if (await getUser(k)) return J(409, { error: "Этот ник уже зарегистрирован" });
    if ((await allUsers()).some(u => u.email === email)) return J(409, { error: "Email уже используется" });
    const now = new Date().toISOString();
    const u = { nick, email, hash: hash(pw), created: now, whitelisted: false, discord: null, role: "player", balance: 0, lastLogin: now, lastIp: ip };
    if (isOwner(u)) u.role = "admin";
    await putUser(u); await audit(nick, "register", nick);
    return J(201, { user: { ...pub(u), unread: 0 } }, { "Set-Cookie": cookie(await startSession(k)) });
  }
  if (p === "/api/login") {
    if (limited("auth:" + ip)) return J(429, { error: "Слишком много попыток, подождите минуту" });
    const login = String(b.login || "").trim().toLowerCase();
    let u = await getUser(login); if (!u && login.includes("@")) u = (await allUsers()).find(x => x.email === login);
    if (!u || !verify(String(b.password || ""), u.hash)) return J(401, { error: "Неверный ник или пароль" });
    if (u.banned) return J(403, { error: "Аккаунт заблокирован" + (u.banReason ? ": " + u.banReason : "") });
    u.lastLogin = new Date().toISOString(); u.lastIp = ip; if (isOwner(u)) u.role = "admin"; await putUser(u);
    const k = u.nick.toLowerCase();
    return J(200, { user: { ...pub(u), unread: await unreadCount(k) } }, { "Set-Cookie": cookie(await startSession(k)) });
  }
  if (p === "/api/logout") { if (tok) await db.del("s:" + tok); return J(200, { ok: true }, clear); }
  if (!U) return needAuth();
  const checkPw = pw => verify(String(pw || ""), U.hash);

  if (p === "/api/profile") {
    U.bio = String(b.bio || "").replace(/\s+/g, " ").trim().slice(0, 160); U.cover = Math.max(0, Math.min(5, +b.cover || 0));
    if (typeof b.coverImg === "string") { if (b.coverImg && (!/^data:image\/(jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(b.coverImg) || b.coverImg.length > 5e5)) return J(400, { error: "Фото слишком большое или неподходящее" }); U.coverImg = b.coverImg; }
    await putUser(U); return J(200, { user: pub(U) });
  }
  if (p === "/api/password") {
    if (limited("pw:" + ip)) return J(429, { error: "Слишком много попыток" });
    if (!checkPw(b.current)) return J(400, { error: "Текущий пароль неверный" });
    if (String(b.next || "").length < 8) return J(400, { error: "Новый пароль короче 8 символов" });
    U.hash = hash(String(b.next)); await putUser(U); await killSessions(meKey, tok); await audit(U.nick, "password", U.nick); return J(200, { ok: true });
  }
  if (p === "/api/email") {
    if (limited("pw:" + ip)) return J(429, { error: "Слишком много попыток" });
    const email = String(b.email || "").trim().toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return J(400, { error: "Некорректный email" });
    if (!checkPw(b.password)) return J(400, { error: "Пароль неверный" });
    if ((await allUsers()).some(x => x.nick.toLowerCase() !== meKey && x.email === email)) return J(409, { error: "Email уже используется" });
    U.email = email; await putUser(U); return J(200, { user: pub(U) });
  }
  if (p === "/api/discord/unlink") { if (U.whitelisted) await whitelist(U.nick, false).catch(() => {}); U.discord = null; U.whitelisted = false; await putUser(U); await audit(U.nick, "discord_unlink", U.nick); return J(200, { user: pub(U) }); }
  if (p === "/api/logout-all") { await killSessions(meKey); return J(200, { ok: true }, clear); }
  if (p === "/api/delete-account") {
    if (!checkPw(b.password)) return J(400, { error: "Пароль неверный" });
    await whitelist(U.nick, false).catch(() => {}); await audit(U.nick, "self_delete", U.nick); await db.hdel("users", meKey); await killSessions(meKey);
    return J(200, { ok: true }, clear);
  }
  if (p === "/api/order") {
    if (limited("ord:" + ip, 20)) return J(429, { error: "Слишком много запросов" });
    const pr = (await getProducts()).find(x => x.id === b.product && !x.hidden); if (!pr) return J(404, { error: "Товар не найден" });
    const o = { id: "Q" + Date.now().toString(36).toUpperCase() + crypto.randomBytes(2).toString("hex").toUpperCase(), nick: U.nick, product: pr.id, title: pr.title, price: pr.price, method: b.method === "sbp" ? "sbp" : "card", status: "awaiting_payment", created: new Date().toISOString() };
    const orders = await getOrders(); orders.unshift(o); await db.set("orders", orders.slice(0, 2000)); await audit(U.nick, "order", U.nick, `${o.id} · ${pr.title} · ${pr.price} ₽`);
    return J(201, { order: o });
  }
  if (p === "/api/messages/send") {
    if (limited("msg:" + meKey, 20)) return J(429, { error: "Слишком часто. Подождите немного" });
    const o = await getUser(String(b.to || "")); if (!o) return J(404, { error: "Игрок не найден" });
    const ok = o.nick.toLowerCase(); if (ok === meKey) return J(400, { error: "Нельзя написать самому себе" });
    const text = String(b.text || "").replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim().slice(0, 1000);
    if (!text) return J(400, { error: "Пустое сообщение" });
    const t = new Date().toISOString(), key = pair(meKey, ok);
    const msgs = (await db.get(key)) || []; msgs.push({ f: U.nick, x: text, t }); await db.set(key, msgs.slice(-300));
    const short = text.slice(0, 80);
    const mine = (await db.get("inbox:" + meKey)) || {}; mine[ok] = { nick: o.nick, last: short, mine: true, at: t, unread: 0 }; await db.set("inbox:" + meKey, mine);
    const their = (await db.get("inbox:" + ok)) || {}; their[meKey] = { nick: U.nick, last: short, mine: false, at: t, unread: ((their[meKey] || {}).unread || 0) + 1 }; await db.set("inbox:" + ok, their);
    return J(201, { message: { from: U.nick, text, at: t } });
  }
  return J(404, { error: "Not found" });
}

async function adminApi(p, M, b, who, ip) {
  if (p === "me") return J(200, { ok: true, who });
  if (p === "overview") {
    const list = await allUsers(), orders = await getOrders(), state = await getState(), counts = {};
    list.forEach(u => { const s = statusOf(u); counts[s] = (counts[s] || 0) + 1; });
    const revenue = orders.filter(o => o.status === "done" || o.status === "paid").reduce((a, o) => a + o.price, 0);
    const days = [...Array(14)].map((_, i) => { const d = new Date(Date.now() - (13 - i) * 864e5).toISOString().slice(0, 10); return { d, n: list.filter(u => String(u.created).slice(0, 10) === d).length }; });
    return J(200, { total: list.length, counts, days, revenue, newOrders: orders.filter(o => o.status === "awaiting_payment" || o.status === "paid").length, server: await serverStatus(), rcon: !!CFG.rconPass, discord: discordOn(), autoWhitelist: CFG.autoWhitelist, recent: (state.log || []).slice(0, 6) });
  }
  if (p === "users") return J(200, { users: (await allUsers()).map(adminView).sort((a, b) => String(b.created).localeCompare(String(a.created))) });
  if (p === "log") return J(200, { log: (await getState()).log || [] });
  if (p === "orders") return J(200, { orders: await getOrders() });
  if (p === "products" && M === "GET") return J(200, { products: await getProducts() });
  if (p === "announcement" && M === "GET") return J(200, (await getState()).announcement);
  if (M !== "POST") return J(404, { error: "Not found" });
  if (p === "announcement") { const s = await getState(); s.announcement = { enabled: !!b.enabled, text: String(b.text || "").slice(0, 300), type: b.type === "warn" ? "warn" : "info" }; await db.set("state", s); await audit(who, "announcement", "-", s.announcement.enabled ? s.announcement.text : "выключено"); return J(200, s.announcement); }
  if (p === "order") {
    const orders = await getOrders(), o = orders.find(x => x.id === b.id); if (!o) return J(404, { error: "Заказ не найден" });
    if (!["awaiting_payment", "paid", "done", "cancelled"].includes(b.status)) return J(400, { error: "Неверный статус" });
    o.status = b.status; o.updated = new Date().toISOString();
    if (b.status === "done" && /^plus(\d)$/.test(o.product)) { const u = await getUser(o.nick); if (u) { const months = +o.product.slice(4), base = plusOf(u) ? new Date(u.plusUntil) : new Date(); base.setMonth(base.getMonth() + months); u.plusUntil = base.toISOString(); await putUser(u); } }
    await db.set("orders", orders); await audit(who, "order_status", o.nick, `${o.id} → ${b.status}`); return J(200, { order: o });
  }
  if (p === "products") {
    if (!Array.isArray(b.products)) return J(400, { error: "Нужен список товаров" });
    const products = b.products.slice(0, 100).map(x => ({ id: String(x.id || crypto.randomBytes(3).toString("hex")).replace(/[^\w-]/g, "").slice(0, 32), cat: String(x.cat || "Прочее").slice(0, 40), title: String(x.title || "Товар").slice(0, 60), desc: String(x.desc || "").slice(0, 200),
      price: Math.max(0, Math.round(+x.price || 0)), old: +x.old > 0 ? Math.round(+x.old) : undefined, badge: x.badge ? String(x.badge).slice(0, 20) : undefined, skin: String(x.skin || "Steve").replace(/[^\w]/g, "").slice(0, 16), color: /^#[0-9a-f]{6}$/i.test(x.color) ? x.color : "#21A038", hidden: !!x.hidden }));
    await db.set("products", products); await audit(who, "products", "-", `${products.length} товаров`); return J(200, { products });
  }
  if (p === "rcon") { const c = String(b.command || "").replace(/^\//, "").trim(); if (!c) return J(400, { error: "Пустая команда" });
    try { const out = await rcon(c); await audit(who, "rcon", "-", c); return J(200, { output: out || "(пустой ответ)" }); } catch (e) { return J(502, { error: e.message }); } }
  if (p === "update") {
    const u = await getUser(String(b.nick || "")); if (!u) return J(404, { error: "Игрок не найден" });
    if (b.role !== undefined) u.role = isOwner(u) ? "admin" : ["player", "helper", "moderator", "admin"].includes(b.role) ? b.role : "player";
    if (b.note !== undefined) u.note = String(b.note).slice(0, 1000);
    if (b.balance !== undefined && b.balance !== "") u.balance = Math.max(0, Math.min(1e9, Math.round(+b.balance || 0)));
    await putUser(u); await audit(who, "update", u.nick, `роль: ${u.role || "player"}, баланс: ${u.balance || 0}`); return J(200, { user: adminView(u) });
  }
  if (p === "action") {
    const errors = [];
    for (const n of (Array.isArray(b.nicks) ? b.nicks : [b.nick]).slice(0, 200)) {
      const u = await getUser(String(n || "")); if (!u) continue; const k = u.nick.toLowerCase();
      try {
        switch (b.action) {
          case "approve": await whitelist(u.nick, true); u.whitelisted = true; u.rejected = false; break;
          case "reject": if (u.whitelisted) await whitelist(u.nick, false); u.whitelisted = false; u.rejected = true; break;
          case "unwhitelist": await whitelist(u.nick, false); u.whitelisted = false; break;
          case "ban": if (isOwner(u)) throw new Error("нельзя заблокировать владельца");
            u.banned = true; u.banReason = String(b.reason || "").slice(0, 200); u.whitelisted = false;
            if (CFG.rconPass) await rcon(`ban ${u.nick} ${u.banReason || "Нарушение правил"}`); await whitelist(u.nick, false).catch(() => {}); await killSessions(k); break;
          case "unban": u.banned = false; u.banReason = ""; if (CFG.rconPass) await rcon(`pardon ${u.nick}`); break;
          case "discord_ok": u.discord = { ...(u.discord || {}), inGuild: true, manual: true }; break;
          case "discord_reset": u.discord = null; break;
          case "kick": await rcon(`kick ${u.nick} ${b.reason || ""}`.trim()); break;
          case "reset_password": { const pw = crypto.randomBytes(6).toString("base64url"); u.hash = hash(pw); await putUser(u); await killSessions(k); await audit(who, b.action, u.nick); return J(200, { ok: true, password: pw }); }
          case "delete": if (isOwner(u)) throw new Error("нельзя удалить владельца"); await whitelist(u.nick, false).catch(() => {}); await db.hdel("users", k); await killSessions(k); await audit(who, "delete", u.nick); continue;
          default: return J(400, { error: "Неизвестное действие" });
        }
        await putUser(u); await audit(who, b.action, u.nick, b.reason || "");
      } catch (e) { errors.push(`${u.nick}: ${e.message}`); }
    }
    return J(errors.length ? 207 : 200, { ok: !errors.length, errors });
  }
  return J(404, { error: "Not found" });
}

module.exports = { handle, CFG, db };
