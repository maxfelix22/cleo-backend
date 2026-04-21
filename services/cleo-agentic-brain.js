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

function getPrimaryCartItem(context = {}) {
  return Array.isArray(context.cart?.items) && context.cart.items.length > 0
    ? context.cart.items[0]
    : null;
}

function getPrimaryItemName(context = {}) {
  return getPrimaryCartItem(context)?.label || context.lastProducts?.[0]?.name || context.lastProduct || context.lastProductPayload?.name || '';
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

function buildComparisonReply({ context = {} } = {}) {
  const first = context.lastProducts?.[0] || null;
  const second = context.lastProducts?.[1] || null;
  if (first?.name && second?.name) {
    return `Entre *${first.name}* e *${second.name}*, eu te explico bem simples: um muda mais para um lado e o outro puxa mais para outro. Se você quiser, eu já te digo qual faz mais sentido para o que você quer sentir 💜`;
  }
  if (first?.name) {
    return `Se você quiser, eu comparo *${first.name}* com outra opção parecida e te digo o que muda de verdade entre eles 💜`;
  }
  return '';
}

function buildCrossSellReplyAgentic({ context = {} } = {}) {
  const productName = getPrimaryItemName(context);
  if (!productName) return '';
  return `Tenho sim 💜 Junto com *${productName}*, eu também posso te indicar algo que combine melhor com essa proposta.`;
}

function buildCloseReply({ context = {} } = {}) {
  const productName = getPrimaryItemName(context);
  if (!productName) return '';
  return `Perfeito 💜 Então vamos seguir com *${productName}*. Me diz só se você prefere *pickup*, *entrega em Marlborough* ou *USPS*.`;
}

function buildCheckoutReplyAgentic({ context = {} } = {}) {
  const stage = String(context.currentStage || context.checkout?.stage || '');
  const productName = getPrimaryItemName(context);

  if (stage === 'checkout_choose_delivery') {
    return `Perfeito 💜 Me diz só como você prefere receber${productName ? ` *${productName}*` : ' seu pedido'}: *pickup*, *entrega em Marlborough* ou *USPS*.`;
  }

  return '';
}

function buildGeneralReply({ context = {} } = {}) {
  const productName = getPrimaryItemName(context);
  if (productName) {
    return `Tô com você 💜 Se quiser, eu continuo por *${productName}* e te digo o próximo passo sem complicar.`;
  }
  return '';
}

function buildAgenticReply({ inbound = {}, context = {}, products = [] } = {}) {
  const text = String(inbound.text || '').trim();
  const mode = detectConversationMode(text, context);
  const contextBlock = buildContextBlock(context);

  let replyText = '';
  if (mode === 'recover') {
    replyText = buildRecoveryReply(context);
  } else if (mode === 'discovery') {
    replyText = buildDiscoveryReply({ inbound, context, products });
  } else if (mode === 'compare') {
    replyText = buildComparisonReply({ context });
  } else if (mode === 'cross_sell') {
    replyText = buildCrossSellReplyAgentic({ context });
  } else if (mode === 'close') {
    replyText = buildCloseReply({ context });
  } else if (mode === 'checkout') {
    replyText = buildCheckoutReplyAgentic({ context });
  } else {
    replyText = buildGeneralReply({ context });
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
