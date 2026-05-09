const express = require('express');
const router = express.Router();

router.get('/version', (req, res) => {
  res.json({
    ok: true,
    service: 'cleo-backend',
    version: 'customers-list-no-sort-814e74e',
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
