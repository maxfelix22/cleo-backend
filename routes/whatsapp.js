const express = require('express');
const router = express.Router();

const { normalizeWhatsAppInbound } = require('../lib/whatsapp-normalize');
const { sendWhatsAppMessage, hasRealTwilioConfig } = require('../services/whatsapp-outbound');
const { buildInitialReply, extractRequestedSize } = require('../services/whatsapp-context');

function shouldUseAgenticDiscovery(inbound = {}, context = {}, products = []) {
  const text = String(inbound?.text || '').trim().toLowerCase();
  const stage = String(context?.currentStage || context?.checkout?.stage || '');
  if (!text) return false;
  if (stage && /checkout_|handoff_ready/.test(stage)) return false;
  if (/quero esse|quero essa|vou querer|gostei desse|gostei dessa|quanto custa|preço|preco|valor|tem no tamanho|outra cor|outras cores/.test(text)) return false;
  if (!Array.isArray(products) || products.length === 0) return false;
  return /tem\s+|você tem|vc tem|trabalha com|algo pra|algo para|tem algo|me indica|me mostra|o que você tem/.test(text);
}

function buildAgenticDiscoveryReply(inbound = {}, products = [], context = {}) {
  const text = String(inbound?.text || '').trim().toLowerCase();
  const top = (Array.isArray(products) ? products : []).find((product) => product?.inventory_in_stock !== false) || products[0] || null;
  if (!top) return '';

  const priceLine = top.price ? ` por ${top.price}` : '';
  const shippingLocal = '$5';
  const shippingUsps = Number(top?.priceNumber || 0) >= 99 ? 'frete grátis' : '$10';
  const familyHint = /libido|desejo|vontade|tes[aã]o|excit/.test(text)
    ? 'nessa linha de desejo, excitação e mais vontade'
    : /apertad|sempre virgem|contrair|adstring/.test(text)
      ? 'nessa linha de sensação mais apertadinha'
      : /durar mais|retard|ere[cç][aã]o|berinjelo|volum[aã]o/.test(text)
        ? 'nessa linha de desempenho masculino'
        : /oral|boquete|chupar|beij[aá]vel|sabor/.test(text)
          ? 'nessa linha para oral e estímulo sensorial'
          : /lubrific|molhar|seca|ressec/.test(text)
            ? 'nessa linha de lubrificação e conforto'
            : /lingerie|sensual|fantasia|camisola|body/.test(text)
              ? 'nessa linha mais sensual/visual'
              : 'nessa linha que você está buscando';

  if (/entrega.*marlboro|entrega.*marlborough|marlboro|marlborough/.test(text)) {
    return `Sim amore 💜 Fazemos entrega local em *Marlborough*. A taxa é *${shippingLocal}*. Se você quiser, eu também posso te passar a opção por USPS — para esse pedido fica ${shippingUsps}.`;
  }

  if (/quanto fica pra entregar|valor da entrega|taxa de entrega|entregar em marlboro|entregar em marlborough/.test(text)) {
    return `Pra entrega local em *Marlborough*, fica *${shippingLocal}* 💜 Se preferir envio por USPS, para esse pedido fica ${shippingUsps}.`;
  }

  if (/oi|ol[áa]|boa noite|boa tarde|bom dia/.test(text) && /algo pra|algo para/.test(text)) {
    return `Oiiee amore 💜 Tenho sim. Pelo que você me falou, eu seguiria ${familyHint}. Já achei uma opção que faz sentido: *${top.name}*${priceLine}. Se você quiser, eu também posso te mostrar mais 2 ou 3 opções parecidas e te dizer qual eu acho mais certeira para o que você quer ✨`;
  }

  return `Tem sim amore 💜 Pelo que você me falou, eu seguiria ${familyHint}. Já achei uma opção que faz sentido: *${top.name}*${priceLine}. Se você quiser, eu também posso te mostrar mais 2 ou 3 opções parecidas e te dizer qual eu acho mais certeira para o que você quer ✨`;
}
const { searchProducts, findMatchingVariation } = require('../services/catalog-service');
const { buildFallbackProductsFromText } = require('../services/catalog-fallback');
const { getConversationKey, getContext, saveContext } = require('../services/context-store');
const { getOrCreateCustomerByPhone, getOrCreateOpenConversation, updateConversationState } = require('../services/customer-conversation-store');
const { appendEvent } = require('../services/event-store');
const { applyCheckoutState, buildCheckoutReply } = require('../services/checkout-state');
const { buildHandoffPayload, buildOperationalMessage } = require('../services/handoff-service');
const { sendOperationalTelegramMessage, hasTelegramOpsConfig, buildSalesEscortMessage, buildMemoryEscortMessage, buildCatalogEscortMessage, buildSystemEscortMessage } = require('../services/telegram-ops');

