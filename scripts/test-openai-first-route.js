#!/usr/bin/env node
const path = require('path');
const fs = require('fs');

const workspaceRoot = path.resolve(__dirname, '..', '..');
const envDir = path.join(process.env.HOME || '', '.config', 'cleo', 'env.d');
if (fs.existsSync(envDir)) {
  for (const file of fs.readdirSync(envDir)) {
    if (!file.endsWith('.env')) continue;
    const fullPath = path.join(envDir, file);
    const lines = fs.readFileSync(fullPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (!(key in process.env)) process.env[key] = value;
    }
  }
}

if (!process.env.OPENAI_API_KEY) {
  process.env.OPENAI_API_KEY = 'test-openai-key';
}

const composeService = require('../services/compose-service');
composeService.composeCustomerReply = async function composeCustomerReplyStub(input = {}) {
  const text = String(input.message_text || '').trim().toLowerCase();
  const anchors = Array.isArray(input.conversation_state?.anchor_products) ? input.conversation_state.anchor_products : [];
  const selected = input.selected_product || anchors[0] || input.products_found?.[0] || null;
  const selectedName = selected?.name || '';
  const selectedId = selected?.id || '';

  if (/^sim$|^quero ver$|^me mostra$|^mostra aí$|^mostra ai$/.test(text)) {
    return {
      reply_mode: 'continue_offer',
      conversation_goal: 'sell',
      pending_offer_type: 'confirm_item',
      expected_next_user_move: 'choose',
      last_seller_question: 'Qual dessas opções faz mais sentido pra você?',
      anchor_products: input.products_found?.slice(0, 3) || anchors,
      should_update_cart: false,
      cart_updates: { action: 'none', quantity: null, selected_product_id: '', selected_product_name: '', variation: '' },
      checkout_updates: { delivery_mode: '', next_required_field: '', review_ready: false },
      assistant_notes: 'stub: continuation',
      final_text: 'Te mostro sim 💜 Separei algumas opções pra você e, se quiser, já seguimos na que fizer mais sentido.'
    };
  }

  if (/vou querer 2/.test(text)) {
    return {
      reply_mode: 'close_sale',
      conversation_goal: 'checkout',
      pending_offer_type: 'choose_delivery',
      expected_next_user_move: 'choose',
      last_seller_question: 'Você prefere pickup, entrega local ou USPS?',
      anchor_products: selected ? [selected] : anchors,
      should_update_cart: true,
      cart_updates: { action: 'set_selection', quantity: 2, selected_product_id: selectedId, selected_product_name: selectedName, variation: '' },
      checkout_updates: { delivery_mode: '', next_required_field: 'delivery_mode', review_ready: false },
      assistant_notes: 'stub: quantity purchase',
      final_text: `Fechado 💜 Separei 2x ${selectedName || 'desse item'} pra você.`
    };
  }

  if (/finalizar|me manda o total/.test(text)) {
    return {
      reply_mode: 'checkout_next',
      conversation_goal: 'checkout',
      pending_offer_type: 'review_order',
      expected_next_user_move: 'pay',
      last_seller_question: 'Se estiver tudo certo, me confirma para eu seguir.',
      anchor_products: selected ? [selected] : anchors,
      should_update_cart: false,
      cart_updates: { action: 'none', quantity: null, selected_product_id: '', selected_product_name: '', variation: '' },
      checkout_updates: { delivery_mode: '', next_required_field: 'customer_info', review_ready: true },
      assistant_notes: 'stub: finalize',
      final_text: 'Perfeito 💜 Agora eu só preciso confirmar os dados finais do pedido para seguir.'
    };
  }

  if (input.mode === 'image') {
    return {
      reply_mode: 'visual_reply',
      conversation_goal: 'sell',
      pending_offer_type: 'confirm_item',
      expected_next_user_move: 'confirm',
      last_seller_question: 'É essa linha que você quer ver?',
      anchor_products: input.products_found?.slice(0, 1) || anchors,
      should_update_cart: false,
      cart_updates: { action: 'none', quantity: null, selected_product_id: '', selected_product_name: '', variation: '' },
      checkout_updates: { delivery_mode: '', next_required_field: '', review_ready: false },
      assistant_notes: 'stub: visual',
      final_text: 'Tenho sim 💜 Se for essa linha, eu já te mostro a opção mais parecida que encontrei aqui.'
    };
  }

  return {
    reply_mode: 'show_options',
    conversation_goal: 'discover',
    pending_offer_type: 'show_options',
    expected_next_user_move: 'choose',
    last_seller_question: 'Quer que eu te mostre algumas opções?',
    anchor_products: input.products_found?.slice(0, 3) || anchors,
    should_update_cart: false,
    cart_updates: { action: 'none', quantity: null, selected_product_id: '', selected_product_name: '', variation: '' },
    checkout_updates: { delivery_mode: '', next_required_field: '', review_ready: false },
    assistant_notes: 'stub: discovery',
    final_text: selectedName
      ? `Tenho sim 💜 Separei algumas opções pra você nessa linha, inclusive *${selectedName}*.`
      : 'Tenho sim 💜 Separei algumas opções pra você nessa linha.'
  };
};

