const express = require('express');
const router = express.Router();
const { Client, Environment } = require('square');
const fs = require('fs');
const path = require('path');

const client = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN,
  environment: Environment.Production,
})

// ============================================================
// MAPA SEMÂNTICO — Como clientes falam vs o que buscar
// Baseado em 7754 conversas reais da Bruna Campos
// ============================================================
const SEMANTIC_MAP = [
  // EXCITANTES FEMININOS
  { regex: /excita|tesao|tesão|apimenta|vontade de transar|esquenta a buceta|molha|fica molhada|libido|desejo|afrodisiaco|afrodisíaco|aumentar prazer feminino|mais prazer|vibra na buceta|xana loka|goze|goze\+|sedenta|siri ryka/i, terms: ['xana loka', 'goze excitante', 'excitante feminino', 'sedenta'] },

  // EXCITANTES MASCULINOS
  { regex: /ereção|erecao|ficar duro|levantar|volumao|volumão|berinjelo|pinto loko|retardante|durar mais|demora gozar|resistencia|resistência|excitante masculino|homem excitar/i, terms: ['volumão', 'berinjelo', 'pinto loko', 'excitante masculino'] },

  // GÉIS ORAIS / SEXO ORAL
  { regex: /oral|boquete|felaçao|felacao|chupar|lamber|gozar na boca|sexo oral|garganta profunda|xupa xana|blow girl|sugalik|pico pulse|sabor|afrodisiaco oral/i, terms: ['xupa xana', 'blow girl', 'oral', 'garganta profunda', 'gel beijável'] },

  // VIBRADORES
  { regex: /vibrador|vibra|bullet|sugador|wearable|rabbit|ponto g|ponto-g|dildo|masturbador feminin|se masturbar|prazer sozinha|sozinha|buzz|bzzz/i, terms: ['vibrador', 'bullet', 'sugador', 'rabbit'] },

  // HOT BALLS / BOLINHAS
  { regex: /bolinha|hot ball|capsulas|capsula|estoura|esquenta gela|frio quente|picante frio|babaluu|satisfaction caps/i, terms: ['hot ball', 'bolinha', 'babaluu', 'capsula'] },

  // LUBRIFICANTES
  { regex: /lubrificante|lubrifican|lube|resseca|seca|dor na penetracao|dor penetração|deslizante|deslizar|facilitar penetracao|anal lube|lubri/i, terms: ['lubrificante', 'lube', 'deslizante', 'mylub'] },

  // DESSENSIBILIZANTE / ANAL
  { regex: /anal|retard|relaxar anus|ânus|dor no anal|facilitar anal|dessensibiliza|desensibiliza|primer anal/i, terms: ['dessensibilizante', 'anal', 'primer'] },

  // LINGERIES
  { regex: /lingerie|conjunto|calcinha sutia|soutien|renda|tule|transparente|sensual se vestir|presente pra namorada|look sensual|calcinha sutiã/i, terms: ['lingerie', 'conjunto'] },

  // CAMISOLAS / BABY DOLLS
  { regex: /camisola|baby.?doll|baby dol|negligé|negligee|robe|quimono|look de dormir|roupa de dormir|noite especial/i, terms: ['camisola', 'baby doll', 'robe'] },

  // FANTASIAS
  { regex: /fantasia|fantasi|médica|medica|policial|coelha|fazendeira|militar|bombeira|estudante|roleplay|role play|jogo erótico/i, terms: ['fantasia'] },

  // PERFUME DE CALCINHA
  { regex: /perfume|cheirosa|cheiro intimo|perfume intimo|perfume de calcinha|fragrancia|fragrance|smells good/i, terms: ['perfume calcinha', 'perfume íntimo'] },

  // SABONETE ÍNTIMO / HIGIENE
  { regex: /sabonete|higiene intima|ph intimo|lavar partes intimas|odor intimo|cuidado intimo|limpeza intima|babbaloko/i, terms: ['sabonete íntimo', 'higiene', 'babbaloko'] },

  // ADSTRINGENTE
  { regex: /adstringente|virgindade|apertar|ficar mais aperta|sempre virgem|virginal|contrai/i, terms: ['adstringente', 'sempre virgem', 'hamamelis'] },

  // ESTIMULANTE CLITÓRIS
  { regex: /clitoris|clitóris|estimulador|estimula clitoris|prazer clitoris/i, terms: ['estimulador', 'clitóris', 'bullet'] },

  // PRESERVATIVOS
  { regex: /camisinha|preservativo|condom|proteção|proteção sexual/i, terms: ['preservativo', 'camisinha'] },

  // ANEL PENIANO
  { regex: /anel peniano|cock ring|retarda ejaculacao|anel penis|anel pênis/i, terms: ['anel peniano'] },

  // KIT / COMBO
  { regex: /kit|combo|conjunto de produtos|pacote|tudo junto|presente kit|caixa secreta/i, terms: ['kit', 'combo', 'stimulus', 'caixa secreta'] },

  // ESTÍMULO DUPLO
  { regex: /stimulus|estimulo duplo|casal|pro casal|pra nos dois|duplo prazer/i, terms: ['stimulus', 'kit casal', 'combo casal'] },

  // RASPADINHA / AFRODISÍACO BEBÍVEL
  { regex: /raspadinha|raspa|afrodisiaco pra beber|shot afrodisiaco|bebida afrodisiaca|chazinho do amor/i, terms: ['raspadinha', 'afrodisiaco'] },

  // MASTURBADOR MASCULINO
  { regex: /masturbador|masturbacao masculina|soca soca|punheta|punheta artificial|masturbador egg|egg/i, terms: ['masturbador', 'egg'] },

  // BIQUÍNI / MODA PRAIA
  { regex: /biquini|biquíni|moda praia|praia|sunga|maio|calcinha de praia/i, terms: ['biquíni', 'moda praia'] },

  // CARMED / PROTETOR LABIAL
  { regex: /carmed|protetor labial|baton|gloss|lábio|hidratante labial/i, terms: ['carmed', 'fini', 'protetor labial'] },

  // SUPLEMENTO / COLÁGENO
  { regex: /suplemento|colageno|colágeno|happy hair|happy sleep|cabelo unhas|vitamina/i, terms: ['happy hair', 'happy collagen', 'suplemento'] },

  // ACESSÓRIOS
  { regex: /algema|venda|mordaça|chicote|flogger|bdsm|dominação|submissão|bondage/i, terms: ['algema', 'acessórios', 'dominatrix'] },
];

