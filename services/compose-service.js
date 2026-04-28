function requireOpenAIKey() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY not configured');
  }
}

const REPLY_MODES = new Set([
  'answer',
  'show_options',
  'continue_offer',
  'close_sale',
  'checkout_next',
  'visual_reply',
  'clarify'
]);

const CONVERSATION_GOALS = new Set([
  'discover',
  'compare',
  'sell',
  'checkout',
  'support'
]);

const PENDING_OFFER_TYPES = new Set([
  'show_options',
  'confirm_item',
  'confirm_qty',
  'choose_delivery',
  'get_customer_info',
  'review_order',
  'none'
]);

const EXPECTED_NEXT_USER_MOVES = new Set([
  'confirm',
  'choose',
  'inform',
  'pay',
  'none'
]);

const CART_ACTIONS = new Set([
  'none',
  'set_selection',
  'add_item',
  'update_quantity'
]);

function normalizeEnum(value, allowed, fallback) {
  const normalized = String(value || '').trim();
  return allowed.has(normalized) ? normalized : fallback;
}

function normalizeProducts(products = [], max = 5) {
  return (Array.isArray(products) ? products : [])
    .filter(Boolean)
    .slice(0, max)
    .map((product) => ({
      id: product.id || '',
      name: product.name || '',
      price: product.price || product.price_min_usd || '',
      visibility: product.visibility || '',
      inventory_in_stock: product.inventory_in_stock,
      audience: product.audience || '',
      intents: Array.isArray(product.intents) ? product.intents : [],
      benefits: Array.isArray(product.benefits) ? product.benefits.slice(0, 5) : [],
      variationDetails: Array.isArray(product.variationDetails)
        ? product.variationDetails.slice(0, 10).map((variation) => ({
            label: variation.label || '',
            size: variation.size || '',
            color: variation.color || '',
            flavor: variation.flavor || '',
            inventory_in_stock: variation.inventory_in_stock,
            price: variation.price || ''
          }))
        : []
    }));
}

function normalizeAnchorProducts(anchorProducts = [], productsFound = [], selectedProduct = null) {
  if (Array.isArray(anchorProducts) && anchorProducts.length > 0) {
    return normalizeProducts(anchorProducts, 5);
  }

  const merged = [];
  if (selectedProduct) merged.push(selectedProduct);
  if (Array.isArray(productsFound)) merged.push(...productsFound);
  return normalizeProducts(merged, 5);
}

function normalizeCart(cart = {}) {
  const items = Array.isArray(cart?.items) ? cart.items : [];
  const subtotalRaw = cart?.subtotal ?? cart?.subtotal_usd ?? 0;
  return {
    itemsCount: Number(cart?.itemsCount || items.length || 0),
    subtotal: Number(subtotalRaw || 0),
    currency: String(cart?.currency || 'USD').trim(),
    items: items.slice(0, 10).map((item) => ({
      product_id: item.product_id || item.id || '',
      label: item.label || item.name || '',
      qty: Number(item.qty || item.quantity || 1),
      variation: item.variation || item.flavor || item.size || item.color || '',
      unit_price: item.unit_price || item.price || '',
      line_total: item.line_total || item.total || ''
    }))
  };
}

function normalizeCheckout(checkout = {}) {
  return {
    delivery_mode: String(checkout?.delivery_mode || '').trim(),
    next_required_field: String(checkout?.next_required_field || '').trim(),
    review_ready: Boolean(checkout?.review_ready)
  };
}

function normalizeConversationState(input = {}, anchorProducts = []) {
  const source = input?.conversation_state && typeof input.conversation_state === 'object'
    ? input.conversation_state
    : input;

  return {
    conversation_goal: String(source.conversation_goal || '').trim(),
    pending_offer_type: String(source.pending_offer_type || '').trim(),
    expected_next_user_move: String(source.expected_next_user_move || '').trim(),
    last_seller_question: String(source.last_seller_question || '').trim(),
    anchor_products: anchorProducts
  };
}

