const express = require('express');
const router = express.Router();

const { getStoreFacts } = require('../services/cleo-store-facts');
const { searchCleoKb, buildKBSnippets } = require('../services/cleo-kb-store');
const { searchProducts } = require('../services/catalog-service');
const { buildSemanticContext } = require('../services/semantic-store');
const { buildSemanticContextSupabase } = require('../services/semantic-supabase-store');
const { resolveHybridProducts } = require('../services/hybrid-product-resolver');
const { getConversationKey, getContext, saveContext, clearContext } = require('../services/context-store');
const { getOrCreateCustomerByPhone, getOrCreateOpenConversation, updateConversationState } = require('../services/customer-conversation-store');
const { appendEvent } = require('../services/event-store');
const { composeCustomerReply } = require('../services/compose-service');
const { describeProductImage, transcribeAudio } = require('../services/vision-service');
const { downloadTwilioMediaAsBase64 } = require('../services/twilio-media');
const { normalizeWhatsAppInbound } = require('../lib/whatsapp-normalize');
const {
  sendOperationalTelegramMessage,
  buildSalesEscortMessage,
  buildMemoryEscortMessage,
  buildCatalogEscortMessage,
  buildSystemEscortMessage,
  buildHandoffOrderMessage,
} = require('../services/telegram-ops');

function extractRequestedQuantity(text = '') {
  const normalized = String(text || '').toLowerCase();
  const match = normalized.match(/(?:quero|vou querer|quero levar|leva|me vê|me ver|separa|manda)\s+(\d{1,2})\b/);
  return match ? Number(match[1]) : 0;
}

function extractRequestedSize(text = '') {
  const lower = String(text || '').toLowerCase();
  const direct = lower.match(/\b(pp|p|m|g|gg|xg|xgg)\b/);
  if (direct) return direct[1].toUpperCase();
  const long = lower.match(/tamanho\s+(pp|p|m|g|gg|xg|xgg)/);
  if (long) return long[1].toUpperCase();
  return '';
}

function isShortContinuation(text = '') {
  return /^(sim|ss|pode sim|pode|me mostra|mostra aí|mostra ai|quero ver|manda|pode mandar)$/i.test(String(text || '').trim());
}

function isPurchaseIntent(text = '') {
  const normalized = String(text || '').toLowerCase().trim();
  if (!normalized) return false;

  const explicitPurchasePatterns = [
    /\bquero comprar\b/,
    /\bvou querer\b/,
    /\bquero levar\b/,
    /\bquero esse\b/,
    /\bquero essa\b/,
    /\bgostei desse\b/,
    /\bgostei dessa\b/,
    /\bfechar pedido\b/,
    /\bquero finalizar\b/,
    /\bfinalizar\b/,
    /\bme manda o total\b/
  ];

  return explicitPurchasePatterns.some((pattern) => pattern.test(normalized));
}

function isPureGreeting(text = '') {
  const normalized = String(text || '').toLowerCase().trim();
  if (!normalized) return false;
  return /^(?:oi+|ol[áa]|opa+|e ai|ei|bom dia|boa tarde|boa noite)(?:[!,. ]+(?:oi+|ol[áa]|opa+|bom dia|boa tarde|boa noite))*[!,. ]*$/.test(normalized);
}

function isFinalizeIntent(text = '') {
  return /(finalizar|fechar pedido|me manda o total|quero finalizar|fechou|pode fechar|vamos fechar)/i.test(String(text || ''));
}

function isResetIntent(text = '') {
  return /^(\/)?reset( chat| conversa| session| sessão)?$/i.test(String(text || '').trim());
}

function detectDeliveryMode(text = '') {
  const normalized = String(text || '').toLowerCase().trim();
  if (!normalized) return '';
  if (/\bpickup\b|retirada|retirar|vou retirar|quero retirar|pegar ai|buscar ai|ir buscar/.test(normalized)) return 'pickup';
  if (/usps|correio|envio/.test(normalized)) return 'usps';
  if (/entrega|delivery/.test(normalized)) return 'local_delivery';
  return '';
}

function extractPhoneNumber(text = '') {
  const digits = String(text || '').replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  return '';
}

function extractFullName(text = '', options = {}) {
  const normalized = String(text || '').trim();
  if (!normalized) return '';

  const explicit = normalized.match(/(?:meu nome é|sou|pode colocar no nome de)\s+([A-Za-zÀ-ÿ]+(?:\s+[A-Za-zÀ-ÿ]+){1,4})/i);
  if (explicit) return explicit[1].trim();

  const allowLooseName = Boolean(options.allowLooseName);
  if (!allowLooseName) return '';

  const looksLikeCommand = /quanto custa|tem no tamanho|tem no p\b|tem no m\b|tem no g\b|tem no gg\b|tem em outra cor|quero esse|quero essa|quero ver|me mostra|mostra ai|mostra aí|manda|sim\b|ok\b|okay\b|pickup|retirada|retirar|usps|entrega|delivery|finalizar|fechar pedido|me manda o total/i.test(normalized);
  if (looksLikeCommand) return '';

  if (/^([A-Za-zÀ-ÿ]+\s+[A-Za-zÀ-ÿ]+(?:\s+[A-Za-zÀ-ÿ]+){0,3})$/.test(normalized) && !/\d/.test(normalized)) {
    return normalized;
  }
  return '';
}

function inferCatalogQuery(messageText = '', state = {}, mediaHints = {}) {
  const text = String(messageText || '').trim();
  if (text) return text;
  const visualHint = String(mediaHints?.product_type_guess || mediaHints?.category_guess || '').trim();
  if (visualHint) return visualHint;
  const audioHint = String(mediaHints?.audio_transcription || '').trim();
  if (audioHint) return audioHint;
  const anchors = Array.isArray(state.anchor_products) ? state.anchor_products : [];
  return anchors[0]?.name || '';
}

function normalizeRecentMessages(events = []) {
  return (Array.isArray(events) ? events : [])
    .slice(-8)
    .map((event) => ({
      direction: event?.payload?.direction || event?.direction || '',
      text: event?.payload?.message_text || event?.message_text || '',
      at: event?.created_at || ''
    }))
    .filter((item) => item.text);
}

