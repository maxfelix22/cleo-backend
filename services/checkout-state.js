function extractAddressBlock(text = '') {
  const value = String(text || '').trim();
  if (!value) return null;

  const emailMatch = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const phoneMatch = value.match(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/);
  const lines = value.split(/\n+/).map((line) => line.trim()).filter(Boolean);

  if (lines.length < 2) return null;

  const fullName = lines.find((line) => line.split(/\s+/).filter(Boolean).length >= 2 && !/@/.test(line) && !/\d{3}[\s.-]?\d{3}[\s.-]?\d{4}/.test(line)) || '';
  const email = emailMatch ? emailMatch[0] : '';
  const phone = phoneMatch ? `+${phoneMatch[0].replace(/\D+/g, '')}` : '';

  const addressLines = lines.filter((line) => line !== fullName && line !== email && line !== phoneMatch?.[0]);
  const address = addressLines.join(', ').trim();

  if (!fullName || !address || (!email && !phone)) return null;

  return {
    fullName,
    email,
    phone,
    address,
  };
}

function buildShippingCopy(context = {}) {
  const product = context.lastProducts?.[0] || null;
  const priceNumber = Number(product?.priceNumber || 0);
  const quantity = Number(context.checkout?.quantity || 1) || 1;
  const orderTotal = priceNumber * quantity;

  const localDeliveryFee = 5;
  const uspsFee = orderTotal >= 99 ? 0 : 10;
  const uspsFeeLabel = uspsFee === 0 ? 'frete grátis' : `$${uspsFee}`;

  return {
    localDeliveryFee,
    uspsFee,
    uspsFeeLabel,
    localDeliveryLabel: `$${localDeliveryFee}`,
    localDeliveryEta: '2 a 4 dias úteis dentro de Massachusetts',
    uspsEtaInState: '2 a 4 dias úteis dentro de Massachusetts',
    uspsEtaOutOfState: '3 a 5 dias úteis fora de Massachusetts',
  };
}

function extractFullName(text = '') {
  const value = String(text || '').trim();
  if (!value) return '';
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length < 2) return '';
  const looksLikeCommand = /quanto custa|tem no tamanho|tem em outra cor|quero esse|oi|olá|ola|quero comprar/i.test(value);
  if (looksLikeCommand) return '';
  return value;
}

function extractPhoneOrEmail(text = '') {
  const value = String(text || '').trim();
  const emailMatch = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const phoneDigits = value.replace(/\D+/g, '');
  return {
    email: emailMatch ? emailMatch[0] : '',
    phone: phoneDigits.length >= 10 ? `+${phoneDigits}` : '',
  };
}

function extractDeliveryMode(text = '') {
  const lower = String(text || '').toLowerCase().trim();
  if (/\b(usps|envio|entrega pelos correios|shipping)\b/.test(lower)) return 'usps';
  if (/\b(retirada|retirar|pickup)\b/.test(lower)) return 'pickup';
  if (/\b(entrega local|local delivery|motoboy|entrega)\b/.test(lower)) return 'local_delivery';
  return '';
}

function extractAddress(text = '') {
  const value = String(text || '').trim();
  if (!value) return '';
  if (value.length < 8) return '';
  const looksLikeCommand = /quanto custa|tem no tamanho|tem em outra cor|quero esse|oi|olá|ola|quero comprar|ok|sim|retirada|pickup|usps|entrega local/i.test(value);
  if (looksLikeCommand) return '';
  const hasNumber = /\d/.test(value);
  const hasStreetHint = /rua|avenida|av\.?|travessa|alameda|bairro|cep|street|st\.?/i.test(value);
  if (hasNumber || hasStreetHint) return value;
  return '';
}

