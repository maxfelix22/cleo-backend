const express = require('express');
const router = express.Router();
const { describeProductImage } = require('../services/vision-service');

router.post('/vision/describe-product-image', async (req, res, next) => {
  try {
    const imageUrl = String(req.body.image_url || req.body.imageUrl || '').trim();
    const customerText = String(req.body.customer_text || req.body.customerText || '').trim();
    const conversationContext = String(req.body.conversation_context || req.body.conversationContext || '').trim();

    if (!imageUrl) {
      return res.status(400).json({ ok: false, error: 'image_url is required' });
    }

    const result = await describeProductImage({ imageUrl, customerText, conversationContext });
    return res.json({ ok: true, ...result });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
