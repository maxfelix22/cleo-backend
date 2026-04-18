const TELEGRAM_BOT_TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
const TELEGRAM_OPS_CHAT_ID = String(process.env.TELEGRAM_OPS_CHAT_ID || '').trim();
const TELEGRAM_OPS_THREAD_ID = String(process.env.TELEGRAM_OPS_THREAD_ID || '').trim();
const TELEGRAM_THREAD_ATENDIMENTO_VENDAS = String(process.env.TELEGRAM_THREAD_ATENDIMENTO_VENDAS || '').trim();
const TELEGRAM_THREAD_PRODUTOS_ESTOQUE = String(process.env.TELEGRAM_THREAD_PRODUTOS_ESTOQUE || '').trim();
const TELEGRAM_THREAD_MEMORIA_CLIENTES = String(process.env.TELEGRAM_THREAD_MEMORIA_CLIENTES || '').trim();
const TELEGRAM_THREAD_SISTEMA_AUTOMACAO = String(process.env.TELEGRAM_THREAD_SISTEMA_AUTOMACAO || '').trim();
const TELEGRAM_THREAD_HANDOFF_PEDIDOS = String(process.env.TELEGRAM_THREAD_HANDOFF_PEDIDOS || '').trim();

const THREADS_BY_KEY = {
  atendimento_vendas: TELEGRAM_THREAD_ATENDIMENTO_VENDAS,
  produtos_estoque: TELEGRAM_THREAD_PRODUTOS_ESTOQUE,
  memoria_clientes: TELEGRAM_THREAD_MEMORIA_CLIENTES,
  sistema_automacao: TELEGRAM_THREAD_SISTEMA_AUTOMACAO,
  handoff_pedidos: TELEGRAM_THREAD_HANDOFF_PEDIDOS || TELEGRAM_OPS_THREAD_ID,
};

function hasTelegramOpsConfig() {
  return !!(TELEGRAM_BOT_TOKEN && TELEGRAM_OPS_CHAT_ID);
}

function resolveThreadId(topicKey) {
  const threadId = THREADS_BY_KEY[topicKey] || TELEGRAM_OPS_THREAD_ID;
  return threadId ? Number(threadId) : null;
}

async function sendOperationalTelegramMessage(text, options = {}) {
  if (!hasTelegramOpsConfig()) {
    return {
      ok: true,
      mode: 'stub',
      text,
      topicKey: options.topicKey || 'handoff_pedidos',
      sentAt: new Date().toISOString(),
    };
  }

  const payload = {
    chat_id: TELEGRAM_OPS_CHAT_ID,
    text,
    parse_mode: 'Markdown',
  };

  const resolvedThreadId = resolveThreadId(options.topicKey || 'handoff_pedidos');
  if (resolvedThreadId) {
    payload.message_thread_id = resolvedThreadId;
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
    topicKey: options.topicKey || 'handoff_pedidos',
    result: parsed.result,
    sentAt: new Date().toISOString(),
  };
}

module.exports = {
  hasTelegramOpsConfig,
  resolveThreadId,
  sendOperationalTelegramMessage,
};
