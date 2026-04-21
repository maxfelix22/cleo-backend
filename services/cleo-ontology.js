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
    .filter(Boolean);
}

function buildOntologyIndex() {
  const entries = loadOntologyGraph();
  const entities = new Map();
  const relations = [];

  entries.forEach((entry) => {
    if (entry.op === 'create' && entry.entity) {
      entities.set(entry.entity.id, entry.entity);
    }
    if (entry.op === 'relate') {
      relations.push({
        from: entry.from,
        rel: entry.rel,
        to: entry.to,
        properties: entry.properties || {},
      });
    }
  });

  return { entities, relations };
}

function normalize(value = '') {
  return String(value || '').trim().toLowerCase();
}

function listEntitiesByType(type) {
  const { entities } = buildOntologyIndex();
  return Array.from(entities.values()).filter((entity) => entity.type === type);
}

function listRepresentativeEntities() {
  return listEntitiesByType('ProductRepresentative');
}

function dedupeEntities(entities = []) {
  const seen = new Set();
  return entities.filter((entity) => {
    const id = entity?.id || '';
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function dedupeItemsByName(items = []) {
  const seen = new Set();
  return items.filter((item) => {
    const name = normalize(item?.name);
    if (!name || seen.has(name)) return false;
    seen.add(name);
    return true;
  });
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

function findRelatedEntities(entityId, relationType, direction = 'outgoing') {
  const { entities, relations } = buildOntologyIndex();
  if (!entityId) return [];

  const related = relations
    .filter((relation) => {
      if (direction === 'outgoing') return relation.from === entityId && relation.rel === relationType;
      if (direction === 'incoming') return relation.to === entityId && relation.rel === relationType;
      return relation.rel === relationType && (relation.from === entityId || relation.to === entityId);
    })
    .map((relation) => {
      const otherId = direction === 'incoming'
        ? relation.from
        : direction === 'outgoing'
          ? relation.to
          : relation.from === entityId ? relation.to : relation.from;
      return entities.get(otherId) || null;
    })
    .filter(Boolean);

  return dedupeEntities(related);
}

function findOutgoingRelatedNames(entityId, relationType) {
  return findRelatedEntities(entityId, relationType, 'outgoing')
    .map((entity) => entity?.properties?.name || '')
    .filter(Boolean)
    .map((name) => normalize(name));
}

function inferRepresentativeFamily(representative = {}) {
  const direct = findOutgoingRelatedNames(representative?.id, 'belongs_to')[0];
  if (direct) return direct;

  const name = normalize(representative?.properties?.name || representative?.name || '');
  if (/xana loka|sedenta|stimulus mulher/.test(name)) return 'libido';
  if (/sempre virgem|lacradinha/.test(name)) return 'apertadinha';
  if (/volumao|berinjelo|pinto loko|super pen/.test(name)) return 'masculino';
  if (/blow girl|xupa xana|garganta profunda|boca gostosa/.test(name)) return 'oral';
  if (/mylub|lub/.test(name)) return 'lubrificacao';
  return '';
}

function findComparableRepresentatives(name = '', limit = 2) {
  const current = findRepresentativeByName(name);
  if (current?.id) {
    const graphComparables = findRelatedEntities(current.id, 'compares_with', 'outgoing');
    if (graphComparables.length > 0) {
      return graphComparables.slice(0, limit);
    }
  }

  const currentFamily = inferRepresentativeFamily(current || { properties: { name } });
  const reps = listRepresentativeEntities()
    .filter((entity) => normalize(entity?.properties?.name) !== normalize(name));

  if (!currentFamily) {
    return dedupeEntities(reps).slice(0, limit);
  }

  const sameFamily = reps.filter((entity) => inferRepresentativeFamily(entity) === currentFamily);
  return dedupeEntities(sameFamily).slice(0, limit);
}

function findComplementaryRepresentatives(name = '', limit = 3) {
  const current = findRepresentativeByName(name);
  if (current?.id) {
    const graphComplements = findRelatedEntities(current.id, 'complements', 'outgoing');
    if (graphComplements.length > 0) {
      return dedupeEntities(graphComplements).slice(0, limit);
    }
  }

  const currentFamily = inferRepresentativeFamily(current || { properties: { name } });
  const reps = listRepresentativeEntities()
    .filter((entity) => normalize(entity?.properties?.name) !== normalize(name));

  if (currentFamily === 'libido' || currentFamily === 'apertadinha') {
    return dedupeEntities(reps.filter((entity) => inferRepresentativeFamily(entity) === 'lubrificacao')).slice(0, limit);
  }

  if (currentFamily === 'oral') {
    const oralPeers = reps.filter((entity) => inferRepresentativeFamily(entity) === 'oral');
    if (oralPeers.length) return dedupeEntities(oralPeers).slice(0, limit);
  }

  if (currentFamily === 'masculino') {
    const masculinePeers = reps.filter((entity) => inferRepresentativeFamily(entity) === 'masculino');
    if (masculinePeers.length) return dedupeEntities(masculinePeers).slice(0, limit);
  }

  return dedupeEntities(reps).slice(0, limit);
}

function buildAlternativeOntologyHints(product = {}, limit = 2) {
  const baseHint = buildOntologyHint(product);
  if (baseHint?.id) {
    const graphComparables = dedupeItemsByName(
      findRelatedEntities(baseHint.id, 'compares_with', 'outgoing')
        .map((entity) => ({
          name: entity?.properties?.name || '',
          angle: entity?.properties?.angle || '',
          family: inferRepresentativeFamily(entity),
        }))
        .filter((item) => item.name)
    ).slice(0, limit);

    if (graphComparables.length > 0) {
      return graphComparables;
    }
  }

  const family = inferRepresentativeFamily(baseHint || { properties: { name: product?.name || '' } });
  if (!family) return [];

  return dedupeItemsByName(
    listRepresentativeEntities()
      .filter((entity) => normalize(entity?.properties?.name) !== normalize(baseHint?.properties?.name))
      .filter((entity) => inferRepresentativeFamily(entity) === family)
      .map((entity) => ({
        name: entity?.properties?.name || '',
        angle: entity?.properties?.angle || '',
        family,
      }))
  ).slice(0, limit);
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
  findRelatedEntities,
};
