const express = require('express');
const router = express.Router();

const { getStoreFacts } = require('../services/cleo-store-facts');
const { searchProducts } = require('../services/catalog-service');
const { getConversationKey, getContext, saveContext } = require('../services/context-store');
const { getOrCreateCustomerByPhone, getOrCreateOpenConversation, updateConversationState } = require('../services/customer-conversation-store');
const { appendEvent } = require('../services/event-store');
const { composeCustomerReply } = require('../services/compose-service');
const { normalizeWhatsAppInbound } = require('../lib/whatsapp-normalize');

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
  return /(quero comprar|vou querer|quero levar|quero esse|quero essa|gostei desse|gostei dessa|fechar pedido|quero finalizar|finalizar|me manda o total)/i.test(String(text || ''));
}

function isFinalizeIntent(text = '') {
  return /(finalizar|fechar pedido|me manda o total|quero finalizar|fechou|pode fechar|vamos fechar)/i.test(String(text || ''));
}

function inferCatalogQuery(messageText = '', state = {}) {
  const text = String(messageText || '').trim();
  if (text) return text;
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
    avoid_opening: ['Olá!'],
    preferred_openings: ['Tenho sim 💜', 'Perfeito 💜', 'Te mostro sim 💜', 'Fechado 💜', 'Separei algumas opções pra você 💜'],
    cart_policy: 'Cart-first sempre que houver intenção de compra real.',
    continuity_policy: 'Quando houver pending offer, tratar sim/me mostra/quero ver como continuação.',
    checkout_policy: 'Pedir só o próximo dado operacional necessário.',
    visual_policy: 'Visual precisa ter contrato único até o send.'
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
  return {
    items,
    itemsCount: Number(cart.itemsCount || items.length || 0),
    subtotal: Number(cart.subtotal || calculateCartSubtotal(items, anchorProducts) || 0),
    currency: String(cart.currency || 'USD').trim() || 'USD'
  };
}

