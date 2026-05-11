function hasSupabaseConfigSafe() {
  return !!(String(process.env.SUPABASE_URL || '').trim() && String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim());
}

async function supabaseRequestSafe(path, { method = 'GET', body, headers = {} } = {}) {
  const baseUrl = String(process.env.SUPABASE_URL || '').trim();
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (!(baseUrl && serviceRoleKey)) {
    const error = new Error('Supabase envs ausentes');
    error.code = 'SUPABASE_ENVS_MISSING';
    throw error;
  }

  const response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
    method,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Accept-Profile': 'public',
      'Content-Profile': 'public',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch (err) { parsed = text; }

  if (!response.ok) {
    const payload = parsed && parsed !== '' ? parsed : { raw_text: text || null, path, method };
    const error = new Error(`Supabase request failed with status ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    error.responseText = text;
    error.responseHeaders = Object.fromEntries(response.headers.entries());
    throw error;
  }

  return parsed;
}

async function createSquareSyncRun(syncType, metadata = {}) {
  if (!hasSupabaseConfigSafe()) {
    return {
      mode: 'memory-fallback',
      run: {
        id: `memory-square-sync-${Date.now()}`,
        sync_type: syncType,
        status: 'running',
        metadata,
        started_at: new Date().toISOString(),
      },
    };
  }

  const created = await supabaseRequestSafe('/rest/v1/square_sync_runs', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: [{
      sync_type: syncType,
      status: 'running',
      started_at: new Date().toISOString(),
      metadata,
    }],
  });

  return { mode: 'supabase', run: Array.isArray(created) ? created[0] : created };
}

async function finishSquareSyncRun(runId, status = 'success', patch = {}) {
  if (!runId || !hasSupabaseConfigSafe()) {
    return { mode: hasSupabaseConfigSafe() ? 'supabase' : 'memory-fallback', run: null };
  }

  const updated = await supabaseRequestSafe(`/rest/v1/square_sync_runs?id=eq.${encodeURIComponent(runId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation', Accept: 'application/json' },
    body: {
      status,
      finished_at: new Date().toISOString(),
      ...patch,
    },
  });

  return { mode: 'supabase', run: Array.isArray(updated) ? updated[0] : updated };
}

async function upsertSquareCatalogItems(items = []) {
  const rows = Array.isArray(items) ? items.filter(Boolean) : [];
  if (rows.length === 0) return { mode: hasSupabaseConfigSafe() ? 'supabase' : 'memory-fallback', rows: [], count: 0 };
  if (!hasSupabaseConfigSafe()) return { mode: 'memory-fallback', rows, count: rows.length };

  const created = await supabaseRequestSafe('/rest/v1/square_catalog_items?on_conflict=square_catalog_object_id', {
    method: 'POST',
    headers: {
      Prefer: 'resolution=merge-duplicates,return=representation',
      Accept: 'application/json',
    },
    body: rows,
  });

  const out = Array.isArray(created) ? created : [created];
  return { mode: 'supabase', rows: out, count: out.length };
}

async function upsertSquareOrders(rows = []) {
  const payload = Array.isArray(rows) ? rows.filter(Boolean) : [];
  if (payload.length === 0) return { mode: hasSupabaseConfigSafe() ? 'supabase' : 'memory-fallback', rows: [], count: 0 };
  if (!hasSupabaseConfigSafe()) return { mode: 'memory-fallback', rows: payload, count: payload.length };

  const created = await supabaseRequestSafe('/rest/v1/square_orders?on_conflict=square_order_id', {
    method: 'POST',
    headers: {
      Prefer: 'resolution=merge-duplicates,return=representation',
      Accept: 'application/json',
    },
    body: payload,
  });

  const out = Array.isArray(created) ? created : [created];
  return { mode: 'supabase', rows: out, count: out.length };
}

async function upsertSquareOrderItems(rows = []) {
  const payload = Array.isArray(rows) ? rows.filter(Boolean) : [];
  if (payload.length === 0) return { mode: hasSupabaseConfigSafe() ? 'supabase' : 'memory-fallback', rows: [], count: 0 };
  if (!hasSupabaseConfigSafe()) return { mode: 'memory-fallback', rows: payload, count: payload.length };

  const created = await supabaseRequestSafe('/rest/v1/square_order_items?on_conflict=square_order_id,line_item_uid', {
    method: 'POST',
    headers: {
      Prefer: 'resolution=merge-duplicates,return=representation',
      Accept: 'application/json',
    },
    body: payload,
  });

  const out = Array.isArray(created) ? created : [created];
  return { mode: 'supabase', rows: out, count: out.length };
}

async function upsertSquareCustomers(rows = []) {
  const payload = Array.isArray(rows) ? rows.filter(Boolean) : [];
  if (payload.length === 0) return { mode: hasSupabaseConfigSafe() ? 'supabase' : 'memory-fallback', rows: [], count: 0 };
  if (!hasSupabaseConfigSafe()) return { mode: 'memory-fallback', rows: payload, count: payload.length };

  const created = await supabaseRequestSafe('/rest/v1/square_customers?on_conflict=square_customer_id', {
    method: 'POST',
    headers: {
      Prefer: 'resolution=merge-duplicates,return=representation',
      Accept: 'application/json',
    },
    body: payload,
  });

  const out = Array.isArray(created) ? created : [created];
  return { mode: 'supabase', rows: out, count: out.length };
}

async function upsertSquareCustomerAliases(rows = []) {
  const payload = Array.isArray(rows) ? rows.filter((row) => row && row.requested_square_customer_id && row.canonical_square_customer_id) : [];
  if (payload.length === 0) return { mode: hasSupabaseConfigSafe() ? 'supabase' : 'memory-fallback', rows: [], count: 0 };
  if (!hasSupabaseConfigSafe()) return { mode: 'memory-fallback', rows: payload, count: payload.length };

  const created = await supabaseRequestSafe('/rest/v1/square_customer_aliases?on_conflict=requested_square_customer_id', {
    method: 'POST',
    headers: {
      Prefer: 'resolution=merge-duplicates,return=representation',
      Accept: 'application/json',
    },
    body: payload,
  });

  const out = Array.isArray(created) ? created : [created];
  return { mode: 'supabase', rows: out, count: out.length };
}

async function listDistinctSquareCustomerIdsMissingNames(limit = 100) {
  if (!hasSupabaseConfigSafe()) return [];
  const safeLimit = Math.min(Math.max(Number(limit) || 1, 1), 500);
  const sql = `
    with customer_rollup as (
      select o.square_customer_id, sum(o.total_amount) as total_revenue
      from public.square_orders o
      where o.square_customer_id is not null
      group by o.square_customer_id
    )
    select cr.square_customer_id
    from customer_rollup cr
    left join public.square_customers sc on sc.square_customer_id = cr.square_customer_id
    left join public.square_customers_directory d on d.square_customer_id = cr.square_customer_id
    where coalesce(
      nullif(trim(d.full_name), ''),
      nullif(trim(concat_ws(' ', sc.given_name, sc.family_name)), '')
    ) is null
    order by cr.total_revenue desc nulls last
    limit ${safeLimit}
  `;

  const rows = await supabaseRequestSafe('/rest/v1/rpc/exec_sql', {
    method: 'POST',
    body: { sql },
  }).catch(() => null);

  if (Array.isArray(rows)) return rows.map((row) => row.square_customer_id).filter(Boolean);
  if (rows && Array.isArray(rows.rows)) return rows.rows.map((row) => row.square_customer_id).filter(Boolean);
  return [];
}

module.exports = {
  createSquareSyncRun,
  finishSquareSyncRun,
  upsertSquareCatalogItems,
  upsertSquareOrders,
  upsertSquareOrderItems,
  upsertSquareCustomers,
  upsertSquareCustomerAliases,
  listDistinctSquareCustomerIdsMissingNames,
};
