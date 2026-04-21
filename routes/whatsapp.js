const express = require('express');
const router = express.Router();

const { normalizeWhatsAppInbound } = require('../lib/whatsapp-normalize');
const { sendWhatsAppMessage, hasRealTwilioConfig } = require('../services/whatsapp-outbound');
const { buildInitialReply, extractRequestedSize } = require('../services/whatsapp-context');

function shouldUseAgenticDiscovery(inbound = {}, context = {}, products = []) {
  const text = String(inbound?.text || '').trim().toLowerCase();
  const stage = String(context?.currentStage || context?.checkout?.stage || '');
  if (!text) return false;
  if (stage && /checkout_|handoff_ready/.test(stage)) return false;
  if (/quero esse|quero essa|vou querer|gostei desse|gostei dessa|quanto custa|preço|preco|valor|tem no tamanho|outra cor|outras cores/.test(text)) return false;
  if (!Array.isArray(products) || products.length === 0) return false;
  return /tem\s+|você tem|vc tem|trabalha com|algo pra|algo para|tem algo|me indica|me mostra|o que você tem/.test(text);
}

function extractRequestedQuantity(text = '') {
  const normalized = String(text || '').toLowerCase();
  const match = normalized.match(/(?:quero|vou querer|quero levar|leva|me vê|me ver|separa|manda)\s+(\d{1,2})\b/);
  return match ? Number(match[1]) : 0;
}

function isDirectPurchaseIntent(text = '') {
  return /(quero|vou querer|quero levar|leva|me vê|me ver|separa|manda)\s+\d*\s*(desse|dessa|dele|dela|do|da|unidade|unidades)?/i.test(String(text || ''));
}

function detectMultiItemIntent(text = '') {
  const normalized = String(text || '').toLowerCase();
  if (!/(quero|vou querer|quero levar|leva|me vê|me ver|separa)/.test(normalized)) return false;
  const commaParts = normalized.split(',').filter(Boolean).length;
  const connectors = (normalized.match(/\be\b/g) || []).length;
  const quantityMentions = (normalized.match(/\b\d+\b/g) || []).length;
  return commaParts > 1 || connectors >= 2 || quantityMentions >= 2;
}

function parseMultiItemText(text = '') {
  const normalized = String(text || '').trim();
  if (!normalized) return [];
  return normalized
    .split(/,|\be\b/i)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const quantityMatch = part.match(/\b(\d{1,2})\b/);
      const quantity = quantityMatch ? Number(quantityMatch[1]) : 1;
      const cleaned = part
        .replace(/^(vou querer|quero|quero levar|leva|me vê|me ver|separa)\s+/i, '')
        .replace(/\b(\d{1,2})\b/, '')
        .trim();
      const commercialFamily = inferCommercialFamily({ name: cleaned || part, description: '' });
      return {
        quantity,
        label: cleaned || part,
        commercialFamily,
      };
    });
}

function buildMultiItemReply(inbound = {}) {
  const text = String(inbound?.text || '').trim();
  const items = parseMultiItemText(text);
  const itemLine = items.length > 0
    ? items.map((item) => `${item.quantity}x ${item.label}`).join(', ')
    : text;
  return `Fechou 💜 Já anotei esse pedido com mais de um item: *${itemLine}*. Agora me confirma só se você prefere *pickup*, *entrega em Marlborough* ou *envio por USPS*.`;
}

function buildUsOnlyShippingReply() {
  return 'Sim amore 💜 Enviamos dentro dos Estados Unidos sim. Se você quiser, eu também te passo certinho o valor do frete para o seu pedido.';
}

function buildContextualShippingReply(context = {}, inbound = {}) {
  const text = String(inbound?.text || '').toLowerCase();
  if (/marlboro|marlborough/.test(text)) {
    return 'Pra entrega local em *Marlborough*, fica *$5* 💜';
  }

  const anchoredProduct = context?.lastProducts?.[0] || context?.lastProductPayload || null;
  const quantity = Number(context?.checkout?.quantity || 1) || 1;
  const priceNumber = Number(anchoredProduct?.priceNumber || String(anchoredProduct?.price || '').replace(/[^\d.]/g, '')) || 0;
  const orderTotal = priceNumber * quantity;
  const productName = anchoredProduct?.name || context?.lastProduct || '';
  const uspsCopy = orderTotal >= 99
    ? 'o envio por USPS fica com *frete grátis* 💜'
    : 'o envio por USPS fica em *$10* 💜';

  if (productName) {
    return `Pra *${productName}*, ${uspsCopy}`;
  }

  return `Enviamos sim amore 💜 ${uspsCopy}`;
}

function inferComparisonFamily(text = '', product = null) {
  const normalized = String(text || '').toLowerCase();
  if (/libido|desejo|vontade|tes[aã]o|excit|xana loka|sedenta|stimulus mulher/.test(normalized)) return 'libido';
  if (/apertad|sempre virgem|adstring|lacradinha/.test(normalized)) return 'apertar';
  if (/durar mais|retard|ere[cç][aã]o|volum[aã]o|berinjelo|pinto loko|stimulus homem/.test(normalized)) return 'masculino';
  if (/oral|blow girl|xupa xana|beij[aá]vel|garganta profunda/.test(normalized)) return 'oral';
  if (/lubrific|mylub|deslizante|sedenta molhada/.test(normalized)) return 'lubrificacao';
  return inferFamilyGroup(inferCommercialFamily(product || {}));
}

function inferProductAngle(product = {}, family = 'geral') {
  const text = `${product?.name || ''} ${product?.description || ''}`.toLowerCase();

  if (family === 'libido') {
    if (/xana loka|stimulus mulher/.test(text)) return 'mais direta';
    if (/sedenta|molhada/.test(text)) return 'mais voltada para excitação e lubrificação';
    return 'mais focada em libido';
  }

  if (family === 'apertar') {
    if (/sempre virgem/.test(text)) return 'mais direta';
    if (/lacradinha|adstring/.test(text)) return 'mais funcional';
    return 'mais focada em contração';
  }

  if (family === 'masculino') {
    if (/retard/.test(text)) return 'mais para durar mais';
    if (/berinjelo|volum[aã]o/.test(text)) return 'mais para volume e estímulo';
    if (/ere[cç][aã]o|super pen|pinto loko/.test(text)) return 'mais para ereção e estímulo';
    return 'mais masculina';
  }

  if (family === 'oral') {
    if (/blow girl|xupa xana|garganta profunda/.test(text)) return 'mais funcional';
    if (/beij[aá]vel|sabor|boca gostosa/.test(text)) return 'mais sensorial';
    return 'mais voltada para oral';
  }

  if (family === 'lubrificacao') {
    if (/neutro|mylub|deslizante/.test(text)) return 'mais neutra';
    if (/esquenta|esfria|hot/.test(text)) return 'mais para sensação';
    if (/anal|dessensibilizante/.test(text)) return 'mais específica';
    return 'mais para lubrificação';
  }

  return 'mais nessa linha';
}

