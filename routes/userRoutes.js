const express = require("express");
const router = express.Router();

// Connect to MongoDB
const { MongoClient } = require("mongodb");
const uri = "mongodb://localhost:27017"; // change if needed
const client = new MongoClient(uri);
const dbName = "optometryApp"; // change if you prefer
let db;

// Connect to the database once
async function connectDB() {
  if (!db) {
    await client.connect();
    db = client.db(dbName);
  }
}

// POST /api/register
router.post("/register", async (req, res) => {
  const { district, institution, phone } = req.body;

  if (!district || !institution || !phone) {
    return res.status(400).json({ error: "All fields are required." });
  }

  try {
    await connectDB();
    const users = db.collection("users");

    const exists = await users.findOne({ district, institution });
    if (exists) {
      return res.status(409).json({ error: "Institution already registered." });
    }

    await users.insertOne({ district, institution, phone });
    res.status(200).json({ success: true });
  } catch (err) {
    console.error("Registration error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;

