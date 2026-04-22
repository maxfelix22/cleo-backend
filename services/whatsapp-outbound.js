const TWILIO_ACCOUNT_SID = String(process.env.TWILIO_ACCOUNT_SID || '').trim();
const TWILIO_AUTH_TOKEN = String(process.env.TWILIO_AUTH_TOKEN || '').trim();
const TWILIO_WHATSAPP_FROM = String(process.env.TWILIO_WHATSAPP_FROM || process.env.TWILIO_FROM || '').trim();

function hasRealTwilioConfig() {
  return !!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_WHATSAPP_FROM);
}

async function sendViaTwilio({ to, body, mediaUrls = [] }) {
  const params = new URLSearchParams();
  params.set('To', to.startsWith('whatsapp:') ? to : `whatsapp:${to}`);
  params.set('From', TWILIO_WHATSAPP_FROM.startsWith('whatsapp:') ? TWILIO_WHATSAPP_FROM : `whatsapp:${TWILIO_WHATSAPP_FROM}`);
  if (body) params.set('Body', body);
  for (const mediaUrl of mediaUrls) {
    if (mediaUrl) params.append('MediaUrl', mediaUrl);
  }

  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });

  const text = await response.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch (err) { parsed = { raw: text }; }

  if (!response.ok) {
    const error = new Error(`Twilio outbound failed with status ${response.status}`);
    error.status = response.status;
    error.payload = parsed;
    throw error;
  }

  return {
    ok: true,
    mode: 'twilio',
    to,
    body,
    mediaUrls,
    twilio: parsed,
    sentAt: new Date().toISOString(),
  };
}

async function sendWhatsAppMessage({ to, body, mediaUrls = [] }) {
  if (hasRealTwilioConfig()) {
    return sendViaTwilio({ to, body, mediaUrls });
  }

  return {
    ok: true,
    mode: 'stub',
    to,
    body,
    mediaUrls,
    sentAt: new Date().toISOString(),
  };
}

module.exports = {
  hasRealTwilioConfig,
  sendWhatsAppMessage,
};
