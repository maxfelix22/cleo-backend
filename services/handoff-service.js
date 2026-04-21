function humanizeSnakeCase(value = '') {
  return String(value || '')
    .split('_')
    .filter(Boolean)
    .join(' ')
    .trim();
}

function buildOperationalPriority(payload = {}) {
  const deliveryMode = payload.checkout?.delivery_mode || '';
  const hasAddress = !!payload.checkout?.address;

  if (deliveryMode === 'local_delivery') {
    return {
      priority_code: 'high',
      priority_label: 'alta',
      operator_note: 'confirmar logística local e retorno rápido para a cliente',
    };
  }

  if (deliveryMode === 'usps' && hasAddress) {
    return {
      priority_code: 'medium',
      priority_label: 'média',
      operator_note: 'validar envio e seguir com confirmação do pedido',
    };
  }

  return {
    priority_code: 'normal',
    priority_label: 'normal',
    operator_note: 'revisar pedido e seguir atendimento humano quando necessário',
  };
}

function buildHandoffPayload(context = {}) {
  const product = context.lastProducts?.[0] || context.lastProductPayload || null;
  const checkout = context.checkout || {};
  const multiItems = Array.isArray(context.cart?.items) && context.cart.items.length > 0
    ? context.cart.items
    : (Array.isArray(checkout.multiItems) ? checkout.multiItems : []);
  const primaryCartItem = multiItems[0] || null;
  const address = checkout.address || context.address || '';

  const customerMessage = String(context.lastInboundText || '').trim().toLowerCase();
  const lowSignalMessages = new Set(['ok', 'okay', 'okey', 'sim', 'certo', 'fechado', 'isso']);
  const meaningfulCustomerMessage = lowSignalMessages.has(customerMessage)
    ? ''
    : String(context.lastInboundText || '').trim();

  const queueStatus = 'handoff_sent';
  const queueStage = 'new_order';
  const nextAction = 'review_and_contact_customer';

  const operationalPriority = buildOperationalPriority({
    checkout: {
      delivery_mode: checkout.deliveryMode || '',
      address,
    },
  });

  return {
    handoff_ready: true,
    queue_status: queueStatus,
    queue_status_label: humanizeSnakeCase(queueStatus),
    queue_stage: queueStage,
    queue_stage_label: humanizeSnakeCase(queueStage),
    next_action: nextAction,
    next_action_label: humanizeSnakeCase(nextAction),
    customer_message: meaningfulCustomerMessage,
    debug_customer_message_raw: String(context.lastInboundText || '').trim(),
    debug_customer_message_filtered: meaningfulCustomerMessage,
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
      name: product.name || primaryCartItem?.label || '',
      price: product.price || null,
      source: product.source || 'unknown',
      available_colors: product.availableColors || product.raw?.availableColors || [],
      available_sizes: product.variationDetails || product.raw?.variationDetails || [],
      ontology_family: primaryCartItem?.ontologyFamily || '',
      ontology_subfamilies: Array.isArray(primaryCartItem?.ontologySubfamilies) ? primaryCartItem.ontologySubfamilies : [],
    } : (primaryCartItem ? {
      id: '',
      name: primaryCartItem.label || '',
      price: null,
      source: 'cart',
      available_colors: [],
      available_sizes: [],
      ontology_family: primaryCartItem.ontologyFamily || '',
      ontology_subfamilies: Array.isArray(primaryCartItem.ontologySubfamilies) ? primaryCartItem.ontologySubfamilies : [],
    } : null),
    cart: {
      items: multiItems,
      items_count: multiItems.length,
      semantic_families: Array.isArray(context.cart?.semanticFamilies) ? context.cart.semanticFamilies : [],
      semantic_subfamilies: Array.isArray(context.cart?.semanticSubfamilies) ? context.cart.semanticSubfamilies : [],
    },
    checkout: {
      delivery_mode: checkout.deliveryMode || '',
      address,
      full_name: checkout.fullName || '',
      phone: checkout.phone || '',
      email: checkout.email || '',
      review_confirmed: !!checkout.reviewConfirmed,
      multi_item_text: checkout.multiItemText || '',
      multi_items: Array.isArray(checkout.multiItems) ? checkout.multiItems : [],
    },
    operational_priority: operationalPriority,
  };
}

function buildOperationalMessage(context = {}) {
  const payload = buildHandoffPayload(context);
  const lines = [
    '🛍️ *Novo pedido pronto para handoff*',
    '',
    Array.isArray(payload.cart?.items) && payload.cart.items.length > 0
      ? `• Pedido com ${payload.cart.items.length} item(ns)`
      : null,
    Array.isArray(payload.cart?.semantic_families) && payload.cart.semantic_families.length > 0
      ? `• Famílias do carrinho: ${payload.cart.semantic_families.join(', ')}`
      : null,
    Array.isArray(payload.cart?.semantic_subfamilies) && payload.cart.semantic_subfamilies.length > 0
      ? `• Subfamílias do carrinho: ${payload.cart.semantic_subfamilies.join(', ')}`
      : null,
    payload.product?.name ? `• Produto: ${payload.product.name}` : '• Produto: não identificado',
    payload.product?.price ? `• Preço: ${payload.product.price}` : null,
    payload.checkout.delivery_mode === 'usps' ? '• Entrega: USPS' : null,
    payload.checkout.delivery_mode === 'pickup' ? '• Entrega: Retirada' : null,
    payload.checkout.delivery_mode === 'local_delivery' ? '• Entrega: Entrega local' : null,
    payload.checkout.address ? `• Endereço: ${payload.checkout.address}` : null,
    payload.checkout.multi_item_text ? `• Pedido composto: ${payload.checkout.multi_item_text}` : null,
    Array.isArray(payload.checkout.multi_items) && payload.checkout.multi_items.length > 0
      ? `• Itens detectados: ${payload.checkout.multi_items.map((item) => {
          const tags = [
            item.commercialFamily || '',
            item.ontologyFamily || '',
            ...(Array.isArray(item.ontologySubfamilies) ? item.ontologySubfamilies : []),
          ].filter(Boolean);
          return `${item.quantity}x ${item.label}${tags.length ? ` [${Array.from(new Set(tags)).join(' | ')}]` : ''}`;
        }).join(', ')}`
      : null,
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
    payload.operational_priority?.priority_label ? `• Prioridade: ${payload.operational_priority.priority_label}` : null,
    payload.operational_priority?.operator_note ? `• Nota operacional: ${payload.operational_priority.operator_note}` : null,
    '',
    payload.queue_status_label ? `• Status: ${payload.queue_status_label}` : null,
    payload.queue_stage_label ? `• Etapa: ${payload.queue_stage_label}` : null,
    payload.next_action_label ? `• Próxima ação: ${payload.next_action_label}` : null,
  ].filter(Boolean);

  return lines.join('\n');
}

module.exports = {
  buildHandoffPayload,
  buildOperationalMessage,
};
