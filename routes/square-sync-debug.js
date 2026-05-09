const express = require('express');
const router = express.Router();
const { hasSupabaseConfig, supabaseRequest } = require('../services/supabase-client');

router.post('/square-sync/debug/customers-minimal', async (req, res) => {
  try {
    if (!hasSupabaseConfig()) {
      return res.status(500).json({ ok: false, error: 'SUPABASE_ENVS_MISSING' });
    }

    const payload = [{
      square_customer_id: `debug-${Date.now()}`,
      given_name: 'Debug',
      family_name: 'Customer',
      phone_number: '+15550001111',
      email_address: 'debug@example.com',
      preferences: null,
      group_ids: [],
      segment_ids: [],
      raw_payload: { debug: true },
      created_at_square: new Date().toISOString(),
      updated_at_square: new Date().toISOString(),
      synced_at: new Date().toISOString(),
    }];

    const out = await supabaseRequest('/rest/v1/square_customers?on_conflict=square_customer_id', {
      method: 'POST',
      headers: {
        Prefer: 'resolution=merge-duplicates,return=representation',
        Accept: 'application/json',
      },
      body: payload,
    });

    return res.json({ ok: true, inserted: out });
  } catch (err) {
    return res.status(err?.status || 500).json({
      ok: false,
      error: err?.message || 'debug_insert_failed',
      status: err?.status || 500,
      payload: err?.payload || null,
      responseText: err?.responseText || null,
    });
  }
});

module.exports = router;
