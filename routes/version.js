const express = require('express');
const router = express.Router();

router.get('/version', (req, res) => {
  res.json({
    ok: true,
    service: 'cleo-backend',
    version: 'orders-backfill-ready-1000plus',
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
