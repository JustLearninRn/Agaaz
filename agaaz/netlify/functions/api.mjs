import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";

export const config = { path: "/api/*" };

const J = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const clean = (s) => String(s ?? "").replace(/[^\w-]/g, "").slice(0, 60);
const PW = { admin: () => process.env.ADMIN_PASSWORD || "", super: () => process.env.SUPER_ADMIN_PASSWORD || "" };
const DEF = { presenter: "SRM UNIVERSITY", title: "AAGAAZ 2k26", tagline: "The Fresher's Gala · Crown your Mr. & Miss Fresher" };

const hk = () => crypto.createHash("sha256").update("aagaaz2k26|" + PW.admin() + "|" + PW.super()).digest();
const sign = (p) => crypto.createHmac("sha256", hk()).update(p).digest("base64url");
const mkToken = (role) => { const p = `${Date.now() + 12 * 3600e3}_${role}`; return p + "." + sign(p); };
function roleOf(req) {
  const t = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
  const [p, s] = t.split(".");
  if (!p || !s) return null;
  const e = sign(p);
  if (e.length !== s.length || !crypto.timingSafeEqual(Buffer.from(e), Buffer.from(s))) return null;
  const [exp, role] = p.split("_");
  if (Number(exp) < Date.now() || !PW[role] || !PW[role]()) return null;
  return role;
}
function samePw(input, expected) {
  if (!expected) return false;
  const h = (x) => crypto.createHash("sha256").update(String(x)).digest();
  return crypto.timingSafeEqual(h(input), h(expected));
}
async function all(s, prefix) {
  const { blobs } = await s.list({ prefix });
  const out = [];
  for (let i = 0; i < blobs.length; i += 25) {
    const part = await Promise.all(blobs.slice(i, i + 25).map(async (b) => {
      const v = await s.get(b.key, { type: "json" });
      return v ? { ...v, _key: b.key } : null;
    }));
    out.push(...part.filter(Boolean));
  }
  return out;
}
let cache = { t: 0, v: null };
async function counts(s) {
  if (cache.v && Date.now() - cache.t < 15000) return cache.v;
  const vs = await all(s, "vote:"); const c = {};
  vs.forEach((v) => { c[v.m] = (c[v.m] || 0) + 1; c[v.f] = (c[v.f] || 0) + 1; });
  cache = { t: Date.now(), v: c }; return c;
}
function winnersOf(cs, c) {
  const out = {};
  for (const g of ["M", "F"]) {
    const l = cs.filter((x) => x.gender === g).map((x) => ({ ...x, n: c[x.id] || 0 })).sort((a, b) => b.n - a.n);
    const top = l[0]?.n || 0;
    out[g] = { winners: top > 0 ? l.filter((x) => x.n === top) : [], ranking: l.slice(0, 5) };
  }
  return out;
}
const logAct = (s, role, action, detail = "") =>
  s.set("log:" + Date.now() + "-" + Math.random().toString(36).slice(2, 6), JSON.stringify({ t: Date.now(), role, action, detail })).catch(() => {});
const body = async (req) => { try { return await req.json(); } catch { return {}; } };
const site = (st) => ({ presenter: st.presenter || DEF.presenter, title: st.title || DEF.title, tagline: st.tagline || DEF.tagline });

