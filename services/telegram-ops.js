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

function buildSalesEscortMessage(context = {}) {
  const product = context.lastProducts?.[0] || context.lastProductPayload || null;
  const followUpSignals = context.followUpSignals || {};
  const checkout = context.checkout || {};
  const lowSignalMessages = new Set(['ok', 'okay', 'okey', 'sim', 'certo', 'fechado', 'isso']);
  const lastInboundText = String(context.lastInboundText || '').trim();
  const meaningfulLastMessage = lowSignalMessages.has(lastInboundText.toLowerCase()) ? '' : lastInboundText;

  const signals = [
    followUpSignals.asksPrice ? 'perguntou preço' : null,
    followUpSignals.asksColor ? 'perguntou cor' : null,
    followUpSignals.requestedSize ? `pediu tamanho ${followUpSignals.requestedSize}` : null,
    followUpSignals.wantsThis ? 'mostrou intenção de compra' : null,
  ].filter(Boolean);

  const lines = [
    '💬 *Atendimento & Vendas*',
    '',
    context.profileName ? `• Cliente: ${context.profileName}` : null,
    meaningfulLastMessage ? `• Última msg útil: ${meaningfulLastMessage}` : null,
    product?.name ? `• Produto em foco: ${product.name}` : null,
    product?.price ? `• Preço: ${product.price}` : null,
    signals.length > 0 ? `• Sinais: ${signals.join(' · ')}` : null,
    checkout.deliveryMode === 'local_delivery' ? '• Entrega escolhida: entrega local' : null,
    checkout.deliveryMode === 'usps' ? '• Entrega escolhida: USPS' : null,
    checkout.deliveryMode === 'pickup' ? '• Entrega escolhida: retirada' : null,
    checkout.fullName ? `• Nome: ${checkout.fullName}` : null,
    checkout.email ? `• Email: ${checkout.email}` : null,
    checkout.phone ? `• Telefone: ${checkout.phone}` : null,
    context.summary ? `• Resumo: ${context.summary}` : null,
  ].filter(Boolean);

  return lines.join('\n');
}

module.exports = {
  hasTelegramOpsConfig,
  resolveThreadId,
  sendOperationalTelegramMessage,
  buildSalesEscortMessage,
};
