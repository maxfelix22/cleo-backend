const { hasSupabaseConfig, supabaseRequest } = require('./supabase-client');

function normalizeText(text = '') {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function scoreChunk(chunk = {}, normalizedQuery = '', intentIds = [], productNames = []) {
  const content = normalizeText(chunk.content || '');
  const question = normalizeText(chunk.question || '');
  let score = 0;

  for (const token of normalizedQuery.split(/\s+/).filter(Boolean)) {
    if (token.length < 2) continue;
    if (content.includes(token)) score += 1;
    if (question.includes(token)) score += 2;
  }

  for (const intentId of intentIds) {
    if ((Array.isArray(chunk.intent_ids) ? chunk.intent_ids : []).includes(intentId)) score += 6;
  }

  for (const name of productNames) {
    const normalizedName = normalizeText(name);
    if (!normalizedName) continue;
    if (normalizeText(chunk.product_name || '') === normalizedName) score += 8;
    else if (content.includes(normalizedName)) score += 4;
  }

  if ((Array.isArray(chunk.risk_flags) ? chunk.risk_flags : []).length > 0) score -= 3;
  return score;
}

async function searchCleoKb({ text = '', intentIds = [], productNames = [], limit = 8 } = {}) {
  if (!hasSupabaseConfig()) return [];
  const normalizedQuery = normalizeText(text);
  if (!normalizedQuery && (!Array.isArray(intentIds) || intentIds.length === 0)) return [];

  const rows = await supabaseRequest(`/rest/v1/cleo_kb_chunks?select=source,chunk_type,product_id,product_name,sku,topic,question,audience,intent_ids,upsell_suggestions,response_styles,content,risk_flags,importance,active&active=is.true&limit=300`);
  const ranked = (Array.isArray(rows) ? rows : [])
    .map((row) => ({ row, score: scoreChunk(row, normalizedQuery, intentIds, productNames) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => ({ ...entry.row, semantic_score: entry.score }));

  return ranked;
}

function buildKBSnippets(chunks = [], limit = 6) {
  return (Array.isArray(chunks) ? chunks : [])
    .slice(0, limit)
    .map((chunk) => ({
      product_name: chunk.product_name || '',
      topic: chunk.topic || '',
      question: chunk.question || '',
      response_styles: chunk.response_styles || {},
      risk_flags: Array.isArray(chunk.risk_flags) ? chunk.risk_flags : [],
      content: String(chunk.content || '').slice(0, 1200),
      semantic_score: chunk.semantic_score || 0,
    }));
}

module.exports = {
  searchCleoKb,
  buildKBSnippets,
};
