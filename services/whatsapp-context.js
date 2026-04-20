function extractRequestedSize(text = '') {
  const lower = String(text || '').toLowerCase();
  const direct = lower.match(/\b(pp|p|m|g|gg|xg|xgg)\b/);
  if (direct) return direct[1].toUpperCase();
  const long = lower.match(/tamanho\s+(pp|p|m|g|gg|xg|xgg)/);
  if (long) return long[1].toUpperCase();
  return '';
}

function getVariationDetails(lastProduct = null) {
  return Array.isArray(lastProduct?.variationDetails)
    ? lastProduct.variationDetails
    : Array.isArray(lastProduct?.raw?.variationDetails)
      ? lastProduct.raw.variationDetails
      : [];
}

function listAvailableSizes(lastProduct = null) {
  const details = getVariationDetails(lastProduct);
  const sizes = [...new Set(details.filter((variation) => variation?.inventory_in_stock !== false).map((variation) => variation?.size).filter(Boolean))];
  return sizes;
}

function listAvailableColors(lastProduct = null) {
  const fromProduct = Array.isArray(lastProduct?.availableColors)
    ? lastProduct.availableColors
    : Array.isArray(lastProduct?.raw?.availableColors)
      ? lastProduct.raw.availableColors
      : [];
  const fromVariations = getVariationDetails(lastProduct)
    .filter((variation) => variation?.inventory_in_stock !== false)
    .map((variation) => variation?.color)
    .filter(Boolean);
  return [...new Set([...fromProduct, ...fromVariations])];
}

function hasAnyInventory(lastProduct = null) {
  if (typeof lastProduct?.inventory_in_stock === 'boolean') return lastProduct.inventory_in_stock;
  const details = getVariationDetails(lastProduct);
  return details.some((variation) => variation?.inventory_in_stock === true);
}

function inferProductFamily(product = null) {
  const text = `${product?.name || ''} ${product?.description || ''}`.toLowerCase();
  if (/lingerie|conjunto|calcinha|suti[aã]|body|camisola|baby.?doll/.test(text)) return 'moda-intima';
  if (/lubrificant|gel|deslizante|beij[aá]vel|oral|xupa xana/.test(text)) return 'gel-lubrificante';
  if (/excitante|libido|retard|ere[cç][aã]o|adstringente|hot ball|capsula/.test(text)) return 'funcional';
  if (/vibrador|bullet|sugador|dildo|massageador|masturbador/.test(text)) return 'toy';
  if (/perfume|fragr[aâ]ncia|sabonete|higiene/.test(text)) return 'cuidado';
  return 'geral';
}

function inferDominantAttribute(product = null) {
  const text = `${product?.name || ''} ${product?.description || ''}`.toLowerCase();
  if (/morango|uva|menta|chocolate|cereja|baunilha|melancia|frutas vermelhas|sabor/.test(text)) return 'sabor';
  if (/preta|preto|branca|branco|vermelha|vermelho|rosa|azul|verde|bege|nude|dourada|dourado|prata/.test(text)) return 'cor';
  if (/esquenta|esfria|retard|libido|vibra|adstringente|ere[cç][aã]o|excitante/.test(text)) return 'efeito';
  if (/flor|doce|fragr[aâ]ncia|perfume|cheiro/.test(text)) return 'fragrancia';
  return 'geral';
}

function inferDesiredEffect(text = '') {
  const lower = String(text || '').toLowerCase();
  if (/libido|mais vontade|mais desejo|dar mais desejo|dar mais vontade|afrodis[ií]aco|mais tes[aã]o|mais prazer|excit/.test(lower)) return 'libido';
  if (/apertad|mais apertadinha|sempre virgem|adstringente|virgindade|contrair/.test(lower)) return 'apertar';
  if (/durar mais|demorar gozar|retard|resist[eê]ncia|ficar duro|ere[cç][aã]o|berinjelo|volum[aã]o/.test(lower)) return 'masculino';
  if (/oral|boquete|chupar|garganta profunda|beij[aá]vel|saborizado|sabor/.test(lower)) return 'oral';
  if (/lubrific|molhar|mais molhada|ressecada|seca|desliz/.test(lower)) return 'lubrificacao';
  if (/vibrador|bullet|sugador|clit[oó]ris|prazer sozinha|ponto g/.test(lower)) return 'toy';
  if (/fantasia|lingerie|sensual|camisola|baby doll|visual/.test(lower)) return 'visual';
  return '';
}

