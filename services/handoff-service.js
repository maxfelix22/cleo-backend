function buildHandoffPayload(context = {}) {
  const product = context.lastProducts?.[0] || null;
  const checkout = context.checkout || {};
  const address = checkout.address || context.address || '';

  const customerMessage = String(context.lastInboundText || '').trim();
  const meaningfulCustomerMessage = /^(ok|okay|okey|sim|certo|fechado|isso)$/i.test(customerMessage)
    ? ''
    : customerMessage;

  return {
    handoff_ready: true,
    queue_status: 'handoff_sent',
    queue_stage: 'new_order',
    next_action: 'review_and_contact_customer',
    customer_message: meaningfulCustomerMessage,
    customer: {
      id: context.customerId || '',
      name: checkout.fullName || context.profileName || '',
    },
    conversation: {
      id: context.conversationId || '',
      current_stage: context.currentStage || '',
      summary: context.summary || '',
    },
    product: product ? {
      id: product.id || '',
      name: product.name || '',
      price: product.price || null,
      source: product.source || 'unknown',
      available_colors: product.availableColors || product.raw?.availableColors || [],
      available_sizes: product.variationDetails || product.raw?.variationDetails || [],
    } : null,
    checkout: {
      delivery_mode: checkout.deliveryMode || '',
      address,
      full_name: checkout.fullName || '',
      phone: checkout.phone || '',
      email: checkout.email || '',
      review_confirmed: !!checkout.reviewConfirmed,
    },
  };
}

function buildOperationalMessage(context = {}) {
  const payload = buildHandoffPayload(context);
  const lines = [
    '🛍️ *Novo pedido pronto para handoff*',
    '',
    payload.product?.name ? `• Produto: ${payload.product.name}` : '• Produto: não identificado',
    payload.product?.price ? `• Preço: ${payload.product.price}` : null,
    payload.checkout.delivery_mode === 'usps' ? '• Entrega: USPS' : null,
    payload.checkout.delivery_mode === 'pickup' ? '• Entrega: Retirada' : null,
    payload.checkout.delivery_mode === 'local_delivery' ? '• Entrega: Entrega local' : null,
    payload.checkout.address ? `• Endereço: ${payload.checkout.address}` : null,
    payload.checkout.full_name ? `• Nome: ${payload.checkout.full_name}` : '• Nome: não informado',
    payload.checkout.phone ? `• Telefone: ${payload.checkout.phone}` : null,
    payload.checkout.email ? `• Email: ${payload.checkout.email}` : null,
    Array.isArray(payload.product?.available_colors) && payload.product.available_colors.length > 0
      ? `• Cores vistas: ${payload.product.available_colors.join(', ')}`
      : null,
    Array.isArray(payload.product?.available_sizes) && payload.product.available_sizes.length > 0
      ? `• Tamanhos vistos: ${payload.product.available_sizes.map((item) => item.size || item.name).filter(Boolean).join(', ')}`
      : null,
    payload.customer_message ? `• Última msg cliente: ${payload.customer_message}` : null,
    payload.conversation.id ? `• Conversation ID: ${payload.conversation.id}` : null,
    '',
    `• Queue status: ${payload.queue_status}`,
    `• Next action: ${payload.next_action}`,
  ].filter(Boolean);

  return lines.join('\n');
}

module.exports = {
  buildHandoffPayload,
  buildOperationalMessage,
};
