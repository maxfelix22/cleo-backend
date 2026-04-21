function buildContextBlock(context = {}) {
  const cartItems = Array.isArray(context.cart?.items) ? context.cart.items : [];
  const checkout = context.checkout || {};
  const lastMessage = String(context.lastInboundText || '').trim();
  const summary = String(context.summary || '').trim();

  return {
    currentStage: context.currentStage || checkout.stage || '',
    summary,
    lastMessage,
    cart: {
      items: cartItems,
      itemsCount: Number(context.cart?.itemsCount || cartItems.length || 0),
      semanticFamilies: Array.isArray(context.cart?.semanticFamilies) ? context.cart.semanticFamilies : [],
      semanticSubfamilies: Array.isArray(context.cart?.semanticSubfamilies) ? context.cart.semanticSubfamilies : [],
    },
    checkout: {
      deliveryMode: checkout.deliveryMode || '',
      fullName: checkout.fullName || '',
      phone: checkout.phone || '',
      email: checkout.email || '',
      address: checkout.address || '',
    },
  };
}

function detectConversationMode(text = '', context = {}) {
  const lower = String(text || '').trim().toLowerCase();
  const stage = String(context.currentStage || context.checkout?.stage || '');

  if (/não entendi|ficou confus|nossa conversa.*confus|pera|calma|explica melhor|me perdi/.test(lower)) {
    return 'recover';
  }

  if (/qual (é|e) melhor|qual (é|e) mais forte|qual a diferen|qual compensa/.test(lower)) {
    return 'compare';
  }

  if (/tem mais alguma coisa|mais alguma sugest|mais alguma opç|tem algo a mais/.test(lower)) {
    return 'cross_sell';
  }

  if (/quero|vou querer|gostei|separa|leva/.test(lower)) {
    return 'close';
  }

  if (/tem\s+|você tem|vc tem|algo pra|me indica|me mostra|o que você tem/.test(lower)) {
    return 'discovery';
  }

  if (/checkout_|handoff_ready/.test(stage)) {
    return 'checkout';
  }

  return 'general';
}

function buildRecoveryReply(context = {}) {
  const cartItems = Array.isArray(context.cart?.items) ? context.cart.items : [];
  if (cartItems.length > 1) {
    const itemsLine = cartItems.map((item) => `${item.quantity}x ${item.label}`).join(', ');
    return `Você tem razão 💜 Vamos reorganizar certinho: até agora eu entendi *${itemsLine}*. Agora me diz só como você prefere receber: *pickup*, *entrega em Marlborough* ou *USPS*.`;
  }

  if (cartItems.length === 1) {
    return `Você tem razão 💜 Vamos por partes: até aqui eu entendi que você quer *${cartItems[0].label}*. Agora me diz só se você prefere *pickup*, *entrega em Marlborough* ou *USPS*.`;
  }

  return 'Você tem razão 💜 Vamos reorganizar direitinho. Me fala em uma frase só o que você quer agora que eu sigo sem complicar.';
}

function buildDiscoveryReply({ products = [] } = {}) {
  const top = Array.isArray(products) ? products.find((item) => item?.inventory_in_stock !== false) || products[0] : null;
  if (!top?.name) return '';
  const priceLine = top.price ? ` por ${top.price}` : '';
  return `Tenho sim 💜 O que eu mais te indicaria aí é *${top.name}*${priceLine}. Se quiser, eu já te mostro outras opções nessa mesma linha.`;
}

function buildComparisonReply({ context = {}, helpers = {} } = {}) {
  if (typeof helpers.buildContextualComparisonReply !== 'function') return '';
  return helpers.buildContextualComparisonReply(context, helpers.inbound || {});
}

function buildCrossSellReplyAgentic({ context = {}, helpers = {} } = {}) {
  if (typeof helpers.buildCrossSellReply !== 'function') return '';
  return helpers.buildCrossSellReply(context, helpers.inbound || {});
}

function buildCloseReply({ context = {}, helpers = {} } = {}) {
  if (typeof helpers.buildSoftCloseReply !== 'function') return '';
  return helpers.buildSoftCloseReply(context, helpers.inbound || {});
}

function buildGeneralReply({ context = {}, helpers = {} } = {}) {
  if (typeof helpers.buildContextualFollowUpReply !== 'function') {
    return '';
  }
  return helpers.buildContextualFollowUpReply(context, helpers.inbound || {});
}

function buildAgenticReply({ inbound = {}, context = {}, products = [], helpers = {} } = {}) {
  const text = String(inbound.text || '').trim();
  const mode = detectConversationMode(text, context);
  const contextBlock = buildContextBlock(context);

  let replyText = '';
  if (mode === 'recover') {
    replyText = buildRecoveryReply(context);
  } else if (mode === 'discovery') {
    replyText = buildDiscoveryReply({ inbound, context, products });
  } else if (mode === 'compare') {
    replyText = buildComparisonReply({ context, helpers: { ...helpers, inbound } });
  } else if (mode === 'cross_sell') {
    replyText = buildCrossSellReplyAgentic({ context, helpers: { ...helpers, inbound } });
  } else if (mode === 'close') {
    replyText = buildCloseReply({ context, helpers: { ...helpers, inbound } });
  } else {
    replyText = buildGeneralReply({ context, helpers: { ...helpers, inbound } });
  }

  return {
    mode,
    contextBlock,
    replyText,
    actions: {
      shouldFallback: !replyText,
      updateCart: false,
      updateCheckout: false,
      triggerHandoff: false,
    },
  };
}

module.exports = {
  buildAgenticReply,
  detectConversationMode,
  buildRecoveryReply,
  buildContextBlock,
};