function pickComparisonIntro(text = '') {
  if (/qual (é|e) melhor|qual compensa mais/.test(text)) return 'Eu iria mais de';
  if (/qual (é|e) mais forte/.test(text)) return 'O mais forte aqui me parece';
  if (/qual a diferen[cç]a/.test(text)) return 'A diferença aqui é que';
  return 'Eu iria mais de';
}

function buildContextualComparisonReply(context = {}, inbound = {}) {
  const text = String(inbound?.text || '').trim().toLowerCase();
  const anchoredProducts = Array.isArray(context?.lastProducts) ? context.lastProducts.filter(Boolean) : [];
  let [first, second] = anchoredProducts;
  if (!first) return '';

  if (!second) {
    const ontologyPairs = findComparableRepresentatives(first?.name || '');
    if (ontologyPairs[0]) {
      second = { name: ontologyPairs[0].properties?.name || ontologyPairs[0].name || '' };
    }
  }

  if (/qual (é|e) melhor|qual (é|e) mais forte|qual a diferen[cç]a|qual muda mais|qual compensa mais/.test(text)) {
    const family = inferComparisonFamily(`${text} ${first?.name || ''} ${second?.name || ''}`, first);
    const intro = pickComparisonIntro(text);

    if (family === 'libido' && second) {
      return `${intro} *${first.name}* 💜 O *${first.name}* me parece ${inferProductAngle(first, family)}, e o *${second.name}* fica mais como ${inferProductAngle(second, family)}.`;
    }

    if (family === 'apertar' && second) {
      return `${intro} *${first.name}* 💜 O *${first.name}* entra de forma ${inferProductAngle(first, family)} e o *${second.name}* fica mais como ${inferProductAngle(second, family)}.`;
    }

    if ((family === 'masculino' || family === 'geral') && second) {
      return `${intro} *${first.name}* 💜 O *${first.name}* vai mais como ${inferProductAngle(first, family === 'geral' ? 'masculino' : family)} e o *${second.name}* entra mais como ${inferProductAngle(second, family === 'geral' ? 'masculino' : family)}.`;
    }

    if (family === 'oral' && second) {
      return `${intro} *${first.name}* 💜 O *${first.name}* me parece ${inferProductAngle(first, family)} e o *${second.name}* fica mais como ${inferProductAngle(second, family)}.`;
    }

    if (family === 'lubrificacao' && second) {
      return `${intro} *${first.name}* 💜 O *${first.name}* fica mais como ${inferProductAngle(first, family)} e o *${second.name}* mais como ${inferProductAngle(second, family)}.`;
    }

    if (second) {
      return `${intro} *${first.name}* 💜 Se você quiser, eu também te digo rapidinho a diferença entre eles.`;
    }
    return `${intro} *${first.name}* 💜 Se você quiser, eu também te mostro outra opção parecida pra comparar.`;
  }

  return '';
}

function inferCrossSellFamily(product = {}) {
  return inferCrossSellGroup(inferCommercialFamily(product || {}));
}

function pickSoftCloseIntro(text = '') {
  if (/amei|adorei/.test(text)) return 'Amei esse também 💜';
  if (/gostei|curti/.test(text)) return 'Lindo né? 💜';
  if (/vou pensar/.test(text)) return 'Claro amore 💜';
  return 'Perfeito 💜';
}

function pickCrossSellIntro(text = '') {
  if (/mais alguma sugest[aã]o|tem mais alguma dica/.test(text)) return 'Tenho sim 💜';
  if (/tem mais alguma coisa|tem algo a mais/.test(text)) return 'Tem sim 💜';
  return 'Tenho sim 💜';
}

function buildCrossSellReply(context = {}, inbound = {}) {
  const text = String(inbound?.text || '').trim().toLowerCase();
  const anchoredProduct = context?.lastProducts?.[0] || context?.lastProductPayload || null;
  const productName = anchoredProduct?.name || context?.lastProduct || '';
  if (!productName) return '';

  if (!/tem mais alguma coisa|mais alguma sugest[aã]o|mais alguma op[cç][aã]o|tem algo a mais|tem mais alguma dica/.test(text)) {
    return '';
  }

  const intro = pickCrossSellIntro(text);
  const commercialFamily = inferCommercialFamily(anchoredProduct || {});
  const hint = buildCrossSellHint(commercialFamily);
  const ontologyComplements = findComplementaryRepresentatives(productName);
  const complementName = ontologyComplements[0]?.properties?.name || '';
  if (complementName) {
    return `${intro} Junto com *${productName}*, eu te mostraria ${hint}, como *${complementName}*.`;
  }
  return `${intro} Junto com *${productName}*, eu te mostraria ${hint}.`;
}

