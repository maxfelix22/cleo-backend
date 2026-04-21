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

  if (/não entendi|ficou confus|nossa conversa.*confus|pera|calma|explica melhor|me perdi|não é isso|não era isso/.test(lower)) {
    return 'recover';
  }

  if (/e aí|e ai|oi\?|olá\?|ola\?|hum\?|cadê|me responde/.test(lower)) {
    return 'nudge';
  }

  if (/tem outro parecido|mais nessa linha|mais opções|mais opc|tem mais opc|me mostra outro/.test(lower)) {
    return 'alternatives';
  }

  if (/qual (é|e) melhor|qual (é|e) mais forte|qual a diferen|qual compensa/.test(lower)) {
    return 'compare';
  }

  if (/tem mais alguma coisa|mais alguma sugest|mais alguma opç|tem algo a mais/.test(lower)) {
    return 'cross_sell';
  }

  if (/quero esse|vou querer esse|vou levar esse|esse não|qual você acha melhor pra mim|quero dois|vou levar dois|leva dois|separa dois|me indica um|não sei qual escolher|quero algo mais forte/.test(lower)) {
    return 'intent_short';
  }

  if (/quero|vou querer|gostei|separa|leva/.test(lower)) {
    return 'close';
  }

  if (/tem\s+|você tem|vc tem|algo pra|me indica|me mostra|o que você tem/.test(lower)) {
    return 'discovery';
  }

  if (/frete|envio|usps|pickup|retirada|entrega local|marlboro|marlborough/.test(lower)) {
    return 'shipping';
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
  const available = Array.isArray(products) ? products.filter(Boolean) : [];
  const top = available.find((item) => item?.inventory_in_stock !== false) || available[0] || null;
  if (!top?.name) return '';
  const text = String(inbound.text || '').trim();
  const mood = inferDiscoveryMood(text);
  const priceLine = top.price ? ` por ${top.price}` : '';
  const second = available.find((item) => item?.name && item.name !== top.name);
  const secondLine = second?.name ? ` Se quiser, eu também te mostro *${second.name}* para você sentir melhor a diferença.` : '';
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
  return `${base}${secondLine}`;
}

function buildInitialHelpReplyAgentic({ inbound = {}, products = [] } = {}) {
  const text = String(inbound.text || '').trim();
  if (/^oi+|ol[áa]|boa (tarde|noite|dia)/i.test(text)) {
    return 'Oi amore 💜 Me fala o que você quer que eu já te ajudo.';
  }
  return buildDiscoveryReply({ inbound, products });
}

function buildComparisonReply({ context = {} } = {}) {
  const first = context.lastProducts?.[0] || null;
  const second = context.lastProducts?.[1] || null;
  if (first?.name && second?.name) {
    return `Entre *${first.name}* e *${second.name}*, eu te falaria assim: se você quer algo mais direto para uma proposta, eu iria mais em um; se quer puxar mais para outra sensação, eu iria no outro. Se quiser, eu já te digo qual faz mais sentido pro que você quer 💜`;
  }
  if (first?.name) {
    return `Se você quiser, eu comparo *${first.name}* com outra opção parecida e te explico a diferença sem enrolação 💜`;
  }
  return '';
}

function buildCrossSellReplyAgentic({ context = {} } = {}) {
  const productName = getPrimaryItemName(context);
  if (!productName) return '';
  return `Tenho sim 💜 Junto com *${productName}*, eu também te mostraria algo que complete melhor essa proposta e faça mais sentido no conjunto.`;
}

function buildAlternativesReplyAgentic({ context = {} } = {}) {
  const productName = getPrimaryItemName(context);
  if (!productName) return '';
  return `Tenho sim 💜 Se você quiser, eu te mostro outras opções parecidas com *${productName}* e já te digo qual muda mais de verdade.`;
}

function buildClarifyReplyAgentic({ context = {} } = {}) {
  const productName = getPrimaryItemName(context);
  if (productName) {
    return `Se não era *${productName}*, me fala rapidinho o que você quer mudar que eu ajusto daqui 💜`;
  }
  return 'Me fala rapidinho o que você quer mudar que eu ajusto daqui 💜';
}

function buildNudgeReplyAgentic({ context = {} } = {}) {
  const productName = getPrimaryItemName(context);
  if (productName) {
    return `Tô aqui 💜 Se você quiser, eu continuo por *${productName}* ou te mostro outra opção parecida.`;
  }
  return 'Tô aqui 💜 Me fala só o que você quer que eu sigo com você.';
}