function buildCheckoutSnapshot(existingCheckout = {}, cart = {}, compose = {}) {
  const checkout = {
    delivery_mode: String(existingCheckout.delivery_mode || '').trim(),
    next_required_field: String(existingCheckout.next_required_field || '').trim(),
    review_ready: Boolean(existingCheckout.review_ready),
    full_name: String(existingCheckout.full_name || '').trim(),
    phone: String(existingCheckout.phone || '').trim(),
    email: String(existingCheckout.email || '').trim(),
    address: String(existingCheckout.address || '').trim()
  };

  if (compose?.checkout_updates?.delivery_mode) {
    checkout.delivery_mode = String(compose.checkout_updates.delivery_mode || '').trim();
  }
  if (compose?.checkout_updates?.next_required_field) {
    checkout.next_required_field = String(compose.checkout_updates.next_required_field || '').trim();
  }
  if (typeof compose?.checkout_updates?.review_ready === 'boolean') {
    checkout.review_ready = Boolean(compose.checkout_updates.review_ready);
  }

  if (compose?.reply_mode === 'close_sale' && !checkout.next_required_field) {
    checkout.next_required_field = 'delivery_mode';
  }

  if (compose?.reply_mode === 'checkout_next' && !checkout.next_required_field) {
    checkout.next_required_field = 'customer_info';
  }

  if ((Array.isArray(cart.items) ? cart.items.length : 0) > 0 && !checkout.delivery_mode && compose?.conversation_goal === 'checkout') {
    checkout.next_required_field = checkout.next_required_field || 'delivery_mode';
  }

  return checkout;
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
  const selectedProduct = nextState.anchor_products[0] || products[0] || null;
  const selectedPrice = selectedProduct?.price || '';

  if (compose.should_update_cart && selectedProduct) {
    const item = {
      product_id: updates.selected_product_id || selectedProduct.id || '',
      label: updates.selected_product_name || selectedProduct.name || '',
      qty: updates.quantity || 1,
      variation: updates.variation || '',
      unit_price: selectedPrice
    };

    if (updates.action === 'set_selection') {
      cart.items = [item];
    } else if (updates.action === 'add_item') {
      cart.items = [...cartItems, item];
    } else if (updates.action === 'update_quantity') {
      const targetId = updates.selected_product_id || selectedProduct.id || '';
      const updatedItems = cartItems.map((existing) => (
        (existing.product_id || existing.id || '') === targetId
          ? { ...existing, qty: updates.quantity || existing.qty || 1, variation: updates.variation || existing.variation || '', unit_price: existing.unit_price || selectedPrice }
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
      qty: updates.quantity || extractRequestedQuantity(existingContext.lastInboundText || '') || 1,
      variation: updates.variation || extractRequestedSize(existingContext.lastInboundText || '') || '',
      unit_price: selectedPrice
    }];
  }

  const normalizedCart = ensureCartShape(cart, nextState.anchor_products);
  const checkout = buildCheckoutSnapshot(existingContext.checkout || {}, normalizedCart, compose);

  return { nextState, cart: normalizedCart, checkout };
}

function deriveCurrentStage(compose = {}, existingContext = {}, checkout = {}) {
  if (compose.conversation_goal === 'checkout' || compose.reply_mode === 'checkout_next' || compose.reply_mode === 'close_sale') {
    if (checkout.review_ready) return 'checkout_review';
    if (checkout.next_required_field === 'delivery_mode') return 'checkout_choose_delivery';
    if (checkout.next_required_field === 'customer_info') return 'checkout_collect_customer_info';
    return 'checkout_in_progress';
  }
  return existingContext.currentStage || 'catalog_browse';
}

function enrichFinalText(compose = {}, contextDraft = {}) {
  const finalText = String(compose.final_text || '').trim();
  if (!finalText) return 'Me fala rapidinho o que você quer que eu sigo daqui 💜';

  if (compose.reply_mode === 'checkout_next' && compose.pending_offer_type === 'review_order') {
    const review = buildReviewText(contextDraft);
    if (review) {
      return `${review}\n\n${finalText}`;
    }
  }

  if (compose.reply_mode === 'close_sale' && !/pickup|USPS|entrega/i.test(finalText)) {
    return `${finalText}\n\nVocê prefere *pickup*, *entrega local* ou *USPS*?`;
  }

  return finalText;
}

router.post('/openai-first/whatsapp/inbound', async (req, res, next) => {
  try {
    const inbound = normalizeWhatsAppInbound(req.body || {});
    const contextKey = getConversationKey(inbound);
    const existingContext = getContext(contextKey) || {};

    const customerResult = await getOrCreateCustomerByPhone(inbound.from, inbound.profileName);
    const conversationResult = await getOrCreateOpenConversation({
      customerId: customerResult?.customer?.id,
      existingConversationId: existingContext.conversationId || '',
      channel: inbound.channel,
      phone: inbound.from,
      profileName: inbound.profileName,
      forceNew: false,
    });

    const conversation = conversationResult?.conversation || null;
    const mode = inbound.numMedia > 0 && inbound.mediaContentType?.startsWith('image/')
      ? 'image'
      : inbound.numMedia > 0 && inbound.mediaContentType?.startsWith('audio/')
        ? 'audio'
        : 'text';

    const shouldLookupCatalog = Boolean(
      inbound.text
      || isShortContinuation(inbound.text)
      || isPurchaseIntent(inbound.text)
      || mode === 'image'
    );

    const bootstrapProducts = shouldLookupCatalog
      ? await searchProducts(inferCatalogQuery(inbound.text, existingContext), 5).catch(() => [])
      : [];

    const previousState = buildConversationState(existingContext, conversation, bootstrapProducts);
    const products = bootstrapProducts.length > 0
      ? bootstrapProducts
      : (Array.isArray(previousState.anchor_products) ? previousState.anchor_products : []);

    const recentMessages = normalizeRecentMessages([]);
    const storeFacts = getStoreFacts();
    const composeInput = {
      channel: inbound.channel,
      mode,
      customer_phone: inbound.from,
      profile_name: inbound.profileName,
      message_id: inbound.messageId || '',
      message_text: inbound.text || '',
      audio_transcription: '',
      vision_result: mode === 'image' ? {
        detected: true,
        status: 'pending_real_vision_wiring',
        user_request: inbound.text || ''
      } : null,
      summary: conversation?.summary || existingContext.summary || '',
      intent: isShortContinuation(inbound.text) ? 'short_continuation' : (isPurchaseIntent(inbound.text) ? 'purchase_signal' : ''),
      intent_group: isFinalizeIntent(inbound.text) ? 'checkout' : '',
      current_stage: conversation?.current_stage || existingContext.currentStage || '',
      customer_signal: inbound.text || '',
      conversation_state: previousState,
      selected_product: previousState.anchor_products?.[0] || products[0] || null,
      products_found: products,
      cart: ensureCartShape(existingContext.cart || conversation?.last_product_payload?.cart || { items: [], itemsCount: 0, subtotal: 0, currency: 'USD' }, previousState.anchor_products || products),
      checkout: existingContext.checkout || conversation?.last_product_payload?.checkout || { delivery_mode: '', next_required_field: '', review_ready: false },
      store_facts: storeFacts,
      business_rules: buildBusinessRules(),
      recent_messages: recentMessages
    };

    const compose = await composeCustomerReply(composeInput);
    const applied = applyComposeResultToState({ ...existingContext, lastInboundText: inbound.text || '' }, compose, products);
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
      lastInboundText: inbound.text,
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
      },
      cart: applied.cart,
      checkout: applied.checkout,
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
      message_text: inbound.text,
      payload: { compose_input_mode: mode }
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

    return res.json({
      ok: true,
      inbound,
      compose: { ...compose, final_text: finalText },
      products,
      context: nextContext,
      conversationId: nextContext.conversationId || '',
      customerId: nextContext.customerId || '',
      note: 'OpenAI-first inbound com P0 textual endurecido para continuidade, compra e checkout'
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
