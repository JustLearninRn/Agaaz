import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";

export const config = { path: "/api/*" };

const J = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const clean = (s) => String(s ?? "").replace(/[^\w-]/g, "").slice(0, 60);
const pw = () => process.env.ADMIN_PASSWORD || "";
const key = () => crypto.createHash("sha256").update("agaaz2k26|" + pw()).digest();
const sign = (p) => crypto.createHmac("sha256", key()).update(p).digest("base64url");
const mkToken = () => { const p = String(Date.now() + 12 * 3600e3); return p + "." + sign(p); };
function authed(req) {
  const t = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
  const [p, s] = t.split(".");
  if (!pw() || !p || !s) return false;
  const e = sign(p);
  if (e.length !== s.length) return false;
  return crypto.timingSafeEqual(Buffer.from(e), Buffer.from(s)) && Number(p) > Date.now();
}
function samePw(input) {
  const h = (x) => crypto.createHash("sha256").update(String(x)).digest();
  return crypto.timingSafeEqual(h(input), h(pw()));
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
const body = async (req) => { try { return await req.json(); } catch { return {}; } };

export default async (req) => {
  const s = getStore({ name: "agaaz2k26", consistency: "strong" });
  const path = new URL(req.url).pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
  const m = req.method;
  try {
    /* ---------- public ---------- */
    if (path === "public" && m === "GET") {
      const [cs, st] = await Promise.all([all(s, "contestant:"), s.get("settings", { type: "json" })]);
      const contestants = cs.map(({ _key, ...c }) => c).sort((a, b) => (a.order || 0) - (b.order || 0));
      return J({ contestants, open: st ? st.open !== false : true, board: st && st.showBoard ? await counts(s) : null });
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
      if (st && st.open === false) return J({ error: "Voting is closed." }, 403);
      const [cm, cf] = await Promise.all([s.get("contestant:" + clean(b.m), { type: "json" }), s.get("contestant:" + clean(b.f), { type: "json" })]);
      if (!cm || cm.gender !== "M" || !cf || cf.gender !== "F") return J({ error: "Invalid selection. Please refresh and try again." }, 400);
      const r = await s.set("vote:" + id, JSON.stringify({ reg, name, phone, m: cm.id, f: cf.id, t: Date.now() }), { onlyIfNew: true });
      if (!r.modified) return J({ error: "This registration number has already voted." }, 409);
      return J({ ok: true });
    }

    /* ---------- admin ---------- */
    if (path === "admin/login" && m === "POST") {
      if (!pw()) return J({ error: "ADMIN_PASSWORD is not set on the server." }, 500);
      const b = await body(req);
      return samePw(b.password ?? "") ? J({ token: mkToken() }) : J({ error: "Wrong password" }, 401);
    }
    if (path.startsWith("admin/")) {
      if (!authed(req)) return J({ error: "unauthorized" }, 401);

      if (path === "admin/data" && m === "GET") {
        const [cs, vs, st] = await Promise.all([all(s, "contestant:"), all(s, "vote:"), s.get("settings", { type: "json" })]);
        return J({ contestants: cs.map(({ _key, ...c }) => c), votes: vs.map(({ _key, ...v }) => ({ ...v, id: _key.slice(5) })), open: st ? st.open !== false : true, showBoard: !!(st && st.showBoard) });
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
        return J({ ok: true, id });
      }
      if (path.startsWith("admin/contestant/") && m === "DELETE") {
        const id = clean(path.split("/")[2]);
        await Promise.all([s.delete("contestant:" + id), s.delete("img:" + id)]);
        return J({ ok: true });
      }
      if (path.startsWith("admin/vote/") && m === "DELETE") {
        await s.delete("vote:" + clean(path.split("/")[2]));
        return J({ ok: true });
      }
      if (path === "admin/settings" && m === "POST") {
        const b = await body(req);
        await s.set("settings", JSON.stringify({ open: !!b.open, showBoard: !!b.showBoard }));
        return J({ ok: true });
      }
      if (path === "admin/reset" && m === "POST") {
        const b = await body(req);
        const prefixes = b.all ? ["vote:", "contestant:", "img:"] : ["vote:"];
        for (const p of prefixes) {
          const { blobs } = await s.list({ prefix: p });
          for (let i = 0; i < blobs.length; i += 25) await Promise.all(blobs.slice(i, i + 25).map((x) => s.delete(x.key)));
        }
        return J({ ok: true });
      }
    }
    return J({ error: "Not found" }, 404);
  } catch (e) {
    console.error(e);
    return J({ error: "Server error" }, 500);
  }
};
