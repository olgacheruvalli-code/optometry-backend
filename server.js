/* server.js */
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

/* ======================= Config ======================= */
// ✅ Using 5050 port (fixed)
const PORT = process.env.PORT || 5050;

const MONGO_URI =
  process.env.MONGO_URI || "mongodb://127.0.0.1:27017/optometry";

const ORIGINS_RAW =
  process.env.ALLOWED_ORIGINS || process.env.CORS_ORIGIN || "";
const ALLOWED_ORIGINS = ORIGINS_RAW.split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const ALLOW_VERCEL_PREVIEWS = false;

const FISCAL_MONTHS = [
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
  "January",
  "February",
  "March",
];
const ALL_QUESTION_KEYS = Array.from({ length: 84 }, (_, i) => `q${i + 1}`);

/* ======================= Name Normalization ======================= */
const sanitize = (s = "") => String(s).replace(/\s+/g, " ").trim();
const lowerSan = (s = "") => sanitize(s).toLowerCase();

const CANON = {
  "chc narikkuni": ["chc narikkuni", "bfhc narikkuni"],
  "chc olavanna": ["chc olavanna", "bfhc olavanna"],
  "chc thiruvangoor": ["chc thiruvangoor", "bfhc thiruvangoor"],
  "taluk hospital koyilandy": ["taluk hospital koyilandy", "thqh koyilandy"],
};
const ALIAS_TO_CANON = (() => {
  const map = new Map();
  for (const [canon, aliases] of Object.entries(CANON)) {
    aliases.forEach((a) => map.set(lowerSan(a), canon));
  }
  return map;
})();
const normInstKey = (name = "") => {
  const s = lowerSan(name);
  return ALIAS_TO_CANON.get(s) || s;
};

/* ======================= Helpers ======================= */
const _num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const _normalize84 = (obj = {}) => {
  const out = {};
  for (const k of ALL_QUESTION_KEYS) out[k] = _num(obj[k]);
  return out;
};

const _answersTo84Array = (ans = {}) =>
  ALL_QUESTION_KEYS.map((k) => _num(ans[k]));

const _sum84 = (a = [], b = []) => {
  const n = Math.max(a.length, b.length);
  const out = new Array(n).fill(0);
  for (let i = 0; i < n; i++) out[i] = _num(a[i]) + _num(b[i]);
  return out;
};

const _ensure84OnDoc = (doc) => {
  if (!doc) return doc;
  const d = { ...(doc.toObject?.() || doc) };
  d.institution = sanitize(d.institution || "");
  d.district = sanitize(d.district || "");
  d.answers = _normalize84(d.answers || {});
  const hasCum = d.cumulative && Object.keys(d.cumulative).length > 0;
  d.cumulative = hasCum ? _normalize84(d.cumulative) : { ...d.answers };
  return d;
};

const _fiscalStartYear = (m, y) =>
  ["January", "February", "March"].includes(m) ? +y - 1 : +y;

function _fiscalWindow(toMonth, toYear) {
  const startY = _fiscalStartYear(toMonth, toYear);
  const window = [];
  for (let i = 0; i < FISCAL_MONTHS.length; i++) {
    const m = FISCAL_MONTHS[i];
    const y = i <= 8 ? startY : startY + 1;
    window.push({ month: m, year: String(y) });
    if (m === toMonth && String(y) === String(toYear)) break;
  }
  return window;
}

function normalizeMonth(m = "") {
  const s = lowerSan(m);
  const map = {
    jan: "January",
    feb: "February",
    mar: "March",
    apr: "April",
    may: "May",
    jun: "June",
    jul: "July",
    aug: "August",
    sep: "September",
    sept: "September",
    oct: "October",
    nov: "November",
    dec: "December",
  };
  const key = s.slice(0, 3);
  return map[key] || sanitize(m);
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
ReportSchema.index(
  { district: 1, institution: 1, month: 1, year: 1 },
  { unique: true }
);
const Report = mongoose.model("Report", ReportSchema);

/* ======================= Amblyopia Schema ======================= */
const AmblyopiaSchema = new mongoose.Schema(
  {
    patientId: String,
    age: String,
    sex: String,
    unaidedRE: String,
    unaidedLE: String,
    bcvaRE: String,
    bcvaLE: String,
    type: String,
    degree: String,
    treatment: String,
    outcome: String,
    remarks: String,
    district: String,
    institution: String,
    examiner: String,
    date: String,
  },
  { timestamps: true }
);
const Amblyopia =
  mongoose.models.Amblyopia || mongoose.model("Amblyopia", AmblyopiaSchema);

/* ======================= Registers Schemas ======================= */
const BlindRegisterSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    age: String,
    sex: String,
    address: String,
    vaRE: String,
    vaLE: String,
    cause: String,
    treatment: String,
    district: String,
    institution: String,
    optometrist: String,
    optometristName: String,
    optometristPhone: String,
    date: String,
  },
  { timestamps: true }
);
const BlindRegister =
  mongoose.models.BlindRegister || mongoose.model("BlindRegister", BlindRegisterSchema);

const CataractBacklogSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    age: String,
    sex: String,
    address: String,
    vaRE: String,
    vaLE: String,
    eyeOperated: String,
    detectionDate: String,
    referral: String,
    status: { type: String, default: "Pending" },
    surgeryDate: String,
    district: String,
    institution: String,
    optometrist: String,
    optometristName: String,
    optometristPhone: String,
  },
  { timestamps: true }
);
const CataractBacklog =
  mongoose.models.CataractBacklog || mongoose.model("CataractBacklog", CataractBacklogSchema);

const OldAgedSpectaclesSchema = new mongoose.Schema(
  {
    slNo: String,
    name: { type: String, required: true },
    dateOfPrescription: String,
    sex: String,
    age: String,
    diagnosis: String,
    // Vision
    visionRE_DV: String,
    visionRE_NV: String,
    visionLE_DV: String,
    visionLE_NV: String,
    // Prescribed Power RE
    powerRE_Sph: String,
    powerRE_Cyl: String,
    powerRE_Axis: String,
    powerRE_Add: String,
    // Prescribed Power LE
    powerLE_Sph: String,
    powerLE_Cyl: String,
    powerLE_Axis: String,
    powerLE_Add: String,
    // Corrected Vision
    correctedRE_DV: String,
    correctedRE_NV: String,
    correctedLE_DV: String,
    correctedLE_NV: String,
    
    ipdFrameSize: String,
    reference: String,
    address: String,
    district: String,
    institution: String,
    optometrist: String,
    optometristName: String,
    optometristPhone: String,
  },
  { timestamps: true }
);
const OldAgedSpectacles =
  mongoose.models.OldAgedSpectacles || mongoose.model("OldAgedSpectacles", OldAgedSpectaclesSchema);

const SchoolSpectaclesSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    dateOfPrescription: String,
    sex: String,
    age: String,
    schoolName: String,
    classStandard: String,
    teacherName: String,
    diagnosis: String,
    // Vision
    visionRE_DV: String,
    visionRE_NV: String,
    visionLE_DV: String,
    visionLE_NV: String,
    // Prescribed Power RE
    powerRE_Sph: String,
    powerRE_Cyl: String,
    powerRE_Axis: String,
    powerRE_Add: String,
    // Prescribed Power LE
    powerLE_Sph: String,
    powerLE_Cyl: String,
    powerLE_Axis: String,
    powerLE_Add: String,
    // Corrected Vision
    correctedRE_DV: String,
    correctedRE_NV: String,
    correctedLE_DV: String,
    correctedLE_NV: String,
    
    ipdFrameSize: String,
    reference: String,
    address: String,
    district: String,
    institution: String,
    optometrist: String,
    optometristName: String,
    optometristPhone: String,
  },
  { timestamps: true }
);
const SchoolSpectacles =
  mongoose.models.SchoolSpectacles || mongoose.model("SchoolSpectacles", SchoolSpectaclesSchema);


/* ======================= Express App ======================= */
const app = express();
let dbReady = false;
const startedAt = new Date().toISOString();

/* ---------- SMART CORS BLOCK ---------- */
function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  if (ALLOW_VERCEL_PREVIEWS) {
    try {
      const u = new URL(origin);
      if (u.protocol === "https:" && u.hostname.endsWith(".vercel.app"))
        return true;
    } catch {}
  }
  return false;
}

let corsOptions;
if (process.env.NODE_ENV !== "production") {
  console.log("🔓 Local dev mode: allowing all origins");
  corsOptions = { origin: true };
} else {
  corsOptions = {
    origin(origin, cb) {
      if (isAllowedOrigin(origin)) return cb(null, true);
      return cb(new Error(`CORS blocked for origin: ${origin}`), false);
    },
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: false,
    maxAge: 86400,
  };
}
app.use(cors(corsOptions));
app.options(/^\/api\/.*$/, cors(corsOptions));
app.use((req, res, next) => {
  res.header("Vary", "Origin");
  next();
});

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  if (req.method === "OPTIONS") return res.sendStatus(204);

  // allow ping/health/login before db is ready
  const pass = ["/api/health", "/api/ping", "/api/login"];

  if (!dbReady && req.path.startsWith("/api") && !pass.includes(req.path)) {
    return res.status(503).json({ ok: false, error: "db_not_ready" });
  }
  next();
});

