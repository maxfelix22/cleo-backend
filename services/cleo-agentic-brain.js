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

function inferDiscoveryMood(text = '') {
  const lower = String(text || '').toLowerCase();
  if (/libido|tes[aã]o|vontade|desejo|excita/.test(lower)) return 'libido';
  if (/apertad|sempre virgem|lacradinha|adstring/.test(lower)) return 'apertar';
  if (/oral|boquete|chupar|blow|garganta/.test(lower)) return 'oral';
  if (/berinjelo|volum[aã]o|ere[cç][aã]o|retard|homem|masculino/.test(lower)) return 'masculino';
  if (/lubrific|seca|molhar|desliz/.test(lower)) return 'lubrificacao';
  return 'geral';
}

function buildDiscoveryReply({ inbound = {}, products = [] } = {}) {
  const top = Array.isArray(products) ? products.find((item) => item?.inventory_in_stock !== false) || products[0] : null;
  if (!top?.name) return '';
  const text = String(inbound.text || '').trim();
  const mood = inferDiscoveryMood(text);
  const priceLine = top.price ? ` por ${top.price}` : '';
  const base = mood === 'libido'
    ? `Tenho sim 💜 Pra libido, eu começaria por *${top.name}*${priceLine}.`
    : mood === 'apertar'
      ? `Tenho sim 💜 Pra essa linha mais apertadinha, eu iria primeiro em *${top.name}*${priceLine}.`
      : mood === 'oral'
        ? `Tenho sim 💜 Pra oral, eu te mostraria primeiro *${top.name}*${priceLine}.`
        : mood === 'masculino'
          ? `Tenho sim 💜 Pra essa linha masculina, eu começaria por *${top.name}*${priceLine}.`
          : mood === 'lubrificacao'
            ? `Tenho sim 💜 Pra lubrificação, eu te mostraria primeiro *${top.name}*${priceLine}.`
            : `Tenho sim 💜 O que eu mais te indicaria aí é *${top.name}*${priceLine}.`;
  return `${base} Se quiser, eu já te mostro outras opções nessa mesma linha.`;
}

function buildComparisonReply({ context = {} } = {}) {
  const first = context.lastProducts?.[0] || null;
  const second = context.lastProducts?.[1] || null;
  if (first?.name && second?.name) {
    return `Entre *${first.name}* e *${second.name}*, o que eu te diria bem direto é: um deles puxa mais para uma proposta e o outro vai mais para outra. Se você quiser, eu já te digo qual faz mais sentido para o efeito que você quer 💜`;
  }
  if (first?.name) {
    return `Se você quiser, eu comparo *${first.name}* com outra opção parecida e te explico a diferença de um jeito bem simples 💜`;
  }
  return '';
}

function buildCrossSellReplyAgentic({ context = {} } = {}) {
  const productName = getPrimaryItemName(context);
  if (!productName) return '';
  return `Tenho sim 💜 Se você quiser, junto com *${productName}* eu também te mostro algo que combine de verdade com essa proposta.`;
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
  return 'Me fala o que você quer sentir, o tipo de produto que você quer, ou se já tem algum nome em mente que eu sigo com você 💜';
}

function buildActions({ mode = 'general', context = {}, inbound = {} } = {}) {
  const stage = String(context.currentStage || context.checkout?.stage || '');
  const hasCart = Array.isArray(context.cart?.items) && context.cart.items.length > 0;
  const text = String(inbound.text || '').trim().toLowerCase();
  const closeSignals = /quero|vou querer|gostei|separa|leva/.test(text);
  const confirmationSignals = /ok|pode seguir|fechado|certo|sim/.test(text);
  const multiItemSignals = /\b\d+\b.*\be\b|,/.test(text) && closeSignals;

  return {
    shouldFallback: false,
    updateCart: (mode === 'close' && !hasCart) || multiItemSignals,
    updateCheckout: mode === 'close' || mode === 'recover' || mode === 'checkout' || confirmationSignals,
    triggerHandoff: stage === 'handoff_ready' || (confirmationSignals && stage === 'checkout_review'),
    needsHumanRecoveryStyle: mode === 'recover',
    preferredNextStage: mode === 'close'
      ? 'checkout_choose_delivery'
      : mode === 'recover'
        ? 'checkout_choose_delivery'
        : confirmationSignals && stage === 'checkout_review'
          ? 'handoff_ready'
          : mode === 'checkout'
            ? stage || 'checkout_choose_delivery'
            : '',
    shouldSummarizeCart: multiItemSignals || mode === 'recover',
  };
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
      ...buildActions({ mode, context, inbound }),
      shouldFallback: !replyText,
    },
  };
}

module.exports = {
  buildAgenticReply,
  detectConversationMode,
  buildRecoveryReply,
  buildContextBlock,
};
