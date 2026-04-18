const SUPABASE_URL = String(process.env.SUPABASE_URL || '').trim();
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

function hasSupabaseConfig() {
  return !!(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

async function supabaseRequest(path, { method = 'GET', body, headers = {} } = {}) {
  if (!hasSupabaseConfig()) {
    const error = new Error('Supabase envs ausentes');
    error.code = 'SUPABASE_ENVS_MISSING';
    throw error;
  }

  const response = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}${path}`, {
    method,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch (err) { parsed = text; }

  if (!response.ok) {
    const error = new Error(`Supabase request failed with status ${response.status}`);
    error.status = response.status;
    error.payload = parsed;
    throw error;
  }

  return parsed;
}

module.exports = {
  hasSupabaseConfig,
  supabaseRequest,
};