function applyCheckoutState(context = {}, inbound = {}) {
  const text = String(inbound.text || '').trim();
  const lower = text.toLowerCase();
  const next = { ...context };

  const addressBlock = extractAddressBlock(text);

  if (/quero esse|quero essa|vou querer|gostei desse|gostei dessa/.test(lower)) {
    const anchoredProduct = context.lastProducts?.[0] || context.lastProductPayload || null;
    next.currentStage = 'checkout_choose_delivery';
    next.lastProducts = anchoredProduct ? [anchoredProduct] : (context.lastProducts || []);
    next.lastProduct = anchoredProduct?.name || context.lastProduct || '';
    next.lastProductPayload = anchoredProduct || context.lastProductPayload || null;
    next.checkout = {
      ...(context.checkout || {}),
      stage: 'checkout_choose_delivery',
      interestedProduct: anchoredProduct?.name || context.lastProducts?.[0]?.name || '',
      nextRequiredField: 'delivery_mode',
    };
    return next;
  }

  const stageNow = context.currentStage || context.checkout?.stage || '';

  if (stageNow === 'checkout_choose_delivery') {
    const deliveryMode = extractDeliveryMode(text);
    if (deliveryMode) {
      const nextRequiredField = deliveryMode === 'pickup' ? 'full_name' : 'address';
      const nextStage = deliveryMode === 'pickup' ? 'checkout_collect_name' : 'checkout_collect_address';
      const anchoredProduct = context.lastProducts?.[0] || context.lastProductPayload || null;
      next.currentStage = nextStage;
      next.lastProducts = anchoredProduct ? [anchoredProduct] : (context.lastProducts || []);
      next.lastProduct = anchoredProduct?.name || context.lastProduct || '';
      next.lastProductPayload = anchoredProduct || context.lastProductPayload || null;
      next.checkout = {
        ...(context.checkout || {}),
        stage: nextStage,
        deliveryMode,
        nextRequiredField,
        debug_delivery_transition: {
          text,
          deliveryMode,
          nextStage,
          nextRequiredField,
        },
      };
      next.summary = context.lastProducts?.[0]?.name
        ? `checkout iniciado para ${context.lastProducts[0].name}`
        : 'checkout iniciado';
      return next;
    }
  }

  if (stageNow === 'checkout_collect_address') {
    if (addressBlock) {
      const anchoredProduct = context.lastProducts?.[0] || context.lastProductPayload || null;
      next.currentStage = 'checkout_review';
      next.lastProducts = anchoredProduct ? [anchoredProduct] : (context.lastProducts || []);
      next.lastProduct = anchoredProduct?.name || context.lastProduct || '';
      next.lastProductPayload = anchoredProduct || context.lastProductPayload || null;
      next.checkout = {
        ...(context.checkout || {}),
        stage: 'checkout_review',
        address: addressBlock.address,
        fullName: addressBlock.fullName,
        phone: addressBlock.phone || context.checkout?.phone || '',
        email: addressBlock.email || context.checkout?.email || '',
        nextRequiredField: 'review_order',
      };
      next.summary = context.lastProducts?.[0]?.name
        ? `checkout em revisão para ${context.lastProducts[0].name}`
        : 'checkout em revisão';
      return next;
    }

    const address = extractAddress(text);
    if (address) {
      const anchoredProduct = context.lastProducts?.[0] || context.lastProductPayload || null;
      next.currentStage = 'checkout_collect_name';
      next.lastProducts = anchoredProduct ? [anchoredProduct] : (context.lastProducts || []);
      next.lastProduct = anchoredProduct?.name || context.lastProduct || '';
      next.lastProductPayload = anchoredProduct || context.lastProductPayload || null;
      next.checkout = {
        ...(context.checkout || {}),
        stage: 'checkout_collect_name',
        address,
        nextRequiredField: 'full_name',
      };
      next.summary = context.lastProducts?.[0]?.name
        ? `checkout iniciado para ${context.lastProducts[0].name}`
        : 'checkout iniciado';
      return next;
    }
  }

  if (stageNow === 'checkout_collect_name') {
    const fullName = extractFullName(text);
    if (fullName) {
      const anchoredProduct = context.lastProducts?.[0] || context.lastProductPayload || null;
      next.currentStage = 'checkout_collect_contact';
      next.lastProducts = anchoredProduct ? [anchoredProduct] : (context.lastProducts || []);
      next.lastProduct = anchoredProduct?.name || context.lastProduct || '';
      next.lastProductPayload = anchoredProduct || context.lastProductPayload || null;
      next.checkout = {
        ...(context.checkout || {}),
        stage: 'checkout_collect_contact',
        fullName,
        nextRequiredField: 'phone_or_email',
      };
      next.summary = context.lastProducts?.[0]?.name
        ? `checkout iniciado para ${context.lastProducts[0].name}`
        : 'checkout iniciado';
      return next;
    }
  }

  if (stageNow === 'checkout_collect_contact') {
    const { phone, email } = extractPhoneOrEmail(text);
    if (phone || email) {
      const anchoredProduct = context.lastProducts?.[0] || context.lastProductPayload || null;
      next.currentStage = 'checkout_review';
      next.lastProducts = anchoredProduct ? [anchoredProduct] : (context.lastProducts || []);
      next.lastProduct = anchoredProduct?.name || context.lastProduct || '';
      next.lastProductPayload = anchoredProduct || context.lastProductPayload || null;
      next.checkout = {
        ...(context.checkout || {}),
        stage: 'checkout_review',
        address: context.checkout?.address || '',
        phone: phone || context.checkout?.phone || '',
        email: email || context.checkout?.email || '',
        nextRequiredField: 'review_order',
      };
      next.summary = context.lastProducts?.[0]?.name
        ? `checkout em revisão para ${context.lastProducts[0].name}`
        : 'checkout em revisão';
      return next;
    }
  }

  if (stageNow === 'checkout_review') {
    if (/^(ok|okay|okey|sim|pode seguir|pode|certo|isso|fechado)$/i.test(text)) {
      const anchoredProduct = context.lastProducts?.[0] || context.lastProductPayload || null;
      next.currentStage = 'handoff_ready';
      next.lastProducts = anchoredProduct ? [anchoredProduct] : (context.lastProducts || []);
      next.lastProduct = anchoredProduct?.name || context.lastProduct || '';
      next.lastProductPayload = anchoredProduct || context.lastProductPayload || null;
      next.checkout = {
        ...(context.checkout || {}),
        address: context.checkout?.address || '',
        stage: 'handoff_ready',
        nextRequiredField: 'handoff_ready',
        reviewConfirmed: true,
      };
      next.summary = context.lastProducts?.[0]?.name
        ? `checkout pronto para handoff: ${context.lastProducts[0].name}`
        : 'checkout pronto para handoff';
      return next;
    }
  }

  return next;
}

