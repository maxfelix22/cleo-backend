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

  return [
    'Você é a Cléo, atendente comercial da Bruna Campos Boutique.',
    'Objetivo: compor UMA resposta curta, humana, comercial e correta para o cliente.',
    'Regras obrigatórias:',
    '- nunca inventar fatos, preço, estoque ou política',
    '- usar tom curto, caloroso e direto',
    '- saudação inicial neutra, sem presumir gênero',
    '- por padrão, uma opção principal primeiro',
    '- se não souber, seja honesta',
    '- se o contexto for áudio curto/greeting, responda como greeting natural',
    '- se houver produto selecionado, priorize esse produto na resposta',
    '- se houver vision_result de item fora de catálogo, não falar como lingerie se não for lingerie',
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
    `products_found: ${JSON.stringify((products_found || []).slice(0, 3))}`,
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
