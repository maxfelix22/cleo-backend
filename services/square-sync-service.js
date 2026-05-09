const { Client, Environment } = require('square');
const {
  createSquareSyncRun,
  finishSquareSyncRun,
  upsertSquareCatalogItems,
  upsertSquareOrders,
  upsertSquareOrderItems,
  upsertSquareCustomers,
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

function sanitizeForJson(value) {
  if (typeof value === 'bigint') return Number(value);
  if (Array.isArray(value)) return value.map(sanitizeForJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, val]) => [key, sanitizeForJson(val)])
    );
  }
  return value;
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
    variations_payload: sanitizeForJson(variations),
    raw_payload: sanitizeForJson(item),
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

async function listActiveLocationId() {
  const configured = String(process.env.SQUARE_LOCATION_ID || '').trim();
  if (configured) return configured;
  const locations = await client.locationsApi.listLocations();
  const list = locations.result?.locations || [];
  const firstActive = list.find((loc) => String(loc.status || '').toUpperCase() === 'ACTIVE') || list[0];
  return String(firstActive?.id || '').trim();
}

function normalizeMoneyAmount(money) {
  if (!money || money.amount == null) return null;
  const amount = typeof money.amount === 'bigint' ? Number(money.amount) : Number(money.amount);
  if (!Number.isFinite(amount)) return null;
  return amount / 100;
}

function normalizeSquareOrder(order = {}, locationId = '') {
  const fulfillments = Array.isArray(order.fulfillments) ? order.fulfillments : [];
  const tenders = Array.isArray(order.tenders) ? order.tenders : [];
  const fulfillmentState = fulfillments[0]?.state || null;
  return {
    square_order_id: order.id || '',
    square_customer_id: order.customerId || null,
    location_id: order.locationId || locationId || null,
    state: order.state || null,
    source_name: order.source?.name || null,
    ticket_name: order.ticketName || null,
    fulfillment_state: fulfillmentState,
    net_amount: normalizeMoneyAmount(order.netAmountDueMoney),
    tax_amount: normalizeMoneyAmount(order.totalTaxMoney),
    discount_amount: normalizeMoneyAmount(order.totalDiscountMoney),
    tip_amount: normalizeMoneyAmount(order.totalTipMoney),
    total_amount: normalizeMoneyAmount(order.totalMoney),
    currency: order.totalMoney?.currency || null,
    closed_at_square: toIsoOrNull(order.closedAt),
    created_at_square: toIsoOrNull(order.createdAt),
    updated_at_square: toIsoOrNull(order.updatedAt),
    fulfillments_payload: sanitizeForJson(fulfillments),
    tenders_payload: sanitizeForJson(tenders),
    raw_payload: sanitizeForJson(order),
    synced_at: new Date().toISOString(),
  };
}

function normalizeSquareOrderItems(order = {}) {
  const lineItems = Array.isArray(order.lineItems) ? order.lineItems : [];
  return lineItems.map((item) => ({
    square_order_id: order.id || '',
    line_item_uid: item.uid || '',
    catalog_object_id: item.catalogObjectId || null,
    catalog_version: item.catalogVersion == null ? null : (typeof item.catalogVersion === 'bigint' ? Number(item.catalogVersion) : Number(item.catalogVersion) || null),
    item_type: item.itemType || null,
    item_name: item.name || null,
    variation_name: item.variationName || null,
    sku: item.sku || null,
    quantity: item.quantity == null ? null : Number(item.quantity),
    base_price_amount: normalizeMoneyAmount(item.basePriceMoney),
    gross_sales_amount: normalizeMoneyAmount(item.grossSalesMoney),
    total_tax_amount: normalizeMoneyAmount(item.totalTaxMoney),
    total_discount_amount: normalizeMoneyAmount(item.totalDiscountMoney),
    total_amount: normalizeMoneyAmount(item.totalMoney),
    currency: item.totalMoney?.currency || item.basePriceMoney?.currency || null,
    raw_payload: sanitizeForJson(item),
    synced_at: new Date().toISOString(),
  })).filter((row) => row.square_order_id && row.line_item_uid);
}