function buildBusinessRules() {
  return {
    tone: ['curto', 'direto', 'vivo', 'natural', 'vendedor'],
    persona: ['amiga safadinha', 'carinhosa', 'picante sem ser vulgar'],
    avoid_opening: ['Olá!'],
    preferred_openings: ['Tenho sim 💜', 'Perfeito 💜', 'Te mostro sim 💜', 'Fechado 💜', 'Separei algumas opções pra você 💜'],
    cart_policy: 'Cart-first sempre que houver intenção de compra real.',
    continuity_policy: 'Quando houver pending offer, tratar sim/me mostra/quero ver como continuação.',
    checkout_policy: 'Pedir só o próximo dado operacional necessário.',
    visual_policy: 'Visual precisa ter contrato único até o send.',
    upsell_policy: 'Fazer upsell sutil e relevante quando houver fit claro.',
    trust_policy: 'Nunca julgar, nunca soar clínica, nunca inventar produto fora da base.'
  };
}

function buildConversationState(existingContext = {}, conversation = null, products = []) {
  const payload = existingContext.lastProductPayload || conversation?.last_product_payload || null;
  const fallbackAnchorProducts = Array.isArray(existingContext.lastProducts) && existingContext.lastProducts.length > 0
    ? existingContext.lastProducts
    : (payload ? [payload] : []);

  const conversationGoal = existingContext.conversation_goal
    || payload?.conversation_goal
    || ((existingContext.currentStage || '').startsWith('checkout') ? 'checkout' : '')
    || '';

  const pendingOfferType = existingContext.pending_offer_type
    || payload?.pending_offer_type
    || (isShortContinuation(existingContext.lastInboundText || '') ? 'show_options' : 'none');

  const expectedNextUserMove = existingContext.expected_next_user_move
    || payload?.expected_next_user_move
    || (pendingOfferType === 'show_options' ? 'choose' : 'none');

  return {
    conversation_goal: conversationGoal,
    pending_offer_type: pendingOfferType,
    expected_next_user_move: expectedNextUserMove,
    last_seller_question: existingContext.last_seller_question || payload?.last_seller_question || '',
    requested_quantity: Number(existingContext.requested_quantity || payload?.requested_quantity || 0) || 0,
    anchor_products: fallbackAnchorProducts.length > 0 ? fallbackAnchorProducts : products.slice(0, 3)
  };
}

function calculateCartSubtotal(items = [], anchorProducts = []) {
  const anchors = Array.isArray(anchorProducts) ? anchorProducts : [];
  return (Array.isArray(items) ? items : []).reduce((sum, item) => {
    const productId = item.product_id || item.id || '';
    const anchor = anchors.find((product) => (product.id || '') === productId)
      || anchors.find((product) => (product.name || '') === (item.label || item.name || ''));
    const priceRaw = item.unit_price || anchor?.price || '';
    const numeric = Number(String(priceRaw).replace(/[^\d.]/g, '')) || 0;
    const qty = Number(item.qty || item.quantity || 1) || 1;
    return sum + (numeric * qty);
  }, 0);
}

function ensureCartShape(cart = {}, anchorProducts = []) {
  const items = Array.isArray(cart.items) ? cart.items : [];
  const computedItemsCount = items.reduce((sum, item) => sum + (Number(item.qty || item.quantity || 1) || 1), 0);
  return {
    items,
    itemsCount: Number(cart.itemsCount || computedItemsCount || items.length || 0),
    subtotal: Number(cart.subtotal || calculateCartSubtotal(items, anchorProducts) || 0),
    currency: String(cart.currency || 'USD').trim() || 'USD'
  };
}

function applyExtractedState(existingCheckout = {}, compose = {}, inboundText = '') {
  const extracted = compose?.extracted_state || {};
  const next = {
    ...existingCheckout,
    delivery_mode: String(existingCheckout.delivery_mode || '').trim(),
    next_required_field: String(existingCheckout.next_required_field || '').trim(),
    review_ready: Boolean(existingCheckout.review_ready),
    full_name: String(existingCheckout.full_name || '').trim(),
    phone: String(existingCheckout.phone || '').trim(),
    email: String(existingCheckout.email || '').trim(),
    address: String(existingCheckout.address || '').trim(),
    pickup_schedule: String(existingCheckout.pickup_schedule || '').trim()
  };

  if (extracted.delivery_mode) next.delivery_mode = extracted.delivery_mode;
  if (extracted.pickup_schedule) next.pickup_schedule = extracted.pickup_schedule;
  if (extracted.full_name) next.full_name = extracted.full_name;
  if (extracted.phone) next.phone = extracted.phone;

  const shouldCollectCustomerInfo = String(existingCheckout.next_required_field || '').trim() === 'customer_info';
  if (!next.full_name) next.full_name = extractFullName(inboundText, { allowLooseName: shouldCollectCustomerInfo });
  if (!next.phone && shouldCollectCustomerInfo) next.phone = extractPhoneNumber(inboundText);
  if (extracted.email) next.email = extracted.email;
  if (extracted.address) next.address = extracted.address;
  if (extracted.should_review) next.review_ready = true;

  const missing = Array.isArray(extracted.missing_fields) ? extracted.missing_fields : [];
  if (missing.includes('delivery_mode')) next.next_required_field = 'delivery_mode';
  else if (missing.includes('pickup_schedule')) next.next_required_field = 'pickup_schedule';
  else if (missing.includes('full_name') || missing.includes('phone') || missing.includes('email') || missing.includes('address')) next.next_required_field = 'customer_info';
  else if (extracted.should_review) next.next_required_field = 'review';

  return next;
}

