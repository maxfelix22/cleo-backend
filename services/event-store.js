const inMemoryEvents = [];
const { hasSupabaseConfig, supabaseRequest } = require('./supabase-client');

async function appendEvent(eventPayload = {}) {
  const payload = {
    kind: eventPayload.kind || 'message_event',
    conversation_id: eventPayload.conversation_id || null,
    customer_id: eventPayload.customer_id || null,
    channel: eventPayload.channel || 'whatsapp',
    direction: eventPayload.direction || 'inbound',
    message_text: eventPayload.message_text || '',
    payload: eventPayload.payload || {},
    created_at: new Date().toISOString(),
  };

  if (!hasSupabaseConfig()) {
    const memoryEvent = {
      id: `memory-event-${inMemoryEvents.length + 1}`,
      ...payload,
    };
    inMemoryEvents.push(memoryEvent);
    return { mode: 'memory-fallback', event: memoryEvent };
  }

  const created = await supabaseRequest('/rest/v1/events', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: [payload],
  });

  return {
    mode: 'supabase',
    event: Array.isArray(created) ? created[0] : created,
  };
}

function listMemoryEvents() {
  return [...inMemoryEvents];
}

module.exports = {
  appendEvent,
  listMemoryEvents,
};
