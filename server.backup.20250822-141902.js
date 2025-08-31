// server.js — Optometry backend API (Express 5 + Mongoose)

// ——— core deps ———
const express = require("express");
const { createStore, FileStore, MongoStore } = require("./storage");
const cors = require("cors");
const mongoose = require("mongoose");
const Report = require("./models/Report");

// ——— config ———
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/optometry";
const DEBUG_API = /^1|true$/i.test(String(process.env.DEBUG_API || ""));
const USE_MEMORY_DB = /^1|true$/i.test(String(process.env.USE_MEMORY_DB || "")); // SINGLE declaration

// ——— app init ———
const app = express();

app.use(cors());

// ---- FS overrides for /api/report(s) when running with REPORTS_BACKEND=fs ----
if ((process.env.REPORTS_BACKEND || "mongo").toLowerCase() === "fs") {
  const { createStore } = require("./storage");
  const __fsStore = createStore();
  (async () => { if (__fsStore.init) await __fsStore.init(); console.log("🔁 FS overrides mounted for /api/report(s)"); })();

  const __filt = (q={}) => ({ district:q.district, institution:q.institution, month:q.month, year:q.year });

  // Save/update one report – return the doc directly (Mongo-compatible)
  app.post("/api/report", async (req, res) => {
    try {
      const { district, institution, month, year, answers, cumulative, eyeBank, visionCenter } = req.body || {};
      if (!district || !institution || !month || !year) {
        return res.status(400).json({ ok:false, error:"Missing district/institution/month/year" });
      }
      const saved = await __fsStore.upsertReport({ district, institution, month, year }, { answers, cumulative, eyeBank, visionCenter });
      return res.json(saved.doc);
    } catch (e) {
      console.error("FS POST /api/report error:", e);
      return res.status(500).json({ ok:false, error:String(e) });
    }
  });

  // Get one report by keys
  app.get("/api/report", async (req, res) => {
    try {
      const doc = await __fsStore.getReport(__filt(req.query));
      if (!doc) return res.status(404).json({ ok:false, error:"Not found" });
      return res.json({ ok: true, doc });
    } catch (e) {
      console.error("FS GET /api/report error:", e);
      return res.status(500).json({ ok:false, error:String(e) });
    }
  });

  // List reports – include synthetic _id so the frontend can fetch /api/reports/:id


// ——— Save/Upsert report (MERGE-SAFE) ———
// Use ?merge=1 or body.merge=true to only update provided q* keys.
// If the client omits `answers` and a doc exists, we MERGE to avoid zeroing existing values.
app.post("/api/reports", async (req, res) => {
  try {
    const district    = clean(req.body?.district);
    const institution = clean(req.body?.institution);
    const month       = clean(req.body?.month);
    const year        = String(req.body?.year || "").trim();
    if (!district || !institution || !month || !year) {
      return res.status(400).json({ error: "district, institution, month, year are required" });
    }

    let merge =
      String(req.query.merge ?? "").toLowerCase() === "1" ||
      req.body.merge === true;

    const filter   = { district, institution, month, year };
    const existing = await Report.findOne(filter).lean();

    const hasAnswers = !!(req.body && Object.prototype.hasOwnProperty.call(req.body, "answers")
      && req.body.answers && Object.keys(req.body.answers).length > 0);

    const incoming = hasAnswers ? answersFromAny(req.body.answers) : {};

    if (DEBUG_API || String(req.query.debug) === "1") {
      const keys = Object.entries(incoming).filter(([,v])=>v!==0).map(([k])=>k);
      console.log("POST /api/reports recognized non-zero:", keys.join(", ") || "(none)");
    }

    // Build final answers (merge to preserve if needed)
    let answers84Obj = {};
    for (let i = 1; i <= KEY_COUNT; i++) answers84Obj[`q${i}`] = 0;

    if ((merge || (!hasAnswers && existing?.answers))) {
      answers84Obj = cloneAnswers84(existing?.answers || {});
      Object.assign(answers84Obj, incoming);
    } else {
      Object.assign(answers84Obj, incoming);
    }

    // Cumulative
    let cumulative84Obj;
    if (req.body.cumulative && Object.keys(req.body.cumulative).length) {
      cumulative84Obj = cloneAnswers84(req.body.cumulative);
    } else {
      const fyStartYear = getFYStartYear(year, month);
      const priorReports = await Report.find({ district, institution })
        .select("month year answers").lean();
      let cum = new Array(KEY_COUNT).fill(0);
      for (const r of priorReports) {
        const rMonth = String(r.month || "");
        const rYear  = String(r.year  || "");
        if (!rMonth || !rYear) continue;
        if (rYear === year && rMonth === month) continue; // skip current month
        if (getFYStartYear(rYear, rMonth) === fyStartYear &&
            isMonthOnOrBefore(rMonth, rYear, month, year)) {
          cum = plus84(cum, to84Numbers(r.answers));
        }
      }
      cum = plus84(cum, to84Numbers(answers84Obj));
      cumulative84Obj = object84FromArrayNumbers(cum);
    }

    const eyeBank      = Array.isArray(req.body.eyeBank) ? req.body.eyeBank : [];
    const visionCenter = Array.isArray(req.body.visionCenter) ? req.body.visionCenter : [];

    const update = {
      district, institution, month, year,
      answers: answers84Obj,
      cumulative: cumulative84Obj,
      eyeBank, visionCenter,
      updatedAt: new Date()
    };
    const options = { upsert: true, new: true, setDefaultsOnInsert: true };

    const doc = await Report.findOneAndUpdate(filter, update, options);
    if (DEBUG_API) console.log("POST /api/reports upserted:", doc?._id?.toString(), institution, month, year, { merge, hasAnswers });
    return res.json({ ok: true, doc });
  } catch (err) {
    console.error("❌ POST /api/reports failed:", err?.message || err);
    return res.status(500).json({ error: "Failed to save report" });
  }
});

app.get("/api/reports", async (req, res) => {
    try {
      const list = await __fsStore.listReports(__filt(req.query));
      const withIds = list.map(d => ({
        ...d,
        _id: encodeURIComponent([d.district, d.institution, d.year, d.month].join("::"))
      }));
      return res.json(withIds);
    } catch (e) {
      console.error("FS GET /api/reports error:", e);
      return res.status(500).json({ ok:false, error:String(e) });
    }
  });

  // Fetch by synthetic id: /api/reports/:id
  app.get("/api/reports/:id", async (req, res) => {
    try {
      const raw = decodeURIComponent(req.params.id || "");
      const [district, institution, year, month] = raw.split("::");
      const doc = await __fsStore.getReport({ district, institution, year, month });
      if (!doc) return res.status(404).json({ ok:false, error:"Not found" });
      return res.json({ ok: true, doc });
    } catch (e) {
      console.error("FS GET /api/reports/:id error:", e);
      return res.status(500).json({ ok:false, error:String(e) });
    }
  });
}
// ---- /FS overrides ----
const path = require("path");
app.use("/static", require("express").static(path.join(__dirname,"static"))); 
const fsRoutes = require("./fs-routes");
app.use(fsRoutes);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
require("./fs-augment")(app);