function buildCheckoutSnapshot(existingCheckout = {}, cart = {}, compose = {}, inboundText = '') {
  const checkout = applyExtractedState({
    delivery_mode: String(existingCheckout.delivery_mode || '').trim(),
    next_required_field: String(existingCheckout.next_required_field || '').trim(),
    review_ready: Boolean(existingCheckout.review_ready),
    full_name: String(existingCheckout.full_name || '').trim(),
    phone: String(existingCheckout.phone || '').trim(),
    email: String(existingCheckout.email || '').trim(),
    address: String(existingCheckout.address || '').trim(),
    pickup_schedule: String(existingCheckout.pickup_schedule || '').trim()
  }, compose, inboundText);

  const detectedDeliveryMode = detectDeliveryMode(inboundText);
  if (compose?.checkout_updates?.delivery_mode) {
    checkout.delivery_mode = String(compose.checkout_updates.delivery_mode || '').trim();
  }
  if (!checkout.delivery_mode && detectedDeliveryMode) {
    checkout.delivery_mode = detectedDeliveryMode;
  }
  if (compose?.checkout_updates?.next_required_field) {
    checkout.next_required_field = String(compose.checkout_updates.next_required_field || '').trim();
  }
  if (typeof compose?.checkout_updates?.review_ready === 'boolean') {
    checkout.review_ready = Boolean(compose.checkout_updates.review_ready);
  }

  if (compose?.reply_mode === 'close_sale' && !checkout.next_required_field) {
    checkout.next_required_field = checkout.delivery_mode ? 'customer_info' : 'delivery_mode';
  }

  if (compose?.reply_mode === 'checkout_next' && !checkout.next_required_field) {
    checkout.next_required_field = checkout.delivery_mode ? 'customer_info' : 'delivery_mode';
  }

  if ((Array.isArray(cart.items) ? cart.items.length : 0) > 0 && compose?.conversation_goal === 'checkout') {
    if (!checkout.delivery_mode) {
      checkout.next_required_field = checkout.next_required_field || 'delivery_mode';
    } else if (checkout.delivery_mode === 'pickup' && !checkout.pickup_schedule) {
      checkout.next_required_field = 'pickup_schedule';
    } else if (!checkout.full_name) {
      checkout.next_required_field = 'customer_info';
    }
  }

  if (isFinalizeIntent(inboundText) && checkout.delivery_mode === 'pickup' && !checkout.pickup_schedule) {
    checkout.next_required_field = 'pickup_schedule';
  } else if (isFinalizeIntent(inboundText) && checkout.delivery_mode && !checkout.full_name) {
    checkout.next_required_field = 'customer_info';
  }

  const hasOperationalSchedule = checkout.delivery_mode !== 'pickup' || !!checkout.pickup_schedule;
  if (checkout.delivery_mode && hasOperationalSchedule && checkout.full_name && (checkout.phone || checkout.email)) {
    checkout.review_ready = true;
    checkout.next_required_field = 'review';
  }

  return checkout;
}

function buildPaymentPrompt(context = {}) {
  const checkout = context?.checkout || {};
  const cart = ensureCartShape(context?.cart || {}, context?.lastProducts || []);
  const totalText = cart.subtotal > 0 ? `$${cart.subtotal.toFixed(2)}` : '';
  const scheduleText = checkout.pickup_schedule ? ` para retirada ${checkout.pickup_schedule}` : '';

  return `Perfeito 💜 Seu pedido ficou em *${totalText || 'valor confirmado'}*${scheduleText}.\n\nPode fazer o pagamento via *Zelle* para:\n*5086189995*\n*Bruna Campos Samora Felix*\n\nAssim que enviar, me manda o comprovante 💜`;
}

function buildCustomerInfoPrompt(checkout = {}) {
  const mode = String(checkout?.delivery_mode || '').trim();
  if (mode === 'pickup') {
    return 'Perfeito 💜 Agora me manda tudo junto assim:\n\n*Nome Completo*:\n*Telefone*:\n*E-mail*:';
  }

  if (mode === 'usps') {
    return 'Perfeito 💜 Agora me manda tudo junto assim:\n\n*Nome Completo*:\n*Telefone*:\n*E-mail*:\n*Endereço*:\n*Apt / Unit*:\n*Cidade*:\n*Estado*:\n*Zip Code*:\n\n🚨 *IMPORTANTE:* Se o endereço estiver incompleto, a USPS retorna a encomenda para a loja e o novo frete fica por conta do cliente.';
  }

  if (mode === 'local_delivery') {
    return 'Perfeito 💜 Agora me manda tudo junto assim:\n\n*Nome Completo*:\n*Telefone*:\n*E-mail*:\n*Endereço*:\n*Apt / Unit*:\n*Cidade*:\n*Estado*:\n*Zip Code*:';
  }

  return 'Perfeito 💜 Agora me manda seus dados para eu seguir com o pedido.';
}

function buildReviewText(context = {}) {
  const anchors = Array.isArray(context.lastProducts) ? context.lastProducts : [];
  const cart = ensureCartShape(context.cart || {}, anchors);
  const checkout = context.checkout || {};
  const items = Array.isArray(cart.items) ? cart.items : [];
  if (items.length === 0 && anchors.length === 0) return '';

  const effectiveItems = items.length > 0
    ? items.map((item) => ({
        ...item,
        label: item.label || item.name || anchors[0]?.name || 'item',
        unit_price: item.unit_price || anchors.find((anchor) => (anchor.id || '') === (item.product_id || item.id || ''))?.price || anchors[0]?.price || ''
      }))
    : [{
        qty: 1,
        label: anchors[0]?.name || 'item',
        unit_price: anchors[0]?.price || ''
      }];

  const itemLines = effectiveItems.map((item) => {
    const qty = Number(item.qty || item.quantity || 1) || 1;
    const label = item.label || item.name || 'item';
    const unitPrice = item.unit_price || '';
    return unitPrice
      ? `• ${qty}x ${label} — ${unitPrice}`
      : `• ${qty}x ${label}`;
  });

  let shippingLabel = '';
  if (checkout.delivery_mode === 'pickup') shippingLabel = 'Pickup grátis';
  if (checkout.delivery_mode === 'local_delivery') shippingLabel = 'Entrega local';
  if (checkout.delivery_mode === 'usps') shippingLabel = cart.subtotal >= 99 ? 'USPS grátis' : 'USPS $10';

  const computedSubtotal = cart.subtotal > 0
    ? cart.subtotal
    : effectiveItems.reduce((sum, item) => {
        const qty = Number(item.qty || item.quantity || 1) || 1;
        const numeric = Number(String(item.unit_price || '').replace(/[^\d.]/g, '')) || 0;
        return sum + (numeric * qty);
      }, 0);
  const totalText = computedSubtotal > 0 ? `$${computedSubtotal.toFixed(2)}` : '';
  const shippingLine = shippingLabel ? `\n• Entrega: ${shippingLabel}` : '';
  const totalLine = totalText ? `\n• Subtotal: ${totalText}` : '';

  return `Fechado 💜 Seu pedido está assim até aqui:\n\n${itemLines.join('\n')}${shippingLine}${totalLine}`;
}