function buildAlternativeSuggestion(products = [], currentName = '', currentProduct = null, requestedSize = '') {
  const normalizedCurrent = String(currentName || '').trim().toLowerCase();
  const currentFamily = inferProductFamily(currentProduct);
  const currentAttribute = inferDominantAttribute(currentProduct);
  const currentPrice = Number(currentProduct?.priceNumber || 0);
  const currentColors = listAvailableColors(currentProduct);
  const candidates = (Array.isArray(products) ? products : []).filter((product) => {
    if (!product?.name) return false;
    if (normalizedCurrent && String(product.name).trim().toLowerCase() === normalizedCurrent) return false;
    return product.inventory_in_stock !== false;
  });

  const sameAttribute = candidates.filter((product) => inferDominantAttribute(product) === currentAttribute);
  const sameFamily = candidates.filter((product) => inferProductFamily(product) === currentFamily);
  const sameFamilyAndAttribute = sameAttribute.filter((product) => inferProductFamily(product) === currentFamily);
  const pool = sameFamilyAndAttribute.length > 0
    ? sameFamilyAndAttribute
    : (sameFamily.length > 0 ? sameFamily : (sameAttribute.length > 0 ? sameAttribute : candidates));
  pool.sort((a, b) => {
    const aSizes = listAvailableSizes(a);
    const bSizes = listAvailableSizes(b);
    const aColors = listAvailableColors(a);
    const bColors = listAvailableColors(b);
    const aSizeScore = requestedSize && aSizes.includes(requestedSize) ? 1 : 0;
    const bSizeScore = requestedSize && bSizes.includes(requestedSize) ? 1 : 0;
    if (aSizeScore !== bSizeScore) return bSizeScore - aSizeScore;

    const aColorScore = currentColors.some((color) => aColors.includes(color)) ? 1 : 0;
    const bColorScore = currentColors.some((color) => bColors.includes(color)) ? 1 : 0;
    if (aColorScore !== bColorScore) return bColorScore - aColorScore;

    const aPrice = Number(a?.priceNumber || 0);
    const bPrice = Number(b?.priceNumber || 0);
    return Math.abs(aPrice - currentPrice) - Math.abs(bPrice - currentPrice);
  });

  return pool[0] || null;
}

