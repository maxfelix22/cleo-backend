const express = require('express');
const { Client, Environment } = require('square');
const { normalizeSquareCustomer, listRecentCustomers } = require('../services/square-sync-service');
const router = express.Router();

const squareClient = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN,
  environment: Environment.Production,
});

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

router.post('/square-sync/debug/customers-minimal', async (req, res) => {
  try {
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

    const out = await supabaseRequestSafe('/rest/v1/square_customers?on_conflict=square_customer_id', {
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

router.post('/square-sync/debug/customers-first-real', async (req, res) => {
  try {
    const customers = await listRecentCustomers(1);
    const rawCustomer = customers[0] || null;

    if (!rawCustomer) {
      return res.status(404).json({ ok: false, error: 'NO_SQUARE_CUSTOMERS_FOUND' });
    }

    const normalized = normalizeSquareCustomer(rawCustomer);
    const out = await supabaseRequestSafe('/rest/v1/square_customers?on_conflict=square_customer_id', {
      method: 'POST',
      headers: {
        Prefer: 'resolution=merge-duplicates,return=representation',
        Accept: 'application/json',
      },
      body: [normalized],
    });

    return res.json({
      ok: true,
      square_customer_id: normalized.square_customer_id,
      normalized,
      inserted: out,
    });
  } catch (err) {
    return res.status(err?.status || 500).json({
      ok: false,
      error: err?.message || 'debug_real_customer_insert_failed',
      status: err?.status || 500,
      payload: err?.payload || null,
      responseText: err?.responseText || null,
      responseHeaders: err?.responseHeaders || null,
    });
  }
});

module.exports = router;
