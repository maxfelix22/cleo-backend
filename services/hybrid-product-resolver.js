function normalizeText(text = '') {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function tokenSet(text = '') {
  return new Set(normalizeText(text).split(/\s+/).filter(Boolean));
}

function overlapScore(a = '', b = '') {
  const aSet = tokenSet(a);
  const bSet = tokenSet(b);
  if (aSet.size === 0 || bSet.size === 0) return 0;
  let score = 0;
  for (const token of aSet) {
    if (bSet.has(token)) score += 1;
  }
  return score;
}

function numericPrice(product = {}) {
  const fromPrice = Number(String(product.price || '').replace(/[^\d.]/g, '')) || 0;
  const min = Number(product.price_min_usd || 0) || 0;
  return fromPrice || min || 0;
}

function buildCanonicalRecord(product = {}, source = 'unknown') {
  return {
    ...product,
    source,
    id: product.id || '',
    name: product.name || '',
    intents: Array.isArray(product.intents) ? product.intents : [],
    benefits: Array.isArray(product.benefits) ? product.benefits : [],
    visibility: Array.isArray(product.visibility)
      ? product.visibility
      : (product.visibility ? [product.visibility] : []),
    price: product.price || (product.price_min_usd ? `$${Number(product.price_min_usd).toFixed(2)}` : ''),
    price_min_usd: product.price_min_usd ?? numericPrice(product) ?? null,
    inventory_in_stock: product.inventory_in_stock,
    variationDetails: Array.isArray(product.variationDetails) ? product.variationDetails : [],
  };
}

function scoreResolvedProduct(product = {}, { text = '', intentIds = [] } = {}) {
  const normalizedQuery = normalizeText(text);
  const name = normalizeText(product.name || '');
  const description = normalizeText(product.short_description || product.description || product.full_description || '');
  const source = String(product.source || '');
  const intents = Array.isArray(product.intents) ? product.intents : [];
  const visibility = Array.isArray(product.visibility) ? product.visibility : [];

  let score = 0;
  score += overlapScore(normalizedQuery, name) * 8;
  score += overlapScore(normalizedQuery, description) * 2;

  for (const intentId of intentIds) {
    if (intents.includes(intentId)) score += 14;
  }

  if (visibility.includes('visible')) score += 6;
  if (product.inventory_in_stock === true) score += 5;
  if (source === 'merged') score += 10;
  if (source === 'square') score += 4;
  if (source === 'supabase') score += 3;

  if (/rabbit/.test(normalizedQuery) && /rabbit/.test(name)) score += 15;
  if (/vibrador/.test(normalizedQuery) && /vibrador/.test(name)) score += 10;
  if (/anal/.test(normalizedQuery) && /anal/.test(name)) score += 10;
  if (/lingerie/.test(normalizedQuery) && /lingerie|body|camisola|baby doll/.test(name)) score += 10;
  if (/libido|tesao|tesão|vontade/.test(normalizedQuery) && /stimulus|tesao|xana loka|sedenta/.test(name)) score += 8;

  const price = numericPrice(product);
  if (price > 0 && price <= 25) score += 2;
  if (price > 0 && price <= 15) score += 1;

  return score;
}

function mergeOne(squareProduct = {}, semanticProduct = {}) {
  return buildCanonicalRecord({
    ...semanticProduct,
    ...squareProduct,
    id: squareProduct.id || semanticProduct.id || '',
    name: squareProduct.name || semanticProduct.name || '',
    intents: Array.isArray(semanticProduct.intents) && semanticProduct.intents.length > 0
      ? semanticProduct.intents
      : (Array.isArray(squareProduct.intents) ? squareProduct.intents : []),
    benefits: Array.isArray(semanticProduct.benefits) && semanticProduct.benefits.length > 0
      ? semanticProduct.benefits
      : (Array.isArray(squareProduct.benefits) ? squareProduct.benefits : []),
    visibility: Array.isArray(semanticProduct.visibility) && semanticProduct.visibility.length > 0
      ? semanticProduct.visibility
      : (Array.isArray(squareProduct.visibility) ? squareProduct.visibility : []),
    cleo_reply_template: semanticProduct.cleo_reply_template || squareProduct.cleo_reply_template || '',
    upsell_suggestions: semanticProduct.upsell_suggestions || squareProduct.upsell_suggestions || [],
    short_description: semanticProduct.short_description || squareProduct.short_description || squareProduct.description || '',
    full_description: semanticProduct.full_description || squareProduct.full_description || squareProduct.description || '',
    semantic_score: semanticProduct.semantic_score || 0,
    inventory_in_stock: squareProduct.inventory_in_stock ?? semanticProduct.inventory_in_stock,
    inventory_total_quantity: squareProduct.inventory_total_quantity ?? semanticProduct.inventory_total_quantity,
    inventory_by_state: squareProduct.inventory_by_state || semanticProduct.inventory_by_state || {},
    variationDetails: Array.isArray(squareProduct.variationDetails) && squareProduct.variationDetails.length > 0
      ? squareProduct.variationDetails
      : (Array.isArray(semanticProduct.variationDetails) ? semanticProduct.variationDetails : []),
    price: squareProduct.price || semanticProduct.price || '',
    price_min_usd: squareProduct.price_min_usd ?? semanticProduct.price_min_usd ?? null,
  }, 'merged');
}

function resolveHybridProducts({ text = '', intentIds = [], semanticProducts = [], squareProducts = [], limit = 5 } = {}) {
  const results = [];
  const usedSquare = new Set();
  const semanticList = Array.isArray(semanticProducts) ? semanticProducts : [];
  const squareList = Array.isArray(squareProducts) ? squareProducts : [];

  for (const semanticProduct of semanticList) {
    const semanticName = semanticProduct?.name || '';
    let matchedIndex = -1;
    let bestMatchScore = 0;

    squareList.forEach((squareProduct, index) => {
      if (usedSquare.has(index)) return;
      const score = overlapScore(semanticName, squareProduct?.name || '');
      if (score > bestMatchScore) {
        bestMatchScore = score;
        matchedIndex = index;
      }
    });

    if (matchedIndex >= 0 && bestMatchScore >= 2) {
      usedSquare.add(matchedIndex);
      results.push(mergeOne(squareList[matchedIndex], semanticProduct));
    } else {
      results.push(buildCanonicalRecord(semanticProduct, 'supabase'));
    }
  }

  squareList.forEach((squareProduct, index) => {
    if (usedSquare.has(index)) return;
    results.push(buildCanonicalRecord(squareProduct, 'square'));
  });

  return results
    .map((product) => ({
      ...product,
      hybrid_score: scoreResolvedProduct(product, { text, intentIds }),
    }))
    .sort((a, b) => b.hybrid_score - a.hybrid_score)
    .slice(0, limit);
}

module.exports = {
  resolveHybridProducts,
};