function buildCheckoutReply(context = {}) {
  const stageNow = context.currentStage || context.checkout?.stage || '';

  if (stageNow === 'checkout_choose_delivery') {
    const shipping = buildShippingCopy(context);
    return `Me diz como você prefere receber essa peça 💜

• envio (USPS)
• retirada
• entrega local em Marlborough (${shipping.localDeliveryLabel})

• USPS abaixo de $99: $10
• USPS acima de $99: frete grátis
• Atendemos apenas endereços dentro dos Estados Unidos`;
  }

  if (stageNow === 'checkout_collect_address') {
    if (context.checkout?.deliveryMode === 'usps') {
      const shipping = buildShippingCopy(context);
      return `Me manda seu *endereço completo* com *ZIP code* para eu seguir com o envio 💜

Se quiser agilizar, pode mandar tudo de uma vez:
• nome completo
• telefone
• email
• endereço completo com ZIP code

• Frete USPS deste pedido: ${shipping.uspsFeeLabel}
• Prazo estimado em Massachusetts: ${shipping.uspsEtaInState}
• Prazo estimado fora de Massachusetts: ${shipping.uspsEtaOutOfState}
• Atendemos apenas endereços dentro dos Estados Unidos`;
    }
    if (context.checkout?.deliveryMode === 'local_delivery') {
      const shipping = buildShippingCopy(context);
      return `Me manda seu *endereço completo* para entrega local 💜

Se quiser agilizar, pode mandar tudo de uma vez:
• nome completo
• telefone
• email
• endereço completo

• Entrega local em Marlborough: ${shipping.localDeliveryLabel}`;
    }
  }

  if (stageNow === 'checkout_collect_name') {
    const productName = context.lastProducts?.[0]?.name || 'a peça';
    return `Perfeito amore 💜 Vamos seguir com a *${productName}*. Essa peça está saindo super bem por aqui ✨ Me manda seu *nome completo* que eu já separo seu pedido por aqui.`;
  }

  if (stageNow === 'checkout_collect_contact' && context.checkout?.fullName) {
    return `Perfeito, ${context.checkout.fullName} 💜 Agora me manda seu *telefone* ou *email* para eu continuar e deixar tudo certinho no seu pedido.`;
  }

  if (stageNow === 'checkout_review' && context.checkout?.fullName) {
    const shipping = buildShippingCopy(context);
    const lines = [];
    const quantity = Number(context.checkout?.quantity || 1) || 1;
    const multiItems = Array.isArray(context.checkout?.multiItems) ? context.checkout.multiItems : [];
    if (multiItems.length > 0) {
      lines.push('• Itens do pedido:');
      multiItems.forEach((item) => {
        const semanticTags = [
          item.ontologyFamily || '',
          ...(Array.isArray(item.ontologySubfamilies) ? item.ontologySubfamilies : []),
        ].filter(Boolean);
        lines.push(`  - ${item.quantity}x ${item.label}${semanticTags.length ? ` [${Array.from(new Set(semanticTags)).join(' | ')}]` : ''}`);
      });
    } else if (context.lastProducts?.[0]?.name) {
      lines.push(`• Produto: ${context.lastProducts[0].name}`);
    }
    if (multiItems.length === 0 && quantity > 1) lines.push(`• Quantidade: ${quantity}`);
    if (context.checkout.deliveryMode === 'usps') {
      lines.push('• Entrega: USPS');
      lines.push(`• Frete: ${shipping.uspsFeeLabel}`);
      lines.push('• Atendimento: apenas endereços dentro dos Estados Unidos');
    }
    if (context.checkout.deliveryMode === 'pickup') lines.push('• Entrega: Retirada');
    if (context.checkout.deliveryMode === 'local_delivery') {
      lines.push('• Entrega: Entrega local');
      lines.push(`• Taxa de entrega: ${shipping.localDeliveryLabel}`);
    }
    if (context.checkout.address) lines.push(`• Endereço: ${context.checkout.address}`);
    if (context.checkout.fullName) lines.push(`• Nome: ${context.checkout.fullName}`);
    if (context.checkout.phone) lines.push(`• Telefone: ${context.checkout.phone}`);
    if (context.checkout.email) lines.push(`• Email: ${context.checkout.email}`);
    return `Perfeito amore 💜 Deixa eu te confirmar como seu pedido ficou até aqui:\n\n${lines.join('\n')}\n\nSe estiver tudo certinho, me responde *ok* que eu sigo por aqui. Se quiser ajustar alguma coisinha antes, me fala ✨`;
  }

  if (stageNow === 'handoff_ready') {
    return 'Perfeito amore 💜 Seu pedido já ficou certinho por aqui. Agora eu sigo com o próximo passo para deixar tudo alinhado pra você ✨';
  }

  return '';
}

module.exports = {
  applyCheckoutState,
  buildCheckoutReply,
  buildShippingCopy,
  extractAddressBlock,
  extractFullName,
  extractPhoneOrEmail,
  extractDeliveryMode,
  extractAddress,
};