const openaiFirstRoute = require('../routes/openai-first');

function getRouteHandler(router, routePath) {
  const layer = router.stack.find((entry) => entry.route && entry.route.path === routePath && entry.route.methods.post);
  if (!layer) throw new Error(`Route not found: ${routePath}`);
  return layer.route.stack[0].handle;
}

function makeReq(body) {
  return { body };
}

function makeRes() {
  return {
    statusCode: 200,
    payload: null,
    json(data) {
      this.payload = data;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    }
  };
}

async function invoke(handler, body) {
  const req = makeReq(body);
  const res = makeRes();
  await new Promise((resolve, reject) => {
    const maybePromise = handler(req, res, (err) => (err ? reject(err) : resolve()));
    if (maybePromise && typeof maybePromise.then === 'function') {
      maybePromise.then(resolve).catch(reject);
    }
  });
  return res.payload;
}

function buildInbound({ from, body, profileName = 'Cliente Teste', numMedia = 0, mediaContentType0 = '', mediaUrl0 = '' }) {
  return {
    From: `whatsapp:${from}`,
    To: 'whatsapp:+14155238886',
    Body: body,
    ProfileName: profileName,
    MessageSid: `SM-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    NumMedia: numMedia,
    MediaContentType0: mediaContentType0,
    MediaUrl0: mediaUrl0,
  };
}

const scenarios = [
  {
    name: 'p0_discovery_to_continuation',
    phone: '+15550000001',
    steps: [
      buildInbound({ from: '+15550000001', body: 'tem lingerie?' }),
      buildInbound({ from: '+15550000001', body: 'sim' }),
      buildInbound({ from: '+15550000001', body: 'quero ver' }),
    ]
  },
  {
    name: 'p0_purchase_flow',
    phone: '+15550000002',
    steps: [
      buildInbound({ from: '+15550000002', body: 'tem algo pra libido feminina?' }),
      buildInbound({ from: '+15550000002', body: 'vou querer 2' }),
      buildInbound({ from: '+15550000002', body: 'finalizar' }),
      buildInbound({ from: '+15550000002', body: 'me manda o total' }),
    ]
  },
  {
    name: 'p0_visual_stub',
    phone: '+15550000003',
    steps: [
      buildInbound({ from: '+15550000003', body: 'vc tem esse produto?', numMedia: 1, mediaContentType0: 'image/jpeg', mediaUrl0: 'https://example.com/test-image.jpg' })
    ]
  }
];

async function main() {
  const handler = getRouteHandler(openaiFirstRoute, '/openai-first/whatsapp/inbound');
  const results = [];

  for (const scenario of scenarios) {
    const scenarioResult = { name: scenario.name, steps: [] };
    for (const step of scenario.steps) {
      const payload = await invoke(handler, step);
      scenarioResult.steps.push({
        inbound: step.Body,
        final_text: payload?.compose?.final_text || '',
        reply_mode: payload?.compose?.reply_mode || '',
        conversation_goal: payload?.compose?.conversation_goal || '',
        pending_offer_type: payload?.compose?.pending_offer_type || '',
        expected_next_user_move: payload?.compose?.expected_next_user_move || '',
        current_stage: payload?.context?.currentStage || '',
        cart: payload?.context?.cart || null,
        checkout: payload?.context?.checkout || null,
      });
    }
    results.push(scenarioResult);
  }

  console.log(JSON.stringify({ ok: true, results }, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err.message, stack: err.stack }, null, 2));
  process.exit(1);
});
