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

function buildCrossSellHint(commercialFamily = '') {
  const family = normalizeText(commercialFamily);
  if (family === 'libido') return 'um lubrificante pra usar junto ou outra opção de libido na mesma linha';
  if (family === 'apertar') return 'um lubrificante pra usar junto ou outra opção mais nessa linha de apertadinha';
  if (family === 'masculino_retardante') return 'outra opção masculina mais nessa linha de durar mais';
  if (family === 'masculino_erecao') return 'outra opção masculina mais nessa linha de ereção e estímulo';
  if (family === 'masculino_volume') return 'outra opção masculina mais nessa linha de volume e intensidade';
  if (family === 'masculino') return 'outra opção masculina ou alguma linha complementar pra fechar melhor';
  if (family === 'oral_funcional') return 'outra opção pra oral mais funcional ou algum item da mesma pegada';
  if (family === 'oral_sensorial') return 'outra opção pra oral mais sensorial ou algum item da mesma pegada';
  if (family === 'lubrificacao_neutra') return 'outro gel mais neutro ou alguma linha complementar';
  if (family === 'lubrificacao_sensacao') return 'outro gel mais voltado para sensação ou alguma linha complementar';
  if (family === 'lubrificacao_especifica') return 'outro gel mais específico ou alguma linha complementar';
  if (family === 'visual') return 'outra peça da mesma linha ou algum complemento que combine';
  return 'mais uma opção nessa linha ou algum complemento';
}

module.exports = {
  inferCommercialFamily,
  inferFamilyGroup,
  inferCrossSellGroup,
  buildCrossSellHint,
};
