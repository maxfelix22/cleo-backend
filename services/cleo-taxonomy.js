function normalizeText(value = '') {
  return String(value || '').toLowerCase().trim();
}

function buildHaystack(product = {}) {
  return normalizeText(`${product?.name || ''} ${product?.description || ''}`);
}

function inferCommercialFamily(product = {}) {
  const text = buildHaystack(product);
  if (/sempre virgem|lacradinha|adstring|hamamelis|contra[ií]/.test(text)) return 'apertar';
  if (/xana loka|stimulus mulher|sedenta|libido|tes[aã]o|excitante feminino/.test(text)) return 'libido';
  if (/retard|durar mais/.test(text)) return 'masculino_retardante';
  if (/ere[cç][aã]o|super pen|pinto loko/.test(text)) return 'masculino_erecao';
  if (/berinjelo|volum[aã]o/.test(text)) return 'masculino_volume';
  if (/homem|masculino/.test(text)) return 'masculino';
  if (/blow girl|xupa xana|garganta profunda/.test(text)) return 'oral_funcional';
  if (/oral|beij[aá]vel|sabor|boca gostosa/.test(text)) return 'oral_sensorial';
  if (/lubrificante|mylub|deslizante|neutro/.test(text)) return 'lubrificacao_neutra';
  if (/anal|dessensibilizante/.test(text)) return 'lubrificacao_especifica';
  if (/esquenta|esfria|hot/.test(text)) return 'lubrificacao_sensacao';
  if (/lingerie|camisola|baby.?doll|body|conjunto|fantasia/.test(text)) return 'visual';
  if (/vibrador|bullet|sugador|dildo|egg|masturbador/.test(text)) return 'toy';
  return 'geral';
}

function inferFamilyGroup(commercialFamily = '') {
  const family = normalizeText(commercialFamily);
  if (family.startsWith('masculino')) return 'masculino';
  if (family.startsWith('oral')) return 'oral';
  if (family.startsWith('lubrificacao')) return 'lubrificacao';
  return family || 'geral';
}

function inferCrossSellGroup(commercialFamily = '') {
  const family = normalizeText(commercialFamily);
  if (family === 'libido') return 'lubrificacao';
  if (family === 'apertar') return 'lubrificacao';
  if (family.startsWith('masculino')) return 'masculino';
  if (family.startsWith('oral')) return 'oral';
  if (family.startsWith('lubrificacao')) return 'lubrificacao';
  if (family === 'visual') return 'visual';
  return 'geral';
}

module.exports = {
  inferCommercialFamily,
  inferFamilyGroup,
  inferCrossSellGroup,
};
