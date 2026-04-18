# ENVIRONMENT.md — Variáveis necessárias para a nova arquitetura Cléo sem n8n

## Objetivo
Listar de forma clara o que precisa existir no ambiente para tirar os fallbacks e ativar as integrações reais do novo backend.

---

## 1. WhatsApp / Twilio
Essas variáveis ativam o envio real de mensagens no módulo novo.

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_WHATSAPP_FROM`

### Efeito
Sem elas:
- `services/whatsapp-outbound.js` fica em `mode: stub`

Com elas:
- o backend já pode enviar WhatsApp real via Twilio

---

## 2. Supabase
Essas variáveis ativam persistência real de customer/conversation/events.

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

### Efeito
Sem elas:
- `customer-conversation-store.js` cai em `memory-fallback`
- `event-store.js` cai em `memory-fallback`

Com elas:
- customer, conversation e events já podem ser persistidos de verdade

---

## 3. Square
Essa variável ativa catálogo real no novo backend.

- `SQUARE_ACCESS_TOKEN`

### Efeito
Sem ela:
- `catalog-service.js` falha
- o fluxo depende do fallback local de produto

Com ela:
- o backend pode puxar catálogo real do Square

---

## 4. Telegram operacional
Essas variáveis ativam o envio real do handoff operacional.

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_OPS_CHAT_ID`
- `TELEGRAM_OPS_THREAD_ID` (opcional, se quiser enviar direto em tópico)

### Efeito
Sem elas:
- `telegram-ops.js` fica em `mode: stub`

Com elas:
- handoff operacional já pode ser enviado ao Telegram real

---

## 5. Backend público
Estas variáveis ajudam em links e resolução pública quando necessário.

- `BACKEND_PUBLIC_BASE_URL`
- ou `RAILWAY_PUBLIC_DOMAIN`

---

# Ordem recomendada de ativação

## Primeiro
- `TWILIO_*`
- `SUPABASE_*`

## Depois
- `SQUARE_ACCESS_TOKEN`

## Depois
- `TELEGRAM_*`

---

# Leitura prática

## Se quisermos sair dos fallbacks na nova arquitetura, o mínimo mais importante é:
1. Twilio real
2. Supabase real
3. depois Square real
4. depois Telegram ops real

---

# Estado atual da migração
Hoje, sem essas envs carregadas localmente:
- WhatsApp outbound = stub
- customer/conversation = memory-fallback
- events = memory-fallback
- catálogo real = falha local / fallback
- Telegram ops = stub

Mesmo assim, a espinha do fluxo já está implementada e testada localmente.
