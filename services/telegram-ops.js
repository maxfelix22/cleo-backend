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

function buildShortSummary(context = {}) {
  const pieces = [];
  const product = context.lastProducts?.[0] || context.lastProductPayload || null;
  const checkout = context.checkout || {};

  if (product?.name) pieces.push(product.name);
  if (context.followUpSignals?.requestedSize) pieces.push(`tam ${context.followUpSignals.requestedSize}`);
  if (checkout.deliveryMode === 'local_delivery') pieces.push('entrega local');
  if (checkout.deliveryMode === 'usps') pieces.push('USPS');
  if (checkout.deliveryMode === 'pickup') pieces.push('retirada');
  if (context.currentStage === 'checkout_review') pieces.push('em revisão');
  if (context.currentStage === 'handoff_ready') pieces.push('pronta para handoff');

  return pieces.join(' · ');
}

function buildSalesEscortMessage(context = {}) {
  const product = context.lastProducts?.[0] || context.lastProductPayload || null;
  const followUpSignals = context.followUpSignals || {};
  const checkout = context.checkout || {};
  const lowSignalMessages = new Set(['ok', 'okay', 'okey', 'sim', 'certo', 'fechado', 'isso']);
  const lastInboundText = String(context.lastInboundText || '').trim();
  const meaningfulLastMessage = lowSignalMessages.has(lastInboundText.toLowerCase()) ? '' : lastInboundText;
  const shortSummary = buildShortSummary(context);

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

  let priorityScore = 0;
  if (followUpSignals.wantsThis) priorityScore += 3;
  if (context.currentStage === 'checkout_review') priorityScore += 3;
  if (context.currentStage === 'handoff_ready') priorityScore += 4;
  if (followUpSignals.asksPrice) priorityScore += 1;
  if (followUpSignals.requestedSize) priorityScore += 1;
  if (followUpSignals.asksColor) priorityScore += 1;
  if (checkout.deliveryMode) priorityScore += 1;
  if (checkout.fullName || checkout.email || checkout.phone) priorityScore += 1;

  let priority = 'normal';
  if (priorityScore >= 5) {
    priority = 'alta';
  } else if (priorityScore >= 2) {
    priority = 'média';
  }

  const heatSignals = [];
  if (followUpSignals.wantsThis) heatSignals.push('intenção explícita de compra');
  if (context.currentStage === 'checkout_review') heatSignals.push('cliente já chegou na revisão do pedido');
  if (context.currentStage === 'handoff_ready') heatSignals.push('cliente pronta para handoff');
  if (checkout.deliveryMode) heatSignals.push(`logística já definida: ${checkout.deliveryMode}`);
  if (checkout.fullName || checkout.email || checkout.phone) heatSignals.push('dados de checkout já começaram a ser entregues');

  const actionHints = [];
  if (followUpSignals.wantsThis) actionHints.push('aproveitar intenção de compra e acelerar fechamento');
  if (context.currentStage === 'checkout_review') actionHints.push('evitar atrito e confirmar fechamento do pedido');
  if (context.currentStage === 'handoff_ready') actionHints.push('priorizar contato operacional sem esfriar a cliente');
  if (checkout.deliveryMode === 'local_delivery') actionHints.push('acompanhar logística local');
  if (checkout.deliveryMode === 'usps') actionHints.push('acompanhar envio e confirmação de frete');
  if (!checkout.deliveryMode && product?.name) actionHints.push('seguir condução comercial para fechamento');

  const lines = [
    '💬 *Atendimento & Vendas*',
    '',
    context.profileName ? `• Cliente: ${context.profileName}` : null,
    priority ? `• Prioridade comercial: ${priority}` : null,
    `• Score comercial: ${priorityScore}`,
    stageLabel ? `• Etapa comercial: ${stageLabel}` : null,
    meaningfulLastMessage ? `• Última msg útil: ${meaningfulLastMessage}` : null,
    product?.name ? `• Produto em foco: ${product.name}` : null,
    product?.price ? `• Preço: ${product.price}` : null,
    signals.length > 0 ? `• Sinais: ${signals.join(' · ')}` : null,
    heatSignals.length > 0 ? `• Calor comercial: ${heatSignals.join(' · ')}` : null,
    checkout.deliveryMode === 'local_delivery' ? '• Entrega escolhida: entrega local' : null,
    checkout.deliveryMode === 'usps' ? '• Entrega escolhida: USPS' : null,
    checkout.deliveryMode === 'pickup' ? '• Entrega escolhida: retirada' : null,
    actionHints.length > 0 ? `• Próximo olhar comercial: ${actionHints.join(' · ')}` : null,
    shortSummary ? `• Resumo curto: ${shortSummary}` : null,
    context.summary ? `• Resumo: ${context.summary}` : null,
  ].filter(Boolean);

  return lines.join('\n');
}

