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

function listRepresentativeEntities() {
  return loadOntologyGraph()
    .map((entry) => entry.entity)
    .filter((entity) => entity.type === 'ProductRepresentative');
}

function findComparableRepresentatives(name = '') {
  const normalized = String(name || '').trim().toLowerCase();
  if (!normalized) return [];
  const reps = listRepresentativeEntities();
  return reps.filter((entity) => String(entity?.properties?.name || '').trim().toLowerCase() !== normalized);
}

function findComplementaryRepresentatives(name = '') {
  return findComparableRepresentatives(name).slice(0, 3);
}

function findRepresentativeByName(name = '') {
  const normalized = String(name || '').trim().toLowerCase();
  if (!normalized) return null;
  return listRepresentativeEntities().find((entity) => String(entity?.properties?.name || '').trim().toLowerCase() === normalized) || null;
}

function buildOntologyHint(product = {}) {
  const haystack = `${product?.name || ''}`.trim().toLowerCase();
  if (!haystack) return null;
  return listRepresentativeEntities().find((entity) => haystack.includes(String(entity?.properties?.name || '').trim().toLowerCase())) || null;
}

module.exports = {
  listRepresentativeEntities,
  findRepresentativeByName,
  buildOntologyHint,
  findComparableRepresentatives,
  findComplementaryRepresentatives,
};
