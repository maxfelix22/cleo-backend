const { Client, Environment } = require('square');

const client = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN,
  environment: Environment.Production,
});

function scoreProduct(item, query) {
  const q = String(query || '').toLowerCase().trim();
  if (!q) return 0;

  const nome = String(item.itemData?.name || '').toLowerCase();
  const descricao = String(item.itemData?.description || '').toLowerCase();
  const categorias = (item.itemData?.categories || []).map(c => c.name || '').join(' ').toLowerCase();
  const text = `${nome} ${descricao} ${categorias}`;

  let score = 0;
  for (const word of q.split(/\s+/).filter(Boolean)) {
    if (nome.includes(word)) score += 10;
    if (descricao.includes(word)) score += 3;
    if (categorias.includes(word)) score += 5;
    if (text.includes(word)) score += 1;
  }
  return score;
}

async function listCatalogItems() {
  let allItems = [];
  let cursor = undefined;

  do {
    const response = await client.catalogApi.listCatalog(cursor);
    if (response.result?.objects) {
      allItems = allItems.concat(response.result.objects);
    }
    cursor = response.result?.cursor;
  } while (cursor);

  return allItems.filter(item => item.type === 'ITEM' && !item.isDeleted && item.itemData?.name);
}

function formatSimpleProduct(item) {
  const variations = (item.itemData?.variations || []).map(v => v.itemVariationData?.name).filter(Boolean);
  const priceMoney = item.itemData?.variations?.[0]?.itemVariationData?.priceMoney;
  const amount = typeof priceMoney?.amount === 'bigint' ? Number(priceMoney.amount) : Number(priceMoney?.amount || 0);
  const price = amount ? `$${(amount / 100).toFixed(2)}` : null;

  return {
    id: item.id,
    name: item.itemData?.name || '',
    description: item.itemData?.description || '',
    price,
    variations,
  };
}

async function searchProducts(query, limit = 3) {
  const items = await listCatalogItems();
  const ranked = items
    .map(item => ({ item, score: scoreProduct(item, query) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(x => formatSimpleProduct(x.item));

  return ranked;
}

module.exports = {
  searchProducts,
};