function buildSoftCloseReply(context = {}, inbound = {}) {
  const text = String(inbound?.text || '').trim().toLowerCase();
  const anchoredProduct = context?.lastProducts?.[0] || context?.lastProductPayload || null;
  const productName = anchoredProduct?.name || context?.lastProduct || '';
  if (!productName) return '';
  const intro = pickSoftCloseIntro(text);

  if (/vou querer|quero sim|fech[ao]|pode separar|quero levar/.test(text)) {
    const checkout = context?.checkout || {};
    const deliveryMode = String(checkout.deliveryMode || '').toLowerCase();
    const hasFullName = Boolean(checkout.fullName);
    const hasContact = Boolean(checkout.email || checkout.phone);
    const hasAddress = Boolean(checkout.address);
    const intro = pickCloseIntro(text);

    if (deliveryMode === 'pickup') {
      if (!hasFullName) {
        return `${intro} Então eu já sigo com *${productName}* em *pickup*. Me manda só o nome completo para eu continuar.`;
      }
      if (!hasContact) {
        return `${intro} Então eu já sigo com *${productName}* em *pickup*. Me manda só seu telefone ou email para eu continuar.`;
      }
      return `${intro} Então eu já sigo com *${productName}* em *pickup*. Se quiser, eu já posso te passar o resumo do pedido.`;
    }

    if (deliveryMode === 'local_delivery') {
      if (!hasAddress) {
        return `${intro} Então eu já sigo com *${productName}* na *entrega em Marlborough*. Me manda só o endereço certinho para eu continuar.`;
      }
      if (!hasFullName) {
        return `${intro} Já anotei a entrega de *${productName}*. Me manda só o nome completo para eu continuar.`;
      }
      if (!hasContact) {
        return `${intro} Já anotei a entrega de *${productName}*. Me manda só seu telefone ou email para eu continuar.`;
      }
      return `${intro} Então eu já sigo com *${productName}* na entrega local. Se quiser, eu já posso te passar o resumo do pedido.`;
    }

    if (deliveryMode === 'usps') {
      if (!hasAddress) {
        return `${intro} Então eu já sigo com *${productName}* por *USPS*. Me manda só o endereço completo com ZIP code para eu continuar.`;
      }
      if (!hasFullName) {
        return `${intro} Já anotei o envio de *${productName}*. Me manda só o nome completo para eu continuar.`;
      }
      if (!hasContact) {
        return `${intro} Já anotei o envio de *${productName}*. Me manda só seu telefone ou email para eu continuar.`;
      }
      return `${intro} Então eu já sigo com *${productName}* por USPS. Se quiser, eu já posso te passar o resumo do pedido.`;
    }

    return `${intro} Então eu já sigo com *${productName}*. Você prefere *pickup*, *entrega em Marlborough* ou *envio por USPS*?`;
  }

  if (/gostei|amei|adorei|vou pensar|acho que vou querer|curti/.test(text)) {
    return `${intro} Se você quiser, eu já separo o *${productName}* pra você.`;
  }

  const crossSellReply = buildCrossSellReply(context, inbound);
  if (crossSellReply) return crossSellReply;

  return '';
}

function buildContextualFollowUpReply(context = {}, inbound = {}) {
  const text = String(inbound?.text || '').trim().toLowerCase();
  const anchoredProduct = context?.lastProducts?.[0] || context?.lastProductPayload || null;
  const productName = anchoredProduct?.name || context?.lastProduct || '';
  if (!productName) return '';

  const comparisonReply = buildContextualComparisonReply(context, inbound);
  if (comparisonReply) return comparisonReply;

  const softCloseReply = buildSoftCloseReply(context, inbound);
  if (softCloseReply) return softCloseReply;

  if (/e se eu quiser esse|quero esse|vou querer esse|vou levar esse/.test(text)) {
    return `Perfeito 💜 Se for esse *${productName}*, eu sigo com você por aqui. Você prefere *pickup*, *entrega em Marlborough* ou *envio por USPS*?`;
  }

  if (/tem mais opc|mais opc|tem outro parecido|outras opc|mais nessa linha/.test(text)) {
    const alternativeHints = buildAlternativeOntologyHints(anchoredProduct || { name: productName }, 2);
    if (alternativeHints.length > 0) {
      const alternativesLine = alternativeHints
        .map((item) => item.angle ? `*${item.name}* (${item.angle})` : `*${item.name}*`)
        .join(' e ');
      return `Tenho sim 💜 Nessa mesma linha, eu te mostraria ${alternativesLine}.`;
    }
    return `Tenho sim 💜 Se quiser, eu te mostro mais opções parecidas com *${productName}* nessa mesma linha.`;
  }

  if (/e o frete|frete pra c[aá]|quanto fica pra enviar|quanto fica pra mandar/.test(text)) {
    return buildContextualShippingReply(context, inbound);
  }

  return '';
}

function pickCloseIntro(text = '') {
  if (/vou querer|quero levar/.test(text)) return 'Fechou 💜';
  if (/quero sim|pode separar/.test(text)) return 'Perfeito 💜';
  return 'Perfeito 💜';
}

function buildDirectPurchaseReply(context = {}, inbound = {}) {
  const text = String(inbound?.text || '').toLowerCase();
  const quantity = extractRequestedQuantity(text) || 1;
  const anchoredProduct = context?.lastProducts?.[0] || context?.lastProductPayload || null;
  const productName = anchoredProduct?.name || context?.lastProduct || 'esse item';
  const intro = pickCloseIntro(text);
  const variationDetails = Array.isArray(anchoredProduct?.variationDetails) ? anchoredProduct.variationDetails : [];
  const requestedSize = extractRequestedSize(text);
  const colorMatch = text.match(/preta|preto|branca|branco|vermelha|vermelho|rosa|azul|verde|bege|nude|dourada|dourado|prata|roxa|roxo/i);
  const requestedColor = colorMatch ? colorMatch[0] : '';
  const needsVariationChoice = variationDetails.length > 0 && (!requestedSize || !requestedColor);

  if (needsVariationChoice) {
    const availableSizes = [...new Set(variationDetails.map((variation) => variation.size).filter(Boolean))];
    const availableColors = [...new Set(variationDetails.map((variation) => variation.color).filter(Boolean))];
    const sizeLine = availableSizes.length > 0 ? ` tamanhos: *${availableSizes.join(', ')}*.` : '';
    const colorLine = availableColors.length > 0 ? ` cores: *${availableColors.join(', ')}*.` : '';
    return `${intro} Separei *${quantity} ${quantity === 1 ? 'unidade' : 'unidades'}* de *${productName}*. Me confirma só${sizeLine}${colorLine}`.trim();
  }

  return `${intro} Separei *${quantity} ${quantity === 1 ? 'unidade' : 'unidades'}* de *${productName}*. Você prefere *pickup*, *entrega em Marlborough* ou *envio por USPS*?`;
}

function inferAgenticIntent(text = '') {
  if (/libido|desejo|vontade|tes[aã]o|excit/.test(text)) return 'libido';
  if (/apertad|sempre virgem|contrair|adstring/.test(text)) return 'apertar';
  if (/durar mais|retard/.test(text)) return 'masculino_retardante';
  if (/ere[cç][aã]o|ficar duro|levantar|super pen|pinto loko/.test(text)) return 'masculino_erecao';
  if (/berinjelo|volum[aã]o|volume/.test(text)) return 'masculino_volume';
  if (/homem|masculino/.test(text)) return 'masculino';
  if (/oral|boquete|chupar|beij[aá]vel|sabor/.test(text)) return 'oral';
  if (/lubrific|molhar|seca|ressec/.test(text)) return 'lubrificacao';
  if (/lingerie|sensual|fantasia|camisola|body/.test(text)) return 'visual';
  return 'geral';
}