// Tag each response so you know which build handled it
const STARTED_AT = new Date().toISOString();
app.use((req, res, next) => {
  res.set("X-Server-Tag", `server.js@${new Date().toISOString()}`);
  res.set("X-Server-File", __filename);
  res.set("X-Server-Started-At", STARTED_AT);
  next();
});

// ——— helpers ———
const KEY_COUNT = 84;
const KEYS = Array.from({ length: KEY_COUNT }, (_, i) => `q${i + 1}`);
const FY_MONTHS = ["April","May","June","July","August","September","October","November","December","January","February","March"];
const MONTH_INDEX = Object.fromEntries(FY_MONTHS.map((m,i)=>[m,i]));
const ORDER = MONTH_INDEX;

const clean = (s) => String(s || "").trim().replace(/\s+/g, " ");
const esc = (s) => String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Accepts full month name, prefix, or 1..12 (FY starting April)
function monthRegexLoose(m){
  if(!m) return undefined;
  const full = clean(m), lower = full.toLowerCase();
  const idx = FY_MONTHS.findIndex(x => x.toLowerCase() === lower || x.toLowerCase().startsWith(lower));
  if (!Number.isNaN(Number(lower)) && Number(lower)>=1 && Number(lower)<=12){
    const i = (Number(lower)+2)%12; // 1→April, 12→March
    const fullName = FY_MONTHS[i];
    return new RegExp(`^${esc(fullName.slice(0,3))}(?:${esc(fullName.slice(3))})?$`,"i");
  }
  if (idx>=0){
    const fullName=FY_MONTHS[idx];
    return new RegExp(`^${esc(fullName.slice(0,3))}(?:${esc(fullName.slice(3))})?$`,"i");
  }
  return new RegExp(esc(full),"i");
}

