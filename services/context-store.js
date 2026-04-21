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

function getPrimaryCartItem(next = {}) {
  return Array.isArray(next.cart?.items) && next.cart.items.length > 0
    ? next.cart.items[0]
    : null;
}

function getPrimaryItemName(next = {}) {
  return getPrimaryCartItem(next)?.label || next.lastProducts?.[0]?.name || '';
}

function buildSummary(next) {
  const primaryItemName = getPrimaryItemName(next);
  if (next.currentStage === 'handoff_ready' && primaryItemName) {
    return `checkout pronto para handoff: ${primaryItemName}`;
  }
  if (next.currentStage === 'checkout_review' && primaryItemName) {
    return `checkout em revisão para ${primaryItemName}`;
  }
  if ((next.currentStage === 'checkout_collect_contact' || next.currentStage === 'checkout_collect_name') && primaryItemName) {
    return `checkout iniciado para ${primaryItemName}`;
  }
  if (primaryItemName) {
    return `produto em foco: ${primaryItemName}`;
  }
  if (next.lastInboundText) {
    return `última mensagem: ${next.lastInboundText}`;
  }
  return next.summary || '';
}

function buildLastProductPayload(next) {
  const mainProduct = next.lastProducts?.[0] || null;
  const primaryCartItem = getPrimaryCartItem(next);
  const existingPayload = next.lastProductPayload || null;
  if (!mainProduct && !primaryCartItem) return existingPayload;

  return {
    product_id: mainProduct?.id || existingPayload?.product_id || '',
    product_name: primaryCartItem?.label || mainProduct?.name || existingPayload?.product_name || '',
    price: mainProduct?.price || existingPayload?.price || '',
    image: mainProduct?.image || existingPayload?.image || '',
    source: mainProduct?.source || existingPayload?.source || (primaryCartItem ? 'cart' : 'unknown'),
    variation: mainProduct?.variation || existingPayload?.variation || '',
    variation_details: mainProduct?.variationDetails || mainProduct?.raw?.variationDetails || existingPayload?.variation_details || [],
    available_colors: mainProduct?.availableColors || mainProduct?.raw?.availableColors || existingPayload?.available_colors || [],
    color: mainProduct?.color || existingPayload?.color || '',
    size: mainProduct?.size || existingPayload?.size || '',
    current_stage: next.currentStage || existingPayload?.current_stage || '',
    summary: next.summary || existingPayload?.summary || '',
    checkout: next.checkout || existingPayload?.checkout || null,
    follow_up_signals: next.followUpSignals || existingPayload?.follow_up_signals || null,
    ontology_family: primaryCartItem?.ontologyFamily || existingPayload?.ontology_family || '',
    ontology_subfamilies: primaryCartItem?.ontologySubfamilies || existingPayload?.ontology_subfamilies || [],
    cart: next.cart || existingPayload?.cart || null,
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
  next.lastProduct = getPrimaryItemName(next) || patch.lastProduct || existing.lastProduct || next.lastProductPayload?.product_name || '';
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
