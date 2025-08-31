// fs-augment.js — FS-backed routes with route-level body parsing (robust)
module.exports = function mountFsOverrides(app) {
  if ((process.env.REPORTS_BACKEND || "mongo").toLowerCase() !== "fs") return;

  const express = require("express");
  const jsonParser = express.json({ limit: "2mb" });
  const formParser = express.urlencoded({ extended: true });

  const { createStore } = require("./storage");
  const store = createStore();

  (async () => {
    try { if (store.init) await store.init(); } catch (e) { console.error(e); }
    console.log("🔁 FS augment mounted for /api/report(s) (+ id)");
  })();

  const filt = (q = {}) => ({
    district: q.district,
    institution: q.institution,
    month: q.month,
    year: q.year,
  });

  const parseMaybeJson = (v) => {
    if (typeof v === "string") {
      try { return JSON.parse(v); } catch { return v; }
    }
    return v;
  };

  // ----- Save/Update (singular) -----
  app.post("/api/report", jsonParser, formParser, async (req, res) => {
    try {
      let { district, institution, month, year, answers, cumulative, eyeBank, visionCenter } = req.body || {};
      answers = parseMaybeJson(answers) || {};
      cumulative = parseMaybeJson(cumulative) || {};
      eyeBank = parseMaybeJson(eyeBank) || [];
      visionCenter = parseMaybeJson(visionCenter) || [];
      if (!district || !institution || !month || !year) {
        return res.status(400).json({ ok:false, error:"Missing district/institution/month/year" });
      }
      const saved = await store.upsertReport({ district, institution, month, year }, { answers, cumulative, eyeBank, visionCenter });
      if (saved.file) console.log("📝 FS write →", saved.file);
      return res.json(saved.doc || saved);
    } catch (e) {
      console.error("FS POST /api/report error:", e);
      res.status(500).json({ ok:false, error:String(e) });
    }
  });

  // ----- Save/Update (plural) -----
  app.post("/api/reports", jsonParser, formParser, async (req, res) => {
    try {
      let { district, institution, month, year, answers, cumulative, eyeBank, visionCenter } = req.body || {};
      answers = parseMaybeJson(answers) || {};
      cumulative = parseMaybeJson(cumulative) || {};
      eyeBank = parseMaybeJson(eyeBank) || [];
      visionCenter = parseMaybeJson(visionCenter) || [];
      if (!district || !institution || !month || !year) {
        return res.status(400).json({ ok:false, error:"Missing district/institution/month/year" });
      }
      const saved = await store.upsertReport({ district, institution, month, year }, { answers, cumulative, eyeBank, visionCenter });
      if (saved.file) console.log("📝 FS write →", saved.file);
      return res.json(saved.doc || saved);
    } catch (e) {
      console.error("FS POST /api/reports error:", e);
      res.status(500).json({ ok:false, error:String(e) });
    }
  });

  // ----- Get one by keys -----
  app.get("/api/report", async (req, res) => {
    try {
      const doc = await store.getReport(filt(req.query));
      if (!doc) return res.status(404).json({ ok:false, error:"Not found" });
      return res.json(doc);
    } catch (e) {
      console.error("FS GET /api/report error:", e);
      res.status(500).json({ ok:false, error:String(e) });
    }
  });

  // ----- List (array) with synthetic _id -----
  app.get("/api/reports", async (req, res) => {
    try {
      const list = await store.listReports(filt(req.query));
      const withIds = list.map(d => ({
        ...d,
        _id: encodeURIComponent([d.district, d.institution, d.year, d.month].join("::")),
      }));
      return res.json(withIds);
    } catch (e) {
      console.error("FS GET /api/reports error:", e);
      res.status(500).json({ ok:false, error:String(e) });
    }
  });

  // ----- Get one by synthetic id -----
  app.get("/api/reports/:id", async (req, res) => {
    try {
      const raw = decodeURIComponent(req.params.id || "");
      const [district, institution, year, month] = raw.split("::");
      const doc = await store.getReport({ district, institution, year, month });
      if (!doc) return res.status(404).json({ ok:false, error:"Not found" });
      return res.json(doc);
    } catch (e) {
      console.error("FS GET /api/reports/:id error:", e);
      res.status(500).json({ ok:false, error:String(e) });
    }
  });
};