function numberFromAny(v) {
  if (v === null || v === undefined) return 0;
  const s = String(v).trim();
  if (!s || /^(-|—|NA|N\/A|nil)$/i.test(s)) return 0;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

// Normalize incoming "answers" from various shapes:
// - { q1: "123", q2: "45" }
// - { "1": "123", "2": "45", "q_3": "7", "answer04": "10" } (any key ending with digits)
// - [123, 45, 7, ...]  (array of up to 84)
function answersFromAny(input) {
  const out = {}; for (let i = 1; i <= KEY_COUNT; i++) out[`q${i}`] = 0;

  if (Array.isArray(input)) {
    for (let i = 0; i < Math.min(KEY_COUNT, input.length); i++) {
      out[`q${i+1}`] = numberFromAny(input[i]);
    }
    return out;
  }

  if (input && typeof input === "object") {
    for (const [k, v] of Object.entries(input)) {
      const m = String(k).match(/(\d{1,2})$/);  // any suffix of 1–2 digits
      if (!m) continue;
      const n = Number(m[1]);
      if (n >= 1 && n <= KEY_COUNT) out[`q${n}`] = numberFromAny(v);
    }
  }
  return out;
}
function to84Numbers(raw){
  const arr=new Array(KEY_COUNT).fill(0);
  if (raw && typeof raw==="object" && !Array.isArray(raw)){
    for(let i=0;i<KEY_COUNT;i++) arr[i]=numberFromAny(raw[KEYS[i]] ?? 0);
  } else if (Array.isArray(raw)){
    for(let i=0;i<Math.min(KEY_COUNT, raw.length);i++) arr[i]=numberFromAny(raw[i] ?? 0);
  }
  return arr;
}
function cloneAnswers84(src){
  const out={};
  for (let i=1;i<=KEY_COUNT;i++){
    const k=`q${i}`;
    out[k]=numberFromAny(src?.[k] ?? 0);
  }
  return out;
}
function normalizeAnswerChanges(obj){
  const out={};
  if (!obj || typeof obj!=="object") return out;
  for (const [k,v] of Object.entries(obj)){
    const m = String(k).match(/(\d{1,2})$/);
    if (!m) continue;
    const i = Number(m[1]);
    if (i<1 || i>KEY_COUNT) continue;
    out[`q${i}`]=numberFromAny(v);
  }
  return out;
}
function plus84(a,b){ const out=new Array(KEY_COUNT); for(let i=0;i<KEY_COUNT;i++) out[i]=Number(a[i]||0)+Number(b[i]||0); return out; }
function object84FromArrayNumbers(arr){ const out={}; for(let i=0;i<KEY_COUNT;i++) out[KEYS[i]]=Number(arr[i]||0); return out; }

function getFYStartYear(targetYear, targetMonth){
  return ["January","February","March"].includes(targetMonth) ? (Number(targetYear)-1) : Number(targetYear);
}
function isMonthOnOrBefore(aMonth,aYear,bMonth,bYear){
  const aIdx=MONTH_INDEX[aMonth], bIdx=MONTH_INDEX[bMonth];
  const aFY=getFYStartYear(aYear,aMonth); const bFY=getFYStartYear(bYear,bMonth);
  if (aFY!==bFY) return aFY<bFY; return aIdx<=bIdx;
}

// ——— Mongo connect (local first, fallback to in-memory; or force with USE_MEMORY_DB=1) ———
(async () => {
  async function connect(uri) {
    await mongoose.connect(uri, { dbName: "optometry" });
    console.log("✅ Mongo connected:", uri);
  }

  try {
    if (USE_MEMORY_DB) throw new Error("FORCE_MEMORY_DB");
    await connect(MONGO_URI);
    app.locals.dbMode = "real";
  } catch (e) {
    console.error("❌ Mongo connect error:", e.message);
    try {
      const { MongoMemoryServer } = require("mongodb-memory-server");
      const mem = await MongoMemoryServer.create({ binary: { version: "6.0.6" } });
      const memUri = mem.getUri("optometry");
      await connect(memUri);
      app.locals.dbMode = "memory";
      app.locals.memUri = memUri;
      console.log("🧪 Using mongodb-memory-server (binary 6.0.6)");
      app.get("/api/debug/memdb", (_req, res) => res.json({ memory: true, uri: memUri, binaryVersion: "6.0.6" }));
} catch (e2) {
      console.error("❌ Failed to start memory server:", e2.message);
    }
  }
})();

// ——— debug/health routes ———
app.get("/api/health", (req, res) => {
  res.json({ ok: true, tag: "server.js", pid: process.pid, time: new Date().toISOString(), file: __filename, startedAt: STARTED_AT });
});

app.get("/api/debug/who", (req, res) => {
  const routes = (app._router?.stack || [])
    .filter(l => l.route && l.route.path)
    .map(l => ({ path: l.route.path, methods: Object.keys(l.route.methods || {}) }));
  res.json({ ok: true, pid: process.pid, file: __filename, startedAt: STARTED_AT, routes });
});

// Group counts (quick inventory)
app.get("/api/debug/groups", async (req, res) => {
  try {
    const rows = await Report.aggregate([
      { $group: { _id: { district:"$district", institution:"$institution", year:"$year", month:"$month" }, c:{$sum:1} } },
      { $sort: { "_id.district":1, "_id.institution":1, "_id.year":1, "_id.month":1 } }
    ]);
    const groups = rows.map(r => ({
      district: r._id.district,
      institution: r._id.institution,
      year: r._id.year,
      month: r._id.month,
      count: r.c
    }));
    const totalDocs = await Report.countDocuments({});
    res.json({ totalDocs, groups });
  } catch (e) {
    res.status(500).json({ ok:false, error:e.message });
  }
});

// Per institution timeline
app.get("/api/debug/timeline", async (req, res) => {
  try {
    const q = {};
    if (req.query.district) q.district = new RegExp(`^${esc(clean(req.query.district))}$`,"i");
    const docs = await Report.find(q).select("district institution month year").lean();
    const map = new Map();
    for (const d of docs) {
      const k = `${d.district}||${d.institution}`;
      if (!map.has(k)) map.set(k, { district: d.district, institution: d.institution, months: [] });
      map.get(k).months.push({ year: d.year, month: d.month });
    }
    res.json({ totalInstitutions: map.size, timelines: Array.from(map.values()) });
  } catch (e) {
    res.status(500).json({ ok:false, error:e.message });
  }
});

// Flexible finder (case-insensitive contains)
app.get("/api/debug/find-like", async (req, res) => {
  try {
    const { district, institution, month, year } = req.query || {};
    const q = {};
    if (district) q.district = new RegExp(esc(clean(district)), "i");
    if (institution) q.institution = new RegExp(esc(clean(institution)), "i");
    if (month) q.month = new RegExp(esc(clean(month)), "i");
    if (year) q.year = String(year);
    const docs = await Report.find(q).select("district institution month year updatedAt").lean();
    res.json(docs.sort((a,b)=> (a.institution||"").localeCompare(b.institution||"")));
  } catch (e) {
    console.error("GET /api/debug/find-like error:", e?.message||e);
    res.status(500).json({ ok:false, error:"server_error" });
  }
});

// DB info
app.get("/api/debug/db-info", async (req, res) => {
  try {
    const conn = mongoose.connection;
    const total = await Report.countDocuments({});
    const byYear = await Report.aggregate([
      { $group: { _id: { year: "$year" }, c: { $sum: 1 } } },
      { $sort: { "_id.year": 1 } }
    ]);
    const byDistrict = await Report.aggregate([
      { $group: { _id: { district: "$district" }, c: { $sum: 1 } } },
      { $sort: { c: -1 } }
    ]);
    const sample = await Report.find({})
      .select("district institution month year updatedAt")
      .sort({ updatedAt: -1 })
      .limit(10)
      .lean();

    res.json({
      ok: true,
      envMongoUri: MONGO_URI,
      mongoose: {
        readyState: conn.readyState, // 1 = connected
        name: conn.name,
        host: conn.host,
        port: conn.port,
      },
      model: {
        collection: Report.collection?.name,
        databaseName: Report.db?.name,
      },
      totals: { documents: total, byYear, byDistrict },
      sample
    });
  } catch (e) {
    res.status(500).json({ ok:false, error: e.message });
  }
});

// Mirror payloads for debugging
app.post("/api/debug/echo", (req, res) => {
  if (DEBUG_API) console.log("ECHO BODY:", JSON.stringify(req.body, null, 2));
  res.json({ ok: true, body: req.body });
});

// ——— Institutions helper ———
app.get("/api/institutions", async (req, res) => {
  try {
    const district = clean(req.query?.district);
    const q = {};
    if (district) q.district = new RegExp(`^${esc(district)}$`, "i");
    const list = await Report.distinct("institution", q);
    const filtered = (list || [])
      .filter(name => !!name && !/^DC\s|^DOC\s/i.test(name))
      .sort((a, b) => a.localeCompare(b));
    res.json(filtered);
  } catch (e) {
    console.error("GET /api/institutions error:", e?.message || e);
    res.status(500).json({ error: "Failed to load institutions" });
  }
});

// ——— Save/Upsert report (MERGE-SAFE) ———
// Use ?merge=1 or body.merge=true to update only provided q* keys.

app.get("/api/reports", async (req, res) => {
  try {
    const { month, year, district, institution, full } = req.query || {};
    const q = {};
    if (month) q.month = monthRegexLoose(month);
    if (year) q.year = String(year);
    if (district) q.district = new RegExp(`^${esc(clean(district))}$`, "i");
    if (institution) q.institution = new RegExp(`^${esc(clean(institution))}$`, "i");

    const wantFull = String(full).toLowerCase() === "1" || String(full).toLowerCase() === "true";
    const projection = wantFull
      ? "+answers +cumulative +eyeBank +visionCenter"
      : "district institution month year updatedAt";

    const docs = await Report.find(q).select(projection).lean();

    // sort: newest FY first; then month order; then institution name
    docs.sort((a, b) => {
      const ya = Number(a.year), yb = Number(b.year);
      if (ya !== yb) return yb - ya;
      const ma = ORDER[a.month] ?? 99, mb = ORDER[b.month] ?? 99;
      if (ma !== mb) return ma - mb;
      return (a.institution || "").localeCompare(b.institution || "");
    });

    if (DEBUG_API) console.log("GET /api/reports found:", docs.length, "query:", q);
    const out = docs.map(d => ({ ...d, _id: d._id?.toString?.() ?? "" }));
    res.json(out);
  } catch (e) {
    console.error("GET /api/reports error:", e);
    res.status(500).json({ error: "Failed to load reports" });
  }
});

// ——— DETAIL by id ———
app.get("/api/reports/:id", async (req, res) => {
  try {
    const doc = await Report.findById(req.params.id)
      .select("+answers +cumulative +eyeBank +visionCenter")
      .lean();
    if (!doc) return res.status(404).json({ ok: false, error: "not_found" });
    res.json({ ok: true, doc });
  } catch (e) {
    console.error("GET /api/reports/:id error:", e?.message || e);
    res.status(400).json({ ok: false, error: "bad_id" });
  }
});

// ——— DETAIL by keys ———
app.get("/api/report", async (req, res) => {
  const { district, institution, month, year } = req.query || {};
  if (!district || !institution || !month || !year) {
    return res.status(400).json({ error: "district, institution, month, year are required" });
  }
  try {
    const doc = await Report.findOne({
      district:    new RegExp(`^${esc(clean(district))}$`, "i"),
      institution: new RegExp(`^${esc(clean(institution))}$`, "i"),
      month:       monthRegexLoose(month),
      year:        String(year),
    }).select("+answers +cumulative +eyeBank +visionCenter").lean();
    if (DEBUG_API) console.log("GET /api/report", { district, institution, month, year, found: !!doc });
    if (!doc) return res.status(404).json({ ok: false, error: "not_found" });
    res.json({ ok: true, doc });
  } catch (e) {
    console.error("GET /api/report error:", e?.message || e);
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

// ——— Dev auth ———
app.post("/api/login", (req, res) => {
  const { username, password, district, institution } = req.body || {};
  if (!username || !password || !district || !institution) {
    return res.status(400).json({ error: "username, password, district, and institution are required" });
  }
  const isDoc = /^DC\s/i.test(institution || username);
  return res.json({ ok: true, user: { username, district, institution, role: isDoc ? "DOC" : "USER", isDoc }, token: "dev-token" });
});

// Mirror payloads for debugging
app.post("/api/debug/echo", (req, res) => {
  if (DEBUG_API) console.log("ECHO BODY:", JSON.stringify(req.body, null, 2));
  res.json({ ok: true, body: req.body });
});

// Preview normalization & cumulative WITHOUT saving
app.post("/api/debug/preview", async (req, res) => {
  try {
    const district = clean(req.body?.district);
    const institution = clean(req.body?.institution);
    const month = clean(req.body?.month);
    const year = String(req.body?.year || "").trim();
    if (!district || !institution || !month || !year) {
      return res.status(400).json({ error: "district, institution, month, year are required" });
    }

    let merge = String(req.query.merge ?? "").toLowerCase() == "1" ||
      req.body.merge === true;

    const filter   = { district, institution, month, year };
    const existing = await Report.findOne(filter).lean();
    const hasAnswers = req.body && Object.prototype.hasOwnProperty.call(req.body, "answers") && req.body.answers && Object.keys(req.body.answers).length > 0;
    if (!merge && !hasAnswers && existing?.answers) { merge = true; }
    const hasAnswers = req.body && Object.prototype.hasOwnProperty.call(req.body, "answers") && req.body.answers && Object.keys(req.body.answers).length > 0;
    if (!merge && !hasAnswers && existing?.answers) { merge = true; }
    const hasAnswers = req.body && Object.prototype.hasOwnProperty.call(req.body, "answers") && req.body.answers && Object.keys(req.body.answers).length > 0;
    if (!merge && !hasAnswers && existing?.answers) { merge = true; }

    // normalize answers from any shape
    const incoming = hasAnswers ? answersFromAny(req.body.answers) : {};
    let answers = {}; for (let i=1;i<=KEY_COUNT;i++) answers['q'+i]=0;

    if (merge && existing?.answers) {
      answers = cloneAnswers84(existing.answers);
      Object.assign(answers, incoming);
    } else {
      Object.assign(answers, incoming);
    }

    // compute cumulative preview for FY
    const fyStartYear = getFYStartYear(year, month);
    const priorReports = await Report.find({ district, institution }).select("month year answers").lean();
    let cum = new Array(KEY_COUNT).fill(0);
    for (const r of priorReports) {
      const rMonth = String(r.month || "");
      const rYear  = String(r.year  || "");
      if (!rMonth || !rYear) continue;
      if (rYear == year && rMonth == month) continue; // skip current month to avoid double count
      if (getFYStartYear(rYear, rMonth) == fyStartYear &&
          isMonthOnOrBefore(rMonth, rYear, month, year)) {
        cum = plus84(cum, to84Numbers(r.answers));
      }
    }
    cum = plus84(cum, to84Numbers(answers));
    const cumulative = object84FromArrayNumbers(cum);

    if (DEBUG_API || String(req.query.debug) === "1") {
      const nz = Object.entries(answers).filter(([,v])=>v!==0).map(([k])=>k);
      console.log("PREVIEW non-zero answers:", nz.join(", ") || "(none)");      
    }

    res.json({ ok:true, preview:{ answers, cumulative }, existingId: existing?._id || null });
  } catch (e) {
    res.status(500).json({ ok:false, error:e.message });
  }
});

// ——— JSON 404 catch-all ———
app.use((req, res) => {
  res.status(404).json({ ok: false, error: "route_not_found", path: req.path });
});

// ——— start ———
function logRoutes() {
  const routes = (app._router?.stack || [])
    .filter(l => l.route && l.route.path)
    .map(l => `${Object.keys(l.route.methods).join(',').toUpperCase()} ${l.route.path}`);
  console.log("Registered routes:\n" + routes.join("\n"));
}
app.listen(PORT, () => {
  console.log(`🚀 API listening on http://localhost:${PORT}`);
  logRoutes();
});
