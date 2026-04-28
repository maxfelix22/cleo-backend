const express = require('express');
const router = express.Router();

const { getStoreFacts } = require('../services/cleo-store-facts');
const { searchProducts } = require('../services/catalog-service');
const { getConversationKey, getContext, saveContext } = require('../services/context-store');
const { getOrCreateCustomerByPhone, getOrCreateOpenConversation, updateConversationState } = require('../services/customer-conversation-store');
const { appendEvent } = require('../services/event-store');
const { applyCheckoutState } = require('../services/checkout-state');
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
  const currentCart = existingContext.cart || payload?.cart || { items: [], itemsCount: 0, subtotal: 0, currency: 'USD' };
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

  const cart = existingContext.cart && typeof existingContext.cart === 'object'
    ? { ...existingContext.cart }
    : { items: [], itemsCount: 0, subtotal: 0, currency: 'USD' };

  const cartItems = Array.isArray(cart.items) ? [...cart.items] : [];
  const updates = compose.cart_updates || {};
  const selectedProduct = nextState.anchor_products[0] || products[0] || null;

  if (compose.should_update_cart && selectedProduct) {
    const item = {
      product_id: updates.selected_product_id || selectedProduct.id || '',
      label: updates.selected_product_name || selectedProduct.name || '',
      qty: updates.quantity || 1,
      variation: updates.variation || ''
    };

    if (updates.action === 'set_selection') {
      cart.items = [item];
    } else if (updates.action === 'add_item') {
      cart.items = [...cartItems, item];
    } else if (updates.action === 'update_quantity') {
      const targetId = updates.selected_product_id || selectedProduct.id || '';
      cart.items = cartItems.map((existing) => (
        (existing.product_id || existing.id || '') === targetId
          ? { ...existing, qty: updates.quantity || existing.qty || 1, variation: updates.variation || existing.variation || '' }
          : existing
      ));
      if (cart.items.length === 0 && item.label) cart.items = [item];
    } else if (item.label && cartItems.length === 0) {
      cart.items = [item];
    }
  }

  cart.itemsCount = Array.isArray(cart.items) ? cart.items.length : 0;

  const checkout = {
    ...(existingContext.checkout || {}),
    ...(compose.checkout_updates || {})
  };

  return { nextState, cart, checkout };
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
    const previousState = buildConversationState(existingContext, conversation, []);
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

    const products = shouldLookupCatalog
      ? await searchProducts(inferCatalogQuery(inbound.text, previousState), 5).catch(() => [])
      : [];

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
      intent: '',
      intent_group: '',
      current_stage: conversation?.current_stage || existingContext.currentStage || '',
      customer_signal: inbound.text || '',
      conversation_state: previousState,
      selected_product: previousState.anchor_products?.[0] || products[0] || null,
      products_found: products,
      cart: existingContext.cart || conversation?.last_product_payload?.cart || { items: [], itemsCount: 0, subtotal: 0, currency: 'USD' },
      checkout: existingContext.checkout || conversation?.last_product_payload?.checkout || { delivery_mode: '', next_required_field: '', review_ready: false },
      store_facts: storeFacts,
      business_rules: buildBusinessRules(),
      recent_messages: recentMessages
    };

    const compose = await composeCustomerReply(composeInput);
    const applied = applyComposeResultToState(existingContext, compose, products);

    let nextContext = saveContext(contextKey, {
      ...existingContext,
      profileName: inbound.profileName,
      customerId: customerResult?.customer?.id || existingContext.customerId || '',
      conversationId: conversation?.id || existingContext.conversationId || '',
      lastInboundText: inbound.text,
      lastReplyText: compose.final_text,
      lastProducts: applied.nextState.anchor_products,
      lastProduct: applied.nextState.anchor_products?.[0]?.name || '',
      lastProductPayload: applied.nextState.anchor_products?.[0] || null,
      cart: applied.cart,
      checkout: applied.checkout,
      conversation_goal: applied.nextState.conversation_goal,
      pending_offer_type: applied.nextState.pending_offer_type,
      expected_next_user_move: applied.nextState.expected_next_user_move,
      last_seller_question: applied.nextState.last_seller_question,
      currentStage: compose.conversation_goal === 'checkout' || compose.reply_mode === 'checkout_next'
        ? 'checkout_in_progress'
        : (existingContext.currentStage || conversation?.current_stage || 'catalog_browse'),
      summary: compose.final_text,
    });

    nextContext = applyCheckoutState(nextContext, { text: inbound.text || '' });
    nextContext = saveContext(contextKey, nextContext);

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
      message_text: compose.final_text,
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
      compose,
      products,
      context: nextContext,
      conversationId: nextContext.conversationId || '',
      customerId: nextContext.customerId || '',
      note: 'OpenAI-first inbound scaffold com estado canônico e compose real'
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
