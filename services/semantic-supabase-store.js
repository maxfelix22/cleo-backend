const { hasSupabaseConfig, supabaseRequest } = require('./supabase-client');
const { inferIntentsFromText, searchSemanticProducts } = require('./semantic-store');

function normalizeText(text = '') {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function quote(value = '') {
  return encodeURIComponent(String(value || ''));
}

async function fetchProductsByIntentIds(intentIds = [], limit = 5) {
  const ids = Array.isArray(intentIds) ? intentIds.filter(Boolean) : [];
  if (!hasSupabaseConfig() || ids.length === 0) return [];

  const orFilters = ids.map((id) => `intents.cs.{${id}}`).join(',');
  const path = `/rest/v1/products?select=id,name,intents,benefits,cleo_reply_template,upsell_suggestions,short_description,full_description,related_questions,price_min_usd,price_max_usd,visibility,audience,slang_aliases,keywords&or=(${orFilters})&limit=${Number(limit || 5)}`;
  const rows = await supabaseRequest(path);
  return Array.isArray(rows) ? rows : [];
}

async function fetchProductsBySynonymText(text = '', limit = 5) {
  const normalized = normalizeText(text);
  if (!hasSupabaseConfig() || !normalized) return [];

  const synonymRows = await supabaseRequest(`/rest/v1/synonyms?select=term,intents&limit=200`);
  const matchedIntentIds = new Set();
  for (const row of Array.isArray(synonymRows) ? synonymRows : []) {
    const term = normalizeText(row.term || '');
    if (!term || !normalized.includes(term)) continue;
    for (const intentId of Array.isArray(row.intents) ? row.intents : []) {
      matchedIntentIds.add(intentId);
    }
  }

  if (matchedIntentIds.size === 0) return [];
  return fetchProductsByIntentIds([...matchedIntentIds], limit);
}

function mergeProducts(primary = [], secondary = [], limit = 5) {
  const merged = [];
  const seen = new Set();
  for (const product of [...primary, ...secondary]) {
    const key = String(product?.id || '').trim() || String(product?.name || '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(product);
    if (merged.length >= limit) break;
  }
  return merged;
}

async function buildSemanticContextSupabase(text = '', limit = 5) {
  const localIntentCandidates = inferIntentsFromText(text, 6);
  const localIntentIds = localIntentCandidates.map((item) => item.intent_id);

  if (!hasSupabaseConfig()) {
    return {
      source: 'local-fallback-no-supabase',
      text,
      intent_candidates: localIntentCandidates,
      intent_ids: localIntentIds,
      products: searchSemanticProducts({ text, intentIds: localIntentIds, limit, visibleFirst: true }),
    };
  }

  try {
    const byIntent = await fetchProductsByIntentIds(localIntentIds, limit);
    const bySynonym = await fetchProductsBySynonymText(text, limit);
    const merged = mergeProducts(byIntent, bySynonym, limit);

    return {
      source: 'supabase-intent-synonym',
      text,
      intent_candidates: localIntentCandidates,
      intent_ids: localIntentIds,
      products: merged,
    };
  } catch (err) {
    return {
      source: 'local-fallback-supabase-error',
      error: err.message,
      text,
      intent_candidates: localIntentCandidates,
      intent_ids: localIntentIds,
      products: searchSemanticProducts({ text, intentIds: localIntentIds, limit, visibleFirst: true }),
    };
  }
}

module.exports = {
  buildSemanticContextSupabase,
};