function buildPrompt(input) {
  const {
    channel = 'whatsapp',
    mode = 'text',
    message_text = '',
    summary = '',
    intent = '',
    intent_group = '',
    current_stage = '',
    audio_transcription = '',
    vision_result = null,
    selected_product = null,
    products_found = [],
    semantic_candidates = [],
    semantic_intent_candidates = [],
    cart = {},
    checkout = {},
    store_facts = {},
    business_rules = {},
    recent_messages = [],
    customer_signal = ''
  } = input || {};

  const topProducts = normalizeProducts(products_found, 5);
  const topSemanticCandidates = normalizeProducts(semantic_candidates, 5);
  const safeSelectedProduct = selected_product
    ? normalizeProducts([selected_product], 1)[0]
    : null;
  const anchorProducts = normalizeAnchorProducts(input?.anchor_products, topProducts, safeSelectedProduct);
  const safeCart = normalizeCart(cart);
  const safeCheckout = normalizeCheckout(checkout);
  const safeConversationState = normalizeConversationState(input, anchorProducts);

  return [
    'Você é a Cléo, consultora íntima e comercial da Bruna Campos Boutique no WhatsApp.',
    'Você é a camada PRINCIPAL de resposta da conversa. Pense como vendedora real e conduza a cliente até a próxima ação útil.',
    '',
    'Sua missão neste turno:',
    '- interpretar a mensagem atual no contexto da conversa',
    '- decidir a próxima jogada comercial certa',
    '- responder de forma curta, humana, natural e vendedora',
    '- quando já houver contexto suficiente, avançar em vez de repetir convite',
    '- quando a cliente já quiser comprar, assumir a venda e empurrar para checkout',
    '- usar os candidatos semânticos e templates comerciais como repertório principal de venda',
    '',
    'Regras obrigatórias:',
    '- nunca inventar fatos, preço, estoque, política, frete ou disponibilidade',
    '- responder em português do Brasil',
    '- evitar abrir com "Olá!" salvo necessidade real',
    '- preferir aberturas vivas como "Tenho sim 💜", "Perfeito 💜", "Te mostro sim 💜", "Fechado 💜", "Separei algumas opções pra você 💜" quando fizer sentido',
    '- soar como vendedora real: curta, direta, viva e natural',
    '- nunca julgar a cliente',
    '- se a cliente disser "sim", "me mostra", "mostra aí", "quero ver", tratar isso como continuação quando houver oferta ou pergunta pendente',
    '- se a cliente disser "quero comprar", "vou querer 2", "quero finalizar", "me manda o total", tratar isso como sinal de conversão e avançar checkout',
    '- se houver produto selecionado ou âncoras fortes, priorizar esses produtos',
    '- se houver candidatos semânticos fortes, usar nome, benefício e template deles para vender com mais precisão',
    '- se houver 2 ou 3 boas opções, você pode listar 2 ou 3 com preço',
    '- se o item visual estiver fora do catálogo, responder honestamente',
    '- se faltar só um dado operacional obrigatório, pedir apenas o próximo dado necessário',
    '- se a conversa já estiver em checkout, empurrar para o próximo campo ou revisão em vez de voltar para discovery',
    '- se a cliente pedir para finalizar ou pedir o total, pensar em modo checkout e não em modo descoberta',
    '- se o delivery_mode já estiver resolvido, não repetir a pergunta de entrega; avance para pickup_schedule, customer_info ou review',
    '',
    'Princípios de decisão:',
    '- discovery -> mostrar opção útil',
    '- shortlist -> já trazer opções com preço quando fizer sentido',
    '- continuação curta -> avançar o que estava pendente',
    '- preço -> responder preço real e conduzir',
    '- compra -> assumir item/quantidade e puxar entrega ou próximo campo do checkout',
    '- visual -> responder o item/produto da imagem e seguir a venda se possível',
    '- checkout -> empurrar a conversa para o próximo campo obrigatório',
    '- finalize/total -> revisar carrinho atual, consolidar pedido e levar para entrega/revisão',
    '- pickup já escolhido -> pedir dia/horário; depois nome completo; depois revisão',
    '',
    `canal: ${channel}`,
    `modo: ${mode}`,
    `intent: ${intent}`,
    `intent_group: ${intent_group}`,
    `current_stage: ${current_stage}`,
    `customer_signal: ${customer_signal}`,
    `message_text: ${message_text}`,
    `audio_transcription: ${audio_transcription}`,
    `summary: ${summary}`,
    `recent_messages: ${JSON.stringify(Array.isArray(recent_messages) ? recent_messages.slice(-8) : [])}`,
    `conversation_state: ${JSON.stringify(safeConversationState)}`,
    `vision_result: ${JSON.stringify(vision_result || null)}`,
    `selected_product: ${JSON.stringify(safeSelectedProduct || null)}`,
    `anchor_products: ${JSON.stringify(anchorProducts)}`,
    `products_found: ${JSON.stringify(topProducts)}`,
    `semantic_candidates: ${JSON.stringify(topSemanticCandidates)}`,
    `semantic_intent_candidates: ${JSON.stringify(Array.isArray(semantic_intent_candidates) ? semantic_intent_candidates.slice(0, 8) : [])}`,
    `cart: ${JSON.stringify(safeCart)}`,
    `checkout: ${JSON.stringify(safeCheckout)}`,
    `store_facts: ${JSON.stringify(store_facts || {})}`,
    `business_rules: ${JSON.stringify(business_rules || {})}`,
    '',
    'Responda SOMENTE em JSON com esta forma:',
    '{',
    '  "reply_mode": "answer|show_options|continue_offer|close_sale|checkout_next|visual_reply|clarify",',
    '  "conversation_goal": "discover|compare|sell|checkout|support",',
    '  "pending_offer_type": "show_options|confirm_item|confirm_qty|choose_delivery|get_customer_info|review_order|none",',
    '  "expected_next_user_move": "confirm|choose|inform|pay|none",',
    '  "last_seller_question": "",',
    '  "anchor_products": [],',
    '  "should_update_cart": true,',
    '  "cart_updates": {',
    '    "action": "none|set_selection|add_item|update_quantity",',
    '    "quantity": null,',
    '    "selected_product_id": "",',
    '    "selected_product_name": "",',
    '    "variation": ""',
    '  },',
    '  "checkout_updates": {',
    '    "delivery_mode": "",',
    '    "next_required_field": "",',
    '    "review_ready": false',
    '  },',
    '  "assistant_notes": ""',
    '  "final_text": "..."',
    '}'
  ].join('\n');
}