function buildFollowUpReplyAgentic({ context = {} } = {}) {
  const productName = getPrimaryItemName(context);
  const cartItems = Array.isArray(context.cart?.items) ? context.cart.items : [];
  if (cartItems.length > 1) {
    const itemsLine = cartItems.map((item) => `${item.quantity}x ${item.label}`).join(', ');
    return `Até aqui ficou *${itemsLine}* 💜 Se quiser, eu sigo daqui e te conduzo no próximo passo sem embolar.`;
  }
  if (productName) {
    return `Tô com você 💜 Se quiser, eu continuo por *${productName}* e te digo o próximo passo sem complicar.`;
  }
  return 'Me fala o que você quer sentir, o tipo de produto que você quer, ou se já tem algum nome em mente que eu sigo com você 💜';
}

function buildIntentShortReplyAgentic({ context = {}, inbound = {} } = {}) {
  const text = String(inbound.text || '').trim().toLowerCase();
  const productName = getPrimaryItemName(context);

  if (/esse não/.test(text)) {
    return productName
      ? `Sem problema 💜 Então eu tiro *${productName}* da frente e te mostro outra opção melhor.`
      : 'Sem problema 💜 Então me fala rapidinho qual direção você quer que eu te mostro outra opção.';
  }

  if (/qual você acha melhor pra mim|me indica um|não sei qual escolher/.test(text)) {
    return productName
      ? `Se eu fosse te indicar uma direção agora, eu começaria por *${productName}* e depois te mostraria a segunda melhor opção pra você sentir a diferença 💜`
      : 'Se você quiser, eu te digo direto o que eu acho melhor pra você agora 💜';
  }

  if (/quero algo mais forte/.test(text)) {
    return productName
      ? `Se você quer algo mais forte, eu posso subir um degrau a partir de *${productName}* e te mostrar uma opção mais intensa 💜`
      : 'Se você quer algo mais forte, eu te mostro já a opção que sobe um degrau 💜';
  }

  if (/quero dois|vou levar dois|leva dois|separa dois/.test(text)) {
    return productName
      ? `Perfeito 💜 Então eu já considero *2x ${productName}*. Agora me diz só se você prefere *pickup*, *entrega em Marlborough* ou *USPS*.`
      : 'Perfeito 💜 Então me fala só quais dois itens você quer que eu já organizo daqui.';
  }

  if (/quero esse|vou querer esse|vou levar esse/.test(text)) {
    return productName
      ? `Perfeito 💜 Então vamos seguir com *${productName}*. Me diz só se você prefere *pickup*, *entrega em Marlborough* ou *USPS*.`
      : 'Perfeito 💜 Então me confirma só qual item você quer que eu sigo daqui.';
  }

  return '';
}

function buildCloseReply({ context = {} } = {}) {
  const productName = getPrimaryItemName(context);
  const cartItems = Array.isArray(context.cart?.items) ? context.cart.items : [];
  if (cartItems.length > 1) {
    const itemsLine = cartItems.map((item) => `${item.quantity}x ${item.label}`).join(', ');
    return `Perfeito 💜 Então vamos seguir com *${itemsLine}*. Agora me diz só se você prefere *pickup*, *entrega em Marlborough* ou *USPS*.`;
  }
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

function buildShippingReplyAgentic({ context = {}, inbound = {} } = {}) {
  const text = String(inbound.text || '').toLowerCase();
  const productName = getPrimaryItemName(context);
  if (/marlboro|marlborough/.test(text)) {
    return 'Pra entrega local em *Marlborough*, fica *$5* 💜';
  }
  if (productName) {
    return `Se for *${productName}*, eu te digo certinho o frete assim que você me falar se prefere *pickup*, *entrega em Marlborough* ou *USPS* 💜`;
  }
  return 'Eu te passo certinho o frete 💜 Me diz só se você quer *pickup*, *entrega em Marlborough* ou *USPS*.';
}

function buildGeneralReply({ context = {} } = {}) {
  return buildFollowUpReplyAgentic({ context });
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
    replyText = buildInitialHelpReplyAgentic({ inbound, context, products });
  } else if (mode === 'alternatives') {
    replyText = buildAlternativesReplyAgentic({ context });
  } else if (mode === 'nudge') {
    replyText = buildNudgeReplyAgentic({ context });
  } else if (mode === 'intent_short') {
    replyText = buildIntentShortReplyAgentic({ context, inbound });
  } else if (mode === 'recover' && /não é isso|não era isso/.test(text.toLowerCase())) {
    replyText = buildClarifyReplyAgentic({ context });
  } else if (mode === 'compare') {
    replyText = buildComparisonReply({ context });
  } else if (mode === 'cross_sell') {
    replyText = buildCrossSellReplyAgentic({ context });
  } else if (mode === 'close') {
    replyText = buildCloseReply({ context });
  } else if (mode === 'shipping') {
    replyText = buildShippingReplyAgentic({ context, inbound });
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
