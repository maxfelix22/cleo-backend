const TWILIO_ACCOUNT_SID = String(process.env.TWILIO_ACCOUNT_SID || '').trim();
const TWILIO_AUTH_TOKEN = String(process.env.TWILIO_AUTH_TOKEN || '').trim();

function hasTwilioMediaAuth() {
  return !!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN);
}

async function downloadTwilioMediaAsBase64(mediaUrl = '') {
  const url = String(mediaUrl || '').trim();
  if (!url) throw new Error('mediaUrl is required');
  if (!hasTwilioMediaAuth()) throw new Error('Twilio media auth not configured');

  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
  const response = await fetch(url, {
    headers: {
      Authorization: `Basic ${auth}`,
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Twilio media download failed ${response.status}: ${text.slice(0, 200)}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const contentType = String(response.headers.get('content-type') || '').trim();
  const base64 = Buffer.from(arrayBuffer).toString('base64');

  return {
    ok: true,
    contentType,
    base64,
    bytes: arrayBuffer.byteLength,
    mediaUrl: url,
  };
}

module.exports = {
  hasTwilioMediaAuth,
  downloadTwilioMediaAsBase64,
};
