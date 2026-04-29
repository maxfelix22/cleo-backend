const fs = require('fs');
const path = require('path');

const FACTS_PATH = path.join('/home/maxwel/.openclaw/workspace', 'memory', 'context', 'business-facts-cleo.md');

function loadStoreFactsText() {
  if (!fs.existsSync(FACTS_PATH)) return '';
  return fs.readFileSync(FACTS_PATH, 'utf8');
}

function escapeRegExp(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchLine(text, label) {
  const safeLabel = escapeRegExp(label);
  const regex = new RegExp(`- \\*\\*${safeLabel}:\\*\\*\\s*(.+)`, 'i');
  const match = text.match(regex);
  return match ? String(match[1] || '').trim() : '';
}

function extractPaymentFact(text = '', label = '') {
  const value = matchLine(text, label);
  return value.replace(/^\*+|\*+$/g, '').trim();
}

function getStoreFacts() {
  const text = loadStoreFactsText();
  return {
    publicName: matchLine(text, 'Nome público da loja') || 'Bruna Campos Moda Íntima',
    owner: matchLine(text, 'Razão / proprietária') || 'Bruna Campos Samora Felix',
    address: '79 Phelps St, Apt B, Marlborough, MA',
    site: matchLine(text, 'Site') || 'https://www.brunacamposboutique.com',
    linktree: matchLine(text, 'Linktree') || 'https://linktr.ee/brunacamposmodaintima_',
    whatsapp: matchLine(text, 'WhatsApp oficial') || 'https://tr.ee/mlMK9AfviU',
    vipGroup: matchLine(text, 'Grupo VIP WhatsApp') || 'https://tr.ee/VWqn8cYpHo',
    zelle: extractPaymentFact(text, 'Zelle') || '508-618-9995 (Bruna Campos Samora Felix)',
    marlboroughFee: '$5',
    hudsonFee: '$8',
    uspsFee: '$10',
    freeShippingThreshold: '$99',
    hoursWeek: 'Segunda a sábado: 10am às 8pm',
    hoursSunday: 'Domingo: 2pm às 9pm',
    pickupRule: 'somente com horário marcado',
    localAreas: ['marlborough', 'hudson'],
    localCitiesSoft: ['framingham'],
    localDeliveryCopy: 'entrega local combinada',
    packagePickupCutoff: '11pm',
    packageDispatchTime: '8:30am',
  };
}

module.exports = {
  getStoreFacts,
};
