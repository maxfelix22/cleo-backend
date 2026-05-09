const express = require('express');
const router = express.Router();

router.get('/version', (req, res) => {
  res.json({
    ok: true,
    service: 'cleo-backend',
    version: 'ecab33f',
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
