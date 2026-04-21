function inferCustomerProfile(context = {}) {
  const customer = context.customer || {};
  const totalOrders = Number(customer.total_orders || customer.totalOrders || 0);
  const tags = Array.isArray(customer.tags) ? customer.tags.map((tag) => String(tag).toLowerCase()) : [];
  const isVip = Boolean(customer.is_vip || customer.isVip || tags.includes('vip') || totalOrders >= 5);
  const lastInteraction = customer.last_interaction || customer.lastInteraction || '';
  const inactive = lastInteraction
    ? (Date.now() - new Date(lastInteraction).getTime()) > (60 * 24 * 60 * 60 * 1000)
    : false;
  const isRecurring = totalOrders >= 2;
  const gender = String(customer.gender || '').toLowerCase();
  const isMale = gender === 'male' || gender === 'masculino' || tags.includes('male') || tags.includes('masculino');
  const isShy = tags.includes('shy') || tags.includes('timida') || tags.includes('tímida');

  return {
    name: customer.name || context.profileName || '',
    totalOrders,
    isVip,
    isRecurring,
    inactive,
    isMale,
    isShy,
  };
}

function buildContextBlock(context = {}) {
  const cartItems = Array.isArray(context.cart?.items) ? context.cart.items : [];
  const checkout = context.checkout || {};
  const lastMessage = String(context.lastInboundText || '').trim();
  const summary = String(context.summary || '').trim();

  return {
    currentStage: context.currentStage || checkout.stage || '',
    summary,
    lastMessage,
    cart: {
      items: cartItems,
      itemsCount: Number(context.cart?.itemsCount || cartItems.length || 0),
      semanticFamilies: Array.isArray(context.cart?.semanticFamilies) ? context.cart.semanticFamilies : [],
      semanticSubfamilies: Array.isArray(context.cart?.semanticSubfamilies) ? context.cart.semanticSubfamilies : [],
    },
    checkout: {
      deliveryMode: checkout.deliveryMode || '',
      fullName: checkout.fullName || '',
      phone: checkout.phone || '',
      email: checkout.email || '',
      address: checkout.address || '',
    },
    customerProfile: inferCustomerProfile(context),
  };
}

const { getStoreFacts } = require('./cleo-store-facts');

function detectConversationMode(text = '', context = {}, inbound = {}) {
  const lower = String(text || '').trim().toLowerCase();
  const stage = String(context.currentStage || context.checkout?.stage || '');
  const hasMedia = Array.isArray(inbound.media) && inbound.media.length > 0;

  if (/áudio|audio|voice/i.test(String(inbound.media?.[0]?.contentType || '')) || /transcri/i.test(lower)) {
    return 'audio_recovery';
  }

  if (hasMedia && !lower) {
    return 'media_recovery';
  }

  if (/não entendi|ficou confus|nossa conversa.*confus|pera|calma|explica melhor|me perdi|não é isso|não era isso/.test(lower)) {
    return 'recover';
  }

  if (/e aí|e ai|oi\?|olá\?|ola\?|hum\?|cadê|me responde/.test(lower)) {
    return 'nudge';
  }

  if (/tem outro parecido|mais nessa linha|mais opções|mais opc|tem mais opc|me mostra outro/.test(lower)) {
    return 'alternatives';
  }

  if (/qual (é|e) melhor|qual (é|e) mais forte|qual a diferen|qual compensa/.test(lower)) {
    return 'compare';
  }

  if (/tem mais alguma coisa|mais alguma sugest|mais alguma opç|tem algo a mais/.test(lower)) {
    return 'cross_sell';
  }

  if (/desconto|descontinho|faz mais barato|faz um valor melhor|tem como melhorar|consegue melhorar|precinho|pre[cç]o melhor|t[aá] caro|vou pensar|tenho vergonha|t[oô] com vergonha|discreto|discreta/.test(lower)) {
    return 'objection';
  }

  if (/quero esse|vou querer esse|vou levar esse|esse não|qual você acha melhor pra mim|quero dois|vou levar dois|leva dois|separa dois|me indica um|não sei qual escolher|quero algo mais forte/.test(lower)) {
    return 'intent_short';
  }

  if (/quero|vou querer|gostei|separa|leva/.test(lower)) {
    return 'close';
  }

  if (/tem\s+|você tem|vc tem|algo pra|me indica|me mostra|o que você tem/.test(lower)) {
    return 'discovery';
  }

  if (/endere[cç]o|onde vocês ficam|onde fica a loja|tem loja f[ií]sica|localiza[cç][aã]o|hor[aá]rio|funcionamento|site|instagram|linktree|grupo vip|whatsapp oficial|troca|devolu[cç][aã]o|pagamento|zelle|venmo|afterpay|square|roubado|roubaram|entregue e sumiu|sumiu depois de entregue/.test(lower)) {
    return 'institutional';
  }

  if (/foto|fotos|imagem|imagens|v[ií]deo|video|me manda|me envia|quero ver foto|quero ver v[ií]deo/.test(lower)) {
    return 'media_request';
  }

  if (/frete|envio|usps|pickup|retirada|entrega local|entrega em|voc[eê]s entregam|manda pra|marlboro|marlborough|hudson|framingham/.test(lower)) {
    return 'shipping';
  }

  if (/checkout_|handoff_ready/.test(stage)) {
    return 'checkout';
  }

  return 'general';
}

