function buildHandoffPayload(context = {}) {
  const product = context.lastProducts?.[0] || null;
  const checkout = context.checkout || {};

  return {
    handoff_ready: true,
    queue_status: 'handoff_sent',
    queue_stage: 'new_order',
    next_action: 'review_and_contact_customer',
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
    } : null,
    checkout: {
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
    payload.checkout.full_name ? `• Nome: ${payload.checkout.full_name}` : '• Nome: não informado',
    payload.checkout.phone ? `• Telefone: ${payload.checkout.phone}` : null,
    payload.checkout.email ? `• Email: ${payload.checkout.email}` : null,
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