// ============================================================
// FUNÇÃO: Tradução semântica da query do cliente
// ============================================================
function semanticTranslate(query) {
  const q = (query || '').toLowerCase();
  const extras = [];

  for (const rule of SEMANTIC_MAP) {
    if (rule.regex.test(q)) {
      extras.push(...rule.terms);
    }
  }

  // Se encontrou termos semânticos, retorna a union
  if (extras.length > 0) {
    // Retorna query original + termos semânticos (sem duplicar)
    const all = [q, ...extras];
    return [...new Set(all)].join(' ');
  }

  return q;
}

// ============================================================
// FUNÇÃO: Score de relevância de produto
// ============================================================
function scoreProduto(item, termosArray) {
  const nome = (item.itemData?.name || '').toLowerCase();
  const descricao = (item.itemData?.description || '').toLowerCase();
  const categorias = (item.itemData?.categories || [])
    .map(c => c.name || '').join(' ').toLowerCase();
  const texto = `${nome} ${descricao} ${categorias}`;

  let score = 0;

  for (const termo of termosArray) {
    const t = termo.toLowerCase().trim();
    if (!t) continue;

    // Nome exato = maior peso
    if (nome === t) score += 30;
    else if (nome.startsWith(t)) score += 20;
    else if (nome.includes(t)) score += 15;

    // Descrição
    if (descricao.includes(t)) score += 5;

    // Categoria
    if (categorias.includes(t)) score += 8;

    // Palavras individuais
    const palavras = t.split(/\s+/);
    for (const p of palavras) {
      if (p.length < 3) continue;
      if (nome.includes(p)) score += 3;
      if (descricao.includes(p)) score += 1;
      if (categorias.includes(p)) score += 2;
    }
  }

  return score;
}

// ============================================================
// FUNÇÃO: Formatar imagem do produto
// ============================================================
function getImageUrl(item) {
  const imageIds = item.itemData?.imageIds || item.itemData?.image_ids || [];
  if (Array.isArray(imageIds) && imageIds.length > 0) {
    return `https://items-images-production.s3.us-west-2.amazonaws.com/files/${imageIds[0]}/original.jpeg`;
  }
  return null;
}