function getPrimaryCartItem(context = {}) {
  return Array.isArray(context.cart?.items) && context.cart.items.length > 0
    ? context.cart.items[0]
    : null;
}

function getPrimaryItemName(context = {}) {
  return getPrimaryCartItem(context)?.label || context.lastProducts?.[0]?.name || context.lastProduct || context.lastProductPayload?.name || '';
}

function buildRecoveryReply(context = {}) {
  const cartItems = Array.isArray(context.cart?.items) ? context.cart.items : [];
  if (cartItems.length > 1) {
    const itemsLine = cartItems.map((item) => `${item.quantity}x ${item.label}`).join(', ');
    return `Você tem razão 💜 Vamos reorganizar certinho: até agora eu entendi *${itemsLine}*. Agora me diz só como você prefere receber: *pickup*, *entrega em Marlborough* ou *USPS*.`;
  }

  if (cartItems.length === 1) {
    return `Você tem razão 💜 Vamos por partes: até aqui eu entendi que você quer *${cartItems[0].label}*. Agora me diz só se você prefere *pickup*, *entrega em Marlborough* ou *USPS*.`;
  }

  return 'Você tem razão 💜 Vamos reorganizar direitinho. Me fala em uma frase só o que você quer agora que eu sigo sem complicar.';
}

function inferDiscoveryMood(text = '') {
  const lower = String(text || '').toLowerCase();
  if (/libido|tes[aã]o|vontade|desejo|excita/.test(lower)) return 'libido';
  if (/apertad|sempre virgem|lacradinha|adstring/.test(lower)) return 'apertar';
  if (/oral|boquete|chupar|blow|garganta/.test(lower)) return 'oral';
  if (/berinjelo|volum[aã]o|ere[cç][aã]o|retard|homem|masculino/.test(lower)) return 'masculino';
  if (/lubrific|seca|molhar|desliz/.test(lower)) return 'lubrificacao';
  return 'geral';
}

function hasWeakIntentSignal(text = '') {
  const lower = String(text || '').trim().toLowerCase();
  if (!lower) return true;
  if (lower.length <= 3) return true;
  if (/^(oi+|ol[áa]|boa noite|boa tarde|bom dia|hum|hmm|quero|tem|me ajuda|me indica)$/.test(lower)) return true;
  return false;
}

function buildClarifyingQuestion({ context = {}, inbound = {} } = {}) {
  const text = String(inbound.text || '').toLowerCase();
  const customerProfile = inferCustomerProfile(context);

  if (/presente|namorado|marido|esposa|mulher/.test(text) || customerProfile.isMale) {
    return 'Me fala só se é pra presente ou pra você, que eu já te indico no caminho certo 💜';
  }

  if (/lingerie|conjunto|camisola|body/.test(text)) {
    return 'Você quer algo mais pra dia a dia, mais sensual, ou pra uma ocasião especial? 💜';
  }

  if (/libido|tes[aã]o|excita|desejo|apertad|oral|boquete|lubrific|seca|molhar|masculino/.test(text)) {
    return 'Você quer algo mais leve ou algo mais direto mesmo? 💜';
  }

  return 'Me fala rapidinho o que você quer: lingerie, sex shop, presente ou algo pra uma ocasião especial? 💜';
}