function buildInitialReply(inbound, options = {}) {
  const text = String(inbound?.text || '').trim();
  const lower = text.toLowerCase();
  const products = Array.isArray(options.products) ? options.products : [];
  const desiredEffect = inferDesiredEffect(text);
  const context = options.context || {};
  const lastProducts = Array.isArray(context.lastProducts) ? context.lastProducts : [];
  const lastProduct = lastProducts[0] || null;
  const requestedSize = extractRequestedSize(text);
  const matchingVariation = options.matchingVariation || null;
  const availableSizes = listAvailableSizes(lastProduct);
  const availableColors = listAvailableColors(lastProduct);
  const hasInventory = hasAnyInventory(lastProduct);
  const alternativeSuggestion = buildAlternativeSuggestion(products, lastProduct?.name || '', lastProduct, requestedSize);

  if (!text) {
    return 'Oiiee amore 💜 Recebi sua mensagem aqui. Me conta o que você está procurando que eu sigo com você.';
  }

  if (/^oi+|ol[áa]|boa (tarde|noite|dia)/i.test(text) && !/tem\s+|você tem|vc tem|algo pra|algo para|trabalha com/.test(lower)) {
    return 'Oiiee amore 💜 Tudo bem? Me conta o que você está procurando que eu te ajudo por aqui.';
  }

  if (/quero comprar|quero pedir|quero fazer pedido/i.test(lower)) {
    return 'Perfeito amore 💜 Me diz o que você quer ou me manda a foto/nome da peça que eu já sigo com você.';
  }

  const looksLikeProductDiscovery = /tem\s+|você tem|vc tem|trabalha com|tem aí|tem desse|tem dessa/.test(lower);
  if (looksLikeProductDiscovery) {
    if (products.length > 0) {
      const firstInStock = products.find((product) => product?.inventory_in_stock !== false) || products[0];
      const top = firstInStock;
      const priceLine = top.price ? ` por ${top.price}` : '';
      if (top.inventory_in_stock === false) {
        return `Tem sim amore 💜 Eu encontrei esse tipo de produto por aqui, mas essa primeira leitura está me mostrando o item principal sem estoque no momento. Se você quiser, eu posso te mostrar alternativas disponíveis ou confirmar reposição certinho.`;
      }
      const effectLine = desiredEffect === 'libido'
        ? 'Ele entra bem nessa linha de aumentar desejo e excitação ✨'
        : desiredEffect === 'apertar'
          ? 'Ele entra bem nessa linha de sensação mais apertadinha ✨'
          : desiredEffect === 'masculino'
            ? 'Ele entra bem nessa linha de desempenho e apoio masculino ✨'
            : desiredEffect === 'oral'
              ? 'Ele entra bem nessa linha para oral e estímulo sensorial ✨'
              : desiredEffect === 'lubrificacao'
                ? 'Ele entra bem nessa linha de mais conforto e lubrificação ✨'
                : desiredEffect === 'toy'
                  ? 'Ele entra bem nessa linha de prazer e estimulação ✨'
                  : desiredEffect === 'visual'
                    ? 'Ele entra bem nessa linha mais sensual/visual ✨'
                    : 'Esse tipo de produto sai super bem por aqui ✨';
      return `Tem sim amore 💜 Já achei uma opção por aqui: *${top.name}*${priceLine}. ${effectLine} Se você quiser, eu também posso te mostrar mais opções parecidas e te dizer qual faz mais sentido para o que você quer. Trabalhamos com retirada, entrega local e envio dentro dos Estados Unidos.`;
    }
    return 'Tem sim amore 💜 Me deixa puxar as melhores opções pra você. Se quiser, eu também posso te mostrar alternativas parecidas e te orientar pelo que faz mais sentido. Trabalhamos com retirada, entrega local e envio dentro dos Estados Unidos.';
  }

  if (/quanto custa|preço|preco|valor/.test(lower)) {
    if (lastProduct?.name) {
      if (!hasInventory) {
        return lastProduct.price
          ? `Claro amore 💜 A *${lastProduct.name}* está por ${lastProduct.price}, mas aqui ela aparece sem estoque disponível no momento. Se você quiser, eu posso confirmar certinho pra você se já está entrando em reposição.`
          : `Claro amore 💜 Vou confirmar certinho o valor e a disponibilidade da *${lastProduct.name}* pra te passar tudo redondinho.`;
      }
      return lastProduct.price
        ? `Claro amore 💜 A *${lastProduct.name}* está por ${lastProduct.price}. Se quiser, eu já sigo com você nesse pedido. Trabalhamos com retirada, entrega local e envio dentro dos Estados Unidos.`
        : `Claro amore 💜 Vou confirmar certinho o valor da *${lastProduct.name}* pra te passar tudo redondinho.`;
    }
    return 'Claro amore 💜 Me confirma qual peça você quer que eu veja o valor certinho pra não te passar nada errado.';
  }

  if (/site est[aá]|no site est[aá]|no site t[aá]|site t[aá]|na loja est[aá]|t[aá] no site/.test(lower)) {
    if (lastProduct?.name) {
      return `Entendi amore 💜 Aqui eu estou lendo a *${lastProduct.name}* pelo catálogo/runtime da operação, e às vezes o valor do site pode estar diferente por vitrine, variação, promoção ou sincronização. Para não te passar errado, eu prefiro te confirmar esse valor certinho antes de fechar como definitivo.`;
    }
    return 'Entendi amore 💜 Pode acontecer diferença entre site e catálogo operacional. Se você me disser qual peça é, eu confirmo certinho para não te passar nada errado.';
  }

  if (/entrega.*marlboro|entrega.*marlborough|marlboro|marlborough/.test(lower)) {
    return 'Sim amore 💜 Fazemos entrega local em *Marlborough*. A taxa da entrega local é *$5*.';
  }

  if (/quanto fica pra entregar|valor da entrega|taxa de entrega/.test(lower)) {
    return 'Pra entrega local em *Marlborough*, fica *$5* 💜';
  }

  if (/e ai\??|e aí\??|oi\??|ol[aá]\??|hum\??/.test(lower)) {
    if (lastProduct?.name) {
      return `Tô aqui amore 💜 Se você quiser, eu posso confirmar certinho o valor da *${lastProduct.name}* e também te mostrar outras opções parecidas.`;
    }
    return 'Tô aqui amore 💜 Me fala qual peça ou efeito você quer que eu sigo com você.';
  }

  if (/tem no tamanho|tamanho\s+[pmg]|tem p\b|tem m\b|tem g\b/.test(lower)) {
    if (lastProduct?.name) {
      if (requestedSize && matchingVariation) {
        if (matchingVariation.inventory_in_stock === false) {
          if (alternativeSuggestion?.name) {
            return `A *${lastProduct.name}* aparece no tamanho *${requestedSize}*, mas essa variação está sem estoque no momento 💜 Se você quiser, eu já posso te mostrar uma alternativa disponível como *${alternativeSuggestion.name}* ou confirmar reposição.`;
          }
          return `A *${lastProduct.name}* aparece no tamanho *${requestedSize}*, mas essa variação está sem estoque no momento 💜 Se quiser, eu posso te mostrar outro tamanho disponível ou confirmar reposição.`;
        }
        const priceLine = matchingVariation.price ? ` e o valor dela fica em ${matchingVariation.price}` : '';
        return `Tem sim amore 💜 A *${lastProduct.name}* aparece com variação no tamanho *${requestedSize}*${priceLine}. Esse modelo sai super bem por aqui ✨ Se quiser, já sigo com você nesse pedido.`;
      }
      if (requestedSize) {
        if (availableSizes.length > 0) {
          return `Não apareceu uma variação clara em *${requestedSize}* para a *${lastProduct.name}* aqui no catálogo 💜 As opções que consegui ler com mais segurança foram: *${availableSizes.join(', ')}*. Se quiser, eu sigo te ajudando por esse caminho.`;
        }
        return `Não vi uma variação clara em *${requestedSize}* para a *${lastProduct.name}* aqui no catálogo, então prefiro te confirmar certinho antes de te prometer errado 💜`;
      }
      return `Consigo ver sim amore 💜 Vou checar a disponibilidade da *${lastProduct.name}* no tamanho certinho para você.`;
    }
    return 'Consigo ver sim amore 💜 Me confirma qual peça você quer que eu cheque no tamanho certinho.';
  }

  if (/tem em outra cor|outra cor|outras cores/.test(lower)) {
    if (lastProduct?.name) {
      if (availableColors.length > 0) {
        return `Tem sim mulher 💜 Pelo que consegui ler no catálogo da *${lastProduct.name}*, aparecem estas cores: *${availableColors.join(', ')}*. É uma peça que chama bastante atenção por aqui ✨ Se quiser, eu já sigo com você na que fizer mais sentido.`;
      }
      return `Vejo sim mulher 💜 Vou consultar as outras cores da *${lastProduct.name}* pra você e já te digo certinho.`;
    }
    return 'Vejo sim mulher 💜 Me confirma qual peça você quer que eu consulte nas outras cores.';
  }

  if (/quero esse|quero essa|vou querer|gostei desse|gostei dessa/.test(lower)) {
    if (lastProduct?.name) {
      if (!hasInventory) {
        if (alternativeSuggestion?.name) {
          return `Aaaamei amore 💜 A *${lastProduct.name}* aparece aqui, mas no momento estou vendo ela sem estoque disponível. Se você quiser, eu já te mostro outra opção parecida que está disponível, como *${alternativeSuggestion.name}*, ou confirmo reposição certinho.`;
        }
        return `Aaaamei amore 💜 A *${lastProduct.name}* aparece aqui, mas no momento estou vendo ela sem estoque disponível. Se quiser, eu confirmo reposição certinho ou já te mostro outra opção parecida.`;
      }
      return `Aaaamei amore 💜 Perfeito, vamos seguir com a *${lastProduct.name}*. Essa peça está saindo super bem por aqui ✨ Me manda só seu nome completo que eu já começo seu pedido.`;
    }
    return 'Aaaamei amore 💜 Me manda só o nome da peça, ou a foto de novo, que eu já sigo com seu pedido.';
  }

  return `Recebi sua mensagem: ${text}`;
}

module.exports = {
  buildInitialReply,
  extractRequestedSize,
  listAvailableSizes,
  listAvailableColors,
};
