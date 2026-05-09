const { Client, Environment } = require('square');
const {
  createSquareSyncRun,
  finishSquareSyncRun,
  upsertSquareCatalogItems,
} = require('./square-sync-store');

const client = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN,
  environment: Environment.Production,
});

function toIsoOrNull(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function normalizeCatalogItem(item = {}) {
  const itemData = item.itemData || {};
  const categories = Array.isArray(itemData.categories) ? itemData.categories : [];
  const variations = Array.isArray(itemData.variations) ? itemData.variations : [];

  return {
    square_catalog_object_id: item.id || '',
    square_type: item.type || 'ITEM',
    item_name: itemData.name || null,
    description: itemData.description || null,
    is_deleted: item.isDeleted === true,
    product_type: itemData.productType || null,
    category_ids: categories.map((c) => c.id).filter(Boolean),
    reporting_category: categories[0]?.name || null,
    present_at_all_locations: item.presentAtAllLocations ?? null,
    present_at_location_ids: Array.isArray(item.presentAtLocationIds) ? item.presentAtLocationIds : [],
    absent_at_location_ids: Array.isArray(item.absentAtLocationIds) ? item.absentAtLocationIds : [],
    variations_payload: variations,
    raw_payload: item,
    version: typeof item.version === 'bigint' ? Number(item.version) : Number(item.version || 0) || null,
    created_at_square: toIsoOrNull(item.createdAt),
    updated_at_square: toIsoOrNull(item.updatedAt),
    synced_at: new Date().toISOString(),
  };
}

async function listAllCatalogItems() {
  let allItems = [];
  let cursor = undefined;

  do {
    const response = await client.catalogApi.listCatalog(cursor);
    if (response.result?.objects) {
      allItems = allItems.concat(response.result.objects);
    }
    cursor = response.result?.cursor;
  } while (cursor);

  return allItems.filter((item) => item.type === 'ITEM' && item.itemData?.name);
}

async function syncSquareCatalog() {
  const runResult = await createSquareSyncRun('catalog', {
    source: 'square',
    scope: 'items',
  });
  const run = runResult.run || null;

  try {
    const items = await listAllCatalogItems();
    const normalized = items.map(normalizeCatalogItem).filter((row) => row.square_catalog_object_id);

    let upsertedCount = 0;
    const batchSize = 100;
    for (let i = 0; i < normalized.length; i += batchSize) {
      const batch = normalized.slice(i, i + batchSize);
      const result = await upsertSquareCatalogItems(batch);
      upsertedCount += Number(result.count || 0);
    }

    await finishSquareSyncRun(run?.id, 'success', {
      rows_processed: normalized.length,
      rows_upserted: upsertedCount,
      metadata: {
        source: 'square',
        scope: 'items',
        batches: Math.ceil(normalized.length / batchSize),
      },
    });

    return {
      ok: true,
      sync_type: 'catalog',
      rows_processed: normalized.length,
      rows_upserted: upsertedCount,
      run_id: run?.id || null,
    };
  } catch (err) {
    await finishSquareSyncRun(run?.id, 'error', {
      error_message: err.message || String(err),
    });
    throw err;
  }
}

module.exports = {
  syncSquareCatalog,
  normalizeCatalogItem,
  listAllCatalogItems,
};