function buildDiscoveryReply({ inbound = {}, products = [], context = {} } = {}) {
  const available = Array.isArray(products) ? products.filter(Boolean) : [];
  const weakIntent = hasWeakIntentSignal(inbound.text || '');
  const top = available.find((item) => item?.inventory_in_stock !== false) || available[0] || null;
  if (weakIntent && available.length > 3) return buildClarifyingQuestion({ context, inbound });
  if (!top?.name) return buildClarifyingQuestion({ context, inbound });
  const text = String(inbound.text || '').trim();
  const mood = inferDiscoveryMood(text);
  const customerProfile = inferCustomerProfile(context);
  const priceLine = top.price ? ` por ${top.price}` : '';
  const second = available.find((item) => item?.name && item.name !== top.name);
  const secondLine = second?.name ? ` Se quiser, eu também te mostro *${second.name}* para você sentir melhor a diferença.` : '';
  let base = mood === 'libido'
    ? `Tenho sim 💜 Pra libido, eu começaria por *${top.name}*${priceLine}.`
    : mood === 'apertar'
      ? `Tenho sim 💜 Pra essa linha mais apertadinha, eu iria primeiro em *${top.name}*${priceLine}.`
      : mood === 'oral'
        ? `Tenho sim 💜 Pra oral, eu te mostraria primeiro *${top.name}*${priceLine}.`
        : mood === 'masculino'
          ? `Tenho sim 💜 Pra essa linha masculina, eu começaria por *${top.name}*${priceLine}.`
          : mood === 'lubrificacao'
            ? `Tenho sim 💜 Pra lubrificação, eu te mostraria primeiro *${top.name}*${priceLine}.`
            : `Tenho sim 💜 O que eu mais te indicaria aí é *${top.name}*${priceLine}.`;

  if (customerProfile.isVip) {
    base = `Separei uma opção linda pra você 💜 Eu começaria por *${top.name}*${priceLine}.`;
  } else if (customerProfile.inactive) {
    base = `Tenho novidade boa pra você 💜 Eu começaria por *${top.name}*${priceLine}.`;
  } else if (customerProfile.isMale) {
    base = `Tenho sim 💜 Se for presente ou pra facilitar sua escolha, eu começaria por *${top.name}*${priceLine}.`;
  } else if (customerProfile.isShy) {
    base = `Tenho sim 💜 Vou te mostrar de um jeito bem leve e discreto: eu começaria por *${top.name}*${priceLine}.`;
  }

  return `${base}${secondLine}`;
}

function buildInitialHelpReplyAgentic({ inbound = {}, products = [], context = {} } = {}) {
  const text = String(inbound.text || '').trim();
  const customerProfile = inferCustomerProfile(context);
  const firstName = String(customerProfile.name || '').trim().split(/\s+/)[0] || '';

  if (/^oi+|ol[áa]|boa (tarde|noite|dia)/i.test(text)) {
    if (customerProfile.isVip && firstName) {
      return `Oiiee ${firstName} 💜 Minha cliente querida, que bom te ver de volta. Quer que eu te mostre o que tem de mais lindo hoje?`;
    }
    if (customerProfile.inactive && firstName) {
      return `Oiiee ${firstName} 💜 Quanto tempo! Me fala o que você tá procurando que eu já te mostro as novidades.`;
    }
    if (customerProfile.isRecurring && firstName) {
      return `Oiiee ${firstName} 💜 Que bom te ver de volta. Me fala o que você quer hoje que eu sigo com você.`;
    }
    return 'Oi amore 💜 Me fala o que você quer que eu já te ajudo.';
  }
  return buildDiscoveryReply({ inbound, products, context });
}

function buildComparisonReply({ context = {}, inbound = {} } = {}) {
  const first = context.lastProducts?.[0] || null;
  const second = context.lastProducts?.[1] || null;
  if (first?.name && second?.name) {
    return `Entre *${first.name}* e *${second.name}*, eu te falaria assim: se você quer algo mais direto para uma proposta, eu iria mais em um; se quer puxar mais para outra sensação, eu iria no outro. Se quiser, eu já te digo qual faz mais sentido pro que você quer 💜`;
  }

  if (hasWeakIntentSignal(inbound.text || '')) {
    return buildClarifyingQuestion({ context, inbound });
  }
  if (first?.name) {
    return `Se você quiser, eu comparo *${first.name}* com outra opção parecida e te explico a diferença sem enrolação 💜`;
  }
  return '';
}

