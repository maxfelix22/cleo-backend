const { Client, Environment } = require('square');

const client = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN,
  environment: Environment.Production,
});

const SQUARE_LOCATION_ID = (process.env.SQUARE_LOCATION_ID || '').trim();

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

function summarizeInventory(counts = []) {
  const summary = {
    inStock: false,
    totalQuantity: 0,
    byState: {},
  };

  for (const entry of counts) {
    const state = String(entry.state || 'UNKNOWN').toUpperCase();
    const quantity = Number(entry.quantity || 0);
    if (!Number.isFinite(quantity)) continue;
    summary.byState[state] = (summary.byState[state] || 0) + quantity;
    if (state === 'IN_STOCK' && quantity > 0) {
      summary.inStock = true;
      summary.totalQuantity += quantity;
    }
  }

  return summary;
}

async function listInventoryCounts(catalogObjectIds = []) {
  const ids = Array.isArray(catalogObjectIds)
    ? [...new Set(catalogObjectIds.map((id) => String(id || '').trim()).filter(Boolean))]
    : [];

  if (ids.length === 0) return { countsByObjectId: {}, mode: 'no-ids' };

  try {
    const response = await client.inventoryApi.batchRetrieveInventoryCounts({
      catalogObjectIds: ids,
      locationIds: SQUARE_LOCATION_ID ? [SQUARE_LOCATION_ID] : undefined,
    });

    const counts = response.result?.counts || [];
    const countsByObjectId = {};

    for (const count of counts) {
      const objectId = String(count.catalogObjectId || '').trim();
      if (!objectId) continue;
      if (!countsByObjectId[objectId]) countsByObjectId[objectId] = [];
      countsByObjectId[objectId].push({
        state: count.state || '',
        quantity: count.quantity || '0',
      });
    }

    return { countsByObjectId, mode: 'inventory-api' };
  } catch (err) {
    return { countsByObjectId: {}, mode: 'inventory-api-error', error: err.message };
  }
}

function formatVariation(itemVariation = {}, itemName = '', inventoryCountsByObjectId = {}) {
  const data = itemVariation.itemVariationData || {};
  const priceMoney = data.priceMoney;
  const amount = typeof priceMoney?.amount === 'bigint' ? Number(priceMoney.amount) : Number(priceMoney?.amount || 0);
  const price = amount ? `$${(amount / 100).toFixed(2)}` : null;
  const name = data.name || '';
  const normalized = `${itemName} ${name}`.toLowerCase();
  const sizeMatch = normalized.match(/\b(pp|p|m|g|gg|xg|xgg)\b/);
  const colorHints = ['preta','preto','branca','branco','vermelha','vermelho','rosa','azul','verde','bege','nude','dourada','dourado','prata','roxa','roxo'];
  const color = colorHints.find((hint) => normalized.includes(hint)) || '';
  const inventory = summarizeInventory(inventoryCountsByObjectId[itemVariation.id] || []);

  return {
    id: itemVariation.id || '',
    name,
    price,
    size: sizeMatch ? sizeMatch[1].toUpperCase() : '',
    color,
    available: itemVariation.isDeleted !== true,
    inventory_in_stock: inventory.inStock,
    inventory_total_quantity: inventory.totalQuantity,
    inventory_by_state: inventory.byState,
  };
}

function extractAvailableColors(item = {}) {
  const itemName = String(item.itemData?.name || '').toLowerCase();
  const description = String(item.itemData?.description || '').toLowerCase();
  const haystack = `${itemName} ${description}`;
  const colorHints = ['preta','preto','branca','branco','vermelha','vermelho','rosa','azul','verde','bege','nude','dourada','dourado','prata','roxa','roxo'];
  return [...new Set(colorHints.filter((hint) => haystack.includes(hint)))];
}

function parsePriceNumber(price = '') {
  const value = Number(String(price || '').replace(/[^\d.]/g, ''));
  return Number.isFinite(value) ? value : 0;
}

function formatSimpleProduct(item, inventoryCountsByObjectId = {}) {
  const variationObjects = item.itemData?.variations || [];
  const itemName = item.itemData?.name || '';
  const variations = variationObjects.map((variation) => formatVariation(variation, itemName, inventoryCountsByObjectId)).filter(v => v.name);
  const firstPricedVariation = variations.find(v => v.price) || null;
  const price = firstPricedVariation?.price || null;
  const availableColors = extractAvailableColors(item);
  const itemInventory = summarizeInventory(
    variations.flatMap((variation) =>
      Object.entries(variation.inventory_by_state || {}).map(([state, quantity]) => ({ state, quantity }))
    )
  );

  return {
    id: item.id,
    name: itemName,
    description: item.itemData?.description || '',
    price,
    priceNumber: parsePriceNumber(price),
    variations: variations.map(v => v.name),
    variationDetails: variations,
    availableColors,
    inventory_in_stock: itemInventory.inStock,
    inventory_total_quantity: itemInventory.totalQuantity,
    inventory_by_state: itemInventory.byState,
  };
}

async function searchProducts(query, limit = 3) {
  const items = await listCatalogItems();
  const rankedItems = items
    .map(item => ({ item, score: scoreProduct(item, query) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(x => x.item);

  const variationIds = rankedItems.flatMap((item) => Array.isArray(item.itemData?.variations)
    ? item.itemData.variations.map((variation) => variation.id).filter(Boolean)
    : []);
  const inventoryResult = await listInventoryCounts(variationIds);

  return rankedItems.map((item) => formatSimpleProduct(item, inventoryResult.countsByObjectId || {}));
}

function findMatchingVariation(product = {}, requestedSize = '') {
  const size = String(requestedSize || '').trim().toUpperCase();
  const details = Array.isArray(product.variationDetails) ? product.variationDetails : [];
  if (!size) return null;
  return details.find((variation) => variation.size === size) || null;
}

module.exports = {
  searchProducts,
  findMatchingVariation,
  parsePriceNumber,
};
