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

  if (/quero esse|quero essa|vou querer|gostei desse|gostei dessa/.test(lower)) {
    next.currentStage = 'checkout_choose_delivery';
    next.checkout = {
      ...(context.checkout || {}),
      stage: 'checkout_choose_delivery',
      interestedProduct: context.lastProducts?.[0]?.name || '',
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
      next.currentStage = nextStage;
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
    const address = extractAddress(text);
    if (address) {
      next.currentStage = 'checkout_collect_name';
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
      next.currentStage = 'checkout_collect_contact';
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
      next.currentStage = 'checkout_review';
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
      next.currentStage = 'handoff_ready';
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
    return 'Perfeito amore 💜 Antes de seguir, me diz como você prefere receber: *envio (USPS)*, *retirada* ou *entrega local*?';
  }

  if (stageNow === 'checkout_collect_address') {
    if (context.checkout?.deliveryMode === 'usps') {
      return 'Perfeito amore 💜 Me manda seu *endereço completo* para envio por USPS que eu sigo com seu pedido.';
    }
    if (context.checkout?.deliveryMode === 'local_delivery') {
      return 'Perfeito amore 💜 Me manda seu *endereço completo* para entrega local que eu sigo com seu pedido.';
    }
  }

  if (stageNow === 'checkout_collect_name') {
    const productName = context.lastProducts?.[0]?.name || 'a peça';
    return `Perfeito amore 💜 Vamos seguir com a *${productName}*. Me manda seu *nome completo* que eu já começo seu pedido.`;
  }

  if (stageNow === 'checkout_collect_contact' && context.checkout?.fullName) {
    return `Perfeito, ${context.checkout.fullName} 💜 Agora me manda seu *telefone* ou *email* para eu continuar seu pedido.`;
  }

  if (stageNow === 'checkout_review' && context.checkout?.fullName) {
    const lines = [];
    if (context.lastProducts?.[0]?.name) lines.push(`• Produto: ${context.lastProducts[0].name}`);
    if (context.checkout.deliveryMode === 'usps') lines.push('• Entrega: USPS');
    if (context.checkout.deliveryMode === 'pickup') lines.push('• Entrega: Retirada');
    if (context.checkout.deliveryMode === 'local_delivery') lines.push('• Entrega: Entrega local');
    if (context.checkout.address) lines.push(`• Endereço: ${context.checkout.address}`);
    if (context.checkout.fullName) lines.push(`• Nome: ${context.checkout.fullName}`);
    if (context.checkout.phone) lines.push(`• Telefone: ${context.checkout.phone}`);
    if (context.checkout.email) lines.push(`• Email: ${context.checkout.email}`);
    return `Perfeito 💜 Aqui vai a revisão do seu pedido até agora:\n\n${lines.join('\n')}\n\nSe estiver tudo certo, me responde *ok* que eu sigo para o próximo passo.`;
  }

  if (stageNow === 'handoff_ready') {
    return 'Perfeito amore 💜 Seu pedido já ficou pronto para o próximo passo do atendimento. Vou encaminhar isso certinho agora.';
  }

  return '';
}

module.exports = {
  applyCheckoutState,
  buildCheckoutReply,
  extractFullName,
  extractPhoneOrEmail,
  extractDeliveryMode,
  extractAddress,
};