function buildCrossSellReplyAgentic({ context = {} } = {}) {
  const productName = getPrimaryItemName(context);
  const customerProfile = inferCustomerProfile(context);
  if (!productName) return '';

  if (customerProfile.isVip) {
    return `Tenho sim 💜 Junto com *${productName}*, eu também posso te mostrar um complemento mais especial pra fechar redondinho.`;
  }

  if (customerProfile.isMale) {
    return `Tenho sim 💜 Junto com *${productName}*, eu posso te mostrar mais um item que combine e facilite seu presente.`;
  }

  if (customerProfile.isShy) {
    return `Tenho sim 💜 Junto com *${productName}*, eu posso te sugerir um complemento bem discreto e fácil de encaixar.`;
  }

  return `Tenho sim 💜 Junto com *${productName}*, eu também te mostraria algo que complete melhor essa proposta e faça mais sentido no conjunto.`;
}

function buildAlternativesReplyAgentic({ context = {} } = {}) {
  const productName = getPrimaryItemName(context);
  if (!productName) return '';
  return `Tenho sim 💜 Se você quiser, eu te mostro outras opções parecidas com *${productName}* e já te digo qual muda mais de verdade.`;
}

function buildClarifyReplyAgentic({ context = {} } = {}) {
  const productName = getPrimaryItemName(context);
  if (productName) {
    return `Se não era *${productName}*, me fala rapidinho o que você quer mudar que eu ajusto daqui 💜`;
  }
  return 'Me fala rapidinho o que você quer mudar que eu ajusto daqui 💜';
}

function buildNudgeReplyAgentic({ context = {} } = {}) {
  const productName = getPrimaryItemName(context);
  if (productName) {
    return `Tô aqui 💜 Se você quiser, eu continuo por *${productName}* ou te mostro outra opção parecida.`;
  }
  return 'Tô aqui 💜 Me fala só o que você quer que eu sigo com você.';
}

function buildFollowUpReplyAgentic({ context = {} } = {}) {
  const productName = getPrimaryItemName(context);
  const cartItems = Array.isArray(context.cart?.items) ? context.cart.items : [];
  if (cartItems.length > 1) {
    const itemsLine = cartItems.map((item) => `${item.quantity}x ${item.label}`).join(', ');
    return `Até aqui ficou *${itemsLine}* 💜 Se quiser, eu sigo daqui e te conduzo no próximo passo sem embolar.`;
  }
  if (productName) {
    return `Tô com você 💜 Se quiser, eu continuo por *${productName}* e te digo o próximo passo sem complicar.`;
  }
  return 'Me fala o que você quer sentir, o tipo de produto que você quer, ou se já tem algum nome em mente que eu sigo com você 💜';
}

function buildObjectionReplyAgentic({ context = {}, inbound = {} } = {}) {
  const text = String(inbound.text || '').trim().toLowerCase();
  const productName = getPrimaryItemName(context);

  if (/desconto|descontinho|faz mais barato|faz um valor melhor|tem como melhorar|consegue melhorar|precinho/.test(text)) {
    return 'Amore, no preço eu não consigo mexer 💜 Mas se você quiser, eu posso te ajudar a montar da melhor forma e ainda incluir um brindezinho especial 🎁';
  }

  if (/t[aá] caro/.test(text)) {
    return 'Entendo mulher 💜 Mas posso te ajudar a montar da forma que faça mais sentido pra você, e se fechar eu ainda vejo um brindezinho especial 🎁';
  }

  if (/vou pensar/.test(text)) {
    return productName
      ? `Claro amore, sem pressão nenhuma 💜 Se quiser, eu posso deixar *${productName}* separado pra você por enquanto.`
      : 'Claro amore, sem pressão nenhuma 💜 Se quiser, eu posso deixar isso encaminhado pra você e você me chama quando decidir.';
  }

  if (/tenho vergonha|t[oô] com vergonha|discreto|discreta/.test(text)) {
    return 'Fica tranquila 💜 É tudo bem discreto e eu te conduzo com jeitinho, sem te deixar desconfortável.';
  }

  return '';
}

