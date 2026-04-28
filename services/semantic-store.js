const fs = require('fs');
const path = require('path');

const DEFAULT_SEMANTIC_JSON_PATHS = [
  process.env.CLEO_SEMANTIC_JSON_PATH,
  '/home/maxwel/.openclaw/media/inbound/Cleo_Base_Semantica_Supabase---0d70b363-7fdf-44a5-a0da-ebd31b1b99d2.json',
  '/home/maxwel/.openclaw/media/inbound/Cleo_Base_Semantica_Supabase---fc8820b2-7e8e-4830-b51c-107fa93b4d43.json',
].filter(Boolean);

let semanticCache = null;
let resolvedSemanticPath = null;

function normalizeText(text = '') {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function resolveSemanticJsonPath() {
  if (resolvedSemanticPath) return resolvedSemanticPath;
  const found = DEFAULT_SEMANTIC_JSON_PATHS.find((candidate) => candidate && fs.existsSync(candidate));
  resolvedSemanticPath = found || null;
  return resolvedSemanticPath;
}

function loadSemanticBase() {
  if (semanticCache) return semanticCache;
  const semanticPath = resolveSemanticJsonPath();
  if (!semanticPath) {
    semanticCache = { intents: [], products: [], synonyms: [] };
    return semanticCache;
  }
  const raw = fs.readFileSync(semanticPath, 'utf8');
  const parsed = JSON.parse(raw);
  semanticCache = parsed;
  return semanticCache;
}

function getAllIntents() {
  return Array.isArray(loadSemanticBase().intents) ? loadSemanticBase().intents : [];
}

function getAllProducts() {
  return Array.isArray(loadSemanticBase().products) ? loadSemanticBase().products : [];
}

function getAllSynonyms() {
  return Array.isArray(loadSemanticBase().synonyms) ? loadSemanticBase().synonyms : [];
}

function inferIntentsFromText(text = '', limit = 6) {
  const normalized = normalizeText(text);
  if (!normalized) return [];

  const scores = new Map();

  for (const intent of getAllIntents()) {
    const bag = [
      intent.id,
      intent.label,
      ...(Array.isArray(intent.synonyms) ? intent.synonyms : []),
      ...(Array.isArray(intent.example_questions) ? intent.example_questions : []),
    ].map(normalizeText).filter(Boolean);

    let score = 0;
    for (const term of bag) {
      if (!term) continue;
      if (normalized === term) score += 10;
      else if (normalized.includes(term)) score += Math.min(8, Math.max(2, term.split(/\s+/).length + 1));
      else if (term.includes(normalized) && normalized.length >= 4) score += 1;
    }

    if (score > 0) scores.set(intent.id, (scores.get(intent.id) || 0) + score);
  }

  for (const synonymRow of getAllSynonyms()) {
    const term = normalizeText(synonymRow.term || '');
    if (!term || !normalized.includes(term)) continue;
    const intents = Array.isArray(synonymRow.intents) ? synonymRow.intents : [];
    for (const intentId of intents) {
      scores.set(intentId, (scores.get(intentId) || 0) + 6);
    }
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([intentId, score]) => ({
      intent_id: intentId,
      score,
      intent: getAllIntents().find((item) => item.id === intentId) || null,
    }));
}

function scoreProductBySemanticFit(product = {}, normalizedQuery = '', intentIds = []) {
  const bag = [
    product.name,
    product.short_description,
    product.full_description,
    product.cleo_reply_template,
    product.semantic_blob,
    ...(Array.isArray(product.keywords) ? product.keywords : []),
    ...(Array.isArray(product.slang_aliases) ? product.slang_aliases : []),
    ...(Array.isArray(product.intents) ? product.intents : []),
  ].map(normalizeText).filter(Boolean);

  let score = 0;
  for (const chunk of bag) {
    if (!chunk) continue;
    if (normalizedQuery && chunk.includes(normalizedQuery)) score += 8;
    for (const token of normalizedQuery.split(/\s+/).filter(Boolean)) {
      if (token.length < 2) continue;
      if (chunk.includes(token)) score += 1;
    }
  }

  const productIntents = Array.isArray(product.intents) ? product.intents : [];
  for (const intentId of intentIds) {
    if (productIntents.includes(intentId)) score += 10;
  }

  if ((Array.isArray(product.visibility) ? product.visibility : []).includes('visible')) score += 2;
  return score;
}

function searchSemanticProducts({ text = '', intentIds = [], limit = 5, visibleFirst = true } = {}) {
  const normalizedQuery = normalizeText(text);
  const products = getAllProducts();

  return products
    .map((product) => ({
      product,
      score: scoreProductBySemanticFit(product, normalizedQuery, intentIds),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (visibleFirst) {
        const aVisible = (Array.isArray(a.product.visibility) ? a.product.visibility : []).includes('visible') ? 1 : 0;
        const bVisible = (Array.isArray(b.product.visibility) ? b.product.visibility : []).includes('visible') ? 1 : 0;
        if (aVisible !== bVisible) return bVisible - aVisible;
      }
      return b.score - a.score;
    })
    .slice(0, limit)
    .map((entry) => ({
      id: entry.product.id,
      name: entry.product.name,
      intents: Array.isArray(entry.product.intents) ? entry.product.intents : [],
      benefits: Array.isArray(entry.product.benefits) ? entry.product.benefits : [],
      cleo_reply_template: entry.product.cleo_reply_template || '',
      upsell_suggestions: Array.isArray(entry.product.upsell_suggestions) ? entry.product.upsell_suggestions : [],
      short_description: entry.product.short_description || '',
      full_description: entry.product.full_description || '',
      related_questions: Array.isArray(entry.product.related_questions) ? entry.product.related_questions : [],
      price_min_usd: entry.product.price_min_usd ?? null,
      price_max_usd: entry.product.price_max_usd ?? null,
      visibility: Array.isArray(entry.product.visibility) ? entry.product.visibility : [],
      semantic_score: entry.score,
      audience: entry.product.audience || '',
      slang_aliases: Array.isArray(entry.product.slang_aliases) ? entry.product.slang_aliases : [],
      keywords: Array.isArray(entry.product.keywords) ? entry.product.keywords : [],
    }));
}

function buildSemanticContext(text = '') {
  const intents = inferIntentsFromText(text, 6);
  const intentIds = intents.map((item) => item.intent_id);
  const products = searchSemanticProducts({ text, intentIds, limit: 5, visibleFirst: true });

  return {
    text,
    intent_candidates: intents,
    intent_ids: intentIds,
    products,
  };
}

module.exports = {
  loadSemanticBase,
  inferIntentsFromText,
  searchSemanticProducts,
  buildSemanticContext,
};