async function listRecentOrders(limit = 200) {
  const locationId = await listActiveLocationId();
  if (!locationId) {
    throw new Error('missing_location_id');
  }

  const response = await client.ordersApi.searchOrders({
    locationIds: [locationId],
    limit,
    sort: {
      sortField: 'CREATED_AT',
      sortOrder: 'DESC',
    },
  });

  return {
    locationId,
    orders: response.result?.orders || [],
  };
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

function normalizeSquareCustomer(customer = {}) {
  return {
    square_customer_id: customer.id || '',
    given_name: customer.givenName || null,
    family_name: customer.familyName || null,
    nickname: null,
    company_name: null,
    phone_number: customer.phoneNumber || null,
    email_address: customer.emailAddress || null,
    reference_id: null,
    creation_source: null,
    preferences: null,
    group_ids: [],
    segment_ids: [],
    raw_payload: sanitizeForJson(customer),
    created_at_square: toIsoOrNull(customer.createdAt),
    updated_at_square: toIsoOrNull(customer.updatedAt),
    synced_at: new Date().toISOString(),
  };
}

async function listRecentCustomers(limit = 200) {
  const pageSize = Math.min(Math.max(Number(limit) || 1, 1), 100);

  try {
    const response = await client.customersApi.searchCustomers({
      limit: pageSize,
    });
    return response.result?.customers || [];
  } catch (err) {
    const wrapped = new Error(`square customers search failed: ${err?.message || err}`);
    wrapped.status = err?.statusCode || err?.status || 500;
    wrapped.squareStage = 'search_customers';
    wrapped.squareArgs = { limit: pageSize };
    wrapped.squareBody = err?.body || err?.result || null;
    throw wrapped;
  }
}

async function syncSquareOrders(limit = 200) {
  const runResult = await createSquareSyncRun('orders', {
    source: 'square',
    scope: 'orders+items',
    limit,
  });
  const run = runResult.run || null;

  try {
    const { locationId, orders } = await listRecentOrders(limit);
    const normalizedOrders = orders.map((order) => normalizeSquareOrder(order, locationId)).filter((row) => row.square_order_id);
    const normalizedItems = orders.flatMap((order) => normalizeSquareOrderItems(order));

    let ordersUpserted = 0;
    let itemsUpserted = 0;
    const batchSize = 100;

    for (let i = 0; i < normalizedOrders.length; i += batchSize) {
      const batch = normalizedOrders.slice(i, i + batchSize);
      const result = await upsertSquareOrders(batch);
      ordersUpserted += Number(result.count || 0);
    }

    for (let i = 0; i < normalizedItems.length; i += batchSize) {
      const batch = normalizedItems.slice(i, i + batchSize);
      const result = await upsertSquareOrderItems(batch);
      itemsUpserted += Number(result.count || 0);
    }

    await finishSquareSyncRun(run?.id, 'success', {
      rows_processed: normalizedOrders.length,
      rows_upserted: ordersUpserted,
      metadata: {
        source: 'square',
        scope: 'orders+items',
        location_id: locationId,
        orders_count: normalizedOrders.length,
        order_items_count: normalizedItems.length,
        order_items_upserted: itemsUpserted,
      },
    });

    return {
      ok: true,
      sync_type: 'orders',
      rows_processed: normalizedOrders.length,
      rows_upserted: ordersUpserted,
      order_items_processed: normalizedItems.length,
      order_items_upserted: itemsUpserted,
      run_id: run?.id || null,
      location_id: locationId,
    };
  } catch (err) {
    await finishSquareSyncRun(run?.id, 'error', {
      error_message: err.message || String(err),
    });
    throw err;
  }
}

async function syncSquareCustomers(limit = 200) {
  const runResult = await createSquareSyncRun('customers', {
    source: 'square',
    scope: 'customers',
    limit,
  });
  const run = runResult.run || null;

  try {
    const customers = await listRecentCustomers(limit);
    const normalizedCustomers = customers.map(normalizeSquareCustomer).filter((row) => row.square_customer_id);

    let customersUpserted = 0;
    for (let i = 0; i < normalizedCustomers.length; i += 1) {
      const row = normalizedCustomers[i];
      try {
        const result = await upsertSquareCustomers([row]);
        customersUpserted += Number(result.count || 0);
      } catch (err) {
        err.debugCustomer = {
          index: i,
          square_customer_id: row.square_customer_id,
          payload: row,
        };
        throw err;
      }
    }

    await finishSquareSyncRun(run?.id, 'success', {
      rows_processed: normalizedCustomers.length,
      rows_upserted: customersUpserted,
      metadata: {
        source: 'square',
        scope: 'customers',
        strategy: 'one-by-one-debug',
      },
    });

    return {
      ok: true,
      sync_type: 'customers',
      rows_processed: normalizedCustomers.length,
      rows_upserted: customersUpserted,
      run_id: run?.id || null,
    };
  } catch (err) {
    await finishSquareSyncRun(run?.id, 'error', {
      error_message: err.message || String(err),
      metadata: {
        source: 'square',
        scope: 'customers',
        failed_customer: err.debugCustomer || null,
      },
    });
    throw err;
  }
}

module.exports = {
  syncSquareCatalog,
  syncSquareOrders,
  syncSquareCustomers,
  normalizeCatalogItem,
  normalizeSquareOrder,
  normalizeSquareOrderItems,
  normalizeSquareCustomer,
  listAllCatalogItems,
  listRecentOrders,
  listRecentCustomers,
};