function buildIntentShortReplyAgentic({ context = {}, inbound = {} } = {}) {
  const text = String(inbound.text || '').trim().toLowerCase();
  const productName = getPrimaryItemName(context);

  if (/esse não/.test(text)) {
    return productName
      ? `Sem problema 💜 Então eu tiro *${productName}* da frente e te mostro outra opção melhor.`
      : 'Sem problema 💜 Então me fala rapidinho qual direção você quer que eu te mostro outra opção.';
  }

  if (/qual você acha melhor pra mim|me indica um|não sei qual escolher/.test(text)) {
    return productName
      ? `Se eu fosse te indicar uma direção agora, eu começaria por *${productName}* e depois te mostraria a segunda melhor opção pra você sentir a diferença 💜`
      : 'Se você quiser, eu te digo direto o que eu acho melhor pra você agora 💜';
  }

  if (/quero algo mais forte/.test(text)) {
    return productName
      ? `Se você quer algo mais forte, eu posso subir um degrau a partir de *${productName}* e te mostrar uma opção mais intensa 💜`
      : 'Se você quer algo mais forte, eu te mostro já a opção que sobe um degrau 💜';
  }

  if (/quero dois|vou levar dois|leva dois|separa dois/.test(text)) {
    return productName
      ? `Perfeito 💜 Então eu já considero *2x ${productName}*. Agora me diz só se você prefere *pickup*, *entrega em Marlborough* ou *USPS*.`
      : 'Perfeito 💜 Então me fala só quais dois itens você quer que eu já organizo daqui.';
  }

  if (/quero esse|vou querer esse|vou levar esse/.test(text)) {
    return productName
      ? `Perfeito 💜 Então vamos seguir com *${productName}*. Me diz só se você prefere *pickup*, *entrega em Marlborough* ou *USPS*.`
      : 'Perfeito 💜 Então me confirma só qual item você quer que eu sigo daqui.';
  }

  return '';
}

function buildCloseReply({ context = {} } = {}) {
  const productName = getPrimaryItemName(context);
  const cartItems = Array.isArray(context.cart?.items) ? context.cart.items : [];
  if (cartItems.length > 1) {
    const itemsLine = cartItems.map((item) => `${item.quantity}x ${item.label}`).join(', ');
    return `Perfeito 💜 Então vamos seguir com *${itemsLine}*. Agora me diz só se você prefere *pickup*, *entrega em Marlborough* ou *USPS*.`;
  }
  if (!productName) return '';
  return `Perfeito 💜 Então vamos seguir com *${productName}*. Me diz só se você prefere *pickup*, *entrega em Marlborough* ou *USPS*.`;
}

function buildCheckoutReplyAgentic({ context = {} } = {}) {
  const stage = String(context.currentStage || context.checkout?.stage || '');
  const productName = getPrimaryItemName(context);

  if (stage === 'checkout_choose_delivery') {
    return `Perfeito 💜 Me diz só como você prefere receber${productName ? ` *${productName}*` : ' seu pedido'}: *pickup*, *entrega em Marlborough* ou *USPS*.`;
  }

  return '';
}

function buildInstitutionalReplyAgentic({ inbound = {} } = {}) {
  const text = String(inbound.text || '').toLowerCase();
  const facts = getStoreFacts();

  if (/endere[cç]o|onde vocês ficam|onde fica a loja|localiza[cç][aã]o/.test(text)) {
    return `Estamos em *${facts.address}* 💜 Se quiser atendimento presencial, é só com horário marcado.`;
  }

  if (/hor[aá]rio|funcionamento/.test(text)) {
    return `Nosso atendimento é de *segunda a sábado, 10am às 8pm*, e *domingo, 2pm às 9pm* 💜 O site fica disponível 24h.`;
  }

  if (/site/.test(text)) {
    return `Nosso site é: ${facts.site} 💜`;
  }

  if (/linktree/.test(text)) {
    return `Aqui está nossa central de links 💜 ${facts.linktree}`;
  }

  if (/grupo vip/.test(text)) {
    return `Se quiser entrar no nosso Grupo VIP do WhatsApp, é por aqui 💜 ${facts.vipGroup}`;
  }

  if (/whatsapp oficial/.test(text)) {
    return `Nosso WhatsApp oficial é esse aqui 💜 ${facts.whatsapp}`;
  }

  if (/tem loja f[ií]sica/.test(text)) {
    return `Temos atendimento presencial sim 💜 Ficamos em *${facts.address}* e atendemos só com horário marcado.`;
  }

  if (/troca|devolu[cç][aã]o/.test(text)) {
    return 'Nossa troca funciona assim 💜 são *7 dias após o recebimento*, com a peça *sem uso e com etiqueta*. Não fazemos devolução em dinheiro e peça de promoção não tem troca.';
  }

  if (/roubado|roubaram|entregue e sumiu|sumiu depois de entregue/.test(text)) {
    return 'Amore, lamento muito essa situação 💜 Quando a USPS confirma a entrega no endereço informado, a responsabilidade passa a ser do destinatário. Se quiser, eu te explico como seguir com claim na USPS.';
  }

  if (/pagamento|zelle|venmo|afterpay|square/.test(text)) {
    return 'Aceitamos *Zelle, Venmo, AfterPay e Square* 💜 Se quiser, eu já te passo a melhor opção pra fechar seu pedido.';
  }

  return '';
}

