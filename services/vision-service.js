const fs = require('fs');
const path = require('path');

function loadEnvFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return;
    const text = fs.readFileSync(filePath, 'utf8');
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const match = line.match(/^export\s+([A-Za-z_][A-Za-z0-9_]*)=(.*)$/) || line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;
      const key = match[1];
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  } catch (err) {
    console.warn('[vision-service] failed loading env file', filePath, err.message);
  }
}

function ensureVisionEnv() {
  if (process.env.OPENAI_API_KEY) return;
  loadEnvFile('/home/maxwel/.config/cleo/env.d/openai.env');
  loadEnvFile(path.join(process.env.HOME || '', '.config/cleo/env.d/openai.env'));
}

async function describeProductImage({ imageUrl, customerText = '', conversationContext = '' }) {
  ensureVisionEnv();
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not configured');
  }
  if (!imageUrl) {
    throw new Error('imageUrl is required');
  }

  const prompt = [
    'Você está analisando uma imagem enviada por cliente para atendimento comercial de uma boutique de lingerie/sexshop.',
    'Responda somente JSON válido.',
    'Campos obrigatórios:',
    '{',
    '  "category_guess": string,',
    '  "product_type_guess": string,',
    '  "style_tags": string[],',
    '  "confidence": number,',
    '  "short_description": string,',
    '  "commercial_next_step": string',
    '}',
    'Use category_guess com valores curtos como: lingerie, vibrador, fantasia, cosmético_sensual, higiene_intima, clareador, lubrificante, acessório, desconhecido.',
    'Use product_type_guess com algo curto e prático como: baby-doll, camisola, body, conjunto, bullet, rabbit, gel excitante, sabonete íntimo etc.',
    'confidence deve ser de 0 a 1.',
    customerText ? `Texto da cliente: ${customerText}` : 'Texto da cliente: (vazio)',
    conversationContext ? `Contexto da conversa: ${conversationContext}` : 'Contexto da conversa: (vazio)'
  ].join('\n');

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4.1-mini',
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: prompt },
            { type: 'input_image', image_url: imageUrl }
          ]
        }
      ]
    })
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`vision upstream ${response.status}: ${text.slice(0, 500)}`);
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch (err) {
    throw new Error(`vision non-json response: ${text.slice(0, 500)}`);
  }

  const outputText = Array.isArray(payload.output)
    ? payload.output.flatMap(item => Array.isArray(item.content) ? item.content : []).find(item => item.type === 'output_text')?.text
    : payload.output_text;

  if (!outputText) {
    return { raw: payload, parsed: null };
  }

  try {
    return { raw: payload, parsed: JSON.parse(outputText) };
  } catch (err) {
    return { raw: payload, parsed: null, outputText };
  }
}

module.exports = { describeProductImage };
