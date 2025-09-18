
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

/** Update a report by id */
const { ObjectId } = require('mongodb');
router.put('/api/reports/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const col = (req.app.get && req.app.get('db'))
      ? req.app.get('db').collection('reports')
      : require('mongoose').connection.collection('reports');

    const set = { updatedAt: new Date() };
    if (req.body.answers) set.answers = req.body.answers;
    if (req.body.eyeBank) set.eyeBank = req.body.eyeBank;
    if (req.body.visionCenter) set.visionCenter = req.body.visionCenter;

    const r = await col.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: set },
      { returnDocument: 'after' }
    );
    if (!r.value) return res.status(404).json({ ok:false, error:'not_found' });
    res.json({ ok:true, doc:r.value });
  } catch (e) {
    console.error('PUT /api/reports/:id failed', e);
    res.status(500).json({ ok:false, error:'server_error' });
  }
});
