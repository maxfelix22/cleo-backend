const express = require('express');
const router = express.Router();
const { syncSquareCatalog, syncSquareOrders, syncSquareCustomers } = require('../services/square-sync-service');

function isInternalSyncAllowed(req) {
  const requiredToken = String(process.env.SQUARE_SYNC_TOKEN || '').trim();
  if (!requiredToken) return true;
  const provided = String(req.headers['x-sync-token'] || req.query.token || '').trim();
  return provided && provided === requiredToken;
}

router.get('/square-sync/health', (req, res) => {
  res.json({ ok: true, service: 'square-sync', timestamp: new Date().toISOString() });
});

router.post('/square-sync/catalog', async (req, res, next) => {
  try {
    if (!isInternalSyncAllowed(req)) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }

    const result = await syncSquareCatalog();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/square-sync/orders', async (req, res, next) => {
  try {
    if (!isInternalSyncAllowed(req)) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }

    const limit = Number(req.body?.limit || req.query.limit || 200);
    const result = await syncSquareOrders(limit);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/square-sync/customers', async (req, res, next) => {
  try {
    if (!isInternalSyncAllowed(req)) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }

    const limit = Number(req.body?.limit || req.query.limit || 200);
    const result = await syncSquareCustomers(limit);
    res.json(result);
  } catch (err) {
    console.error('[square-sync/customers]', err?.status || '', err?.message || err, err?.payload || '', err?.debugCustomer || '');
    return res.status(err?.status || 500).json({
      ok: false,
      error: err?.message || 'square_customers_sync_failed',
      status: err?.status || 500,
      payload: err?.payload || null,
      debug_customer: err?.debugCustomer || null,
    });
  }
});

module.exports = router;