// ============================================================
// ENDPOINT PRINCIPAL: /square/products-simple
// Com busca semântica + score de relevância
// ============================================================
router.get('/square/products-simple', async (req, res) => {
  try {
    const queryRaw = (req.query.query || '').trim();
    const limit = parseInt(req.query.limit) || 20;

    // Tradução semântica
    const queryExpandida = semanticTranslate(queryRaw);
    const termos = queryExpandida.split(/\s+/).filter(t => t.length >= 2);

    // Buscar catálogo completo do Square
    let allItems = [];
    let cursor = undefined;

    do {
      const response = await client.catalogApi.listCatalog(cursor);
      if (response.result?.objects) {
        allItems = allItems.concat(response.result.objects);
      }
      cursor = response.result?.cursor;
    } while (cursor);

    // Filtrar apenas ativos e presentes
    console.log('[SQUARE DEBUG] total:', allItems.length); const ativos = allItems.filter(item =>
      item.type === 'ITEM' &&
      !item.isDeleted &&
      item.itemData?.name
    );

    // Se não tem query, retorna mais vendidos / lista geral
    if (!queryRaw) {
      const formatados = ativos.slice(0, limit).map(item => formatItem(item));
      return res.json(formatados);
    }

    // Score + rank
    const comScore = ativos
      .map(item => ({ item, score: scoreProduto(item, termos) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score);

    // Se não achou nada com score, faz busca mais ampla (só 1 termo por vez)
    let resultado = comScore;
    if (resultado.length === 0 && queryRaw) {
      const termoUnico = [queryRaw.toLowerCase()];
      resultado = ativos
        .map(item => ({ item, score: scoreProduto(item, termoUnico) }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score);
    }

    const formatados = resultado.slice(0, limit).map(({ item }) => formatItem(item));
    res.json(formatados);

  } catch (err) {
    console.error('Erro products-simple:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// ENDPOINT: /square/products-by-category
// ============================================================
router.get('/square/products-by-category', async (req, res) => {
  try {
    const categoria = (req.query.category || '').toLowerCase();
    const limit = parseInt(req.query.limit) || 15;

    let allItems = [];
    let cursor = undefined;

    do {
      const response = await client.catalogApi.listCatalog(cursor);
      if (response.result?.objects) {
        allItems = allItems.concat(response.result.objects);
      }
      cursor = response.result?.cursor;
    } while (cursor);

    const filtrados = allItems.filter(item => {
      if (item.type !== 'ITEM' || item.isDeleted || !item.itemData?.name) return false;
      const cats = (item.itemData?.categories || [])
        .map(c => (c.name || '').toLowerCase())
        .join(' ');
      const nome = (item.itemData?.name || '').toLowerCase();
      return cats.includes(categoria) || nome.includes(categoria);
    });

    res.json(filtrados.slice(0, limit).map(formatItem));

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// ENDPOINT: /square/best-sellers
// Retorna os mais vendidos/recomendados da loja
// ============================================================
router.get('/square/best-sellers', async (req, res) => {
  try {
    // Produtos mais vendidos identificados manualmente
    const MAIS_VENDIDOS = [
      'xana loka', 'goze', 'xupa xana', 'volumão', 'berinjelo',
      'tesão de vaca', 'love chic', 'blow girl', 'stimulus',
      'hot ball', 'babaluu', 'raspadinha'
    ];

    let allItems = [];
    let cursor = undefined;

    do {
      const response = await client.catalogApi.listCatalog(cursor);
      if (response.result?.objects) {
        allItems = allItems.concat(response.result.objects);
      }
      cursor = response.result?.cursor;
    } while (cursor);

    const bestSellers = [];
    for (const keyword of MAIS_VENDIDOS) {
      const found = allItems.find(item =>
        item.type === 'ITEM' &&
        !item.isDeleted &&
        (item.itemData?.name || '').toLowerCase().includes(keyword)
      );
      if (found) bestSellers.push(formatItem(found));
    }

    res.json(bestSellers);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// ENDPOINT: /square/log-miss — Auto-aprendizagem
// Loga queries que não encontraram produto
// ============================================================
const missLog = [];
router.post('/square/log-miss', (req, res) => {
  const { query, telefone, timestamp } = req.body || {};
  if (query) {
    const entry = {
      query,
      telefone: telefone || 'unknown',
      timestamp: timestamp || new Date().toISOString(),
    };
    missLog.push(entry);
    // Manter só últimos 500
    if (missLog.length > 500) missLog.shift();
    console.log(`[MISS LOG] Query não encontrada: "${query}"`);
  }
  res.json({ ok: true });
});

// Ver queries sem resultado (para análise)
router.get('/square/miss-log', (req, res) => {
  const freq = {};
  for (const entry of missLog) {
    freq[entry.query] = (freq[entry.query] || 0) + 1;
  }
  const sorted = Object.entries(freq)
    .sort(([, a], [, b]) => b - a)
    .map(([query, count]) => ({ query, count }));
  res.json({ total: missLog.length, topMisses: sorted.slice(0, 30) });
});

// ============================================================
// SESSION CACHE — Memória rápida por telefone
// Resolve race condition do Google Sheets (sub-1ms vs 500ms)
// Dados: nome, last_product, last_price, stage, gender
// ⚠️ In-memory: reseta quando Replit reinicia
//    Para persistência total: migrar para Supabase Postgres
// ============================================================
const SESSION_CACHE = new Map();
const SESSION_TTL = 8 * 60 * 60 * 1000; // 8 horas

// GET /session/:phone — carrega sessão do cliente
router.get('/session/:phone', (req, res) => {
  const phone = req.params.phone;
  const session = SESSION_CACHE.get(phone);
  if (!session) return res.json({ found: false });
  // Expirar sessões antigas
  if (Date.now() - session.updatedAt > SESSION_TTL) {
    SESSION_CACHE.delete(phone);
    return res.json({ found: false });
  }
  res.json({ found: true, ...session });
});

// POST /session/:phone — salva/atualiza sessão (merge parcial)
router.post('/session/:phone', (req, res) => {
  const phone = req.params.phone;
  const existing = SESSION_CACHE.get(phone) || {};
  const updated = {
    ...existing,
    ...req.body,
    updatedAt: Date.now(),
    createdAt: existing.createdAt || Date.now(),
  };
  SESSION_CACHE.set(phone, updated);
  res.json({ ok: true, session: updated });
});

// DELETE /session/:phone — limpa sessão (para reset manual)
router.delete('/session/:phone', (req, res) => {
  SESSION_CACHE.delete(req.params.phone);
  res.json({ ok: true });
});

// GET /session-stats — quantas sessões ativas
router.get('/session-stats', (req, res) => {
  const now = Date.now();
  const active = [...SESSION_CACHE.values()].filter(s => now - s.updatedAt < SESSION_TTL);
  res.json({ total: SESSION_CACHE.size, active: active.length });
});

// ============================================================
// FUNÇÃO AUXILIAR: Formatar item do Square
// ============================================================
function formatItem(item) {
  const data = item.itemData || {};
  const variations = Array.isArray(data.variations) ? data.variations : [];

  let preco = null;
  let priceMin = null;
  let priceMax = null;

  const formattedVariations = variations.map(v => {
    const variationData = v.itemVariationData || {};
    const amount = variationData?.priceMoney?.amount;
    const price = (amount !== undefined && amount !== null)
      ? Number(amount) / 100
      : null;

    if (price !== null) {
      if (priceMin === null || price < priceMin) priceMin = price;
      if (priceMax === null || price > priceMax) priceMax = price;
      if (preco === null) preco = price;
    }

    return {
      id: v.id || '',
      name: variationData.name || '',
      price,
      available: !v.isDeleted,
    };
  });

  const imagemUrl = getImageUrl(item);

  const categorias = Array.isArray(data.categories)
    ? data.categories.map(c => c?.name).filter(Boolean)
    : [];

  return {
    id: item.id,
    name: data.name || '',
    description: (data.description || '').replace(/<[^>]*>/g, '').substring(0, 500),
    price: preco,
    price_min: priceMin,
    price_max: priceMax,
    image: imagemUrl,
    has_image: !!imagemUrl,
    categories: categorias,
    available: !item.isDeleted,
    variation_count: formattedVariations.length,
    variations: formattedVariations,
  };
}

module.exports = router;