async function composeCustomerReply(input) {
  requireOpenAIKey();
  const prompt = buildPrompt(input);

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4.1-mini',
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: prompt }
          ]
        }
      ]
    })
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`compose upstream ${response.status}: ${text.slice(0, 500)}`);
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch (err) {
    throw new Error(`compose non-json response: ${text.slice(0, 500)}`);
  }

  const outputText = Array.isArray(payload.output)
    ? payload.output
        .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
        .filter((item) => item.type === 'output_text')
        .map((item) => item.text || '')
        .join('\n')
        .trim()
    : '';

  const cleaned = String(outputText || '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`compose invalid-json-output: ${cleaned.slice(0, 500)}`);
  }

  const anchorProducts = normalizeAnchorProducts(parsed.anchor_products, input?.products_found, input?.selected_product);

  return {
    raw: payload,
    reply_mode: normalizeEnum(parsed.reply_mode, REPLY_MODES, 'answer'),
    conversation_goal: normalizeEnum(parsed.conversation_goal, CONVERSATION_GOALS, 'discover'),
    pending_offer_type: normalizeEnum(parsed.pending_offer_type, PENDING_OFFER_TYPES, 'none'),
    expected_next_user_move: normalizeEnum(parsed.expected_next_user_move, EXPECTED_NEXT_USER_MOVES, 'none'),
    last_seller_question: String(parsed.last_seller_question || '').trim(),
    anchor_products: anchorProducts,
    should_update_cart: Boolean(parsed.should_update_cart),
    cart_updates: parsed.cart_updates && typeof parsed.cart_updates === 'object'
      ? {
          action: normalizeEnum(parsed.cart_updates.action, CART_ACTIONS, 'none'),
          quantity: parsed.cart_updates.quantity == null ? null : Number(parsed.cart_updates.quantity),
          selected_product_id: String(parsed.cart_updates.selected_product_id || '').trim(),
          selected_product_name: String(parsed.cart_updates.selected_product_name || '').trim(),
          variation: String(parsed.cart_updates.variation || '').trim()
        }
      : {
          action: 'none',
          quantity: null,
          selected_product_id: '',
          selected_product_name: '',
          variation: ''
        },
    checkout_updates: parsed.checkout_updates && typeof parsed.checkout_updates === 'object'
      ? {
          delivery_mode: String(parsed.checkout_updates.delivery_mode || '').trim(),
          next_required_field: String(parsed.checkout_updates.next_required_field || '').trim(),
          review_ready: Boolean(parsed.checkout_updates.review_ready)
        }
      : {
          delivery_mode: '',
          next_required_field: '',
          review_ready: false
        },
    assistant_notes: String(parsed.assistant_notes || '').trim(),
    final_text: String(parsed.final_text || '').trim()
  };
}

module.exports = { composeCustomerReply };