function applyComposeResultToState(existingContext = {}, compose = {}, products = []) {
  const extracted = compose.extracted_state || {};
  const nextState = {
    conversation_goal: compose.conversation_goal || existingContext.conversation_goal || '',
    pending_offer_type: compose.pending_offer_type || existingContext.pending_offer_type || 'none',
    expected_next_user_move: compose.expected_next_user_move || existingContext.expected_next_user_move || 'none',
    last_seller_question: compose.last_seller_question || existingContext.last_seller_question || '',
    anchor_products: Array.isArray(compose.anchor_products) && compose.anchor_products.length > 0
      ? compose.anchor_products
      : (Array.isArray(existingContext.lastProducts) && existingContext.lastProducts.length > 0 ? existingContext.lastProducts : products.slice(0, 3))
  };

  const baseCart = existingContext.cart && typeof existingContext.cart === 'object'
    ? { ...existingContext.cart }
    : { items: [], itemsCount: 0, subtotal: 0, currency: 'USD' };

  const cart = ensureCartShape(baseCart, nextState.anchor_products);
  const cartItems = Array.isArray(cart.items) ? [...cart.items] : [];
  const updates = compose.cart_updates || {};
  const selectedProduct = nextState.anchor_products.find((product) => (
    (extracted.selected_product_id && (product.id || '') === extracted.selected_product_id)
    || (extracted.selected_product_name && (product.name || '').toLowerCase() === extracted.selected_product_name.toLowerCase())
  )) || nextState.anchor_products[0] || products[0] || null;
  const selectedPrice = selectedProduct?.price || '';
  const rememberedRequestedQty = Number(existingContext.requested_quantity || existingContext.lastProductPayload?.requested_quantity || 0) || 0;

  if (isEachSelectionIntent(existingContext.lastInboundText || '') && nextState.anchor_products.length > 1) {
    cart.items = nextState.anchor_products.map((product) => ({
      product_id: product.id || '',
      label: product.name || '',
      qty: 1,
      variation: '',
      unit_price: product.price || ''
    }));
  } else if (compose.should_update_cart && selectedProduct) {
    const requestedQty = updates.quantity || extracted.selected_quantity || rememberedRequestedQty || extractRequestedQuantity(existingContext.lastInboundText || '') || 1;
    const item = {
      product_id: updates.selected_product_id || selectedProduct.id || '',
      label: updates.selected_product_name || selectedProduct.name || '',
      qty: requestedQty,
      variation: updates.variation || '',
      unit_price: selectedPrice
    };

    if (updates.action === 'set_selection') {
      cart.items = [item];
    } else if (updates.action === 'add_item') {
      const targetId = updates.selected_product_id || selectedProduct.id || '';
      const existingIndex = cartItems.findIndex((existing) => (existing.product_id || existing.id || '') === targetId);
      if (existingIndex >= 0) {
        cart.items = cartItems.map((existing, index) => (
          index === existingIndex
            ? { ...existing, qty: requestedQty, variation: updates.variation || existing.variation || '', unit_price: existing.unit_price || selectedPrice }
            : existing
        ));
      } else {
        cart.items = [...cartItems, item];
      }
    } else if (updates.action === 'update_quantity') {
      const targetId = updates.selected_product_id || selectedProduct.id || '';
      const updatedItems = cartItems.map((existing) => (
        (existing.product_id || existing.id || '') === targetId
          ? { ...existing, qty: requestedQty, variation: updates.variation || existing.variation || '', unit_price: existing.unit_price || selectedPrice }
          : existing
      ));
      cart.items = updatedItems.length > 0 ? updatedItems : [item];
    } else if (item.label && cartItems.length === 0) {
      cart.items = [item];
    }
  }

  if ((compose.reply_mode === 'close_sale' || compose.reply_mode === 'checkout_next') && selectedProduct && cart.items.length === 0) {
    cart.items = [{
      product_id: selectedProduct.id || '',
      label: selectedProduct.name || '',
      qty: updates.quantity || extracted.selected_quantity || rememberedRequestedQty || extractRequestedQuantity(existingContext.lastInboundText || '') || 1,
      variation: updates.variation || extractRequestedSize(existingContext.lastInboundText || '') || '',
      unit_price: selectedPrice
    }];
  }

  cart.subtotal = calculateCartSubtotal(cart.items, nextState.anchor_products);
  cart.itemsCount = (Array.isArray(cart.items) ? cart.items : []).reduce((sum, item) => sum + (Number(item.qty || item.quantity || 1) || 1), 0);

  const normalizedCart = ensureCartShape(cart, nextState.anchor_products);
  const checkout = buildCheckoutSnapshot(existingContext.checkout || {}, normalizedCart, compose, existingContext.lastInboundText || '');

  return { nextState, cart: normalizedCart, checkout };
}

function deriveCurrentStage(compose = {}, existingContext = {}, checkout = {}) {
  if (compose.conversation_goal === 'checkout' || compose.reply_mode === 'checkout_next' || compose.reply_mode === 'close_sale') {
    if (checkout.review_ready) return 'checkout_review';
    if (checkout.next_required_field === 'delivery_mode') return 'checkout_choose_delivery';
    if (checkout.next_required_field === 'pickup_schedule') return 'checkout_pickup_schedule';
    if (checkout.next_required_field === 'customer_info') return 'checkout_collect_customer_info';
    return 'checkout_in_progress';
  }
  return existingContext.currentStage || 'catalog_browse';
}

function isEachSelectionIntent(text = '') {
  const normalized = String(text || '').toLowerCase().trim();
  if (!normalized) return false;
  return /\b(1\s+de\s+cada|um\s+de\s+cada|uma\s+de\s+cada|quero\s+todos|leva\s+os\s+\d+|quero\s+os\s+\d+)\b/.test(normalized);
}