function buildShippingReplyAgentic({ context = {}, inbound = {} } = {}) {
  const text = String(inbound.text || '').toLowerCase();
  const productName = getPrimaryItemName(context);

  if (/framingham/.test(text)) {
    return 'Entregamos na região sim 💜 Me confirma só o endereço certinho ou ZIP code que eu te digo a melhor forma de entrega pra você.';
  }

  if (/hudson/.test(text)) {
    return 'Pra entrega local em *Hudson*, fica *$8* 💜';
  }

  if (/marlboro|marlborough/.test(text)) {
    return 'Pra entrega local em *Marlborough*, fica *$5* 💜';
  }

  if (/pickup|retirada/.test(text)) {
    return 'Tem pickup sim 💜 É grátis, mas funciona só com horário marcado.';
  }

  if (/usps|frete|envio/.test(text)) {
    return 'Enviamos por USPS para todo os EUA 💜 O frete é *$10 fixo* e acima de *$99* sai grátis.';
  }

  if (productName) {
    return `Se for *${productName}*, eu te digo certinho a melhor entrega pra você 💜 Se quiser, me fala sua cidade ou ZIP code.`;
  }

  return 'Eu te passo certinho a melhor entrega 💜 Me fala só sua cidade ou se você prefere *pickup*, *entrega local* ou *USPS*.';
}

function buildMediaRequestReplyAgentic({ context = {} } = {}) {
  const productName = getPrimaryItemName(context);
  if (productName) {
    return `Claro 💜 Se quiser, eu te mostro mais de *${productName}* e também posso te mandar outra opção parecida.`;
  }
  return 'Claro 💜 Me fala qual produto ou linha você quer ver que eu sigo por aí.';
}

function buildAudioRecoveryReplyAgentic() {
  return 'Tô te ouvindo sim 💜 Se quiser, me manda em texto rapidinho o principal ponto ou repete o que você precisa que eu sigo certinho com você.';
}

function buildMediaRecoveryReplyAgentic() {
  return 'Recebi aqui 💜 Se quiser, me diz rapidinho o que você quer ver ou confirmar nessa imagem que eu sigo com você.';
}

function buildProfileAwareFollowUp(context = {}) {
  const customerProfile = inferCustomerProfile(context);
  const productName = getPrimaryItemName(context);

  if (customerProfile.isVip && productName) {
    return `Pra você, eu seguiria por *${productName}* e se quiser também separo uma opção mais especial junto 💜`;
  }

  if (customerProfile.inactive && productName) {
    return `Se quiser, eu retomo por *${productName}* e também te mostro o que chegou de novidade nessa linha 💜`;
  }

  if (customerProfile.isMale && productName) {
    return `Se quiser, eu sigo por *${productName}* e te ajudo a fechar isso de um jeito fácil, sem complicar 💜`;
  }

  if (customerProfile.isShy && productName) {
    return `Se quiser, eu sigo por *${productName}* com calma e de um jeito bem discreto 💜`;
  }

  return '';
}

function buildGeneralReply({ context = {}, inbound = {} } = {}) {
  const text = String(inbound.text || '').trim();
  const customerProfile = inferCustomerProfile(context);
  const firstName = String(customerProfile.name || '').trim().split(/\s+/)[0] || '';
  if (/^oi+|ol[áa]|boa (tarde|noite|dia)/i.test(text)) {
    if (customerProfile.isVip && firstName) {
      return `Oiiee ${firstName} 💜 Minha cliente querida, quer ver novidade ou você já tá procurando algo específico?`;
    }
    if (customerProfile.inactive && firstName) {
      return `Oiiee ${firstName} 💜 Saudade de você por aqui. Quer que eu te mostre novidade ou você já tem algo em mente?`;
    }
    if (customerProfile.isRecurring && firstName) {
      return `Oiiee ${firstName} 💜 Que bom te ver de volta. Me fala o que você quer que eu sigo com você.`;
    }
    return 'Oi amore 💜 Me fala o que você quer ou o que você está procurando que eu sigo com você.';
  }
  if (/tem algo|algo pra|algo para|me indica|me mostra/.test(text.toLowerCase())) {
    return hasWeakIntentSignal(text)
      ? buildClarifyingQuestion({ context, inbound })
      : 'Tenho sim 💜 Me fala só o que você quer sentir ou a linha que você quer que eu já te indico melhor.';
  }
  return buildProfileAwareFollowUp(context) || buildFollowUpReplyAgentic({ context }) || buildClarifyingQuestion({ context, inbound });
}

