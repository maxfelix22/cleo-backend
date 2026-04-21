const fs = require('fs');
const path = require('path');

const GRAPH_PATH = path.join('/home/maxwel/.openclaw/workspace', 'memory', 'ontology', 'graph.jsonl');

function loadOntologyGraph() {
  if (!fs.existsSync(GRAPH_PATH)) {
    return [];
  }

  const raw = fs.readFileSync(GRAPH_PATH, 'utf8');
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .filter((entry) => entry.op === 'create' && entry.entity);
}

function listEntitiesByType(type) {
  return loadOntologyGraph()
    .map((entry) => entry.entity)
    .filter((entity) => entity.type === type);
}

function listRepresentativeEntities() {
  return listEntitiesByType('ProductRepresentative');
}

function normalize(value = '') {
  return String(value || '').trim().toLowerCase();
}

function inferRepresentativeFamily(representative = {}) {
  const name = normalize(representative?.properties?.name || representative?.name || '');
  if (/xana loka|sedenta|stimulus mulher/.test(name)) return 'libido';
  if (/sempre virgem|lacradinha/.test(name)) return 'apertadinha';
  if (/volumao|berinjelo|pinto loko|super pen/.test(name)) return 'masculino';
  if (/blow girl|xupa xana|garganta profunda|boca gostosa/.test(name)) return 'oral';
  if (/mylub|lub/.test(name)) return 'lubrificacao';
  return '';
}

function findRepresentativeByName(name = '') {
  const normalized = normalize(name);
  if (!normalized) return null;
  return listRepresentativeEntities().find((entity) => normalize(entity?.properties?.name) === normalized) || null;
}

function buildOntologyHint(product = {}) {
  const haystack = normalize(product?.name || '');
  if (!haystack) return null;
  return listRepresentativeEntities().find((entity) => haystack.includes(normalize(entity?.properties?.name))) || null;
}

function findComparableRepresentatives(name = '', limit = 2) {
  const current = findRepresentativeByName(name);
  const currentFamily = inferRepresentativeFamily(current || { properties: { name } });
  const reps = listRepresentativeEntities()
    .filter((entity) => normalize(entity?.properties?.name) !== normalize(name));

  if (!currentFamily) {
    return reps.slice(0, limit);
  }

  const sameFamily = reps.filter((entity) => inferRepresentativeFamily(entity) === currentFamily);
  return sameFamily.slice(0, limit);
}

function findComplementaryRepresentatives(name = '', limit = 3) {
  const current = findRepresentativeByName(name);
  const currentFamily = inferRepresentativeFamily(current || { properties: { name } });
  const reps = listRepresentativeEntities()
    .filter((entity) => normalize(entity?.properties?.name) !== normalize(name));

  if (currentFamily === 'libido' || currentFamily === 'apertadinha') {
    return reps.filter((entity) => inferRepresentativeFamily(entity) === 'lubrificacao').slice(0, limit);
  }

  if (currentFamily === 'oral') {
    const oralPeers = reps.filter((entity) => inferRepresentativeFamily(entity) === 'oral');
    if (oralPeers.length) return oralPeers.slice(0, limit);
  }

  if (currentFamily === 'masculino') {
    const masculinePeers = reps.filter((entity) => inferRepresentativeFamily(entity) === 'masculino');
    if (masculinePeers.length) return masculinePeers.slice(0, limit);
  }

  return reps.slice(0, limit);
}

function buildAlternativeOntologyHints(product = {}, limit = 2) {
  const baseHint = buildOntologyHint(product);
  const family = inferRepresentativeFamily(baseHint || { properties: { name: product?.name || '' } });
  if (!family) return [];

  return listRepresentativeEntities()
    .filter((entity) => normalize(entity?.properties?.name) !== normalize(baseHint?.properties?.name))
    .filter((entity) => inferRepresentativeFamily(entity) === family)
    .slice(0, limit)
    .map((entity) => ({
      name: entity?.properties?.name || '',
      angle: entity?.properties?.angle || '',
      family,
    }));
}

module.exports = {
  listEntitiesByType,
  listRepresentativeEntities,
  findRepresentativeByName,
  buildOntologyHint,
  findComparableRepresentatives,
  findComplementaryRepresentatives,
  buildAlternativeOntologyHints,
  inferRepresentativeFamily,
};
