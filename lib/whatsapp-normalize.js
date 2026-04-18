function normalizePhone(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (value.startsWith('whatsapp:')) return value.replace(/^whatsapp:/i, '').trim();
  if (value.startsWith('+')) return value;
  const digits = value.replace(/\D+/g, '');
  return digits ? `+${digits}` : '';
}

function normalizeWhatsAppInbound(payload = {}) {
  const from = normalizePhone(payload.From || payload.from || payload.WaId || '');
  const to = normalizePhone(payload.To || payload.to || '');
  const text = String(payload.Body || payload.body || '').trim();
  const profileName = String(payload.ProfileName || payload.profileName || '').trim();
  const messageSid = String(payload.MessageSid || payload.SmsMessageSid || payload.messageSid || '').trim();
  const mediaCount = Number(payload.NumMedia || payload.numMedia || 0) || 0;

  const media = [];
  for (let i = 0; i < mediaCount; i += 1) {
    const url = String(payload[`MediaUrl${i}`] || '').trim();
    const contentType = String(payload[`MediaContentType${i}`] || '').trim();
    if (url) media.push({ url, contentType });
  }

  return {
    channel: 'whatsapp',
    provider: 'twilio',
    from,
    to,
    profileName,
    text,
    messageSid,
    media,
    raw: payload,
    receivedAt: new Date().toISOString(),
  };
}

module.exports = {
  normalizePhone,
  normalizeWhatsAppInbound,
};
