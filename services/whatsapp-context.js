function buildInitialReply(inbound, options = {}) {
  const text = String(inbound?.text || '').trim();
  const lower = text.toLowerCase();
  const products = Array.isArray(options.products) ? options.products : [];
  const context = options.context || {};
  const lastProducts = Array.isArray(context.lastProducts) ? context.lastProducts : [];
  const lastProduct = lastProducts[0] || null;

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
      return `Tem sim amore 💜 Já achei uma opção linda: *${top.name}*${priceLine}. Se quiser, eu também posso te mostrar mais opções parecidas.`;
    }
    return 'Tem sim amore 💜 Me deixa puxar as melhores opções pra você. Se quiser, já posso te mostrar as que mais saem também.';
  }

  if (/quanto custa|preço|preco|valor/.test(lower)) {
    if (lastProduct?.name) {
      return lastProduct.price
        ? `Claro amore 💜 A *${lastProduct.name}* está por ${lastProduct.price}. Se quiser, eu já sigo com você nesse pedido.`
        : `Claro amore 💜 Vou confirmar certinho o valor da *${lastProduct.name}* pra te passar tudo redondinho.`;
    }
    return 'Claro amore 💜 Me confirma qual peça você quer que eu veja o valor certinho pra não te passar nada errado.';
  }

  if (/tem no tamanho|tamanho\s+[pmg]|tem p\b|tem m\b|tem g\b/.test(lower)) {
    if (lastProduct?.name) {
      return `Consigo ver sim amore 💜 Vou checar o tamanho certinho da *${lastProduct.name}* para você.`;
    }
    return 'Consigo ver sim amore 💜 Me confirma qual peça você quer que eu cheque no tamanho certinho.';
  }

  if (/tem em outra cor|outra cor|outras cores/.test(lower)) {
    if (lastProduct?.name) {
      return `Vejo sim mulher 💜 Vou consultar as outras cores da *${lastProduct.name}* pra você.`;
    }
    return 'Vejo sim mulher 💜 Me confirma qual peça você quer que eu consulte nas outras cores.';
  }

  if (/quero esse|quero essa|vou querer|gostei desse|gostei dessa/.test(lower)) {
    if (lastProduct?.name) {
      return `Aaaamei amore 💜 Perfeito, vamos seguir com a *${lastProduct.name}*. Me manda só seu nome completo que eu já começo seu pedido.`;
    }
    return 'Aaaamei amore 💜 Me manda só o nome da peça, ou a foto de novo, que eu já sigo com seu pedido.';
  }

  return `Recebi sua mensagem: ${text}`;
}

module.exports = {
  buildInitialReply,
};
