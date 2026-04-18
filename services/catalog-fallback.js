function buildFallbackProductsFromText(text = '') {
  const lower = String(text || '').toLowerCase();
  const products = [];

  if (lower.includes('lingerie') && lower.includes('preta')) {
    products.push({
      id: 'fallback-lingerie-preta',
      name: 'Lingerie preta',
      description: 'Produto inferido localmente enquanto o catálogo real não está disponível.',
      price: null,
      variations: [],
      source: 'fallback',
    });
  }

  if (lower.includes('conjunto')) {
    products.push({
      id: 'fallback-conjunto',
      name: 'Conjunto',
      description: 'Produto inferido localmente enquanto o catálogo real não está disponível.',
      price: null,
      variations: [],
      source: 'fallback',
    });
  }

  return products;
}

module.exports = {
  buildFallbackProductsFromText,
};
