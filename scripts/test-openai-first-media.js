#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const envDir = path.join(process.env.HOME || '', '.config', 'cleo', 'env.d');
if (fs.existsSync(envDir)) {
  for (const file of fs.readdirSync(envDir)) {
    if (!file.endsWith('.env')) continue;
    const fullPath = path.join(envDir, file);
    const lines = fs.readFileSync(fullPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const exportLine = trimmed.replace(/^export\s+/, '');
      const eq = exportLine.indexOf('=');
      if (eq === -1) continue;
      const key = exportLine.slice(0, eq).trim();
      let value = exportLine.slice(eq + 1).trim();
      value = value.replace(/^['"]|['"]$/g, '');
      if (!(key in process.env)) process.env[key] = value;
    }
  }
}

const twilioMedia = require('../services/twilio-media');
const openaiFirstRoute = require('../routes/openai-first');

const imagePath = '/home/maxwel/.openclaw/media/inbound/file_489---e16dc123-42f5-4774-9136-5284fb3fdf38.jpg';
const audioPath = '/home/maxwel/.openclaw/media/inbound/file_100---bcd81efe-7c40-469d-99c3-28800d77e0db.ogg';

const originalDownloader = twilioMedia.downloadTwilioMediaAsBase64;
twilioMedia.downloadTwilioMediaAsBase64 = async function mockDownload(mediaUrl = '') {
  const url = String(mediaUrl || '');
  let filePath = imagePath;
  let contentType = 'image/jpeg';
  if (url.includes('audio-test')) {
    filePath = audioPath;
    contentType = 'audio/ogg';
  }
  const base64 = fs.readFileSync(filePath).toString('base64');
  return {
    ok: true,
    contentType,
    base64,
    bytes: Buffer.byteLength(base64, 'base64'),
    mediaUrl: url,
    mocked: true,
  };
};

function getRouteHandler(router, routePath) {
  const layer = router.stack.find((entry) => entry.route && entry.route.path === routePath && entry.route.methods.post);
  if (!layer) throw new Error(`Route not found: ${routePath}`);
  return layer.route.stack[0].handle;
}

function makeReq(body) {
  return { body };
}

function makeRes() {
  return {
    statusCode: 200,
    payload: null,
    json(data) {
      this.payload = data;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    }
  };
}

async function invoke(handler, body) {
  const req = makeReq(body);
  const res = makeRes();
  await new Promise((resolve, reject) => {
    const maybePromise = handler(req, res, (err) => (err ? reject(err) : resolve()));
    if (maybePromise && typeof maybePromise.then === 'function') {
      maybePromise.then(resolve).catch(reject);
    }
  });
  return res.payload;
}

function inboundBase(from, body) {
  return {
    From: `whatsapp:${from}`,
    To: 'whatsapp:+14155238886',
    Body: body,
    ProfileName: 'Teste Mídia',
    MessageSid: `SM-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
  };
}

async function main() {
  const handler = getRouteHandler(openaiFirstRoute, '/openai-first/whatsapp/inbound');

  const scenarios = [
    {
      name: 'audio_realish',
      body: {
        ...inboundBase('+15550000031', ''),
        NumMedia: '1',
        MediaContentType0: 'audio/ogg',
        MediaUrl0: 'https://mock.local/audio-test.ogg',
      }
    },
    {
      name: 'image_realish',
      body: {
        ...inboundBase('+15550000032', 'vc tem esse produto?'),
        NumMedia: '1',
        MediaContentType0: 'image/jpeg',
        MediaUrl0: 'https://mock.local/image-test.jpg',
      }
    }
  ];

  const results = [];
  for (const scenario of scenarios) {
    const payload = await invoke(handler, scenario.body);
    results.push({
      name: scenario.name,
      mode: payload?.mediaResolved?.mode || '',
      audio_transcription: payload?.mediaResolved?.audio_transcription || '',
      vision_result: payload?.mediaResolved?.vision_result || null,
      top_products: (payload?.products || []).slice(0, 3).map((p) => p.name),
      reply_mode: payload?.compose?.reply_mode || '',
      final_text: payload?.compose?.final_text || '',
      semantic_source: payload?.semantic?.source || '',
    });
  }

  console.log(JSON.stringify({ ok: true, results }, null, 2));
}

main()
  .catch((err) => {
    console.error(JSON.stringify({ ok: false, error: err.message, stack: err.stack }, null, 2));
    process.exit(1);
  })
  .finally(() => {
    twilioMedia.downloadTwilioMediaAsBase64 = originalDownloader;
  });
