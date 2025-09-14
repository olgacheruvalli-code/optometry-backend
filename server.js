// server.js
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

/* ======================= Config ======================= */
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/optometry";

const ORIGINS_RAW = process.env.ALLOWED_ORIGINS || process.env.CORS_ORIGIN || "";
const ALLOWED_ORIGINS = ORIGINS_RAW.split(",").map(s => s.trim()).filter(Boolean);

const FISCAL_MONTHS = [
  "April","May","June","July","August","September",
  "October","November","December","January","February","March",
];
const ALL_QUESTION_KEYS = Array.from({ length: 84 }, (_, i) => `q${i + 1}`);

/* ======================= Helpers ======================= */
const _num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const _empty84 = () => Array.from({ length: 84 }, () => 0);
const _answersTo84Array = (ans = {}) => ALL_QUESTION_KEYS.map((k) => _num(ans[k]));
const _sum84 = (a = [], b = []) => {
  const n = Math.max(a.length, b.length);
  const out = new Array(n).fill(0);
  for (let i = 0; i < n; i++) out[i] = _num(a[i]) + _num(b[i]);
  return out;
};
const _normalize84 = (obj = {}) => {
  const out = {};
  for (const k of ALL_QUESTION_KEYS) out[k] = _num(obj[k]);
  return out;
};
const _ensure84OnDoc = (doc) => {
  if (!doc) return doc;
  const d = { ...(doc.toObject?.() || doc) };
  d.answers = _normalize84(d.answers || {});
  const hasCum = d.cumulative && Object.keys(d.cumulative).length > 0;
  d.cumulative = hasCum ? _normalize84(d.cumulative) : { ...d.answers };
  return d;
};
const _fiscalStartYear = (m, y) => (["January","February","March"].includes(m) ? (+y - 1) : (+y));
function _fiscalWindow(toMonth, toYear) {
  const startY = _fiscalStartYear(toMonth, toYear);
  const window = [];
  for (let i = 0; i < FISCAL_MONTHS.length; i++) {
    const m = FISCAL_MONTHS[i];
    const y = i <= 8 ? startY : startY + 1; // Apr–Dec startY, Jan–Mar next year
    window.push({ month: m, year: String(y) });
    if (m === toMonth && String(y) === String(toYear)) break;
  }
  return window;
}
const escRe = (s = "") => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ciEq = (field, value) => ({
  [field]: { $regex: `^${escRe(String(value).trim())}$`, $options: "i" },
});
function normalizeMonth(m = "") {
  const s = String(m).trim();
  if (!s) return s;
  const full = FISCAL_MONTHS.find((n) => n.toLowerCase() === s.toLowerCase());
  if (full) return full;
  const map = {
    jan: "January", feb: "February", mar: "March", apr: "April", may: "May",
    jun: "June", jul: "July", aug: "August", sep: "September", sept: "September",
    oct: "October", nov: "November", dec: "December",
  };
  const key = s.slice(0, 4).toLowerCase();
  return map[key] || s;
}

/* ======================= Mongoose ======================= */
const ReportSchema = new mongoose.Schema(
  {
    district: { type: String, required: true },
    institution: { type: String, required: true },
    month: { type: String, required: true, enum: FISCAL_MONTHS },
    year: { type: String, required: true },
    answers: { type: Object, default: {} },
    cumulative: { type: Object, default: {} },
    eyeBank: { type: Array, default: [] },
    visionCenter: { type: Array, default: [] },
  },
  { versionKey: false, timestamps: true }
);
ReportSchema.index({ district: 1, institution: 1, month: 1, year: 1 }, { unique: true });
const Report = mongoose.model("Report", ReportSchema);

/* ======================= Express App ======================= */
const app = express();
app.use('/api/admin', require('./routes/admin'));

// CORS (preflight handled)
const corsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true); // non-browser tools
    if (ALLOWED_ORIGINS.length === 0) return cb(null, true); // allow any if not set
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(null, false);
  },
  methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: false, // set true only if you use cookies
  maxAge: 86400,
  optionsSuccessStatus: 204,
};
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use((req, res, next) => {
  res.header("Vary", "Origin");
  next();
});

// Robust body parsing (must be before guards)
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

let dbReady = false;
const startedAt = new Date().toISOString();

