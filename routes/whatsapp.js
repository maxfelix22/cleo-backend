const express = require('express');
const router = express.Router();

const { normalizeWhatsAppInbound } = require('../lib/whatsapp-normalize');
const { sendWhatsAppMessage, hasRealTwilioConfig } = require('../services/whatsapp-outbound');
const { buildInitialReply, extractRequestedSize } = require('../services/whatsapp-context');
const { searchProducts } = require('../services/catalog-service');
const { buildFallbackProductsFromText } = require('../services/catalog-fallback');
const { getConversationKey, getContext, saveContext } = require('../services/context-store');
const { getOrCreateCustomerByPhone, getOrCreateOpenConversation, updateConversationState } = require('../services/customer-conversation-store');
const { appendEvent } = require('../services/event-store');
const { applyCheckoutState, buildCheckoutReply } = require('../services/checkout-state');
const { buildHandoffPayload, buildOperationalMessage } = require('../services/handoff-service');
const { sendOperationalTelegramMessage, hasTelegramOpsConfig } = require('../services/telegram-ops');

router.post('/whatsapp/inbound', async (req, res, next) => {
  try {
    const inbound = normalizeWhatsAppInbound(req.body || {});

    const contextKey = getConversationKey(inbound);
    const existingContext = getContext(contextKey) || {};

    let customerResult = null;
    let conversationResult = null;
    try {
      customerResult = await getOrCreateCustomerByPhone(inbound.from, inbound.profileName);
      conversationResult = await getOrCreateOpenConversation({
        customerId: customerResult?.customer?.id,
        channel: inbound.channel,
        phone: inbound.from,
        profileName: inbound.profileName,
      });
    } catch (err) {
      console.error('[whatsapp/inbound] customer/conversation bootstrap error:', err.message);
    }

    let products = [];
    if (/tem\s+lingerie|tem\s+conjunto|tem\s+calcinha|tem\s+suti[aã]|tem\s+body|tem\s+camisola/i.test(inbound.text || '')) {
      try {
        products = await searchProducts(inbound.text, 3);
      } catch (err) {
        console.error('[whatsapp/inbound] catalog lookup error:', err.message);
      }
    }

    if (products.length === 0) {
      products = buildFallbackProductsFromText(inbound.text);
    }

    const effectiveProducts = products.length > 0 ? products : (Array.isArray(existingContext.lastProducts) ? existingContext.lastProducts : []);
    const contextForState = {
      ...existingContext,
      currentStage: existingContext.checkout?.stage || existingContext.currentStage || '',
      lastProducts: effectiveProducts,
    };

    const checkoutContext = applyCheckoutState(contextForState, inbound);

    const followUpSignals = {
      requestedSize: extractRequestedSize(inbound.text),
      asksSize: /tem\s+no\s+tamanho|tamanho\s+[pmg]|tem\s+p\b|tem\s+m\b|tem\s+g\b/i.test(inbound.text || ''),
      asksColor: /tem\s+em\s+outra\s+cor|outra\s+cor|outras\s+cores/i.test(inbound.text || ''),
      asksPrice: /quanto custa|preço|preco|valor/i.test(inbound.text || ''),
      wantsThis: /quero esse|quero essa|vou querer|gostei desse|gostei dessa/i.test(inbound.text || ''),
    };

    let replyText = buildCheckoutReply(checkoutContext);
    if (!replyText) {
      replyText = buildInitialReply(inbound, { products: effectiveProducts, context: checkoutContext });
    }

    const savedContext = saveContext(contextKey, {
      ...checkoutContext,
      profileName: inbound.profileName,
      customerId: customerResult?.customer?.id || existingContext.customerId || '',
      conversationId: conversationResult?.conversation?.id || existingContext.conversationId || '',
      lastInboundText: inbound.text,
      lastProducts: effectiveProducts,
      lastReplyText: replyText,
      lastChannel: inbound.channel,
      lastProvider: inbound.provider,
      followUpSignals,
    });

    let conversationSnapshot = conversationResult?.conversation || null;
    let conversationUpdateDebug = null;
    try {
      const conversationUpdate = await updateConversationState({
        conversationId: savedContext.conversationId,
        summary: savedContext.summary,
        currentStage: savedContext.currentStage,
        lastProduct: savedContext.lastProduct,
        lastProductPayload: savedContext.lastProductPayload,
      });
      conversationUpdateDebug = {
        ok: true,
        patch: conversationUpdate?.patch || null,
        conversationId: savedContext.conversationId,
        updatedConversationId: conversationUpdate?.conversation?.id || null,
        updatedStage: conversationUpdate?.conversation?.current_stage || null,
        updatedSummary: conversationUpdate?.conversation?.summary || null,
        updatedLastProduct: conversationUpdate?.conversation?.last_product || null,
      };
      if (conversationUpdate?.conversation) {
        conversationSnapshot = conversationUpdate.conversation;
      }
    } catch (err) {
      conversationUpdateDebug = {
        ok: false,
        conversationId: savedContext.conversationId,
        message: err.message,
        status: err.status || null,
        payload: err.payload || null,
      };
      console.error('[whatsapp/inbound] conversation state update error:', err.message, err.payload || '');
    }

    const outbound = await sendWhatsAppMessage({
      to: inbound.from,
      body: replyText,
      mediaUrls: [],
    });

    let inboundEvent = null;
    let outboundEvent = null;
    let handoffPayload = null;
    let operationalMessage = '';
    let operationalDispatch = null;
    if ((savedContext.currentStage || '') === 'handoff_ready') {
      handoffPayload = buildHandoffPayload(savedContext);
      operationalMessage = buildOperationalMessage(savedContext);
      try {
        operationalDispatch = await sendOperationalTelegramMessage(operationalMessage);
      } catch (err) {
        console.error('[whatsapp/inbound] telegram ops dispatch error:', err.message);
      }
    }

    try {
      inboundEvent = await appendEvent({
        kind: 'whatsapp_inbound_received',
        conversation_id: conversationResult?.conversation?.id || savedContext.conversationId || null,
        customer_id: customerResult?.customer?.id || savedContext.customerId || null,
        channel: inbound.channel,
        direction: 'inbound',
        message_text: inbound.text,
        payload: { profileName: inbound.profileName, raw: inbound.raw },
      });

      outboundEvent = await appendEvent({
        kind: 'whatsapp_outbound_sent',
        conversation_id: conversationResult?.conversation?.id || savedContext.conversationId || null,
        customer_id: customerResult?.customer?.id || savedContext.customerId || null,
        channel: inbound.channel,
        direction: 'outbound',
        message_text: replyText,
        payload: { transportMode: hasRealTwilioConfig() ? 'twilio' : 'stub', outbound, handoffPayload },
      });
    } catch (err) {
      console.error('[whatsapp/inbound] event append error:', err.message);
    }

    return res.json({
      ok: true,
      inbound,
      outbound,
      products: effectiveProducts,
      contextKey,
      context: savedContext,
      state: {
        summary: savedContext.summary || '',
        currentStage: savedContext.currentStage || '',
        lastProductName: savedContext.lastProducts?.[0]?.name || '',
        customerId: savedContext.customerId || '',
        conversationId: savedContext.conversationId || '',
      },
      customer: customerResult?.customer || null,
      conversation: conversationSnapshot,
      conversationUpdateDebug,
      inboundEvent: inboundEvent?.event || null,
      outboundEvent: outboundEvent?.event || null,
      handoffPayload,
      operationalMessage,
      operationalDispatch,
      persistenceMode: customerResult?.mode || conversationResult?.mode || 'memory-fallback',
      opsDispatchMode: operationalDispatch?.mode || (hasTelegramOpsConfig() ? 'telegram' : 'stub'),
      eventMode: inboundEvent?.mode || outboundEvent?.mode || 'memory-fallback',
      note: 'Primeira rota funcional do módulo WhatsApp fora do n8n',
      transportMode: hasRealTwilioConfig() ? 'twilio' : 'stub',
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