function buildActions({ mode = 'general', context = {}, inbound = {} } = {}) {
  const stage = String(context.currentStage || context.checkout?.stage || '');
  const hasCart = Array.isArray(context.cart?.items) && context.cart.items.length > 0;
  const text = String(inbound.text || '').trim().toLowerCase();
  const closeSignals = /quero|vou querer|gostei|separa|leva/.test(text);
  const confirmationSignals = /ok|pode seguir|fechado|certo|sim/.test(text);
  const multiItemSignals = /\b\d+\b.*\be\b|,/.test(text) && closeSignals;

  return {
    shouldFallback: false,
    updateCart: (mode === 'close' && !hasCart) || multiItemSignals,
    updateCheckout: mode === 'close' || mode === 'recover' || mode === 'checkout' || confirmationSignals,
    triggerHandoff: stage === 'handoff_ready' || (confirmationSignals && stage === 'checkout_review'),
    needsHumanRecoveryStyle: mode === 'recover',
    preferredNextStage: mode === 'close'
      ? 'checkout_choose_delivery'
      : mode === 'recover'
        ? 'checkout_choose_delivery'
        : confirmationSignals && stage === 'checkout_review'
          ? 'handoff_ready'
          : mode === 'checkout'
            ? stage || 'checkout_choose_delivery'
            : '',
    shouldSummarizeCart: multiItemSignals || mode === 'recover',
  };
}

function buildAgenticReply({ inbound = {}, context = {}, products = [] } = {}) {
  const text = String(inbound.text || '').trim();
  const mode = detectConversationMode(text, context, inbound);
  const contextBlock = buildContextBlock(context);

  let replyText = '';
  if (mode === 'recover') {
    replyText = buildRecoveryReply(context);
  } else if (mode === 'discovery') {
    replyText = buildInitialHelpReplyAgentic({ inbound, context, products });
  } else if (mode === 'alternatives') {
    replyText = buildAlternativesReplyAgentic({ context });
  } else if (mode === 'nudge') {
    replyText = buildNudgeReplyAgentic({ context });
  } else if (mode === 'objection') {
    replyText = buildObjectionReplyAgentic({ context, inbound });
  } else if (mode === 'intent_short') {
    replyText = buildIntentShortReplyAgentic({ context, inbound });
  } else if (mode === 'recover' && /não é isso|não era isso/.test(text.toLowerCase())) {
    replyText = buildClarifyReplyAgentic({ context });
  } else if (mode === 'compare') {
    replyText = buildComparisonReply({ context, inbound });
  } else if (mode === 'cross_sell') {
    replyText = buildCrossSellReplyAgentic({ context });
  } else if (mode === 'close') {
    replyText = buildCloseReply({ context });
  } else if (mode === 'institutional') {
    replyText = buildInstitutionalReplyAgentic({ inbound });
  } else if (mode === 'media_request') {
    replyText = buildMediaRequestReplyAgentic({ context, inbound });
  } else if (mode === 'audio_recovery') {
    replyText = buildAudioRecoveryReplyAgentic({ inbound });
  } else if (mode === 'media_recovery') {
    replyText = buildMediaRecoveryReplyAgentic({ inbound });
  } else if (mode === 'shipping') {
    replyText = buildShippingReplyAgentic({ context, inbound });
  } else if (mode === 'checkout') {
    replyText = buildCheckoutReplyAgentic({ context });
  } else {
    replyText = buildGeneralReply({ context, inbound });
  }

  return {
    mode,
    contextBlock,
    replyText,
    actions: {
      ...buildActions({ mode, context, inbound }),
      shouldFallback: !replyText,
    },
  };
}

module.exports = {
  buildAgenticReply,
  detectConversationMode,
  buildRecoveryReply,
  buildContextBlock,
};