/* ======================= Diagnostics ======================= */
app.get("/api/health", (req, res) =>
  res.json({ ok: true, startedAt, version: "v10-nov-purge" })
);

app.get("/api/ping", (req, res) =>
  res.json({ ok: true, msg: "backend alive", db: dbReady })
);

/* ======================= SIMPLE LOCAL LOGIN ======================= */
app.post("/api/login", (req, res) => {
  const { username, district, institution } = req.body || {};

  if (!username) {
    return res.status(400).json({ ok: false, error: "missing_username" });
  }

  const role =
    String(username).toLowerCase().startsWith("dc") ||
    String(username).toLowerCase().startsWith("doc")
      ? "DOC"
      : "OPTOMETRIST";

  return res.json({
    ok: true,
    user: {
      username,
      district: district || "",
      institution: institution || "",
      role,
      isGuest: false,
    },
  });
});

/* ======================= Amblyopia Research ======================= */
app.post("/api/amblyopia-research", async (req, res) => {
  try {
    const data = req.body;

    if (!data.district || !data.institution) {
      return res.json({ ok: false, error: "Missing district/institution" });
    }

    await Amblyopia.create(data);

    res.json({ ok: true });
  } catch (e) {
    console.error("❌ Amblyopia save error:", e);
    res.json({ ok: false, error: "server_error" });
  }
});

app.get("/api/amblyopia-research", async (req, res) => {
  try {
    const { district, institution } = req.query;

    const filter = {};
    if (district) filter.district = district;
    if (institution) filter.institution = institution;

    const docs = await Amblyopia.find(filter)
      .sort({ createdAt: -1 })
      .lean();

    res.json({ ok: true, docs });
  } catch (e) {
    console.error("❌ Amblyopia fetch error:", e);
    res.json({ ok: false, error: "server_error" });
  }
});

/* ======================= Helper for Register Endpoints ======================= */
function makeRegisterRoutes(routePath, Model) {
  app.post(`/api/${routePath}`, async (req, res) => {
    try {
      const data = req.body;
      if (!data.district || !data.institution) {
        return res.status(400).json({ ok: false, error: "Missing district/institution" });
      }
      const doc = await Model.create(data);
      res.json({ ok: true, doc });
    } catch (e) {
      console.error(`❌ ${routePath} save error:`, e);
      res.status(500).json({ ok: false, error: "server_error" });
    }
  });

  app.get(`/api/${routePath}`, async (req, res) => {
    try {
      const { district, institution } = req.query;
      const filter = {};
      if (district) filter.district = district;
      if (institution) filter.institution = institution;
      const docs = await Model.find(filter).sort({ createdAt: -1 }).lean();
      res.json({ ok: true, docs });
    } catch (e) {
      console.error(`❌ ${routePath} fetch error:`, e);
      res.status(500).json({ ok: false, error: "server_error" });
    }
  });

  app.put(`/api/${routePath}/:id`, async (req, res) => {
    try {
      const doc = await Model.findByIdAndUpdate(req.params.id, req.body, { new: true });
      if (!doc) return res.status(404).json({ ok: false, error: "not_found" });
      res.json({ ok: true, doc });
    } catch (e) {
      console.error(`❌ ${routePath} update error:`, e);
      res.status(500).json({ ok: false, error: "server_error" });
    }
  });

  app.delete(`/api/${routePath}/:id`, async (req, res) => {
    try {
      const doc = await Model.findByIdAndDelete(req.params.id);
      if (!doc) return res.status(404).json({ ok: false, error: "not_found" });
      res.json({ ok: true });
    } catch (e) {
      console.error(`❌ ${routePath} delete error:`, e);
      res.status(500).json({ ok: false, error: "server_error" });
    }
  });
}

makeRegisterRoutes("blind-register", BlindRegister);
makeRegisterRoutes("cataract-backlog", CataractBacklog);
makeRegisterRoutes("old-aged-spectacles", OldAgedSpectacles);
makeRegisterRoutes("school-spectacles", SchoolSpectacles);

