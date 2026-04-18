const TELEGRAM_BOT_TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
const TELEGRAM_OPS_CHAT_ID = String(process.env.TELEGRAM_OPS_CHAT_ID || '').trim();
const TELEGRAM_OPS_THREAD_ID = String(process.env.TELEGRAM_OPS_THREAD_ID || '').trim();

function hasTelegramOpsConfig() {
  return !!(TELEGRAM_BOT_TOKEN && TELEGRAM_OPS_CHAT_ID);
}

async function sendOperationalTelegramMessage(text) {
  if (!hasTelegramOpsConfig()) {
    return {
      ok: true,
      mode: 'stub',
      text,
      sentAt: new Date().toISOString(),
    };
  }

  const payload = {
    chat_id: TELEGRAM_OPS_CHAT_ID,
    text,
    parse_mode: 'Markdown',
  };

  if (TELEGRAM_OPS_THREAD_ID) {
    payload.message_thread_id = Number(TELEGRAM_OPS_THREAD_ID);
  }

  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const textResponse = await response.text();
  let parsed;
  try { parsed = JSON.parse(textResponse); } catch (err) { parsed = { raw: textResponse }; }

  if (!response.ok || parsed.ok === false) {
    const error = new Error('Telegram ops send failed');
    error.status = response.status;
    error.payload = parsed;
    throw error;
  }

  return {
    ok: true,
    mode: 'telegram',
    result: parsed.result,
    sentAt: new Date().toISOString(),
  };
}

module.exports = {
  hasTelegramOpsConfig,
  sendOperationalTelegramMessage,
};
