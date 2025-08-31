// fs-routes.js — adds FS-backed endpoints without touching your mongoose routes
const express = require("express");
const router = express.Router();
router.use(express.json({ limit: "2mb" }));
const { createStore } = require("./storage");

// Use storage.js (FS or Mongo depending on env), but you'll run with REPORTS_BACKEND=fs
const store = createStore();

// async init (no-op for FS, connects for Mongo)
(async () => {
  try {
    if (store.init) await store.init();
    const info = await store.info();
    console.log("🗄️  FS router storage info:", info);
  } catch (e) {
    console.error("FS router init error:", e);
  }
})();

function filt(q) {
  return {
    district: q.district,
    institution: q.institution,
    month: q.month,
    year: q.year
  };
}

// Report where storage is pointing (FS folder or Mongo URI)
router.get("/api/storage/info", async (req, res) => {
  try {
    const info = await store.info();
    res.json({ ok: true, info });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Save (or update) a report — filesystem version
router.post("/api/report.fs", async (req, res) => {
  try {
    const { district, institution, month, year, answers, cumulative, eyeBank, visionCenter } = req.body || {};
    if (!district || !institution || !month || !year) {
      return res.status(400).json({ ok: false, error: "Missing district/institution/month/year" });
    }
    const filter = { district, institution, month, year };
    const payload = {
      answers: answers || {},
      cumulative: cumulative || {},
      eyeBank: eyeBank || [],
      visionCenter: visionCenter || []
    };
    const saved = await store.upsertReport(filter, payload);
    res.json({ ok: true, saved: saved.doc || null });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Fetch one report — filesystem version
router.get("/api/report.fs", async (req, res) => {
  try {
    const doc = await store.getReport(filt(req.query));
    if (!doc) return res.status(404).json({ ok: false, error: "Not found" });
    res.json({ ok: true, doc });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// List reports — filesystem version (accepts optional filters)
router.get("/api/reports.fs", async (req, res) => {
  try {
    const list = await store.listReports(filt(req.query));
    res.json({ ok: true, list });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

module.exports = router;
