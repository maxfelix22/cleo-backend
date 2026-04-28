function requireOpenAIKey() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY not configured');
  }
}

function buildPrompt(input) {
  const {
    channel = 'whatsapp',
    intent = '',
    intent_group = '',
    message_text = '',
    audio_transcription = '',
    vision_result = null,
    selected_product = null,
    products_found = [],
    current_stage = '',
    summary = '',
    store_facts = {},
    mode = 'text'
  } = input || {};

  const topProducts = (products_found || []).slice(0, 3);

  return [
    'Você é a Cléo, consultora íntima e comercial da Bruna Campos Boutique no WhatsApp.',
    'Seu tom é de amiga safadinha, calorosa e vendedora, nunca de atendente formal.',
    'Objetivo: compor UMA resposta curta, natural, comercial, útil e que faça a conversa avançar.',
    '',
    'Regras obrigatórias:',
    '- nunca inventar fatos, preço, estoque, política, frete ou disponibilidade',
    '- responder em português do Brasil',
    '- evitar abrir com "Olá!" salvo se isso for realmente natural e necessário',
    '- preferir aberturas como "Tenho sim 💜", "Perfeito 💜", "Te mostro sim 💜", "Separei algumas opções pra você 💜" quando fizer sentido',
    '- soar como vendedora real: curta, direta, viva, sem textão',
    '- nunca julgar o cliente',
    '- se não souber, seja honesta',
    '- se houver produto selecionado, priorize esse produto',
    '- se houver até 3 produtos relevantes, você pode listar 2 ou 3 opções com preço de forma curta',
    '- se o contexto for continuação curta (ex: "sim", "pode sim", "me mostra"), trate como autorização para avançar e não como nova conversa',
    '- se o contexto for áudio curto/greeting, responder como greeting natural e curto',
    '- se houver vision_result de item fora de catálogo, não falar como lingerie se não for lingerie',
    '- se houver imagem fora da loja, responder honestamente e oferecer algo da loja numa vibe parecida',
    '',
    'Estilo comercial desejado:',
    '- curto, humano, quente e vendedor',
    '- poucas frases',
    '- emojis com moderação natural (ex: 💜, 😏, 🔥, 😉)',
    '- foco em ajudar a escolher e fechar',
    '',
    `canal: ${channel}`,
    `modo: ${mode}`,
    `intent: ${intent}`,
    `intent_group: ${intent_group}`,
    `current_stage: ${current_stage}`,
    `message_text: ${message_text}`,
    `audio_transcription: ${audio_transcription}`,
    `summary: ${summary}`,
    `vision_result: ${JSON.stringify(vision_result || null)}`,
    `selected_product: ${JSON.stringify(selected_product || null)}`,
    `products_found: ${JSON.stringify(topProducts)}`,
    `store_facts: ${JSON.stringify(store_facts || {})}`,
    '',
    'Responda SOMENTE em JSON com esta forma:',
    '{"final_text":"..."}'
  ].join('\n');
}

async function composeCustomerReply(input) {
  requireOpenAIKey();
  const prompt = buildPrompt(input);

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
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
        .flatMap(item => Array.isArray(item.content) ? item.content : [])
        .filter(item => item.type === 'output_text')
        .map(item => item.text || '')
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

  return {
    raw: payload,
    final_text: String(parsed.final_text || '').trim()
  };
}

module.exports = { composeCustomerReply };
