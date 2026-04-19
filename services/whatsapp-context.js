function extractRequestedSize(text = '') {
  const lower = String(text || '').toLowerCase();
  const direct = lower.match(/\b(pp|p|m|g|gg|xg|xgg)\b/);
  if (direct) return direct[1].toUpperCase();
  const long = lower.match(/tamanho\s+(pp|p|m|g|gg|xg|xgg)/);
  if (long) return long[1].toUpperCase();
  return '';
}

function listAvailableSizes(lastProduct = null) {
  const details = Array.isArray(lastProduct?.variationDetails)
    ? lastProduct.variationDetails
    : Array.isArray(lastProduct?.raw?.variationDetails)
      ? lastProduct.raw.variationDetails
      : [];

  const sizes = [...new Set(details.map((variation) => variation?.size).filter(Boolean))];
  return sizes;
}

function listAvailableColors(lastProduct = null) {
  const fromProduct = Array.isArray(lastProduct?.availableColors)
    ? lastProduct.availableColors
    : Array.isArray(lastProduct?.raw?.availableColors)
      ? lastProduct.raw.availableColors
      : [];
  const fromVariations = Array.isArray(lastProduct?.variationDetails)
    ? lastProduct.variationDetails.map((variation) => variation?.color).filter(Boolean)
    : [];
  return [...new Set([...fromProduct, ...fromVariations])];
}

function buildInitialReply(inbound, options = {}) {
  const text = String(inbound?.text || '').trim();
  const lower = text.toLowerCase();
  const products = Array.isArray(options.products) ? options.products : [];
  const context = options.context || {};
  const lastProducts = Array.isArray(context.lastProducts) ? context.lastProducts : [];
  const lastProduct = lastProducts[0] || null;
  const requestedSize = extractRequestedSize(text);
  const matchingVariation = options.matchingVariation || null;
  const availableSizes = listAvailableSizes(lastProduct);
  const availableColors = listAvailableColors(lastProduct);

  if (!text) {
    return 'Oiiee amore 💜 Recebi sua mensagem aqui. Me conta o que você está procurando que eu sigo com você.';
  }

  if (/^oi+|ol[áa]|boa (tarde|noite|dia)/i.test(text)) {
    return 'Oiiee amore 💜 Tudo bem? Me conta o que você está procurando que eu te ajudo por aqui.';
  }

  if (/quero comprar|quero pedir|quero fazer pedido/i.test(lower)) {
    return 'Perfeito amore 💜 Me diz o que você quer ou me manda a foto/nome da peça que eu já sigo com você.';
  }

  if (/tem\s+lingerie|tem\s+conjunto|tem\s+calcinha|tem\s+suti[aã]|tem\s+body|tem\s+camisola/.test(lower)) {
    if (products.length > 0) {
      const top = products[0];
      const priceLine = top.price ? ` por ${top.price}` : '';
      return `Tem sim amore 💜 Já achei uma opção linda: *${top.name}*${priceLine}. Esse modelo é bem queridinho por aqui ✨ Se quiser, eu também posso te mostrar mais opções parecidas. Trabalhamos com retirada, entrega local e envio dentro dos Estados Unidos.`;
    }
    return 'Tem sim amore 💜 Me deixa puxar as melhores opções pra você. Se quiser, já posso te mostrar as que mais saem também. Trabalhamos com retirada, entrega local e envio dentro dos Estados Unidos.';
  }

  if (/quanto custa|preço|preco|valor/.test(lower)) {
    if (lastProduct?.name) {
      return lastProduct.price
        ? `Claro amore 💜 A *${lastProduct.name}* está por ${lastProduct.price}. Se quiser, eu já sigo com você nesse pedido. Trabalhamos com retirada, entrega local e envio dentro dos Estados Unidos.`
        : `Claro amore 💜 Vou confirmar certinho o valor da *${lastProduct.name}* pra te passar tudo redondinho.`;
    }
    return 'Claro amore 💜 Me confirma qual peça você quer que eu veja o valor certinho pra não te passar nada errado.';
  }

  if (/tem no tamanho|tamanho\s+[pmg]|tem p\b|tem m\b|tem g\b/.test(lower)) {
    if (lastProduct?.name) {
      if (requestedSize && matchingVariation) {
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