function requiresProductDisambiguation(existingContext = {}, products = [], effectiveText = '') {
  const quantityRequested = extractRequestedQuantity(effectiveText || '');
  const purchaseSignal = isPurchaseIntent(effectiveText || '');
  const anchors = Array.isArray(existingContext.lastProducts) ? existingContext.lastProducts : [];
  const candidates = anchors.length > 0 ? anchors : (Array.isArray(products) ? products : []);
  const currentCartItems = Array.isArray(existingContext?.cart?.items) ? existingContext.cart.items : [];

  if (!purchaseSignal) return false;
  if (isEachSelectionIntent(effectiveText || '')) return false;
  if (quantityRequested <= 0) return false;
  if (currentCartItems.length > 0) return false;
  if (candidates.length <= 1) return false;

  const normalized = String(effectiveText || '').toLowerCase();
  const mentionsCandidate = candidates.some((product) => {
    const name = String(product?.name || '').toLowerCase();
    if (!name) return false;
    return normalized.includes(name) || name.split(/\s+/).some((part) => part.length >= 4 && normalized.includes(part));
  });

  return !mentionsCandidate;
}

function buildDisambiguationReply(existingContext = {}, products = []) {
  const anchors = Array.isArray(existingContext.lastProducts) && existingContext.lastProducts.length > 0
    ? existingContext.lastProducts
    : (Array.isArray(products) ? products : []);
  const shortlist = anchors.slice(0, 3);
  if (shortlist.length === 0) {
    return 'Perfeito 💜 Você quer 2 de qual produto exatamente?';
  }

  const lines = shortlist.map((product, index) => `${index + 1}. ${product.name}${product.price ? ` — ${product.price}` : ''}`);
  return `Perfeito 💜 Você quer 2 de qual deles?\n${lines.join('\n')}`;
}

function buildMediaFailureReply(mediaResolved = {}, inbound = {}) {
  const reason = String(mediaResolved?.media_download?.reason || '').toLowerCase();
  const isImage = Array.isArray(inbound?.media) && String(inbound.media[0]?.contentType || '').toLowerCase().startsWith('image/');
  const isAudio = Array.isArray(inbound?.media) && String(inbound.media[0]?.contentType || '').toLowerCase().startsWith('audio/');

  if (isImage) {
    return 'Não consegui abrir essa imagem direito daqui 💜 Me manda outra foto mais nítida ou, se quiser, me fala o nome do produto que eu te ajudo rapidinho.';
  }

  if (isAudio) {
    return reason
      ? 'Não consegui entender esse áudio daqui 💜 Se puder, me manda de novo ou escreve rapidinho que eu sigo com você.'
      : '';
  }

  return '';
}

function shouldSendHandoff(context = {}) {
  const checkout = context.checkout || {};
  const hasCart = Array.isArray(context.cart?.items) && context.cart.items.length > 0;
  const hasDelivery = Boolean(checkout.delivery_mode);
  const hasScheduleIfPickup = checkout.delivery_mode !== 'pickup' || Boolean(checkout.pickup_schedule);
  const hasIdentity = Boolean(checkout.full_name) && Boolean(checkout.phone || checkout.email);
  return hasCart && hasDelivery && hasScheduleIfPickup && hasIdentity;
}

async function dispatchTelegramOps(context = {}, meta = {}) {
  const messages = [
    { topicKey: 'atendimento_vendas', text: buildSalesEscortMessage(context) },
    { topicKey: 'memoria_clientes', text: buildMemoryEscortMessage(context) },
    { topicKey: 'produtos_estoque', text: buildCatalogEscortMessage(context) },
    { topicKey: 'sistema_automacao', text: buildSystemEscortMessage(context, meta) },
  ].filter((entry) => entry.text && String(entry.text).trim());

  const results = [];
  for (const entry of messages) {
    try {
      const sent = await sendOperationalTelegramMessage(entry.text, { topicKey: entry.topicKey });
      results.push({ topicKey: entry.topicKey, mode: sent.mode || 'unknown', ok: true });
    } catch (error) {
      results.push({ topicKey: entry.topicKey, ok: false, error: error.message || 'telegram dispatch failed' });
    }
  }

  if (shouldSendHandoff(context)) {
    try {
      const sent = await sendOperationalTelegramMessage(buildHandoffOrderMessage(context), { topicKey: 'handoff_pedidos' });
      results.push({ topicKey: 'handoff_pedidos', mode: sent.mode || 'unknown', ok: true, kind: 'terminal_handoff' });
    } catch (error) {
      results.push({ topicKey: 'handoff_pedidos', ok: false, kind: 'terminal_handoff', error: error.message || 'handoff telegram dispatch failed' });
    }
  }

  return results;
}

function enrichFinalText(compose = {}, contextDraft = {}) {
  const finalText = String(compose.final_text || '').trim();
  if (!finalText) return 'Me fala rapidinho o que você quer que eu sigo daqui 💜';

  const checkout = contextDraft?.checkout || {};
  const cart = ensureCartShape(contextDraft?.cart || {}, contextDraft?.lastProducts || []);

  if (compose.reply_mode === 'checkout_next' && compose.pending_offer_type === 'review_order') {
    const review = buildReviewText(contextDraft);
    if (review) {
      return `${review}\n\n${finalText}`;
    }
  }

  if ((compose.reply_mode === 'close_sale' || compose.reply_mode === 'checkout_next') && !checkout.delivery_mode && !/pickup|USPS|entrega/i.test(finalText)) {
    return `${finalText}\n\nVocê prefere *pickup*, *entrega local* ou *USPS*?`;
  }

  if ((compose.reply_mode === 'checkout_next' || compose.reply_mode === 'close_sale') && checkout.delivery_mode === 'pickup' && checkout.next_required_field === 'pickup_schedule') {
    return 'Perfeito 💜 Me manda o *dia e horário* que você prefere para retirar, porque atendemos só com horário marcado.';
  }

  if ((compose.reply_mode === 'checkout_next' || compose.reply_mode === 'close_sale') && checkout.delivery_mode && checkout.next_required_field === 'customer_info') {
    return buildCustomerInfoPrompt(checkout);
  }

  if ((compose.reply_mode === 'checkout_next' || compose.reply_mode === 'close_sale') && checkout.review_ready) {
    const looksLikeConfirmation = /^(ok|okay|okey|sim|certo|fechado|pode ser|zelle|pix|venmo|cash app|apple pay)$/i.test(String(contextDraft?.lastInboundText || '').trim());
    if (looksLikeConfirmation) {
      return buildPaymentPrompt(contextDraft);
    }

    const review = buildReviewText(contextDraft);
    if (review) {
      return `${review}\n\nSe estiver tudo certo, me manda só um *ok* que eu sigo 💜`;
    }
  }

  return finalText;
}

