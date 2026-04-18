const inMemoryEvents = [];
const { hasSupabaseConfig, supabaseRequest } = require('./supabase-client');

async function appendEvent(eventPayload = {}) {
  const payload = {
    customer_id: eventPayload.customer_id || null,
    conversation_id: eventPayload.conversation_id || null,
    event_type: eventPayload.kind || 'message_event',
    payload: {
      channel: eventPayload.channel || 'whatsapp',
      direction: eventPayload.direction || 'inbound',
      message_text: eventPayload.message_text || '',
      ...(eventPayload.payload || {}),
    },
    created_at: new Date().toISOString(),
  };

  if (!hasSupabaseConfig()) {
    const memoryEvent = {
      id: `memory-event-${inMemoryEvents.length + 1}`,
      kind: payload.event_type,
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
