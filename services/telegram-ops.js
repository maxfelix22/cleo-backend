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

  const stageLabelMap = {
    catalog_browse: 'descoberta de produto',
    checkout_choose_delivery: 'escolha de entrega',
    checkout_collect_address: 'coleta de endereço',
    checkout_collect_name: 'coleta de nome',
    checkout_collect_contact: 'coleta de contato',
    checkout_review: 'revisão do pedido',
    handoff_ready: 'pronta para handoff',
  };

  const stageLabel = stageLabelMap[context.currentStage] || context.currentStage || '';

  const actionHints = [];
  if (followUpSignals.wantsThis) actionHints.push('aproveitar intenção de compra e acelerar fechamento');
  if (checkout.deliveryMode === 'local_delivery') actionHints.push('acompanhar logística local');
  if (checkout.deliveryMode === 'usps') actionHints.push('acompanhar envio e confirmação de frete');
  if (!checkout.deliveryMode && product?.name) actionHints.push('seguir condução comercial para fechamento');

  const lines = [
    '💬 *Atendimento & Vendas*',
    '',
    context.profileName ? `• Cliente: ${context.profileName}` : null,
    stageLabel ? `• Etapa comercial: ${stageLabel}` : null,
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
    actionHints.length > 0 ? `• Próximo olhar comercial: ${actionHints.join(' · ')}` : null,
    context.summary ? `• Resumo: ${context.summary}` : null,
  ].filter(Boolean);

  return lines.join('\n');
}

function buildMemoryEscortMessage(context = {}) {
  const product = context.lastProducts?.[0] || context.lastProductPayload || null;
  const checkout = context.checkout || {};
  const profileHints = [];

  if (checkout.deliveryMode === 'local_delivery') profileHints.push('prefere entrega local');
  if (checkout.deliveryMode === 'usps') profileHints.push('aceita USPS');
  if (checkout.deliveryMode === 'pickup') profileHints.push('aceita retirada');
  if (product?.name) profileHints.push(`interesse atual em ${product.name}`);
  if (context.followUpSignals?.requestedSize) profileHints.push(`tamanho pedido ${context.followUpSignals.requestedSize}`);

  const lines = [
    '🧠 *Memória & Clientes*',
    '',
    context.profileName ? `• Cliente: ${context.profileName}` : null,
    context.customerId ? `• Customer ID: ${context.customerId}` : null,
    context.conversationId ? `• Conversation ID: ${context.conversationId}` : null,
    profileHints.length > 0 ? `• Pistas de perfil: ${profileHints.join(' · ')}` : null,
    checkout.fullName ? `• Nome salvo: ${checkout.fullName}` : null,
    checkout.email ? `• Email salvo: ${checkout.email}` : null,
    checkout.phone ? `• Telefone salvo: ${checkout.phone}` : null,
    context.summary ? `• Resumo atual: ${context.summary}` : null,
  ].filter(Boolean);

  return lines.join('\n');
}

function buildCatalogEscortMessage(context = {}) {
  const product = context.lastProducts?.[0] || context.lastProductPayload || null;
  const availableSizes = Array.isArray(product?.variationDetails)
    ? product.variationDetails.map((variation) => variation?.size || variation?.name).filter(Boolean)
    : [];
  const availableColors = Array.isArray(product?.availableColors)
    ? product.availableColors
    : [];

  const lines = [
    '📦 *Produtos & Estoque*',
    '',
    product?.name ? `• Produto consultado: ${product.name}` : null,
    product?.price ? `• Preço base: ${product.price}` : null,
    availableSizes.length > 0 ? `• Tamanhos visíveis: ${[...new Set(availableSizes)].join(', ')}` : null,
    availableColors.length > 0 ? `• Cores visíveis: ${[...new Set(availableColors)].join(', ')}` : null,
    context.followUpSignals?.requestedSize ? `• Tamanho pedido na conversa: ${context.followUpSignals.requestedSize}` : null,
    context.followUpSignals?.asksColor ? '• Sinal: cliente perguntou cor' : null,
    context.summary ? `• Resumo atual: ${context.summary}` : null,
  ].filter(Boolean);

  return lines.join('\n');
}

function buildSystemEscortMessage(context = {}, meta = {}) {
  const lines = [
    '⚙️ *Sistema & Automação*',
    '',
    meta.transportMode ? `• Transporte: ${meta.transportMode}` : null,
    meta.persistenceMode ? `• Persistência: ${meta.persistenceMode}` : null,
    meta.eventMode ? `• Eventos: ${meta.eventMode}` : null,
    meta.opsDispatchMode ? `• Ops dispatch: ${meta.opsDispatchMode}` : null,
    context.customerId ? `• Customer ID: ${context.customerId}` : null,
    context.conversationId ? `• Conversation ID: ${context.conversationId}` : null,
    context.currentStage ? `• Stage atual: ${context.currentStage}` : null,
    context.summary ? `• Resumo: ${context.summary}` : null,
  ].filter(Boolean);

  return lines.join('\n');
}

module.exports = {
  hasTelegramOpsConfig,
  resolveThreadId,
  sendOperationalTelegramMessage,
  buildSalesEscortMessage,
  buildMemoryEscortMessage,
  buildCatalogEscortMessage,
  buildSystemEscortMessage,
};