async function resolveInboundMedia(inbound = {}, conversationSummary = '') {
  const media = Array.isArray(inbound.media) ? inbound.media : [];
  const first = media[0] || null;
  if (!first?.url || !first?.contentType) {
    return {
      mode: 'text',
      audio_transcription: '',
      vision_result: null,
      media_download: null,
    };
  }

  const contentType = String(first.contentType || '').toLowerCase();
  const isImage = contentType.startsWith('image/');
  const isAudio = contentType.startsWith('audio/');
  if (!isImage && !isAudio) {
    return {
      mode: 'text',
      audio_transcription: '',
      vision_result: null,
      media_download: { skipped: true, reason: 'unsupported_media_type', contentType },
    };
  }

  const mediaDownload = await downloadTwilioMediaAsBase64(first.url);

  if (isAudio) {
    const transcription = await transcribeAudio({
      audioData: mediaDownload.base64,
      mimeType: contentType,
    });

    return {
      mode: 'audio',
      audio_transcription: String(transcription?.text || '').trim(),
      vision_result: null,
      media_download: { ...mediaDownload, kind: 'audio' },
    };
  }

  if (isImage) {
    const imageDataUrl = `data:${contentType};base64,${mediaDownload.base64}`;
    const described = await describeProductImage({
      imageData: imageDataUrl,
      customerText: inbound.text || '',
      conversationContext: conversationSummary || '',
    });

    return {
      mode: 'image',
      audio_transcription: '',
      vision_result: described?.parsed || described?.raw || null,
      media_download: { ...mediaDownload, kind: 'image' },
    };
  }

  return {
    mode: 'text',
    audio_transcription: '',
    vision_result: null,
    media_download: null,
  };
}