function buildMemoryEscortMessage(context = {}) {
  const product = context.lastProducts?.[0] || context.lastProductPayload || null;
  const checkout = context.checkout || {};
  const profileHints = [];
  const continuityHints = [];

  if (checkout.deliveryMode === 'local_delivery') profileHints.push('prefere entrega local');
  if (checkout.deliveryMode === 'usps') profileHints.push('aceita USPS');
  if (checkout.deliveryMode === 'pickup') profileHints.push('aceita retirada');
  if (product?.name) profileHints.push(`interesse atual em ${product.name}`);
  if (context.followUpSignals?.requestedSize) profileHints.push(`tamanho pedido ${context.followUpSignals.requestedSize}`);

  if (checkout.fullName) continuityHints.push('já temos nome completo');
  if (checkout.email) continuityHints.push('já temos email');
  if (checkout.phone) continuityHints.push('já temos telefone');
  if (checkout.address) continuityHints.push('já temos endereço');
  if (context.currentStage === 'handoff_ready') continuityHints.push('conversa pronta para retomada operacional');
  if (context.currentStage === 'checkout_review') continuityHints.push('cliente parou na revisão do pedido');

  const lines = [
    '🧠 *Memória & Clientes*',
    '',
    context.profileName ? `• Cliente: ${context.profileName}` : null,
    context.customerId ? `• Customer ID: ${context.customerId}` : null,
    context.conversationId ? `• Conversation ID: ${context.conversationId}` : null,
    profileHints.length > 0 ? `• Pistas de perfil: ${profileHints.join(' · ')}` : null,
    continuityHints.length > 0 ? `• Continuidade útil: ${continuityHints.join(' · ')}` : null,
    checkout.fullName ? `• Nome salvo: ${checkout.fullName}` : null,
    checkout.email ? `• Email salvo: ${checkout.email}` : null,
    checkout.phone ? `• Telefone salvo: ${checkout.phone}` : null,
    checkout.address ? '• Endereço salvo no contexto' : null,
    buildShortSummary(context) ? `• Resumo curto: ${buildShortSummary(context)}` : null,
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
  const requestedSize = context.followUpSignals?.requestedSize || '';
  const checkout = context.checkout || {};

  const alerts = [];
  if (requestedSize && availableSizes.length > 0 && !availableSizes.map((item) => String(item).toUpperCase()).includes(requestedSize.toUpperCase())) {
    alerts.push(`tamanho ${requestedSize} pedido, mas não visível com clareza no catálogo`);
  }
  if (context.followUpSignals?.asksColor && availableColors.length === 0) {
    alerts.push('cliente perguntou cor, mas o catálogo não mostrou cor com clareza');
  }
  if (!product?.price) {
    alerts.push('produto sem preço claro no payload atual');
  }
  if (checkout.deliveryMode === 'usps') {
    alerts.push('lembrar operação: loja atende apenas endereços dentro dos Estados Unidos');
  }

  const healthLabel = alerts.length > 0 ? 'catálogo/comercial com pontos de atenção' : 'catálogo com leitura suficiente neste ciclo';

  const lines = [
    '📦 *Produtos & Estoque*',
    '',
    `• Saúde de catálogo: ${healthLabel}`,
    product?.name ? `• Produto consultado: ${product.name}` : null,
    product?.price ? `• Preço base: ${product.price}` : null,
    availableSizes.length > 0 ? `• Tamanhos visíveis: ${[...new Set(availableSizes)].join(', ')}` : null,
    availableColors.length > 0 ? `• Cores visíveis: ${[...new Set(availableColors)].join(', ')}` : null,
    requestedSize ? `• Tamanho pedido na conversa: ${requestedSize}` : null,
    context.followUpSignals?.asksColor ? '• Sinal: cliente perguntou cor' : null,
    alerts.length > 0 ? `• Alertas de catálogo: ${alerts.join(' · ')}` : null,
    buildShortSummary(context) ? `• Resumo curto: ${buildShortSummary(context)}` : null,
    context.summary ? `• Resumo atual: ${context.summary}` : null,
  ].filter(Boolean);

  return lines.join('\n');
}

function buildSystemEscortMessage(context = {}, meta = {}) {
  const alerts = [];
  if (meta.transportMode && meta.transportMode !== 'twilio') alerts.push(`transporte fora do ideal: ${meta.transportMode}`);
  if (meta.persistenceMode && meta.persistenceMode !== 'supabase') alerts.push(`persistência fora do ideal: ${meta.persistenceMode}`);
  if (meta.eventMode && meta.eventMode !== 'supabase') alerts.push(`eventos fora do ideal: ${meta.eventMode}`);
  if (meta.opsDispatchMode && meta.opsDispatchMode !== 'telegram') alerts.push(`ops dispatch fora do ideal: ${meta.opsDispatchMode}`);
  if (!context.customerId) alerts.push('customerId ausente');
  if (!context.conversationId) alerts.push('conversationId ausente');
  if (!context.summary) alerts.push('summary ausente');

  const healthLabel = alerts.length > 0 ? 'ciclo degradado' : 'ciclo saudável';

  const lines = [
    '⚙️ *Sistema & Automação*',
    '',
    `• Saúde do ciclo: ${healthLabel}`,
    meta.transportMode ? `• Transporte: ${meta.transportMode}` : null,
    meta.persistenceMode ? `• Persistência: ${meta.persistenceMode}` : null,
    meta.eventMode ? `• Eventos: ${meta.eventMode}` : null,
    meta.opsDispatchMode ? `• Ops dispatch: ${meta.opsDispatchMode}` : null,
    context.currentStage ? `• Stage atual: ${context.currentStage}` : null,
    alerts.length > 0 ? `• Alertas técnicos: ${alerts.join(' · ')}` : '• Alertas técnicos: nenhum sinal crítico neste ciclo',
    buildShortSummary(context) ? `• Resumo curto: ${buildShortSummary(context)}` : null,
    context.summary ? `• Resumo: ${context.summary}` : null,
  ].filter(Boolean);

  return lines.join('\n');
}

module.exports = {
  hasTelegramOpsConfig,
  resolveThreadId,
  sendOperationalTelegramMessage,
  buildShortSummary,
  buildSalesEscortMessage,
  buildMemoryEscortMessage,
  buildCatalogEscortMessage,
  buildSystemEscortMessage,
};
