const { hasSupabaseConfig, supabaseRequest } = require('./supabase-client');

async function createSquareSyncRun(syncType, metadata = {}) {
  if (!hasSupabaseConfig()) {
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

  const created = await supabaseRequest('/rest/v1/square_sync_runs', {
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
  if (!runId || !hasSupabaseConfig()) {
    return { mode: hasSupabaseConfig() ? 'supabase' : 'memory-fallback', run: null };
  }

  const updated = await supabaseRequest(`/rest/v1/square_sync_runs?id=eq.${encodeURIComponent(runId)}`, {
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
  if (rows.length === 0) return { mode: hasSupabaseConfig() ? 'supabase' : 'memory-fallback', rows: [], count: 0 };
  if (!hasSupabaseConfig()) return { mode: 'memory-fallback', rows, count: rows.length };

  const created = await supabaseRequest('/rest/v1/square_catalog_items?on_conflict=square_catalog_object_id', {
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

module.exports = {
  createSquareSyncRun,
  finishSquareSyncRun,
  upsertSquareCatalogItems,
};