router.post('/openai-first/whatsapp/inbound', async (req, res, next) => {
  try {
    const inbound = normalizeWhatsAppInbound(req.body || {});
    const contextKey = getConversationKey(inbound);
    const existingContext = getContext(contextKey) || {};
    const inboundTextRaw = String(inbound.text || '').trim();
    const resetRequested = isResetIntent(inboundTextRaw);

    if (resetRequested) {
      clearContext(contextKey);
    }

    const customerResult = await getOrCreateCustomerByPhone(inbound.from, inbound.profileName);
    const conversationResult = await getOrCreateOpenConversation({
      customerId: customerResult?.customer?.id,
      existingConversationId: resetRequested ? '' : (existingContext.conversationId || ''),
      channel: inbound.channel,
      phone: inbound.from,
      profileName: inbound.profileName,
      forceNew: resetRequested,
    });

    const conversation = conversationResult?.conversation || null;
    const mediaResolved = await resolveInboundMedia(inbound, conversation?.summary || existingContext.summary || '').catch((error) => ({
      mode: 'text',
      audio_transcription: '',
      vision_result: null,
      media_download: { failed: true, reason: error.message },
    }));
    const effectiveText = String(inbound.text || mediaResolved.audio_transcription || '').trim();
    const mode = mediaResolved.mode || 'text';

    if (resetRequested) {
      const resetReply = 'Pronto 💜 Zerei o contexto dessa conversa. Pode me falar de novo o que você quer que eu te ajudo do zero.';
      const nextContext = saveContext(contextKey, {
        profileName: inbound.profileName,
        customerId: customerResult?.customer?.id || '',
        conversationId: conversation?.id || '',
        lastInboundText: effectiveText,
        lastReplyText: resetReply,
        lastProducts: [],
        lastProduct: '',
        lastProductPayload: null,
        cart: { items: [], itemsCount: 0, subtotal: 0, currency: 'USD' },
        checkout: { delivery_mode: '', next_required_field: '', review_ready: false },
        conversation_goal: '',
        pending_offer_type: 'none',
        expected_next_user_move: 'none',
        last_seller_question: '',
        currentStage: 'catalog_browse',
        summary: resetReply,
      });

      await updateConversationState({
        conversationId: nextContext.conversationId,
        summary: nextContext.summary,
        currentStage: nextContext.currentStage,
        lastProduct: '',
        lastProductPayload: {
          cart: nextContext.cart,
          checkout: nextContext.checkout,
          conversation_goal: '',
          pending_offer_type: 'none',
          expected_next_user_move: 'none',
          last_seller_question: ''
        }
      }).catch(() => null);

      await appendEvent({
        kind: 'openai_first_reset',
        conversation_id: nextContext.conversationId || null,
        customer_id: nextContext.customerId || null,
        channel: inbound.channel,
        direction: 'inbound',
        message_text: effectiveText,
        payload: { reset: true }
      }).catch(() => null);

      return res.json({
        ok: true,
        inbound,
        mediaResolved,
        compose: {
          raw: null,
          reply_mode: 'answer',
          conversation_goal: 'discover',
          pending_offer_type: 'none',
          expected_next_user_move: 'inform',
          last_seller_question: '',
          anchor_products: [],
          should_update_cart: false,
          cart_updates: { action: 'none', quantity: null, selected_product_id: '', selected_product_name: '', variation: '' },
          checkout_updates: { delivery_mode: '', next_required_field: '', review_ready: false },
          assistant_notes: 'reset conversation state explicitly requested by user',
          final_text: resetReply,
        },
        products: [],
        context: nextContext,
        conversationId: nextContext.conversationId || '',
        customerId: nextContext.customerId || '',
        semantic: { source: 'reset', products: [], intent_ids: [], intent_candidates: [] },
        note: 'OpenAI-first inbound reset applied'
      });
    }

    const shouldLookupCatalog = Boolean(
      effectiveText
      || isShortContinuation(effectiveText)
      || isPurchaseIntent(effectiveText)
      || mode === 'image'
    );

    const semantic = await buildSemanticContextSupabase(effectiveText || '', 5).catch(() => buildSemanticContext(effectiveText || ''));
    const bootstrapProducts = shouldLookupCatalog
      ? await searchProducts(inferCatalogQuery(effectiveText, existingContext, { ...mediaResolved.vision_result, audio_transcription: mediaResolved.audio_transcription }), 5).catch(() => [])
      : [];

    const mergedProducts = resolveHybridProducts({
      text: effectiveText || '',
      intentIds: semantic.intent_ids || [],
      semanticProducts: semantic.products || [],
      squareProducts: bootstrapProducts || [],
      limit: 5,
    });

    const previousState = buildConversationState(existingContext, conversation, mergedProducts);
    const products = mergedProducts.length > 0
      ? mergedProducts
      : (Array.isArray(previousState.anchor_products) ? previousState.anchor_products : []);

    const recentMessages = normalizeRecentMessages([]);
    const storeFacts = getStoreFacts();
    const cleoKbChunks = await searchCleoKb({
      text: effectiveText || '',
      intentIds: semantic.intent_ids || [],
      productNames: products.map((item) => item.name).filter(Boolean),
      limit: 6,
    }).catch(() => []);

    const composeInput = {
      channel: inbound.channel,
      mode,
      customer_phone: inbound.from,
      profile_name: inbound.profileName,
      message_id: inbound.messageSid || inbound.messageId || '',
      message_text: effectiveText || '',
      audio_transcription: mediaResolved.audio_transcription || '',
      vision_result: mediaResolved.vision_result || null,
      summary: conversation?.summary || existingContext.summary || '',
      intent: isShortContinuation(effectiveText)
        ? 'short_continuation'
        : (isPurchaseIntent(effectiveText)
          ? 'purchase_signal'
          : ((semantic.intent_ids || [])[0] || '')),
      intent_group: isFinalizeIntent(effectiveText)
        ? 'checkout'
        : (((semantic.intent_ids || []).length > 1) ? 'semantic_multi_intent' : ''),
      current_stage: conversation?.current_stage || existingContext.currentStage || '',
      customer_signal: effectiveText || '',
      conversation_state: previousState,
      selected_product: previousState.anchor_products?.[0] || products[0] || null,
      products_found: products,
      semantic_candidates: semantic.products || [],
      semantic_intent_candidates: semantic.intent_candidates || [],
      cart: ensureCartShape(existingContext.cart || conversation?.last_product_payload?.cart || { items: [], itemsCount: 0, subtotal: 0, currency: 'USD' }, previousState.anchor_products || products),
      checkout: existingContext.checkout || conversation?.last_product_payload?.checkout || { delivery_mode: '', next_required_field: '', review_ready: false },
      store_facts: storeFacts,
      business_rules: buildBusinessRules(),
      recent_messages: recentMessages,
      cleo_kb_snippets: buildKBSnippets(cleoKbChunks, 6)
    };

    const mediaFailureReply = buildMediaFailureReply(mediaResolved, inbound);
    const pureGreeting = isPureGreeting(effectiveText || '');
    const eachSelectionIntent = isEachSelectionIntent(effectiveText || '');
    const heuristicDisambiguation = requiresProductDisambiguation(existingContext, products, effectiveText);
    const composed = mediaFailureReply
      ? null
      : (pureGreeting
        ? {
            raw: null,
            reply_mode: 'answer',
            conversation_goal: 'support',
            pending_offer_type: 'none',
            expected_next_user_move: 'inform',
            last_seller_question: '',
            anchor_products: [],
            should_update_cart: false,
            cart_updates: {
              action: 'none',
              quantity: null,
              selected_product_id: '',
              selected_product_name: '',
              variation: ''
            },
            checkout_updates: {
              delivery_mode: '',
              next_required_field: '',
              review_ready: false
            },
            extracted_state: {
              selected_product_id: '',
              selected_product_name: '',
              selected_quantity: null,
              delivery_mode: '',
              pickup_schedule: '',
              full_name: '',
              phone: '',
              email: '',
              address: '',
              conversation_move: 'answer_question',
              missing_fields: [],
              needs_disambiguation: false,
              should_review: false,
              confidence: 1
            },
            assistant_notes: 'pure greeting detected; bypass product shortlist and answer with neutral greeting',
            final_text: 'Oi 💜 como posso te ajudar?'
          }
        : (eachSelectionIntent && Array.isArray(previousState.anchor_products) && previousState.anchor_products.length > 1)
          ? {
              raw: null,
              reply_mode: 'checkout_next',
              conversation_goal: 'checkout',
              pending_offer_type: 'choose_delivery',
              expected_next_user_move: 'inform',
              last_seller_question: '',
              anchor_products: previousState.anchor_products,
              should_update_cart: false,
              cart_updates: {
                action: 'none',
                quantity: null,
                selected_product_id: '',
                selected_product_name: '',
                variation: ''
              },
              checkout_updates: {
                delivery_mode: '',
                next_required_field: 'delivery_mode',
                review_ready: false
              },
              extracted_state: {
                selected_product_id: '',
                selected_product_name: '',
                selected_quantity: 1,
                delivery_mode: '',
                pickup_schedule: '',
                full_name: '',
                phone: '',
                email: '',
                address: '',
                conversation_move: 'choose_delivery',
                missing_fields: ['delivery_mode'],
                needs_disambiguation: false,
                should_review: false,
                confidence: 1
              },
              assistant_notes: 'each-selection intent detected; convert active shortlist into multi-item cart with qty 1 each',
              final_text: 'Fechado 💜 Já coloquei 1 de cada no seu carrinho. Você prefere *pickup*, *entrega local* ou *USPS*?'
            }
          : await composeCustomerReply(composeInput));
    const purchaseSignal = isPurchaseIntent(effectiveText || '');
    const quantitySignal = extractRequestedQuantity(effectiveText || '') > 0;
    const shouldHonorModelDisambiguation = purchaseSignal || quantitySignal;
    const shouldDisambiguateProduct = !eachSelectionIntent && (heuristicDisambiguation || (shouldHonorModelDisambiguation && Boolean(composed?.extracted_state?.needs_disambiguation)));
    const compose = mediaFailureReply
      ? {
          raw: null,
          reply_mode: 'clarify',
          conversation_goal: 'discover',
          pending_offer_type: 'none',
          expected_next_user_move: 'inform',
          last_seller_question: 'Me manda outra foto mais nítida ou o nome do produto?',
          anchor_products: previousState.anchor_products || [],
          should_update_cart: false,
          cart_updates: {
            action: 'none',
            quantity: null,
            selected_product_id: '',
            selected_product_name: '',
            variation: ''
          },
          checkout_updates: {
            delivery_mode: '',
            next_required_field: '',
            review_ready: false
          },
          assistant_notes: 'media download/analysis failed; ask for clearer resend instead of hallucinating product suggestion',
          final_text: mediaFailureReply,
        }
      : shouldDisambiguateProduct
        ? {
            raw: null,
            reply_mode: 'clarify',
            conversation_goal: 'sell',
            pending_offer_type: 'confirm_item',
            expected_next_user_move: 'choose',
            last_seller_question: 'Você quer 2 de qual deles?',
            anchor_products: previousState.anchor_products || products.slice(0, 3),
            should_update_cart: false,
            cart_updates: {
              action: 'none',
              quantity: null,
              selected_product_id: '',
              selected_product_name: '',
              variation: ''
            },
            checkout_updates: {
              delivery_mode: '',
              next_required_field: '',
              review_ready: false
            },
            extracted_state: {
              selected_quantity: extractRequestedQuantity(effectiveText || '') || Number(existingContext.requested_quantity || 0) || null,
            },
            assistant_notes: 'multiple shortlist candidates with generic purchase/quantity signal; force product disambiguation before cart update',
            final_text: buildDisambiguationReply(existingContext, products),
          }
        : composed;
    const applied = applyComposeResultToState({ ...existingContext, lastInboundText: effectiveText || '' }, compose, products);
    const draftContext = {
      ...existingContext,
      cart: applied.cart,
      checkout: applied.checkout,
      lastProducts: applied.nextState.anchor_products,
      lastProduct: applied.nextState.anchor_products?.[0]?.name || '',
    };
    const finalText = enrichFinalText(compose, draftContext);

    const nextContext = saveContext(contextKey, {
      ...existingContext,
      profileName: inbound.profileName,
      customerId: customerResult?.customer?.id || existingContext.customerId || '',
      conversationId: conversation?.id || existingContext.conversationId || '',
      lastInboundText: effectiveText,
      lastReplyText: finalText,
      lastProducts: applied.nextState.anchor_products,
      lastProduct: applied.nextState.anchor_products?.[0]?.name || '',
      lastProductPayload: {
        ...(applied.nextState.anchor_products?.[0] || {}),
        cart: applied.cart,
        checkout: applied.checkout,
        conversation_goal: applied.nextState.conversation_goal,
        pending_offer_type: applied.nextState.pending_offer_type,
        expected_next_user_move: applied.nextState.expected_next_user_move,
        last_seller_question: applied.nextState.last_seller_question,
        requested_quantity: Number(compose?.cart_updates?.quantity || compose?.extracted_state?.selected_quantity || applied.nextState.requested_quantity || extractRequestedQuantity(effectiveText || '') || 0) || 0,
      },
      cart: applied.cart,
      checkout: applied.checkout,
      requested_quantity: Number(compose?.cart_updates?.quantity || compose?.extracted_state?.selected_quantity || applied.nextState.requested_quantity || extractRequestedQuantity(effectiveText || '') || 0) || 0,
      conversation_goal: applied.nextState.conversation_goal,
      pending_offer_type: applied.nextState.pending_offer_type,
      expected_next_user_move: applied.nextState.expected_next_user_move,
      last_seller_question: applied.nextState.last_seller_question,
      currentStage: deriveCurrentStage(compose, existingContext, applied.checkout),
      summary: finalText,
    });

    await updateConversationState({
      conversationId: nextContext.conversationId,
      summary: nextContext.summary,
      currentStage: nextContext.currentStage,
      lastProduct: nextContext.lastProduct,
      lastProductPayload: {
        ...(nextContext.lastProductPayload || {}),
        cart: nextContext.cart || null,
        checkout: nextContext.checkout || null,
        conversation_goal: nextContext.conversation_goal || '',
        pending_offer_type: nextContext.pending_offer_type || 'none',
        expected_next_user_move: nextContext.expected_next_user_move || 'none',
        last_seller_question: nextContext.last_seller_question || ''
      }
    }).catch(() => null);

    await appendEvent({
      kind: 'openai_first_inbound_received',
      conversation_id: nextContext.conversationId || null,
      customer_id: nextContext.customerId || null,
      channel: inbound.channel,
      direction: 'inbound',
      message_text: effectiveText,
      payload: { compose_input_mode: mode, media_download: mediaResolved.media_download || null, vision_result: mediaResolved.vision_result || null }
    }).catch(() => null);

    await appendEvent({
      kind: 'openai_first_compose_reply',
      conversation_id: nextContext.conversationId || null,
      customer_id: nextContext.customerId || null,
      channel: inbound.channel,
      direction: 'outbound',
      message_text: finalText,
      payload: {
        reply_mode: compose.reply_mode,
        conversation_goal: compose.conversation_goal,
        pending_offer_type: compose.pending_offer_type,
        expected_next_user_move: compose.expected_next_user_move,
        cart_updates: compose.cart_updates,
        checkout_updates: compose.checkout_updates
      }
    }).catch(() => null);

    const opsDispatch = [];

    return res.json({
      ok: true,
      inbound,
      mediaResolved,
      compose: { ...compose, final_text: finalText },
      products,
      context: nextContext,
      conversationId: nextContext.conversationId || '',
      customerId: nextContext.customerId || '',
      semantic,
      opsDispatch,
      note: 'OpenAI-first inbound com P0 textual endurecido + base semântica integrada + ranking híbrido Supabase/Square'
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