function scoreAgenticProduct(product = {}, intent = 'geral') {
  const text = `${product?.name || ''} ${product?.description || ''}`.toLowerCase();
  const commercialFamily = inferCommercialFamily(product || {});
  const familyGroup = inferFamilyGroup(commercialFamily);
  let score = product?.inventory_in_stock === false ? -100 : 0;

  if (intent === 'libido' && familyGroup === 'libido') score += 4;
  if (intent === 'apertar' && familyGroup === 'apertar') score += 4;
  if ((intent === 'masculino' || intent === 'masculino_retardante' || intent === 'masculino_erecao' || intent === 'masculino_volume') && familyGroup === 'masculino') score += 4;
  if (intent === 'oral' && familyGroup === 'oral') score += 4;
  if (intent === 'lubrificacao' && familyGroup === 'lubrificacao') score += 4;

  if (intent === 'libido') {
    if (/stimulus mulher|xana loka|sedenta|excitante feminino|libido|tes[aã]o/.test(text)) score += 12;
    if (/mulher|feminino/.test(text)) score += 2;
    if (/homem|masculino/.test(text)) score -= 6;
    if (/oral|gel beij[aá]vel/.test(text)) score -= 4;
    if (/adstring|sempre virgem|lacradinha/.test(text)) score -= 8;
  }

  if (intent === 'apertar') {
    if (/sempre virgem|lacradinha|adstringente|hamamelis|virgindade|contra[ií]/.test(text)) score += 14;
    if (/stimulus|libido|excitante|xana loka|sedenta/.test(text)) score -= 10;
    if (/lubrificante|mylub|deslizante/.test(text)) score -= 6;
  }

  if (intent === 'masculino' || intent === 'masculino_retardante' || intent === 'masculino_erecao' || intent === 'masculino_volume') {
    if (/retard/.test(text)) score += intent === 'masculino_retardante' ? 14 : 8;
    if (/ere[cç][aã]o|super pen|pinto loko/.test(text)) score += intent === 'masculino_erecao' ? 14 : 8;
    if (/berinjelo|volum[aã]o/.test(text)) score += intent === 'masculino_volume' ? 14 : 8;
    if (/homem|masculino/.test(text)) score += 4;
    if (/mulher|feminino/.test(text)) score -= 8;
    if (/xana loka|sedenta|stimulus mulher/.test(text)) score -= 10;
  }

  if (intent === 'oral') {
    if (/blow girl|xupa xana|garganta profunda/.test(text)) score += 14;
    if (/oral|beij[aá]vel|sabor|boca gostosa/.test(text)) score += 10;
    if (/lubrificante|mylub|deslizante/.test(text)) score -= 6;
  }

  if (intent === 'lubrificacao') {
    if (/lubrificante|lube|deslizante|mylub|neutro/.test(text)) score += 12;
    if (/anal|dessensibilizante/.test(text)) score += 4;
    if (/blow girl|xupa xana|beij[aá]vel|sabor/.test(text)) score -= 8;
    if (/xana loka|stimulus mulher|sedenta/.test(text)) score -= 5;
  }

  if (intent === 'visual') {
    if (/lingerie|fantasia|camisola|body|conjunto/.test(text)) score += 10;
  }

  return score;
}

function pickIntroVariant(intent = 'geral', text = '') {
  if (/oi|ol[áa]|boa noite|boa tarde|bom dia/.test(text) && /algo pra|algo para|tem algo/.test(text)) {
    return 'Oiiee amore 💜';
  }
  if (intent === 'libido') return 'Tenho sim 💜';
  if (intent === 'apertar') return 'Tenho sim 💜';
  if (intent === 'masculino' || intent === 'masculino_retardante' || intent === 'masculino_erecao' || intent === 'masculino_volume') return 'Tenho sim 💜';
  if (intent === 'oral') return 'Tenho sim 💜';
  if (intent === 'lubrificacao') return 'Tenho sim 💜';
  if (intent === 'visual') return 'Tenho sim 💜';
  return 'Tenho sim 💜';
}

