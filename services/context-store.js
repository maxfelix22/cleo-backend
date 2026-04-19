const memoryStore = new Map();

function getConversationKey({ channel = 'whatsapp', from = '' } = {}) {
  return `${channel}:${from}`;
}

function getContext(key) {
  return memoryStore.get(key) || null;
}

function normalizeLastProducts(lastProducts = []) {
  if (!Array.isArray(lastProducts)) return [];
  return lastProducts
    .filter(Boolean)
    .map((product) => ({
      id: product.id || '',
      name: product.name || '',
      price: product.price || '',
      image: product.image || product.image_proxy || '',
      source: product.source || 'unknown',
      variation: product.variation || product.variation_name || '',
      variationDetails: Array.isArray(product.variationDetails)
        ? product.variationDetails
        : Array.isArray(product.raw?.variationDetails)
          ? product.raw.variationDetails
          : [],
      availableColors: Array.isArray(product.availableColors)
        ? product.availableColors
        : Array.isArray(product.raw?.availableColors)
          ? product.raw.availableColors
          : [],
      color: product.color || '',
      size: product.size || '',
      raw: product,
    }));
}

function buildSummary(next) {
  if (next.currentStage === 'handoff_ready' && next.lastProducts?.[0]?.name) {
    return `checkout pronto para handoff: ${next.lastProducts[0].name}`;
  }
  if (next.currentStage === 'checkout_review' && next.lastProducts?.[0]?.name) {
    return `checkout em revisão para ${next.lastProducts[0].name}`;
  }
  if ((next.currentStage === 'checkout_collect_contact' || next.currentStage === 'checkout_collect_name') && next.lastProducts?.[0]?.name) {
    return `checkout iniciado para ${next.lastProducts[0].name}`;
  }
  if (next.lastProducts?.[0]?.name) {
    return `produto em foco: ${next.lastProducts[0].name}`;
  }
  if (next.lastInboundText) {
    return `última mensagem: ${next.lastInboundText}`;
  }
  return next.summary || '';
}

function buildLastProductPayload(next) {
  const mainProduct = next.lastProducts?.[0] || null;
  if (!mainProduct) return next.lastProductPayload || null;

  return {
    product_id: mainProduct.id || '',
    product_name: mainProduct.name || '',
    price: mainProduct.price || '',
    image: mainProduct.image || '',
    source: mainProduct.source || 'unknown',
    variation: mainProduct.variation || '',
    variation_details: mainProduct.variationDetails || mainProduct.raw?.variationDetails || [],
    available_colors: mainProduct.availableColors || mainProduct.raw?.availableColors || [],
    color: mainProduct.color || '',
    size: mainProduct.size || '',
    current_stage: next.currentStage || '',
    summary: next.summary || '',
    checkout: next.checkout || null,
    follow_up_signals: next.followUpSignals || null,
    updated_at: next.updatedAt || new Date().toISOString(),
  };
}

function detectStage(existing = {}, patch = {}) {
  const incomingText = String(patch.lastInboundText || '').toLowerCase();
  if (/quero esse|quero essa|vou querer|quero comprar/.test(incomingText)) return 'checkout_start';
  if (/tem\s+lingerie|tem\s+conjunto|tem\s+calcinha|tem\s+suti[aã]|tem\s+body|tem\s+camisola/.test(incomingText)) return 'catalog_browse';
  return patch.currentStage || existing.currentStage || 'new_lead';
}

function isSummaryConsistent(summary = '', currentStage = '') {
  const text = String(summary || '').toLowerCase();
  if (!text) return false;
  if (currentStage === 'handoff_ready') return /handoff|pronto/.test(text);
  if (currentStage === 'checkout_review') return /revis[aã]o/.test(text);
  if (['checkout_collect_contact', 'checkout_collect_name', 'checkout_collect_address', 'checkout_choose_delivery'].includes(currentStage)) {
    return /checkout iniciado|checkout/.test(text);
  }
  if (currentStage === 'catalog_browse') return /produto em foco/.test(text);
  return true;
}

function saveContext(key, patch = {}) {
  const existing = memoryStore.get(key) || {};
  const next = {
    ...existing,
    ...patch,
    lastProducts: patch.lastProducts ? normalizeLastProducts(patch.lastProducts) : (existing.lastProducts || []),
    updatedAt: new Date().toISOString(),
    createdAt: existing.createdAt || new Date().toISOString(),
  };
  next.currentStage = detectStage(existing, next);
  const patchedSummary = patch.summary || existing.summary || '';
  next.summary = isSummaryConsistent(patchedSummary, next.currentStage)
    ? patchedSummary
    : buildSummary(next);
  next.lastProduct = next.lastProducts?.[0]?.name || patch.lastProduct || existing.lastProduct || next.lastProductPayload?.product_name || '';
  next.lastProductPayload = buildLastProductPayload(next);
  if (next.lastProductPayload?.product_name && next.lastProduct !== next.lastProductPayload.product_name) {
    next.lastProduct = next.lastProductPayload.product_name;
  }
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
