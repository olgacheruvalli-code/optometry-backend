// storage.js — pluggable persistence for reports (FS or Mongo)
const fs = require("fs");
const fsp = require("fs").promises;
const path = require("path");
const { MongoClient } = require("mongodb");

function sanitize(name) {
  return String(name || "").replace(/[\\/:*?"<>|]/g, "_").trim() || "_";
}

function keyFilter(q) {
  return { district: q.district, institution: q.institution, month: q.month, year: q.year };
}

// If your questions are q1..q84, this covers them.
// If you use a custom set, replace this array with your exact keys.
const ALL_QUESTION_KEYS = Array.from({ length: 84 }, (_, i) => `q${i + 1}`);

function normalizeAnswers(obj = {}) {
  const out = {};
  for (const k of ALL_QUESTION_KEYS) out[k] = Number(obj[k] ?? 0);
  return out;
}

class FileStore {
  constructor(baseDir) { this.baseDir = baseDir; }
  setBaseDir(newDir) { this.baseDir = newDir; }
  async ensureDir(dir) { await fsp.mkdir(dir, { recursive: true }); }

  filePath(filter) {
    const d = sanitize(filter.district);
    const i = sanitize(filter.institution);
    const y = sanitize(filter.year);
    const m = sanitize(filter.month);
    return path.join(this.baseDir, d, i, y, `${m}.json`);
  }

  async upsertReport(filter, payload) {
    const file = this.filePath(filter);
    await this.ensureDir(path.dirname(file));
    const now = new Date().toISOString();
    const doc = {
      ...filter,
      answers: normalizeAnswers(payload.answers || {}),
      cumulative: normalizeAnswers(payload.cumulative || {}),
      eyeBank: payload.eyeBank || [],
      visionCenter: payload.visionCenter || [],
      updatedAt: now,
    };
    await fsp.writeFile(file, JSON.stringify(doc, null, 2), "utf8");
    return { ok: true, doc, file };
  }

  async getReport(filter) {
    const file = this.filePath(filter);
    try { return JSON.parse(await fsp.readFile(file, "utf8")); }
    catch { return null; }
  }

  async listReports(filter = {}) {
    const out = [];
    const walk = async (dir) => {
      let entries = [];
      try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) await walk(full);
        else if (e.isFile() && e.name.endsWith(".json")) {
          try {
            const doc = JSON.parse(await fsp.readFile(full, "utf8"));
            let ok = true;
            for (const k of ["district","institution","month","year"]) {
              if (filter[k] && String(filter[k]) !== String(doc[k])) ok = false;
            }
            if (ok) out.push(doc);
          } catch {}
        }
      }
    };
    await walk(this.baseDir);
    return out;
  }

  async info() { return { backend: "fs", baseDir: this.baseDir, keyCount: ALL_QUESTION_KEYS.length }; }
}

class MongoStore {
  constructor(uri) { this.uri = uri; this.client = null; this.db = null; this.col = null; }
  async init() {
    if (this.client) return;
    this.client = new MongoClient(this.uri);
    await this.client.connect();
    const dbName = (new URL(this.uri).pathname.replace("/", "")) || "optometry";
    this.db = this.client.db(dbName);
    this.col = this.db.collection("reports");
    await this.col.createIndex(
      { district:1, institution:1, year:1, month:1 },
      { unique: true, name: "uniq_identity" }
    );
  }
  async upsertReport(filter, payload) {
    await this.init();
    const now = new Date().toISOString();
    const doc = {
      ...filter,
      answers: normalizeAnswers(payload.answers || {}),
      cumulative: normalizeAnswers(payload.cumulative || {}),
      eyeBank: payload.eyeBank || [],
      visionCenter: payload.visionCenter || [],
      updatedAt: now,
    };
    await this.col.updateOne(keyFilter(filter), { $set: doc }, { upsert: true });
    return { ok: true, doc };
  }
  async getReport(filter) { await this.init(); return await this.col.findOne(keyFilter(filter)); }
  async listReports(filter = {}) {
    await this.init();
    const q = {};
    for (const k of ["district","institution","month","year"]) if (filter[k]) q[k] = filter[k];
    return await this.col.find(q).sort({ year:1 }).toArray();
  }
  async info() {
    await this.init();
    return { backend: "mongo", uri: this.uri, db: this.db.databaseName, keyCount: ALL_QUESTION_KEYS.length };
  }
}

function createStore() {
  const mode = (process.env.REPORTS_BACKEND || "mongo").toLowerCase();
  if (mode === "fs") {
    const dir = process.env.REPORTS_DIR || path.join(process.cwd(), "data", "reports");
    fs.mkdirSync(dir, { recursive: true });
    return new FileStore(dir);
  }
  const uri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/optometry";
  return new MongoStore(uri);
}

module.exports = { createStore, FileStore, MongoStore, ALL_QUESTION_KEYS };
