const express = require('express');
const router = express.Router();
const { describeProductImage, transcribeAudio } = require('../services/vision-service');

router.post('/vision/describe-product-image', async (req, res, next) => {
  try {
    const imageUrl = String(req.body.image_url || req.body.imageUrl || '').trim();
    const imageData = String(req.body.image_data || req.body.imageData || '').trim();
    const customerText = String(req.body.customer_text || req.body.customerText || '').trim();
    const conversationContext = String(req.body.conversation_context || req.body.conversationContext || '').trim();

    if (!imageUrl && !imageData) {
      return res.status(400).json({ ok: false, error: 'image_url or image_data is required' });
    }

    const result = await describeProductImage({ imageUrl, imageData, customerText, conversationContext });
    return res.json({ ok: true, ...result });
  } catch (err) {
    return next(err);
  }
});

router.post('/vision/transcribe-audio', async (req, res, next) => {
  try {
    const audioData = String(req.body.audio_data || req.body.audioData || '').trim();
    const mimeType = String(req.body.mime_type || req.body.mimeType || 'audio/ogg').trim();

    if (!audioData) {
      return res.status(400).json({ ok: false, error: 'audio_data is required' });
    }

    const result = await transcribeAudio({ audioData, mimeType });
    return res.json({ ok: true, ...result });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
