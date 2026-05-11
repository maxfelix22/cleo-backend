const { Client, Environment } = require('square');
const {
  createSquareSyncRun,
  finishSquareSyncRun,
  upsertSquareCatalogItems,
  upsertSquareOrders,
  upsertSquareOrderItems,
  upsertSquareCustomers,
  upsertSquareCustomerAliases,
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

async function listRecentOrders(limit = 200, pages = 1) {
  const locationId = await listActiveLocationId();
  if (!locationId) {
    throw new Error('missing_location_id');
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 1, 1), 1000);
  const safePages = Math.min(Math.max(Number(pages) || 1, 1), 10);

  let allOrders = [];
  let cursor = undefined;

  for (let page = 0; page < safePages; page += 1) {
    const response = await client.ordersApi.searchOrders({
      locationIds: [locationId],
      limit: safeLimit,
      cursor,
      sort: {
        sortField: 'CREATED_AT',
        sortOrder: 'DESC',
      },
    });

    const chunk = response.result?.orders || [];
    allOrders = allOrders.concat(chunk);
    cursor = response.result?.cursor;

    if (!cursor || chunk.length === 0) break;
  }

  return {
    locationId,
    orders: allOrders,
    requestedLimit: limit,
    safeLimit,
    requestedPages: pages,
    safePages,
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

async function listRecentCustomers(limit = 200, pages = 1) {
  const requestedLimit = Math.max(Number(limit) || 1, 1);
  const safeLimit = Math.min(requestedLimit, 1000);
  const requestedPages = Math.max(Number(pages) || 1, 1);
  const safePages = Math.min(requestedPages, 10);
  const pageSize = Math.min(safeLimit, 100);

  const collected = [];
  let cursor = undefined;

  try {
    for (let page = 0; page < safePages && collected.length < safeLimit; page += 1) {
      const remaining = safeLimit - collected.length;
      const response = await client.customersApi.searchCustomers({
        cursor,
        limit: Math.min(pageSize, remaining),
      });

      const customers = response.result?.customers || [];
      collected.push(...customers);

      cursor = response.result?.cursor || null;
      if (!cursor || customers.length === 0) break;
    }

    return {
      customers: collected,
      requestedLimit,
      safeLimit,
      requestedPages,
      safePages,
    };
  } catch (err) {
    const wrapped = new Error(`square customers search failed: ${err?.message || err}`);
    wrapped.status = err?.statusCode || err?.status || 500;
    wrapped.squareStage = 'search_customers';
    wrapped.squareArgs = { limit: safeLimit, pages: safePages, cursor: cursor || null };
    wrapped.squareBody = err?.body || err?.result || null;
    throw wrapped;
  }
}

async function syncSquareOrders(limit = 200, pages = 1) {
  const runResult = await createSquareSyncRun('orders', {
    source: 'square',
    scope: 'orders+items',
    limit,
    pages,
  });
  const run = runResult.run || null;

  try {
    const { locationId, orders, requestedLimit, safeLimit, requestedPages, safePages } = await listRecentOrders(limit, pages);
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
        requested_limit: requestedLimit,
        safe_limit: safeLimit,
        requested_pages: requestedPages,
        safe_pages: safePages,
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
      requested_limit: requestedLimit,
      safe_limit: safeLimit,
      requested_pages: requestedPages,
      safe_pages: safePages,
    };
  } catch (err) {
    await finishSquareSyncRun(run?.id, 'error', {
      error_message: err.message || String(err),
    });
    throw err;
  }
}

async function fetchSquareCustomerById(squareCustomerId) {
  const id = String(squareCustomerId || '').trim();
  if (!id) return null;

  try {
    const response = await client.customersApi.retrieveCustomer(id);
    return response.result?.customer || null;
  } catch (err) {
    return null;
  }
}

async function hydrateSquareCustomersByIds(ids = []) {
  const uniqueIds = [...new Set((Array.isArray(ids) ? ids : []).map((id) => String(id || '').trim()).filter(Boolean))];
  const hydrated = [];
  const aliases = [];

  for (const requestedId of uniqueIds) {
    const customer = await fetchSquareCustomerById(requestedId);
    if (!customer) continue;
    const row = normalizeSquareCustomer(customer);
    if (!row.square_customer_id) continue;
    await upsertSquareCustomers([row]);
    hydrated.push(row.square_customer_id);

    if (row.square_customer_id !== requestedId) {
      aliases.push({
        requested_square_customer_id: requestedId,
        canonical_square_customer_id: row.square_customer_id,
        source: 'square_hydrate',
        confidence: 'high',
        note: 'hydrate returned different canonical square customer id',
        updated_at: new Date().toISOString(),
      });
    }
  }

  if (aliases.length > 0) {
    await upsertSquareCustomerAliases(aliases);
  }

  return {
    ok: true,
    hydrated_count: hydrated.length,
    hydrated_ids: hydrated,
    alias_count: aliases.length,
    aliases,
  };
}

async function syncSquareCustomers(limit = 200, pages = 1) {
  const runResult = await createSquareSyncRun('customers', {
    source: 'square',
    scope: 'customers',
    limit,
    pages,
  });
  const run = runResult.run || null;

  try {
    const { customers, requestedLimit, safeLimit, requestedPages, safePages } = await listRecentCustomers(limit, pages);
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
        requested_limit: requestedLimit,
        safe_limit: safeLimit,
        requested_pages: requestedPages,
        safe_pages: safePages,
      },
    });

    return {
      ok: true,
      sync_type: 'customers',
      rows_processed: normalizedCustomers.length,
      rows_upserted: customersUpserted,
      run_id: run?.id || null,
      requested_limit: requestedLimit,
      safe_limit: safeLimit,
      requested_pages: requestedPages,
      safe_pages: safePages,
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
  fetchSquareCustomerById,
  hydrateSquareCustomersByIds,
};
