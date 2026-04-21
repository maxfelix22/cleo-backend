const fs = require('fs');
const path = require('path');

const FACTS_PATH = path.join('/home/maxwel/.openclaw/workspace', 'memory', 'context', 'business-facts-cleo.md');

function loadStoreFactsText() {
  if (!fs.existsSync(FACTS_PATH)) return '';
  return fs.readFileSync(FACTS_PATH, 'utf8');
}

function matchLine(text, label) {
  const regex = new RegExp(`- \*\*${label}:\*\*\\s*(.+)`, 'i');
  const match = text.match(regex);
  return match ? String(match[1] || '').trim() : '';
}

function getStoreFacts() {
  const text = loadStoreFactsText();
  return {
    publicName: matchLine(text, 'Nome público da loja'),
    owner: matchLine(text, 'Razão / proprietária'),
    address: matchLine(text, '79 Phelps St, Apt B, Marlborough, MA') ? '79 Phelps St, Apt B, Marlborough, MA' : '79 Phelps St, Apt B, Marlborough, MA',
    site: matchLine(text, 'Site'),
    linktree: matchLine(text, 'Linktree'),
    whatsapp: matchLine(text, 'WhatsApp oficial'),
    vipGroup: matchLine(text, 'Grupo VIP WhatsApp'),
    marlboroughFee: '$5',
    hudsonFee: '$8',
    uspsFee: '$10',
    freeShippingThreshold: '$99',
    hoursWeek: 'Segunda a sábado: 10am às 8pm',
    hoursSunday: 'Domingo: 2pm às 9pm',
    pickupRule: 'somente com horário marcado',
  };
}

module.exports = {
  getStoreFacts,
};