function buildAgenticDiscoveryReply(inbound = {}, products = [], context = {}) {
  const text = String(inbound?.text || '').trim().toLowerCase();
  const ranked = (Array.isArray(products) ? products : []).filter(Boolean);
  const intent = inferAgenticIntent(text);
  const intro = pickIntroVariant(intent, text);
  const rescored = ranked
    .map((product) => ({ product, score: scoreAgenticProduct(product, intent) }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.product);
  const available = rescored.filter((product) => product?.inventory_in_stock !== false);
  const top = available[0] || rescored[0] || null;
  if (!top) return '';

  const priceLine = top.price ? ` por ${top.price}` : '';
  const shippingLocal = '$5';

  const ontologyHint = buildOntologyHint(top || {});
  const topCommercialFamily = inferCommercialFamily(top || {});
  const topFamilyGroup = inferFamilyGroup(topCommercialFamily);

  const familyHint = intent === 'libido'
    ? 'nessa linha de desejo, excitação e mais vontade'
    : intent === 'apertar'
      ? 'nessa linha de sensação mais apertadinha'
      : intent === 'masculino_retardante'
        ? 'nessa linha mais voltada para durar mais'
        : intent === 'masculino_erecao'
          ? 'nessa linha mais voltada para ereção e estímulo'
          : intent === 'masculino_volume'
            ? 'nessa linha mais voltada para volume e intensidade'
            : intent === 'masculino'
              ? 'nessa linha de desempenho masculino'
              : intent === 'oral'
                ? 'nessa linha para oral e estímulo sensorial'
                : intent === 'lubrificacao'
                  ? 'nessa linha de lubrificação e conforto'
                  : intent === 'visual'
                    ? 'nessa linha mais sensual/visual'
                    : topFamilyGroup === 'oral'
                      ? 'nessa linha para oral e estímulo sensorial'
                      : topFamilyGroup === 'lubrificacao'
                        ? 'nessa linha de lubrificação e conforto'
                        : topFamilyGroup === 'masculino'
                          ? 'nessa linha de desempenho masculino'
                          : 'nessa linha que você está buscando';

  const recommendationWhy = intent === 'libido'
    ? 'faz mais sentido pra libido e excitação'
    : intent === 'apertar'
      ? 'entra mais direto nessa linha de sensação mais apertadinha'
      : intent === 'masculino_retardante'
        ? 'entra mais direto nessa linha de durar mais'
        : intent === 'masculino_erecao'
          ? 'faz mais sentido pra ereção e estímulo'
          : intent === 'masculino_volume'
            ? 'faz mais sentido pra volume e intensidade'
            : intent === 'masculino'
              ? 'faz mais sentido pra desempenho masculino'
              : intent === 'oral'
                ? 'faz mais sentido pra oral'
                : intent === 'lubrificacao'
                  ? 'faz mais sentido pra lubrificação e conforto'
                  : intent === 'visual'
                    ? 'faz mais sentido nessa proposta mais sensual'
                    : topFamilyGroup === 'oral'
                      ? 'faz mais sentido para oral e estímulo sensorial'
                      : topFamilyGroup === 'lubrificacao'
                        ? 'faz mais sentido para lubrificação e conforto'
                        : topFamilyGroup === 'masculino'
                          ? 'faz mais sentido pra desempenho masculino'
                          : 'foi a opção mais coerente que apareceu primeiro aqui';

  if (/entrega.*marlboro|entrega.*marlborough|marlboro|marlborough/.test(text)) {
    return `Sim amore 💜 Fazemos entrega local em *Marlborough*. A taxa da entrega local é *${shippingLocal}*.`;
  }

  if (/quanto fica pra entregar|valor da entrega|taxa de entrega|entregar em marlboro|entregar em marlborough/.test(text)) {
    return `Pra entrega local em *Marlborough*, fica *${shippingLocal}* 💜`;
  }

  const moreOptions = available.slice(1, 3);
  const moreLine = moreOptions.length > 0
    ? ` Se quiser, eu também te mostro outras nessa linha, como *${moreOptions.map((product) => product.name).join('* e *')}*.`
    : '';

  if (intent === 'apertar') {
    return `${intro} Pra essa linha, eu iria mais de *${top.name}*${priceLine}, porque ${recommendationWhy}.${ontologyHint?.properties?.angle ? ` Ele entra ${ontologyHint.properties.angle}.` : ''}${moreLine}`;
  }

  if (intent === 'libido') {
    return `${intro} Pra libido, eu iria mais de *${top.name}*${priceLine}, porque ${recommendationWhy}.${ontologyHint?.properties?.angle ? ` Ele entra ${ontologyHint.properties.angle}.` : ''}${moreLine}`;
  }

  if (intent === 'masculino' || intent === 'masculino_retardante' || intent === 'masculino_erecao' || intent === 'masculino_volume') {
    return `${intro} Pra essa linha masculina, eu iria mais de *${top.name}*${priceLine}, porque ${recommendationWhy}.${ontologyHint?.properties?.angle ? ` Ele entra ${ontologyHint.properties.angle}.` : ''}${moreLine}`;
  }

  if (intent === 'oral') {
    return `${intro} Pra oral, eu iria mais de *${top.name}*${priceLine}, porque ${recommendationWhy}.${ontologyHint?.properties?.angle ? ` Ele entra ${ontologyHint.properties.angle}.` : ''}${moreLine}`;
  }

  if (intent === 'lubrificacao') {
    return `${intro} Pra lubrificação, eu iria mais de *${top.name}*${priceLine}, porque ${recommendationWhy}.${ontologyHint?.properties?.angle ? ` Ele entra ${ontologyHint.properties.angle}.` : ''}${moreLine}`;
  }

  if (intent === 'visual') {
    return `${intro} Pra essa linha mais sensual, eu iria mais de *${top.name}*${priceLine}.${moreLine}`;
  }

  return `${intro} Eu iria mais de *${top.name}*${priceLine}.${moreLine}`;
}
const { searchProducts, findMatchingVariation } = require('../services/catalog-service');
const { buildFallbackProductsFromText } = require('../services/catalog-fallback');
const { inferCommercialFamily, inferFamilyGroup, inferCrossSellGroup, buildCrossSellHint } = require('../services/cleo-taxonomy');
const { buildOntologyHint, findComparableRepresentatives, findComplementaryRepresentatives, buildAlternativeOntologyHints } = require('../services/cleo-ontology');
const { getConversationKey, getContext, saveContext, clearContext } = require('../services/context-store');
const { getOrCreateCustomerByPhone, getOrCreateOpenConversation, updateConversationState } = require('../services/customer-conversation-store');
const { appendEvent } = require('../services/event-store');
const { applyCheckoutState, buildCheckoutReply } = require('../services/checkout-state');
const { buildHandoffPayload, buildOperationalMessage } = require('../services/handoff-service');
const { sendOperationalTelegramMessage, hasTelegramOpsConfig, buildSalesEscortMessage, buildMemoryEscortMessage, buildCatalogEscortMessage, buildSystemEscortMessage } = require('../services/telegram-ops');

router.post('/whatsapp/inbound', async (req, res, next) => {
  try {
    const inbound = normalizeWhatsAppInbound(req.body || {});

    const contextKey = getConversationKey(inbound);
    const existingContext = getContext(contextKey) || {};

    const resetRequested = /^#?reset( chat| conversa| session| sess[aã]o)?$/i.test(String(inbound.text || '').trim());

    let customerResult = null;
    let conversationResult = null;
    let recoveredContextFromConversation = null;
    try {
      customerResult = await getOrCreateCustomerByPhone(inbound.from, inbound.profileName);
      conversationResult = await getOrCreateOpenConversation({
        customerId: customerResult?.customer?.id,
        existingConversationId: resetRequested ? '' : (existingContext.conversationId || ''),
        existingSummary: '',
        existingStage: '',
        existingLastProduct: '',
        existingLastProductPayload: null,
        channel: inbound.channel,
        phone: inbound.from,
        profileName: inbound.profileName,
        forceNew: resetRequested,
      });

      if (conversationResult?.conversation) {
        recoveredContextFromConversation = {
          summary: conversationResult.conversation.summary || '',
          currentStage: conversationResult.conversation.current_stage || '',
          lastProduct: conversationResult.conversation.last_product || '',
          lastProductPayload: conversationResult.conversation.last_product_payload || null,
        };
      }
    } catch (err) {
      console.error('[whatsapp/inbound] customer/conversation bootstrap error:', err.message);
    }

    if (resetRequested) {
      clearContext(contextKey);
      return res.json({
        ok: true,
        reset: true,
        message: 'Conversa resetada com sucesso.',
        contextKey,
        conversationId: conversationResult?.conversation?.id || '',
      });
    }

    let products = [];
    const shouldLookupCatalog = /tem\s+|você tem|vc tem|quanto custa|preço|preco|valor|quero esse|quero essa|vou querer|gostei desse|gostei dessa|xana loka|blow girl|sempre virgem|berinjelo|volum[aã]o|libido|oral|lubrificante|vibrador|fantasia|camisola|lingerie|conjunto|calcinha|suti[aã]|body/i.test(inbound.text || '');
    if (shouldLookupCatalog) {
      try {
        products = await searchProducts(inbound.text, 3);
      } catch (err) {
        console.error('[whatsapp/inbound] catalog lookup error:', err.message);
      }
    }

    if (products.length === 0) {
      products = buildFallbackProductsFromText(inbound.text);
    }

    const recoveredLastProductPayload = recoveredContextFromConversation?.lastProductPayload || null;
    const preservedLastProducts = Array.isArray(existingContext.lastProducts) && existingContext.lastProducts.length > 0
      ? existingContext.lastProducts
      : (recoveredLastProductPayload ? [recoveredLastProductPayload] : []);

    const mergedProducts = products.length > 0
      ? products.map((product) => {
          const previous = preservedLastProducts.find((item) => item?.id && item.id === product.id) || {};
          const previousVariationDetails = Array.isArray(previous.variationDetails)
            ? previous.variationDetails
            : Array.isArray(previous.raw?.variationDetails)
              ? previous.raw.variationDetails
              : [];
          return {
            ...previous,
            ...product,
            variationDetails: Array.isArray(product.variationDetails) && product.variationDetails.length > 0
              ? product.variationDetails
              : previousVariationDetails,
          };
        })
      : preservedLastProducts;

    const effectiveProducts = mergedProducts;
    const recoveredStage = recoveredContextFromConversation?.currentStage || '';
    const persistedStagePriority = {
      new_lead: 0,
      catalog_browse: 1,
      checkout_start: 2,
      checkout_choose_delivery: 3,
      checkout_collect_address: 4,
      checkout_collect_name: 5,
      checkout_collect_contact: 6,
      checkout_review: 7,
      handoff_ready: 8,
    };
    const localStageCandidate = existingContext.checkout?.stage || existingContext.currentStage || '';
    const currentStageForState = (persistedStagePriority[localStageCandidate] || 0) >= (persistedStagePriority[recoveredStage] || 0)
      ? localStageCandidate
      : recoveredStage;
    const recoveredCheckout = recoveredContextFromConversation?.lastProductPayload?.checkout || {};
    const mergedCheckout = {
      ...recoveredCheckout,
      ...(existingContext.checkout || {}),
    };
    if (!mergedCheckout.stage && currentStageForState) {
      mergedCheckout.stage = currentStageForState;
    }

    const resolvedSummary = existingContext.summary || recoveredContextFromConversation?.summary || '';
    const resolvedLastProduct = existingContext.lastProduct || recoveredContextFromConversation?.lastProduct || '';
    const resolvedLastProductPayload = existingContext.lastProductPayload || recoveredContextFromConversation?.lastProductPayload || null;
    const contextForState = {
      ...existingContext,
      summary: resolvedSummary,
      currentStage: currentStageForState,
      checkout: mergedCheckout,
      lastProduct: resolvedLastProduct,
      lastProductPayload: resolvedLastProductPayload,
      lastProducts: effectiveProducts.length > 0
        ? effectiveProducts
        : (recoveredLastProductPayload ? [recoveredLastProductPayload] : []),
    };

    let checkoutContext = applyCheckoutState(contextForState, inbound);

    const handoffAckPattern = /^(oi+|ol[áa]|boa (tarde|noite|dia)|você tem|vc tem|tem\s+|quanto custa|preço|preco|valor|quero esse|quero essa|vou querer|gostei desse|gostei dessa)/i;
    if (
      (checkoutContext.currentStage || '') === 'handoff_ready'
      && handoffAckPattern.test(String(inbound.text || '').trim())
    ) {
      checkoutContext = {
        ...checkoutContext,
        currentStage: 'catalog_browse',
        checkout: {},
        summary: '',
      };
    }

    const productDebug = {
      inboundText: inbound.text,
      existingContextLastProductsCount: Array.isArray(existingContext.lastProducts) ? existingContext.lastProducts.length : 0,
      productsCount: Array.isArray(products) ? products.length : 0,
      effectiveProductsCount: Array.isArray(effectiveProducts) ? effectiveProducts.length : 0,
      contextForStateLastProductsCount: Array.isArray(contextForState.lastProducts) ? contextForState.lastProducts.length : 0,
      checkoutContextLastProductsCount: Array.isArray(checkoutContext.lastProducts) ? checkoutContext.lastProducts.length : 0,
      existingContextLastProductName: existingContext.lastProducts?.[0]?.name || '',
      productCandidateName: products[0]?.name || '',
      effectiveProductName: effectiveProducts[0]?.name || '',
      contextForStateProductName: contextForState.lastProducts?.[0]?.name || '',
      checkoutContextProductName: checkoutContext.lastProducts?.[0]?.name || '',
      checkoutContextLastProduct: checkoutContext.lastProduct || '',
      checkoutContextLastProductPayloadName: checkoutContext.lastProductPayload?.name || '',
      currentStageForState,
      currentStageAfterState: checkoutContext.currentStage || '',
    };

    const followUpSignals = {
      currentStageBefore: currentStageForState,
      currentStageAfter: checkoutContext.currentStage || currentStageForState,
      requestedSize: extractRequestedSize(inbound.text),
      requestedQuantity: extractRequestedQuantity(inbound.text),
      asksSize: /tem\s+no\s+tamanho|tamanho\s+[pmg]|tem\s+p\b|tem\s+m\b|tem\s+g\b/i.test(inbound.text || ''),
      asksColor: /tem\s+em\s+outra\s+cor|outra\s+cor|outras\s+cores/i.test(inbound.text || ''),
      asksPrice: /quanto custa|preço|preco|valor/i.test(inbound.text || ''),
      asksUsShipping: /envia pra|enviam pra|manda pra|faz envio pra|entrega na fl[oó]rida|entrega em miami|outro estado|dentro dos estados unidos|usa/i.test(inbound.text || ''),
      asksShippingCost: /quanto custa o frete|quanto fica o frete|valor do frete|frete pra c[aá]|envio pra c[aá]/i.test(inbound.text || ''),
      wantsThis: /quero esse|quero essa|vou querer|gostei desse|gostei dessa/i.test(inbound.text || ''),
      directPurchase: isDirectPurchaseIntent(inbound.text || ''),
      multiItemPurchase: detectMultiItemIntent(inbound.text || ''),
    };

    const matchingVariation = findMatchingVariation(effectiveProducts[0] || {}, followUpSignals.requestedSize);

    let replyText = buildCheckoutReply(checkoutContext);
    if (!replyText && followUpSignals.multiItemPurchase) {
      const multiItems = parseMultiItemText(inbound.text || '');
      replyText = buildMultiItemReply(inbound);
      checkoutContext = {
        ...checkoutContext,
        currentStage: 'checkout_choose_delivery',
        cart: {
          ...(checkoutContext.cart || {}),
          items: multiItems,
          itemsCount: multiItems.length,
        },
        checkout: {
          ...(checkoutContext.checkout || {}),
          stage: 'checkout_choose_delivery',
          multiItemText: String(inbound.text || '').trim(),
          multiItems,
          quantity: null,
        },
      };
    }
    if (!replyText && followUpSignals.directPurchase && (checkoutContext.lastProducts?.[0] || effectiveProducts[0] || checkoutContext.lastProductPayload)) {
      const purchaseAnchor = checkoutContext.lastProducts?.[0] || effectiveProducts[0] || checkoutContext.lastProductPayload;
      const variationDetails = Array.isArray(purchaseAnchor?.variationDetails) ? purchaseAnchor.variationDetails : [];
      const requestedColorMatch = String(inbound.text || '').match(/preta|preto|branca|branco|vermelha|vermelho|rosa|azul|verde|bege|nude|dourada|dourado|prata|roxa|roxo/i);
      const requestedColor = requestedColorMatch ? requestedColorMatch[0] : '';
      const requestedSize = extractRequestedSize(inbound.text || '');
      const needsVariationChoice = variationDetails.length > 0 && (!requestedSize || !requestedColor);

      replyText = buildDirectPurchaseReply(checkoutContext, inbound);
      checkoutContext = {
        ...checkoutContext,
        currentStage: needsVariationChoice ? 'catalog_browse' : 'checkout_choose_delivery',
        checkout: {
          ...(checkoutContext.checkout || {}),
          stage: needsVariationChoice ? 'catalog_browse' : 'checkout_choose_delivery',
          quantity: followUpSignals.requestedQuantity || 1,
          selectedSize: requestedSize || checkoutContext.checkout?.selectedSize || '',
          selectedColor: requestedColor || checkoutContext.checkout?.selectedColor || '',
        },
      };
    }
    if (!replyText) {
      replyText = buildContextualFollowUpReply(checkoutContext, inbound);
    }
    if (!replyText && followUpSignals.asksUsShipping) {
      replyText = buildUsOnlyShippingReply();
    }
    if (!replyText && followUpSignals.asksShippingCost) {
      replyText = buildContextualShippingReply(checkoutContext, inbound);
    }
    if (!replyText && shouldUseAgenticDiscovery(inbound, checkoutContext, effectiveProducts)) {
      replyText = buildAgenticDiscoveryReply(inbound, effectiveProducts, checkoutContext);
    }
    if (!replyText) {
      replyText = buildInitialReply(inbound, { products: effectiveProducts, context: checkoutContext, matchingVariation });
    }

    const anchoredProduct = followUpSignals.multiItemPurchase
      ? null
      : (checkoutContext.lastProducts?.[0]
        || effectiveProducts[0]
        || existingContext.lastProducts?.[0]
        || checkoutContext.lastProductPayload
        || existingContext.lastProductPayload
        || null);

    const anchoredProducts = followUpSignals.multiItemPurchase
      ? (effectiveProducts.length > 0 ? effectiveProducts : (existingContext.lastProducts || []))
      : (anchoredProduct ? [anchoredProduct] : (effectiveProducts.length > 0 ? effectiveProducts : (existingContext.lastProducts || [])));

    const savedContext = saveContext(contextKey, {
      ...checkoutContext,
      cart: checkoutContext.cart || existingContext.cart || { items: [], itemsCount: 0 },
      profileName: inbound.profileName,
      customerId: customerResult?.customer?.id || existingContext.customerId || '',
      conversationId: conversationResult?.conversation?.id || existingContext.conversationId || '',
      lastInboundText: inbound.text,
      lastProducts: anchoredProducts,
      lastProduct: followUpSignals.multiItemPurchase
        ? ''
        : (anchoredProduct?.name || checkoutContext.lastProduct || existingContext.lastProduct || ''),
      lastProductPayload: followUpSignals.multiItemPurchase
        ? null
        : (anchoredProduct || checkoutContext.lastProductPayload || existingContext.lastProductPayload || null),
      lastReplyText: replyText,
      lastChannel: inbound.channel,
      lastProvider: inbound.provider,
      address: checkoutContext.checkout?.address || existingContext.address || '',
      followUpSignals,
      productDebug,
    });

    let conversationSnapshot = conversationResult?.conversation || null;
    let conversationUpdateDebug = null;
    try {
      const conversationUpdate = await updateConversationState({
        conversationId: savedContext.conversationId,
        summary: savedContext.summary,
        currentStage: savedContext.currentStage,
        lastProduct: savedContext.lastProduct,
        lastProductPayload: savedContext.lastProductPayload,
      });
      conversationUpdateDebug = {
        ok: true,
        patch: conversationUpdate?.patch || null,
        conversationId: savedContext.conversationId,
        updatedConversationId: conversationUpdate?.conversation?.id || null,
        updatedStage: conversationUpdate?.conversation?.current_stage || null,
        updatedSummary: conversationUpdate?.conversation?.summary || null,
        updatedLastProduct: conversationUpdate?.conversation?.last_product || null,
      };
      if (conversationUpdate?.conversation) {
        conversationSnapshot = conversationUpdate.conversation;
      }
    } catch (err) {
      conversationUpdateDebug = {
        ok: false,
        conversationId: savedContext.conversationId,
        message: err.message,
        status: err.status || null,
        payload: err.payload || null,
      };
      console.error('[whatsapp/inbound] conversation state update error:', err.message, err.payload || '');
    }

    const outbound = await sendWhatsAppMessage({
      to: inbound.from,
      body: replyText,
      mediaUrls: [],
    });

    let inboundEvent = null;
    let outboundEvent = null;
    let handoffPayload = null;
    let handoffDebug = null;
    let operationalMessage = '';
    let operationalDispatch = null;
    let salesEscortMessage = '';
    let salesEscortDispatch = null;
    let memoryEscortMessage = '';
    let memoryEscortDispatch = null;
    let catalogEscortMessage = '';
    let catalogEscortDispatch = null;
    let systemEscortMessage = '';
    let systemEscortDispatch = null;
    if ((savedContext.currentStage || '') === 'handoff_ready') {
      salesEscortMessage = buildSalesEscortMessage(savedContext);
      const shouldSendSalesEscort = Boolean(
        savedContext.lastProductPayload?.name
        || savedContext.lastProduct
        || savedContext.followUpSignals?.wantsThis
        || savedContext.followUpSignals?.asksPrice
        || savedContext.followUpSignals?.asksColor
        || savedContext.followUpSignals?.requestedSize
        || savedContext.checkout?.deliveryMode
        || savedContext.checkout?.fullName
        || savedContext.checkout?.email
        || savedContext.checkout?.phone
      );
      if (shouldSendSalesEscort) {
        try {
          salesEscortDispatch = await sendOperationalTelegramMessage(salesEscortMessage, {
            topicKey: 'atendimento_vendas',
          });
        } catch (err) {
          console.error('[whatsapp/inbound] sales escort dispatch error:', err.message);
        }
      }

      memoryEscortMessage = buildMemoryEscortMessage(savedContext);
      const shouldSendMemoryEscort = Boolean(
        savedContext.customerId
        || savedContext.conversationId
        || savedContext.checkout?.fullName
        || savedContext.checkout?.email
        || savedContext.checkout?.phone
        || savedContext.checkout?.address
        || savedContext.checkout?.deliveryMode
        || savedContext.lastProductPayload?.name
        || savedContext.followUpSignals?.requestedSize
        || savedContext.currentStage === 'checkout_review'
        || savedContext.currentStage === 'handoff_ready'
      );
      if (shouldSendMemoryEscort) {
        try {
          memoryEscortDispatch = await sendOperationalTelegramMessage(memoryEscortMessage, {
            topicKey: 'memoria_clientes',
          });
        } catch (err) {
          console.error('[whatsapp/inbound] memory escort dispatch error:', err.message);
        }
      }

      catalogEscortMessage = buildCatalogEscortMessage(savedContext);
      const shouldSendCatalogEscort = Boolean(
        savedContext.lastProductPayload?.name
        || savedContext.lastProduct
        || savedContext.followUpSignals?.requestedSize
        || savedContext.followUpSignals?.asksColor
        || savedContext.followUpSignals?.asksPrice
        || savedContext.checkout?.deliveryMode === 'usps'
      );
      if (shouldSendCatalogEscort) {
        try {
          catalogEscortDispatch = await sendOperationalTelegramMessage(catalogEscortMessage, {
            topicKey: 'produtos_estoque',
          });
        } catch (err) {
          console.error('[whatsapp/inbound] catalog escort dispatch error:', err.message);
        }
      }

      const systemEscortMeta = {
        transportMode: hasRealTwilioConfig() ? 'twilio' : 'stub',
        persistenceMode: customerResult?.mode || conversationResult?.mode || 'memory-fallback',
        eventMode: inboundEvent?.mode || outboundEvent?.mode || 'memory-fallback',
        opsDispatchMode: operationalDispatch?.mode || (hasTelegramOpsConfig() ? 'telegram' : 'stub'),
      };
      systemEscortMessage = buildSystemEscortMessage(savedContext, systemEscortMeta);
      const shouldSendSystemEscort = Boolean(
        systemEscortMeta.transportMode !== 'twilio'
        || systemEscortMeta.persistenceMode !== 'supabase'
        || systemEscortMeta.eventMode !== 'supabase'
        || systemEscortMeta.opsDispatchMode !== 'telegram'
        || !savedContext.customerId
        || !savedContext.conversationId
        || !savedContext.summary
      );
      if (shouldSendSystemEscort) {
        try {
          systemEscortDispatch = await sendOperationalTelegramMessage(systemEscortMessage, {
            topicKey: 'sistema_automacao',
          });
        } catch (err) {
          console.error('[whatsapp/inbound] system escort dispatch error:', err.message);
        }
      }
      handoffDebug = {
        currentStage: savedContext.currentStage,
        checkout: savedContext.checkout || null,
        summary: savedContext.summary || '',
      };
      handoffPayload = buildHandoffPayload(savedContext);
      operationalMessage = buildOperationalMessage(savedContext);
      try {
        operationalDispatch = await sendOperationalTelegramMessage(operationalMessage, {
          topicKey: 'handoff_pedidos',
        });
      } catch (err) {
        console.error('[whatsapp/inbound] telegram ops dispatch error:', err.message);
      }
    }

    try {
      inboundEvent = await appendEvent({
        kind: 'whatsapp_inbound_received',
        conversation_id: conversationResult?.conversation?.id || savedContext.conversationId || null,
        customer_id: customerResult?.customer?.id || savedContext.customerId || null,
        channel: inbound.channel,
        direction: 'inbound',
        message_text: inbound.text,
        payload: { profileName: inbound.profileName, raw: inbound.raw },
      });

      outboundEvent = await appendEvent({
        kind: 'whatsapp_outbound_sent',
        conversation_id: conversationResult?.conversation?.id || savedContext.conversationId || null,
        customer_id: customerResult?.customer?.id || savedContext.customerId || null,
        channel: inbound.channel,
        direction: 'outbound',
        message_text: replyText,
        payload: { transportMode: hasRealTwilioConfig() ? 'twilio' : 'stub', outbound, handoffPayload },
      });
    } catch (err) {
      console.error('[whatsapp/inbound] event append error:', err.message);
    }

    return res.json({
      ok: true,
      inbound,
      outbound,
      products: effectiveProducts,
      contextKey,
      context: savedContext,
      productDebug,
      state: {
        summary: savedContext.summary || '',
        currentStage: savedContext.currentStage || '',
        lastProductName: savedContext.lastProducts?.[0]?.name || '',
        customerId: savedContext.customerId || '',
        conversationId: savedContext.conversationId || '',
      },
      customer: customerResult?.customer || null,
      conversation: conversationSnapshot,
      conversationUpdateDebug,
      inboundEvent: inboundEvent?.event || null,
      outboundEvent: outboundEvent?.event || null,
      handoffPayload,
      handoffDebug,
      operationalMessage,
      operationalDispatch,
      salesEscortMessage,
      salesEscortDispatch,
      memoryEscortMessage,
      memoryEscortDispatch,
      catalogEscortMessage,
      catalogEscortDispatch,
      systemEscortMessage,
      systemEscortDispatch,
      persistenceMode: customerResult?.mode || conversationResult?.mode || 'memory-fallback',
      opsDispatchMode: operationalDispatch?.mode || (hasTelegramOpsConfig() ? 'telegram' : 'stub'),
      eventMode: inboundEvent?.mode || outboundEvent?.mode || 'memory-fallback',
      note: 'Primeira rota funcional do módulo WhatsApp fora do n8n',
      transportMode: hasRealTwilioConfig() ? 'twilio' : 'stub',
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
