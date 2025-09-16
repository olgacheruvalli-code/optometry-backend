
// === PUT /api/reports/:id — update an existing report ===
const mongoose = require('mongoose');

router.put('/reports/:id', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ ok:false, error:'missing_id' });

    let _id;
    try { _id = new mongoose.Types.ObjectId(id); }
    catch { return res.status(400).json({ ok:false, error:'bad_id' }); }

    const { answers, eyeBank, visionCenter, month, year } = req.body || {};
    const update = {};
    if (answers && typeof answers === 'object') update.answers = answers;
    if (Array.isArray(eyeBank)) update.eyeBank = eyeBank;
    if (Array.isArray(visionCenter)) update.visionCenter = visionCenter;
    if (month) update.month = month;
    if (year) update.year = String(year);
    update.updatedAt = new Date();

    const col = mongoose.connection.collection('reports');
    const result = await col.updateOne({ _id }, { $set: update });

    return res.json({
      ok: true,
      matched: result?.matchedCount || 0,
      modified: result?.modifiedCount || 0,
    });
  } catch (e) {
    console.error('PUT /api/reports/:id failed', e);
    return res.status(500).json({ ok:false, error:'server_error' });
  }
});
