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

const CONVERSATION_MOVES = new Set([
  'discover',
  'disambiguate_product',
  'confirm_quantity',
  'choose_delivery',
  'collect_pickup_schedule',
  'collect_customer_info',
  'review_order',
  'answer_question',
  'support'
]);

const MISSING_FIELDS = new Set([
  'product',
  'quantity',
  'delivery_mode',
  'pickup_schedule',
  'full_name',
  'phone',
  'email',
  'address',
  'none'
]);

function normalizeEnum(value, allowed, fallback, aliases = {}) {
  const normalized = String(value || '').trim();
  if (allowed.has(normalized)) return normalized;
  if (aliases && Object.prototype.hasOwnProperty.call(aliases, normalized)) {
    const mapped = aliases[normalized];
    return allowed.has(mapped) ? mapped : fallback;
  }
  return fallback;
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
    review_ready: Boolean(checkout?.review_ready),
    full_name: String(checkout?.full_name || '').trim(),
    phone: String(checkout?.phone || '').trim(),
    email: String(checkout?.email || '').trim(),
    address: String(checkout?.address || '').trim(),
    pickup_schedule: String(checkout?.pickup_schedule || '').trim()
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
    customer_signal = '',
    cleo_kb_snippets = []
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
    'Você é a Cléo, consultora comercial da Bruna Campos Boutique no WhatsApp.',
    'Você não é um classificador nem um robô de atendimento. Você é a voz principal da conversa e deve soar como uma vendedora real, quente, segura, espontânea e comercialmente inteligente.',
    'Nesta fase o sistema está em TESTE e CONSTRUÇÃO. Então prefira liberdade comercial e fluidez humana sempre que isso não violar fatos operacionais reais.',
    '',
    'Sua missão neste turno:',
    '- entender o que a cliente quer de verdade, mesmo quando ela fala curto, solto ou ambíguo',
    '- decidir a próxima jogada comercial mais útil',
    '- responder de forma humana, natural, viva, sedutora na medida certa e nada robótica',
    '- conduzir a conversa como uma boa vendedora: com iniciativa, leitura de contexto, leveza e intenção de fechar',
    '- quando já houver contexto suficiente, avançar sem pedir licença o tempo todo',
    '- quando a cliente já quiser comprar, assumir a venda e puxar o checkout com naturalidade',
    '- usar os candidatos semânticos, templates comerciais e snippets da cleo_kb como repertório vivo, não como script engessado',
    '',
    'Liberdade desejada:',
    '- você pode variar fraseado, abertura, ritmo e microcopy',
    '- você pode soar mais conversacional e menos protocolar',
    '- você pode vender de forma mais orgânica, com opinião, sugestão e condução',
    '- você não precisa repetir estruturas fixas se houver jeito mais natural de dizer a mesma coisa',
    '',
    'Âncoras operacionais que continuam obrigatórias:',
    '- nunca inventar fatos, preço, estoque, política, frete ou disponibilidade',
    '- responder em português do Brasil',
    '- nunca julgar a cliente',
    '- se a cliente já estiver em checkout, não voltar para discovery à toa',
    '- se faltar só um dado operacional obrigatório, pedir apenas o próximo dado necessário',
    '- se já houver item + quantidade + logística + identificação mínima, priorizar revisão curta e fechamento',
    '- em pagamentos via Zelle, nunca prometer link; usar apenas o número/nome oficiais vindos da camada operacional e pedir comprovante',
    '- comprovante de pagamento não significa pagamento confirmado automaticamente; ao receber comprovante, reconhecer o envio e informar que vai conferir antes de confirmar',
    '- nunca trate snippets contaminados como verdade de catálogo; preço/estoque/fato operacional continuam vindo das camadas oficiais',
    '',
    'Heurísticas de boa voz:',
    '- evitar abrir com "Olá!" como padrão',
    '- preferir tom vivo, íntimo, comercial e confiante',
    '- variar naturalmente entre aberturas como "Tenho sim 💜", "Perfeito 💜", "Te mostro sim 💜", "Fechado 💜" e outras equivalentes quando fizer sentido',
    '- evitar cara de formulário, script duro, checklist aparecendo ou resposta burocrática',
    '- quando houver boa intuição comercial, responder já com direção, e não só com classificação fria',
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
    `cleo_kb_snippets: ${JSON.stringify(Array.isArray(cleo_kb_snippets) ? cleo_kb_snippets.slice(0, 6) : [])}`,
    '',
    'Responda SOMENTE em JSON com esta forma. Não trate isso como prova escolar; use o mínimo de estrutura necessária para preservar estado e deixe a naturalidade viver no final_text:',
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
    '  "extracted_state": {',
    '    "selected_product_id": "",',
    '    "selected_product_name": "",',
    '    "selected_quantity": null,',
    '    "delivery_mode": "",',
    '    "pickup_schedule": "",',
    '    "full_name": "",',
    '    "phone": "",',
    '    "email": "",',
    '    "address": "",',
    '    "conversation_move": "discover|disambiguate_product|confirm_quantity|choose_delivery|collect_pickup_schedule|collect_customer_info|review_order|answer_question|support",',
    '    "missing_fields": [],',
    '    "needs_disambiguation": false,',
    '    "should_review": false,',
    '    "confidence": 0',
    '  },',
    '  "assistant_notes": "",',
    '  "final_text": "..."',
    '}',
    '',
    'Importante:',
    '- o campo mais importante é final_text: ele deve soar humano, comercial e natural',
    '- os outros campos existem para preservar estado, não para engessar sua voz',
    '- se ficar em dúvida entre duas taxonomias internas parecidas, escolha a mais próxima e priorize um final_text excelente',
    '',
    'Extração operacional:',
    '- use extracted_state para registrar o que a cliente já definiu no turno atual, mesmo em linguagem natural',
    '- se a cliente disser "retirada", marcar delivery_mode = "pickup"',
    '- se a cliente informar nome, preencher full_name',
    '- se a cliente informar dia/horário de retirada, preencher pickup_schedule',
    '- se houver múltiplos produtos possíveis e a cliente não deixou claro qual quer, marcar needs_disambiguation = true',
    '- missing_fields deve listar só os campos realmente faltantes para concluir o próximo passo',
    '- conversation_move deve refletir a próxima jogada operacional/comercial, não só a intenção geral',
    '- should_review = true apenas quando o pedido já estiver maduro para revisão/resumo',
    '- confidence vai de 0 a 1'
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
      model: process.env.CLEO_COMPOSE_MODEL || 'gpt-4.1-mini',
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
    reply_mode: normalizeEnum(parsed.reply_mode, REPLY_MODES, 'answer', {
      greet: 'answer',
      greeting: 'answer',
      reply: 'answer',
      respond: 'answer',
      offer: 'show_options',
      options: 'show_options',
      continue: 'continue_offer',
      close: 'close_sale',
      checkout: 'checkout_next',
      visual: 'visual_reply',
      clarify_product: 'clarify'
    }),
    conversation_goal: normalizeEnum(parsed.conversation_goal, CONVERSATION_GOALS, 'discover', {
      greeting: 'support',
      general: 'support',
      sales: 'sell',
      sale: 'sell',
      purchase: 'checkout',
      closing: 'checkout'
    }),
    pending_offer_type: normalizeEnum(parsed.pending_offer_type, PENDING_OFFER_TYPES, 'none', {
      options: 'show_options',
      shortlist: 'show_options',
      product_choice: 'confirm_item',
      quantity_choice: 'confirm_qty',
      delivery: 'choose_delivery',
      customer_info: 'get_customer_info',
      review: 'review_order'
    }),
    expected_next_user_move: normalizeEnum(parsed.expected_next_user_move, EXPECTED_NEXT_USER_MOVES, 'none', {
      reply: 'inform',
      answer: 'inform',
      send_info: 'inform',
      choose_option: 'choose',
      confirm_payment: 'pay'
    }),
    last_seller_question: String(parsed.last_seller_question || '').trim(),
    anchor_products: anchorProducts,
    should_update_cart: Boolean(parsed.should_update_cart),
    cart_updates: parsed.cart_updates && typeof parsed.cart_updates === 'object'
      ? {
          action: normalizeEnum(parsed.cart_updates.action, CART_ACTIONS, 'none', {
            select: 'set_selection',
            select_item: 'set_selection',
            choose_item: 'set_selection',
            add: 'add_item',
            add_to_cart: 'add_item',
            change_quantity: 'update_quantity',
            set_quantity: 'update_quantity'
          }),
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
    extracted_state: parsed.extracted_state && typeof parsed.extracted_state === 'object'
      ? {
          selected_product_id: String(parsed.extracted_state.selected_product_id || '').trim(),
          selected_product_name: String(parsed.extracted_state.selected_product_name || '').trim(),
          selected_quantity: parsed.extracted_state.selected_quantity == null ? null : Number(parsed.extracted_state.selected_quantity),
          delivery_mode: String(parsed.extracted_state.delivery_mode || '').trim(),
          pickup_schedule: String(parsed.extracted_state.pickup_schedule || '').trim(),
          full_name: String(parsed.extracted_state.full_name || '').trim(),
          phone: String(parsed.extracted_state.phone || '').trim(),
          email: String(parsed.extracted_state.email || '').trim(),
          address: String(parsed.extracted_state.address || '').trim(),
          conversation_move: normalizeEnum(parsed.extracted_state.conversation_move, CONVERSATION_MOVES, 'discover', {
            greeting: 'answer_question',
            answer: 'answer_question',
            sell: 'discover',
            close: 'review_order',
            delivery: 'choose_delivery',
            pickup: 'collect_pickup_schedule',
            customer_info: 'collect_customer_info',
            review: 'review_order'
          }),
          missing_fields: (Array.isArray(parsed.extracted_state.missing_fields) ? parsed.extracted_state.missing_fields : [])
            .map((item) => String(item || '').trim())
            .filter((item) => MISSING_FIELDS.has(item)),
          needs_disambiguation: Boolean(parsed.extracted_state.needs_disambiguation),
          should_review: Boolean(parsed.extracted_state.should_review),
          confidence: Number(parsed.extracted_state.confidence || 0)
        }
      : {
          selected_product_id: '',
          selected_product_name: '',
          selected_quantity: null,
          delivery_mode: '',
          pickup_schedule: '',
          full_name: '',
          phone: '',
          email: '',
          address: '',
          conversation_move: 'discover',
          missing_fields: [],
          needs_disambiguation: false,
          should_review: false,
          confidence: 0
        },
    assistant_notes: String(parsed.assistant_notes || '').trim(),
    final_text: String(parsed.final_text || '').trim()
  };
}

module.exports = { composeCustomerReply };