router.post('/whatsapp/inbound', async (req, res, next) => {
  try {
    const inbound = normalizeWhatsAppInbound(req.body || {});

    const contextKey = getConversationKey(inbound);
    const existingContext = getContext(contextKey) || {};

    let customerResult = null;
    let conversationResult = null;
    let recoveredContextFromConversation = null;
    try {
      customerResult = await getOrCreateCustomerByPhone(inbound.from, inbound.profileName);
      conversationResult = await getOrCreateOpenConversation({
        customerId: customerResult?.customer?.id,
        existingConversationId: existingContext.conversationId || '',
        existingSummary: existingContext.summary || '',
        existingStage: existingContext.currentStage || existingContext.checkout?.stage || '',
        existingLastProduct: existingContext.lastProduct || '',
        existingLastProductPayload: existingContext.lastProductPayload || null,
        channel: inbound.channel,
        phone: inbound.from,
        profileName: inbound.profileName,
      });

      if (conversationResult?.conversation) {
        recoveredContextFromConversation = {
          summary: conversationResult.conversation.summary || '',
          currentStage: conversationResult.conversation.current_stage || '',
          lastProduct: conversationResult.conversation.last_product || '',
          lastProductPayload: conversationResult.conversation.last_product_payload || null,
        };
      }
    } catch (err) {
      console.error('[whatsapp/inbound] customer/conversation bootstrap error:', err.message);
    }

    let products = [];
    const shouldLookupCatalog = /tem\s+|você tem|vc tem|quanto custa|preço|preco|valor|quero esse|quero essa|vou querer|gostei desse|gostei dessa|xana loka|blow girl|sempre virgem|berinjelo|volum[aã]o|libido|oral|lubrificante|vibrador|fantasia|camisola|lingerie|conjunto|calcinha|suti[aã]|body/i.test(inbound.text || '');
    if (shouldLookupCatalog) {
      try {
        products = await searchProducts(inbound.text, 3);
      } catch (err) {
        console.error('[whatsapp/inbound] catalog lookup error:', err.message);
      }
    }

    if (products.length === 0) {
      products = buildFallbackProductsFromText(inbound.text);
    }

    const recoveredLastProductPayload = recoveredContextFromConversation?.lastProductPayload || null;
    const preservedLastProducts = Array.isArray(existingContext.lastProducts) && existingContext.lastProducts.length > 0
      ? existingContext.lastProducts
      : (recoveredLastProductPayload ? [recoveredLastProductPayload] : []);

    const mergedProducts = products.length > 0
      ? products.map((product) => {
          const previous = preservedLastProducts.find((item) => item?.id && item.id === product.id) || {};
          const previousVariationDetails = Array.isArray(previous.variationDetails)
            ? previous.variationDetails
            : Array.isArray(previous.raw?.variationDetails)
              ? previous.raw.variationDetails
              : [];
          return {
            ...previous,
            ...product,
            variationDetails: Array.isArray(product.variationDetails) && product.variationDetails.length > 0
              ? product.variationDetails
              : previousVariationDetails,
          };
        })
      : preservedLastProducts;

    const effectiveProducts = mergedProducts;
    const recoveredStage = recoveredContextFromConversation?.currentStage || '';
    const persistedStagePriority = {
      new_lead: 0,
      catalog_browse: 1,
      checkout_start: 2,
      checkout_choose_delivery: 3,
      checkout_collect_address: 4,
      checkout_collect_name: 5,
      checkout_collect_contact: 6,
      checkout_review: 7,
      handoff_ready: 8,
    };
    const localStageCandidate = existingContext.checkout?.stage || existingContext.currentStage || '';
    const currentStageForState = (persistedStagePriority[localStageCandidate] || 0) >= (persistedStagePriority[recoveredStage] || 0)
      ? localStageCandidate
      : recoveredStage;
    const recoveredCheckout = recoveredContextFromConversation?.lastProductPayload?.checkout || {};
    const mergedCheckout = {
      ...recoveredCheckout,
      ...(existingContext.checkout || {}),
    };
    if (!mergedCheckout.stage && currentStageForState) {
      mergedCheckout.stage = currentStageForState;
    }

    const resolvedSummary = existingContext.summary || recoveredContextFromConversation?.summary || '';
    const resolvedLastProduct = existingContext.lastProduct || recoveredContextFromConversation?.lastProduct || '';
    const resolvedLastProductPayload = existingContext.lastProductPayload || recoveredContextFromConversation?.lastProductPayload || null;
    const contextForState = {
      ...existingContext,
      summary: resolvedSummary,
      currentStage: currentStageForState,
      checkout: mergedCheckout,
      lastProduct: resolvedLastProduct,
      lastProductPayload: resolvedLastProductPayload,
      lastProducts: effectiveProducts.length > 0
        ? effectiveProducts
        : (recoveredLastProductPayload ? [recoveredLastProductPayload] : []),
    };

    let checkoutContext = applyCheckoutState(contextForState, inbound);

    const handoffAckPattern = /^(oi+|ol[áa]|boa (tarde|noite|dia)|você tem|vc tem|tem\s+|quanto custa|preço|preco|valor|quero esse|quero essa|vou querer|gostei desse|gostei dessa)/i;
    if (
      (checkoutContext.currentStage || '') === 'handoff_ready'
      && handoffAckPattern.test(String(inbound.text || '').trim())
    ) {
      checkoutContext = {
        ...checkoutContext,
        currentStage: 'catalog_browse',
        checkout: {},
        summary: '',
      };
    }

    const productDebug = {
      inboundText: inbound.text,
      existingContextLastProductsCount: Array.isArray(existingContext.lastProducts) ? existingContext.lastProducts.length : 0,
      productsCount: Array.isArray(products) ? products.length : 0,
      effectiveProductsCount: Array.isArray(effectiveProducts) ? effectiveProducts.length : 0,
      contextForStateLastProductsCount: Array.isArray(contextForState.lastProducts) ? contextForState.lastProducts.length : 0,
      checkoutContextLastProductsCount: Array.isArray(checkoutContext.lastProducts) ? checkoutContext.lastProducts.length : 0,
      existingContextLastProductName: existingContext.lastProducts?.[0]?.name || '',
      productCandidateName: products[0]?.name || '',
      effectiveProductName: effectiveProducts[0]?.name || '',
      contextForStateProductName: contextForState.lastProducts?.[0]?.name || '',
      checkoutContextProductName: checkoutContext.lastProducts?.[0]?.name || '',
      checkoutContextLastProduct: checkoutContext.lastProduct || '',
      checkoutContextLastProductPayloadName: checkoutContext.lastProductPayload?.name || '',
      currentStageForState,
      currentStageAfterState: checkoutContext.currentStage || '',
    };

    const followUpSignals = {
      currentStageBefore: currentStageForState,
      currentStageAfter: checkoutContext.currentStage || currentStageForState,
      requestedSize: extractRequestedSize(inbound.text),
      asksSize: /tem\s+no\s+tamanho|tamanho\s+[pmg]|tem\s+p\b|tem\s+m\b|tem\s+g\b/i.test(inbound.text || ''),
      asksColor: /tem\s+em\s+outra\s+cor|outra\s+cor|outras\s+cores/i.test(inbound.text || ''),
      asksPrice: /quanto custa|preço|preco|valor/i.test(inbound.text || ''),
      wantsThis: /quero esse|quero essa|vou querer|gostei desse|gostei dessa/i.test(inbound.text || ''),
    };

    const matchingVariation = findMatchingVariation(effectiveProducts[0] || {}, followUpSignals.requestedSize);

    let replyText = buildCheckoutReply(checkoutContext);
    if (!replyText && shouldUseAgenticDiscovery(inbound, checkoutContext, effectiveProducts)) {
      replyText = buildAgenticDiscoveryReply(inbound, effectiveProducts, checkoutContext);
    }
    if (!replyText) {
      replyText = buildInitialReply(inbound, { products: effectiveProducts, context: checkoutContext, matchingVariation });
    }

    const anchoredProduct = checkoutContext.lastProducts?.[0]
      || effectiveProducts[0]
      || existingContext.lastProducts?.[0]
      || checkoutContext.lastProductPayload
      || existingContext.lastProductPayload
      || null;

    const anchoredProducts = anchoredProduct ? [anchoredProduct] : (effectiveProducts.length > 0 ? effectiveProducts : (existingContext.lastProducts || []));

    const savedContext = saveContext(contextKey, {
      ...checkoutContext,
      profileName: inbound.profileName,
      customerId: customerResult?.customer?.id || existingContext.customerId || '',
      conversationId: conversationResult?.conversation?.id || existingContext.conversationId || '',
      lastInboundText: inbound.text,
      lastProducts: anchoredProducts,
      lastProduct: anchoredProduct?.name || checkoutContext.lastProduct || existingContext.lastProduct || '',
      lastProductPayload: anchoredProduct || checkoutContext.lastProductPayload || existingContext.lastProductPayload || null,
      lastReplyText: replyText,
      lastChannel: inbound.channel,
      lastProvider: inbound.provider,
      address: checkoutContext.checkout?.address || existingContext.address || '',
      followUpSignals,
      productDebug,
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
    let handoffDebug = null;
    let operationalMessage = '';
    let operationalDispatch = null;
    let salesEscortMessage = '';
    let salesEscortDispatch = null;
    let memoryEscortMessage = '';
    let memoryEscortDispatch = null;
    let catalogEscortMessage = '';
    let catalogEscortDispatch = null;
    let systemEscortMessage = '';
    let systemEscortDispatch = null;
    if ((savedContext.currentStage || '') === 'handoff_ready') {
      salesEscortMessage = buildSalesEscortMessage(savedContext);
      const shouldSendSalesEscort = Boolean(
        savedContext.lastProductPayload?.name
        || savedContext.lastProduct
        || savedContext.followUpSignals?.wantsThis
        || savedContext.followUpSignals?.asksPrice
        || savedContext.followUpSignals?.asksColor
        || savedContext.followUpSignals?.requestedSize
        || savedContext.checkout?.deliveryMode
        || savedContext.checkout?.fullName
        || savedContext.checkout?.email
        || savedContext.checkout?.phone
      );
      if (shouldSendSalesEscort) {
        try {
          salesEscortDispatch = await sendOperationalTelegramMessage(salesEscortMessage, {
            topicKey: 'atendimento_vendas',
          });
        } catch (err) {
          console.error('[whatsapp/inbound] sales escort dispatch error:', err.message);
        }
      }

      memoryEscortMessage = buildMemoryEscortMessage(savedContext);
      const shouldSendMemoryEscort = Boolean(
        savedContext.customerId
        || savedContext.conversationId
        || savedContext.checkout?.fullName
        || savedContext.checkout?.email
        || savedContext.checkout?.phone
        || savedContext.checkout?.address
        || savedContext.checkout?.deliveryMode
        || savedContext.lastProductPayload?.name
        || savedContext.followUpSignals?.requestedSize
        || savedContext.currentStage === 'checkout_review'
        || savedContext.currentStage === 'handoff_ready'
      );
      if (shouldSendMemoryEscort) {
        try {
          memoryEscortDispatch = await sendOperationalTelegramMessage(memoryEscortMessage, {
            topicKey: 'memoria_clientes',
          });
        } catch (err) {
          console.error('[whatsapp/inbound] memory escort dispatch error:', err.message);
        }
      }

      catalogEscortMessage = buildCatalogEscortMessage(savedContext);
      const shouldSendCatalogEscort = Boolean(
        savedContext.lastProductPayload?.name
        || savedContext.lastProduct
        || savedContext.followUpSignals?.requestedSize
        || savedContext.followUpSignals?.asksColor
        || savedContext.followUpSignals?.asksPrice
        || savedContext.checkout?.deliveryMode === 'usps'
      );
      if (shouldSendCatalogEscort) {
        try {
          catalogEscortDispatch = await sendOperationalTelegramMessage(catalogEscortMessage, {
            topicKey: 'produtos_estoque',
          });
        } catch (err) {
          console.error('[whatsapp/inbound] catalog escort dispatch error:', err.message);
        }
      }

      const systemEscortMeta = {
        transportMode: hasRealTwilioConfig() ? 'twilio' : 'stub',
        persistenceMode: customerResult?.mode || conversationResult?.mode || 'memory-fallback',
        eventMode: inboundEvent?.mode || outboundEvent?.mode || 'memory-fallback',
        opsDispatchMode: operationalDispatch?.mode || (hasTelegramOpsConfig() ? 'telegram' : 'stub'),
      };
      systemEscortMessage = buildSystemEscortMessage(savedContext, systemEscortMeta);
      const shouldSendSystemEscort = Boolean(
        systemEscortMeta.transportMode !== 'twilio'
        || systemEscortMeta.persistenceMode !== 'supabase'
        || systemEscortMeta.eventMode !== 'supabase'
        || systemEscortMeta.opsDispatchMode !== 'telegram'
        || !savedContext.customerId
        || !savedContext.conversationId
        || !savedContext.summary
      );
      if (shouldSendSystemEscort) {
        try {
          systemEscortDispatch = await sendOperationalTelegramMessage(systemEscortMessage, {
            topicKey: 'sistema_automacao',
          });
        } catch (err) {
          console.error('[whatsapp/inbound] system escort dispatch error:', err.message);
        }
      }
      handoffDebug = {
        currentStage: savedContext.currentStage,
        checkout: savedContext.checkout || null,
        summary: savedContext.summary || '',
      };
      handoffPayload = buildHandoffPayload(savedContext);
      operationalMessage = buildOperationalMessage(savedContext);
      try {
        operationalDispatch = await sendOperationalTelegramMessage(operationalMessage, {
          topicKey: 'handoff_pedidos',
        });
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
      productDebug,
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
      handoffDebug,
      operationalMessage,
      operationalDispatch,
      salesEscortMessage,
      salesEscortDispatch,
      memoryEscortMessage,
      memoryEscortDispatch,
      catalogEscortMessage,
      catalogEscortDispatch,
      systemEscortMessage,
      systemEscortDispatch,
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
