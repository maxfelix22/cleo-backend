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

module.exports = {
  createSquareSyncRun,
  finishSquareSyncRun,
  upsertSquareCatalogItems,
  upsertSquareOrders,
  upsertSquareOrderItems,
  upsertSquareCustomers,
};