export default async (req) => {
  const s = getStore({ name: "agaaz2k26", consistency: "strong" });
  const path = new URL(req.url).pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
  const m = req.method;
  try {
    /* ---------- public ---------- */
    if (path === "public" && m === "GET") {
      const [cs, st0] = await Promise.all([all(s, "contestant:"), s.get("settings", { type: "json" })]);
      const st = st0 || {};
      const contestants = cs.map(({ _key, ...c }) => c).sort((a, b) => (a.order || 0) - (b.order || 0));
      const pub = { contestants, open: st.open !== false, site: site(st), board: null, winners: null };
      if (st.showBoard || st.winners) {
        const c = await counts(s);
        if (st.showBoard) pub.board = c;
        if (st.winners) pub.winners = winnersOf(contestants, c);
      }
      return J(pub);
    }
    if (path.startsWith("img/") && m === "GET") {
      const r = await s.getWithMetadata("img:" + clean(path.slice(4)), { type: "arrayBuffer" });
      if (!r) return new Response("", { status: 404 });
      return new Response(r.data, { headers: { "content-type": r.metadata?.type || "image/jpeg", "cache-control": "public, max-age=31536000, immutable" } });
    }
    if (path === "vote" && m === "POST") {
      const b = await body(req);
      const reg = String(b.reg || "").trim().toUpperCase().slice(0, 30);
      const id = reg.replace(/[^A-Z0-9]/g, "");
      const name = String(b.name || "").trim().slice(0, 80);
      const phone = String(b.phone || "").trim();
      if (!id || !name || !/^\d{10}$/.test(phone)) return J({ error: "Please fill all details correctly (10-digit phone)." }, 400);
      const st = await s.get("settings", { type: "json" });
      if (st && (st.open === false || st.winners)) return J({ error: "Voting is closed." }, 403);
      const [cm, cf] = await Promise.all([s.get("contestant:" + clean(b.m), { type: "json" }), s.get("contestant:" + clean(b.f), { type: "json" })]);
      if (!cm || cm.gender !== "M" || !cf || cf.gender !== "F") return J({ error: "Invalid selection. Please refresh and try again." }, 400);
      const r = await s.set("vote:" + id, JSON.stringify({ reg, name, phone, m: cm.id, f: cf.id, t: Date.now() }), { onlyIfNew: true });
      if (!r.modified) return J({ error: "This registration number has already voted." }, 409);
      return J({ ok: true });
    }

    /* ---------- logins ---------- */
    if ((path === "admin/login" || path === "super/login") && m === "POST") {
      const role = path.startsWith("super") ? "super" : "admin";
      if (!PW[role]()) return J({ error: (role === "super" ? "SUPER_ADMIN_PASSWORD" : "ADMIN_PASSWORD") + " is not set on the server." }, 500);
      const b = await body(req);
      if (!samePw(b.password ?? "", PW[role]())) return J({ error: "Wrong password" }, 401);
      await logAct(s, role, "login");
      return J({ token: mkToken(role), role });
    }

    /* ---------- admin + super ---------- */
    if (path.startsWith("admin/")) {
      const role = roleOf(req);
      if (!role) return J({ error: "unauthorized" }, 401);

      if (path === "admin/data" && m === "GET") {
        const [cs, vs, st0] = await Promise.all([all(s, "contestant:"), all(s, "vote:"), s.get("settings", { type: "json" })]);
        const st = st0 || {};
        const data = { role, contestants: cs.map(({ _key, ...c }) => c), votes: vs.map(({ _key, ...v }) => ({ ...v, id: _key.slice(5) })), open: st.open !== false, showBoard: !!st.showBoard, winners: !!st.winners, site: site(st) };
        if (role === "super") {
          const { blobs } = await s.list({ prefix: "log:" });
          const keys = blobs.map((b) => b.key).sort().reverse().slice(0, 150);
          data.log = (await Promise.all(keys.map((k) => s.get(k, { type: "json" })))).filter(Boolean);
        }
        return J(data);
      }
      if (path === "admin/contestant" && m === "POST") {
        const b = await body(req);
        const id = clean(b.id) || "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        const old = await s.get("contestant:" + id, { type: "json" });
        const name = String(b.name || "").trim().slice(0, 80);
        if (!name || !["M", "F"].includes(b.gender)) return J({ error: "Name and category required" }, 400);
        let img = old?.img || 0;
        if (b.image) {
          const mt = /^data:(image\/[\w+.-]+);base64,(.+)$/.exec(b.image);
          if (!mt) return J({ error: "Bad image" }, 400);
          const buf = Buffer.from(mt[2], "base64");
          if (buf.length > 4e6) return J({ error: "Image too large" }, 400);
          await s.set("img:" + id, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length), { metadata: { type: mt[1] } });
          img = Date.now();
        }
        await s.set("contestant:" + id, JSON.stringify({ id, name, gender: b.gender, talent: String(b.talent || "").trim().slice(0, 200), img, order: old?.order || Date.now() }));
        await logAct(s, role, old ? "edit contestant" : "add contestant", name);
        return J({ ok: true, id });
      }
      if (path.startsWith("admin/contestant/") && m === "DELETE") {
        const id = clean(path.split("/")[2]);
        const old = await s.get("contestant:" + id, { type: "json" });
        await Promise.all([s.delete("contestant:" + id), s.delete("img:" + id)]);
        await logAct(s, role, "delete contestant", old?.name || id);
        return J({ ok: true });
      }
      if (path.startsWith("admin/vote/") && m === "DELETE") {
        const id = clean(path.split("/")[2]);
        const old = await s.get("vote:" + id, { type: "json" });
        await s.delete("vote:" + id);
        cache.v = null;
        await logAct(s, role, "remove vote", old ? `${old.reg} · ${old.name} · ${old.phone}` : id);
        return J({ ok: true });
      }
      if (path === "admin/settings" && m === "POST") {
        const b = await body(req);
        const n = { ...((await s.get("settings", { type: "json" })) || {}) };
        const ch = [];
        for (const k of ["open", "showBoard", "winners"]) if (k in b) { n[k] = !!b[k]; ch.push(`${k}=${n[k]}`); }
        if (role === "super") for (const k of ["presenter", "title", "tagline"]) if (typeof b[k] === "string") { n[k] = b[k].trim().slice(0, 100); ch.push(k); }
        await s.set("settings", JSON.stringify(n));
        cache.v = null;
        await logAct(s, role, "settings", ch.join(", "));
        return J({ ok: true });
      }
      if (path === "admin/reset" && m === "POST") {
        const b = await body(req);
        const prefixes = b.all ? ["vote:", "contestant:", "img:"] : ["vote:"];
        for (const p of prefixes) {
          const { blobs } = await s.list({ prefix: p });
          for (let i = 0; i < blobs.length; i += 25) await Promise.all(blobs.slice(i, i + 25).map((x) => s.delete(x.key)));
        }
        cache.v = null;
        await logAct(s, role, b.all ? "RESET EVERYTHING" : "reset all votes");
        return J({ ok: true });
      }
    }
    return J({ error: "Not found" }, 404);
  } catch (e) {
    console.error(e);
    return J({ error: "Server error" }, 500);
  }
};
