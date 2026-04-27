const express = require('express');
const router = express.Router();
const { composeCustomerReply } = require('../services/compose-service');

router.post('/compose/customer-reply', async (req, res, next) => {
  try {
    const result = await composeCustomerReply(req.body || {});
    return res.json({ ok: true, ...result });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