// Allow diagnostics + login while DB not ready
app.use((req, res, next) => {
  if (req.method === "OPTIONS") return res.sendStatus(204);
  const pass = ["/api/health", "/api/version", "/api/login", "/api/debug/echo", "/api/debug/body"];
  if (!dbReady && req.path.startsWith("/api") && !pass.includes(req.path)) {
    return res.status(503).json({ ok: false, error: "db_not_ready" });
  }
  next();
});

/* ======================= Diagnostics ======================= */
app.get("/api/health", (req, res) =>
  res.json({ ok: true, startedAt, tag: "server.js", version: "login-v4" })
);
app.get("/api/version", (req, res) => res.json({ ok: true, version: "login-v4" }));
app.post("/api/debug/echo", (req, res) => res.json({ ok: true, body: req.body || null }));
app.post("/api/debug/body", (req, res) => {
  const body = req.body;
  res.json({
    ok: true,
    type: typeof body,
    keys: body && typeof body === "object" ? Object.keys(body) : null,
    raw: body,
  });
});

/* ======================= LOGIN (tolerant) ======================= */
app.post("/api/login", (req, res) => {
  try {
    let body = req.body || {};
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch {}
    }

    console.log("[/api/login] headers:", req.headers);
    console.log("[/api/login] body:", body);

    let { username, district, institution, password } = body;
    district = String(district || "").trim();
    institution = String(institution || "").trim();
    password = String(password || "").trim();
    username = String(username || "").trim() || institution;

    if (!district || !institution || !password) {
      return res.status(400).json({
        ok: false,
        error: "missing_fields",
        got: { district: !!district, institution: !!institution, passwordLen: password.length },
      });
    }

    const role = /^dc\s|^doc\s/i.test(institution) ? "DOC" : "USER";
    return res.json({
      ok: true,
      user: { username, district, institution, role, isDoc: role === "DOC" },
      token: "dev-token",
    });
  } catch (e) {
    console.error("login error:", e);
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

/* ======================= Reports ======================= */
// List (filterable)
app.get("/api/reports", async (req, res) => {
  try {
    const { district, institution, month, year } = req.query;
    const q = {};
    if (district) Object.assign(q, ciEq("district", district));
    if (institution) Object.assign(q, ciEq("institution", institution));
    if (month) q.month = normalizeMonth(month);
    if (year) q.year = String(year);

    const docs = await Report.find(q).sort({ year: -1 }).lean();
    const out = docs
      .map(_ensure84OnDoc)
      .sort((a, b) => {
        const y = (parseInt(b.year) || 0) - (parseInt(a.year) || 0);
        if (y !== 0) return y;
        return (FISCAL_MONTHS.indexOf(b.month) ?? -1) - (FISCAL_MONTHS.indexOf(a.month) ?? -1);
      });
    res.json(out);
  } catch (e) {
    console.error("GET /api/reports error:", e);
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

// Get one
app.get("/api/report", async (req, res) => {
  try {
    const { district, institution, month, year } = req.query;
    if (!district || !institution || !month || !year) {
      return res.status(400).json({ ok: false, error: "missing_query" });
    }
    const doc = await Report.findOne({
      ...ciEq("district", district),
      ...ciEq("institution", institution),
      month: normalizeMonth(month),
      year: String(year),
    });
    if (!doc) return res.status(404).json({ ok: false, error: "not_found" });
    res.json(_ensure84OnDoc(doc));
  } catch (e) {
    console.error("GET /api/report error:", e);
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

// Create/update (upsert)
app.post("/api/reports", async (req, res) => {
  try {
    let {
      district,
      institution,
      month,
      year,
      answers = {},
      cumulative = {},
      eyeBank = [],
      visionCenter = [],
    } = req.body || {};

    district = String(district || "").trim();
    institution = String(institution || "").trim();
    month = normalizeMonth(month || "");
    year = String(year || "").trim();

    if (!district || !institution || !month || !year) {
      return res.status(400).json({ ok: false, error: "missing_fields" });
    }

    const normAnswers = _normalize84(answers || {});
    const normCumulative =
      cumulative && Object.keys(cumulative).length ? _normalize84(cumulative) : { ...normAnswers };

    const update = {
      district,
      institution,
      month,
      year,
      answers: normAnswers,
      cumulative: normCumulative,
      eyeBank: Array.isArray(eyeBank) ? eyeBank : [],
      visionCenter: Array.isArray(visionCenter) ? visionCenter : [],
      updatedAt: new Date(),
    };

    const doc = await Report.findOneAndUpdate(
      {
        district: new RegExp(`^${escRe(district)}$`, "i"),
        institution: new RegExp(`^${escRe(institution)}$`, "i"),
        month,
        year
      },
      { $set: update },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    res.json({ ok: true, report: _ensure84OnDoc(doc) });
  } catch (e) {
    console.error("POST /api/reports error:", e);
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

// Danger: wipe all (dev/debug only)
app.delete("/api/reports/all", async (req, res) => {
  try {
    const r = await Report.deleteMany({});
    res.json({ ok: true, deleted: r.deletedCount });
  } catch (e) {
    console.error("DELETE /api/reports/all error:", e);
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

/* ===== District Institution-wise (Month + Cumulative 84-length arrays) ===== */
app.get("/api/district-institution-report", async (req, res) => {
  try {
    let { district, month, year } = req.query;
    district = String(district || "").trim();
    month = normalizeMonth(month || "");
    year = String(year || "").trim();

    if (!district || !month || !year) {
      return res.status(400).json({ ok: false, error: "missing_fields" });
    }

    // Determine fiscal window Apr → selected month
    const window = _fiscalWindow(month, year);
    const monthsInWindow = new Set(window.map((w) => `${w.month}:${w.year}`));

    // Fetch ALL docs for this district in the window
    const years = [...new Set(window.map((w) => w.year))];
    const docs = await Report.find({
      ...ciEq("district", district),
      year: { $in: years.map(String) },
      month: { $in: window.map((w) => w.month) },
    }).lean();

    // Group by institution (exclude DOC logins)
    const groups = new Map(); // inst -> { byMonth: Map("April:2025" -> doc) }
    for (const raw of docs) {
      const d = _ensure84OnDoc(raw);
      if (/^dc\s|^doc\s/i.test(d.institution || "")) continue; // skip coordinators
      const key = d.institution;
      if (!groups.has(key)) groups.set(key, { byMonth: new Map() });
      const g = groups.get(key);
      const tag = `${d.month}:${d.year}`;
      // Dedup: keep the one with latest updatedAt
      if (!g.byMonth.has(tag)) {
        g.byMonth.set(tag, d);
      } else {
        const prev = g.byMonth.get(tag);
        const p = new Date(prev.updatedAt || prev.createdAt || 0).getTime();
        const q = new Date(d.updatedAt || d.createdAt || 0).getTime();
        if (q > p) g.byMonth.set(tag, d);
      }
    }

    // Build response arrays
    const institutionData = [];
    let districtMonthTotal = _empty84();
    let districtCumTotal = _empty84();

    for (const [institution, g] of groups.entries()) {
      // Month data = answers for selected month only (or zeros)
      const selectedTag = `${month}:${year}`;
      const monthDoc = g.byMonth.get(selectedTag);
      const monthData = monthDoc ? _answersTo84Array(monthDoc.answers) : _empty84();

      // Cumulative = sum over window (one per month)
      let cumulativeData = _empty84();
      for (const [tag, d] of g.byMonth.entries()) {
        if (!monthsInWindow.has(tag)) continue;
        cumulativeData = _sum84(cumulativeData, _answersTo84Array(d.answers));
      }

      districtMonthTotal = _sum84(districtMonthTotal, monthData);
      districtCumTotal = _sum84(districtCumTotal, cumulativeData);

      institutionData.push({ institution, monthData, cumulativeData });
    }

    // Sort institutions alphabetically (stable)
    institutionData.sort((a, b) => a.institution.localeCompare(b.institution, "en"));

    res.json({
      ok: true,
      district,
      month,
      year,
      institutionData,
      districtPerformance: { monthData: districtMonthTotal, cumulativeData: districtCumTotal },
    });
  } catch (e) {
    console.error("GET /api/district-institution-report error:", e);
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

/* ======================= 404 ======================= */
app.use((req, res) => res.status(404).json({ ok: false, error: "route_not_found", path: req.path }));

/* ======================= Start ======================= */
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 API listening on port ${PORT}`);
});
mongoose
  .connect(MONGO_URI, { dbName: "optometry" })
  .then(() => {
    dbReady = true;
    console.log("✅ Mongo connected");
  })
  .catch((e) => console.error("❌ Mongo connect failed:", e.message));