/* ======================= REPORT ROUTES ======================= */
app.get("/api/reports", async (req, res) => {
  try {
    const {
      district,
      institution,
      month,
      year,
      q,
      limit = 500,
      page = 1,
    } = req.query;

    const filter = {};
    if (district) filter.district = sanitize(district);
    if (institution) filter.institution = sanitize(institution);
    if (month) filter.month = normalizeMonth(month);
    if (year) filter.year = String(year);

    if (q) {
      const re = new RegExp(sanitize(q), "i");
      filter.$or = [{ district: re }, { institution: re }, { month: re }];
    }

    const lim = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 2000);
    const skip = (Math.max(parseInt(page, 10) || 1, 1) - 1) * lim;

    const docs = await Report.find(filter)
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(lim)
      .lean();

    res.json({ ok: true, docs: docs.map(_ensure84OnDoc) });
  } catch (e) {
    console.error("❌ GET /api/reports error:", e);
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

app.get("/api/reports/:id", async (req, res) => {
  try {
    const doc = await Report.findById(req.params.id);
    if (!doc) return res.status(404).json({ ok: false, error: "not_found" });
    res.json({ ok: true, doc: _ensure84OnDoc(doc) });
  } catch (e) {
    console.error("❌ GET /api/reports/:id error:", e);
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

app.post("/api/reports", async (req, res) => {
  try {
    const {
      district,
      institution,
      month,
      year,
      answers = {},
      eyeBank = [],
      visionCenter = [],
      forceSave,
    } = req.body || {};

    if (!district || !institution || !month || !year) {
      return res
        .status(400)
        .json({ ok: false, error: "missing_required_fields" });
    }

    const dist = sanitize(district);
    const inst = sanitize(institution);
    const mon = normalizeMonth(month);
    const yr = String(year);

    if (!FISCAL_MONTHS.includes(mon)) {
      return res.status(400).json({
        ok: false,
        error: "invalid_month",
        allowed: FISCAL_MONTHS,
      });
    }

    const ans84 = _normalize84(answers);
    const ebArr = Array.isArray(eyeBank) ? eyeBank : [];
    const vcArr = Array.isArray(visionCenter) ? visionCenter : [];

    const anyAnswer = Object.values(ans84).some((v) => _num(v) > 0);
    const hasEB = ebArr.some((row) =>
      Object.values(row || {}).some((v) => _num(v) > 0)
    );
    const hasVC = vcArr.some((row) =>
      Object.values(row || {}).some((v) => _num(v) > 0)
    );

    if (!forceSave && !anyAnswer && !hasEB && !hasVC) {
      return res.status(400).json({
        ok: false,
        error: "empty_report",
      });
    }

    let doc = await Report.findOne({
      district: dist,
      institution: inst,
      month: mon,
      year: yr,
    });

    if (!doc) {
      doc = new Report({
        district: dist,
        institution: inst,
        month: mon,
        year: yr,
      });
    }

    doc.answers = ans84;
    doc.eyeBank = ebArr;
    doc.visionCenter = vcArr;
    doc.cumulative = ans84;

    await doc.save();
    res.json({ ok: true, doc: _ensure84OnDoc(doc) });
  } catch (e) {
    console.error("❌ POST /api/reports error:", e);
    if (e.code === 11000) {
      return res
        .status(409)
        .json({ ok: false, error: "duplicate_report_for_month_year" });
    }
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

/* ======================= DELETE ======================= */
app.delete("/api/reports/:id", async (req, res) => {
  try {
    const doc = await Report.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ ok: false, error: "not_found" });
    res.json({ ok: true });
  } catch (e) {
    console.error("❌ DELETE /api/reports/:id error:", e);
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

/* ========= ONE-TIME ADMIN ROUTE TO DELETE NOVEMBER 2025 REPORTS ========= */
app.post("/api/admin/purge-nov-2025", async (req, res) => {
  try {
    const secret = req.body?.secret;
    const expected = process.env.ADMIN_SECRET || "NOV25_PURGE_LOCK";

    if (secret !== expected) {
      return res
        .status(403)
        .json({ ok: false, error: "forbidden", message: "Bad secret" });
    }

    const filter = { month: "November", year: "2025" };
    const docs = await Report.find(filter).lean();

    const keepDoc = (instRaw = "") => {
      const inst = lowerSan(instRaw);
      return inst.startsWith("doc ") || inst.startsWith("dc ");
    };

    const idsToDelete = docs
      .filter((d) => !keepDoc(d.institution))
      .map((d) => d._id);

    if (!idsToDelete.length) {
      return res.json({ ok: true, deleted: 0 });
    }

    const result = await Report.deleteMany({ _id: { $in: idsToDelete } });
    res.json({ ok: true, deleted: result.deletedCount || 0 });
  } catch (e) {
    console.error("❌ POST /api/admin/purge-nov-2025 error:", e);
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

/* ======================= 404 ======================= */
app.use((req, res) =>
  res
    .status(404)
    .json({ ok: false, error: "route_not_found", path: req.path })
);

/* ======================= Start ======================= */
app.listen(PORT, "0.0.0.0", () =>
  console.log(`🚀 API listening on port ${PORT}`)
);

mongoose
  .connect(MONGO_URI, { dbName: "optometry" })
  .then(() => {
    dbReady = true;
    console.log("✅ Mongo connected");
  })
  .catch((e) => console.error("❌ Mongo connect failed:", e.message));
