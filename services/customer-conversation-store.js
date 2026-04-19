const { hasSupabaseConfig, supabaseRequest } = require('./supabase-client');
const { normalizePhone } = require('../lib/whatsapp-normalize');
const { getConversationKey, getContext, saveContext } = require('./context-store');

async function getOrCreateCustomerByPhone(phone, profileName = '') {
  const normalizedPhone = normalizePhone(phone);

  if (!normalizedPhone) {
    throw new Error('phone obrigatório para getOrCreateCustomerByPhone');
  }

  if (!hasSupabaseConfig()) {
    return {
      mode: 'memory-fallback',
      customer: {
        id: `memory-customer:${normalizedPhone}`,
        phone: normalizedPhone,
        name: profileName || '',
      },
    };
  }

  const found = await supabaseRequest(`/rest/v1/customers?phone=eq.${encodeURIComponent(normalizedPhone)}&select=*&limit=1`);
  if (Array.isArray(found) && found[0]) {
    return { mode: 'supabase', customer: found[0] };
  }

  const created = await supabaseRequest('/rest/v1/customers', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: [{
      phone: normalizedPhone,
      name: profileName || null,
      last_interaction: new Date().toISOString(),
    }],
  });

  return { mode: 'supabase', customer: Array.isArray(created) ? created[0] : created };
}

async function updateConversationState({ conversationId, summary = '', currentStage = '', lastProduct = '', lastProductPayload = null }) {
  if (!conversationId) {
    return { mode: hasSupabaseConfig() ? 'supabase' : 'memory-fallback', conversation: null };
  }

  if (!hasSupabaseConfig()) {
    return { mode: 'memory-fallback', conversation: null };
  }

  const patch = {
    last_message_at: new Date().toISOString(),
  };

  if (summary) patch.summary = summary;
  if (currentStage) patch.current_stage = currentStage;
  if (lastProduct) patch.last_product = lastProduct;
  if (lastProductPayload) patch.last_product_payload = lastProductPayload;

  const updated = await supabaseRequest(`/rest/v1/conversations?id=eq.${encodeURIComponent(conversationId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation', Accept: 'application/json' },
    body: patch,
  });

  const conversation = Array.isArray(updated) ? updated[0] : updated;
  return { mode: 'supabase', conversation, patch };
}

async function getOrCreateOpenConversation({ customerId, existingConversationId = '', channel = 'whatsapp', phone = '', profileName = '' }) {
  if (!customerId) {
    throw new Error('customerId obrigatório para getOrCreateOpenConversation');
  }

  if (!hasSupabaseConfig()) {
    const contextKey = getConversationKey({ channel, from: phone });
    const existing = getContext(contextKey) || {};
    const saved = saveContext(contextKey, {
      ...existing,
      profileName,
      customerId,
      conversationId: existing.conversationId || existingConversationId || `memory-conversation:${channel}:${phone}`,
      currentStage: existing.currentStage || 'new_lead',
    });
    return {
      mode: 'memory-fallback',
      conversation: {
        id: saved.conversationId,
        customer_id: customerId,
        channel,
        status: 'open',
        current_stage: saved.currentStage,
      },
    };
  }

  if (existingConversationId) {
    const byId = await supabaseRequest(`/rest/v1/conversations?id=eq.${encodeURIComponent(existingConversationId)}&status=eq.open&limit=1&select=*`);
    if (Array.isArray(byId) && byId[0]) {
      return { mode: 'supabase', conversation: byId[0], reused: true };
    }
  }

  const found = await supabaseRequest(`/rest/v1/conversations?customer_id=eq.${encodeURIComponent(customerId)}&status=eq.open&order=last_message_at.desc&limit=1&select=*`);
  if (Array.isArray(found) && found[0]) {
    return { mode: 'supabase', conversation: found[0] };
  }

  const created = await supabaseRequest('/rest/v1/conversations', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: [{
      customer_id: customerId,
      channel,
      status: 'open',
      current_stage: 'new_lead',
      assigned_to: 'cleo',
      last_message_at: new Date().toISOString(),
    }],
  });

  return { mode: 'supabase', conversation: Array.isArray(created) ? created[0] : created };
}

module.exports = {
  getOrCreateCustomerByPhone,
  getOrCreateOpenConversation,
  updateConversationState,
};
