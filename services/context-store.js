const memoryStore = new Map();

function getConversationKey({ channel = 'whatsapp', from = '' } = {}) {
  return `${channel}:${from}`;
}

function getContext(key) {
  return memoryStore.get(key) || null;
}

function buildSummary(next) {
  if (next.lastProducts?.[0]?.name) {
    return `produto em foco: ${next.lastProducts[0].name}`;
  }
  if (next.lastInboundText) {
    return `última mensagem: ${next.lastInboundText}`;
  }
  return next.summary || '';
}

function detectStage(existing = {}, patch = {}) {
  const incomingText = String(patch.lastInboundText || '').toLowerCase();
  if (/quero esse|quero essa|vou querer|quero comprar/.test(incomingText)) return 'checkout_start';
  if (/tem\s+lingerie|tem\s+conjunto|tem\s+calcinha|tem\s+suti[aã]|tem\s+body|tem\s+camisola/.test(incomingText)) return 'catalog_browse';
  return patch.currentStage || existing.currentStage || 'new_lead';
}

function saveContext(key, patch = {}) {
  const existing = memoryStore.get(key) || {};
  const next = {
    ...existing,
    ...patch,
    currentStage: detectStage(existing, patch),
    updatedAt: new Date().toISOString(),
    createdAt: existing.createdAt || new Date().toISOString(),
  };
  next.summary = patch.summary || buildSummary(next);
  memoryStore.set(key, next);
  return next;
}

function clearContext(key) {
  memoryStore.delete(key);
  return { ok: true };
}

module.exports = {
  getConversationKey,
  getContext,
  saveContext,
  clearContext,
};
