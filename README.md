# Black NetFiscal

Página de ofertas, três checkouts Pix nativos e boas-vindas. Publicação automática na Vercel a partir de main.

| Página | URL | Preço |
| --- | --- | --- |
| Ofertas | / | MBA, Pós e Imersão |
| MBA | /checkout/mba | R$ 6 à vista via Pix (teste temporário) |
| Pós | /checkout/pos | R$ 6 à vista via Pix (teste temporário) |
| Imersão | /checkout/imersao | R$ 6 por ingresso, à vista via Pix (teste temporário) |

Os três checkouts estão temporariamente em R$ 6 para testar o pagamento real e o redirecionamento. Valores regulares a restaurar após o teste: MBA R$ 397, Pós R$ 497 e Imersão R$ 697. Os preços do servidor (`lib/catalog.js`) e da interface (`assets/checkout.js`) devem ser restaurados juntos. Cobranças já emitidas mantêm o valor original.
| Obrigado | /obrigado | Guia e suporte para liberação |

O servidor determina os preços em lib/catalog.js. Valores, descontos e status enviados pelo navegador não autorizam pagamentos. O modal inicial apenas seleciona o produto. A adquirente Pix ativa na FireBot foi verificada em 11/11/2026 e limita cobranças a R$ 1.000: novos pedidos de Imersão aceitam um ingresso por compra. Pedidos antigos preservam sua quantidade registrada.

Suporte: **+55 75 98839-3742** (https://wa.me/5575988393742). A equipe libera o curso ou orienta a participação na Imersão. O redirecionamento ao obrigado é automático após confirmação verificada, mas não cria matrícula nem credenciais de uma plataforma de ensino.

## Vercel e credenciais

Node.js 24; preset Other; instalação pnpm install --frozen-lockfile; build node scripts/build.mjs; saída public. Functions na região gru1. Somente HTML e assets são copiados para a saída pública.

O armazenamento privado Vercel Blob netfiscal-checkout-orders utiliza OIDC e BLOB_STORE_ID.

Cadastre em Production, como Secret/Sensitive:

| Variável | Finalidade |
| --- | --- |
| FIREBOT_API_KEY | Chave privada fire_sk_live_... para gerar e consultar Pix |
| FIREBOT_WEBHOOK_SECRET | Opcional: segredo da assinatura HMAC do webhook da FireBot |
| POSEIDON_PUBLIC_KEY / POSEIDON_SECRET_KEY | Preservar para consultar e confirmar pedidos anteriores à migração |
| BLOB_STORE_ID | ID criado ao conectar o armazenamento privado |
| SITE_URL | Opcional; padrão https://black-netfiscal.vercel.app |

Não use chave pública nem chave de saque da FireBot. Nunca coloque credenciais em HTML, assets, commits, capturas ou chat. Faça um novo deploy após salvar variáveis. Sem FIREBOT_API_KEY, novas cobranças ficam indisponíveis. Não há retorno automático à Poseidon.

## Integração FireBot

Documentação autenticada: https://firebotbr.com/integracoes/docs

1. POST /api/checkout valida produto, dados e quantidade; reserva um pedido privado nf-fb-... e impede duplicidade por tentativa.
2. POST https://firebotbr.com/api/v1/pix/create utiliza x-api-key somente no servidor, amount em reais, productType DIGITAL, descrição, storeUrl e dados básicos do pagador. qrStyle plain solicita QR sem marca. Os dados de aluno, endereço e participantes permanecem no armazenamento privado.
3. A criação exige success true, ID fire_tx_..., valor correto, status PENDING e pixCopiaECola. O QR é gerado localmente a partir desse código, sem carregar imagens externas. O cliente vê QR, código e botão Pix Copia e Cola, com o rodapé Pagamento seguro.
4. O navegador consulta /api/order-status com um token de pedido assinado. O servidor consulta GET /api/v1/pix/{transactionId} com autenticação e confere ID, valor, método/moeda quando informados e status PAID antes de confirmar. Consultas são limitadas por pedido a uma a cada 15 segundos na primeira hora e uma por minuto depois, com reserva atômica para evitar concorrência. Não é necessário configurar webhook para que o redirecionamento funcione.
5. Após a confirmação, o comprador é redirecionado automaticamente a /obrigado?origem=checkout.

### Webhook opcional

Endpoint: https://black-netfiscal.vercel.app/api/firebot-webhook

Eventos: venda.paga, venda.pendente e venda.estornada. Configure o segredo de assinatura correspondente em FIREBOT_WEBHOOK_SECRET. O endpoint verifica x-signature (HMAC SHA-256 sobre o corpo original), localiza a transação em um índice privado e confere valor, método e status. Sem segredo configurado, recusa notificações. O navegador continua usando consultas autenticadas de confirmação.

Webhooks repetidos são idempotentes. Eventos atrasados e consultas lentas não desfazem pagamentos confirmados ou estornos. Eventos de saque são ignorados. O endpoint local de simulação nunca é publicado.

### Falhas e pedidos anteriores

Um timeout ou retorno incompleto nunca dispara uma segunda cobrança automaticamente. Se houver transactionId, o servidor pode consultar a mesma transação. Se a resposta se perder sem um ID, mantém o pedido em revisão para atendimento, sem inventar um código Pix. A interface não exibe mensagens de recuperação.

Pedidos da Poseidon mantêm seu endpoint /api/pix-webhook e consultas de status. Uma sessão antiga com Pix válido ou pagamento confirmado é preservada; uma tentativa antiga sem código não bloqueia um novo checkout FireBot. As novas cobranças usam exclusivamente a FireBot.

Os tokens de sessão e fingerprints da FireBot são assinados com sua chave privada; uma rotação dessa chave invalida sessões anteriores. Preserve registros de pedidos e oriente compradores com transações ainda pendentes antes de rotacionar.

## Dados e segurança

Dados pessoais, credenciais e códigos Pix não são registrados em logs. Respostas públicas não incluem documentos, contatos, dados do pagador ou segredos de webhook. Logs incluem somente IDs operacionais, códigos HTTP, nomes de campos e resultados de validação. Novas tentativas são limitadas a seis por IP/hora. Escritas usam ETags e compare-and-swap para proteger atualizações simultâneas.

O Blob é privado e não há exclusão automática de pedidos. O responsável deve definir a retenção operacional e remover dados antigos após revisão.

## Desenvolvimento e testes

Execute pnpm install, pnpm test e pnpm build. Para testar sem cobranças reais: node scripts/dev.mjs --mock. O modo padrão simula a FireBot; usa memória, gera QR explicitamente de teste e disponibiliza /__test__/paid apenas no servidor local. Envie webhook false nessa simulação para verificar confirmação pela consulta autenticada. --mock --legacy --recover-pix reproduz o antigo fluxo Poseidon.

Os testes cobrem preços, limite por compra, dados inválidos, duplicidade, autenticação de status, assinatura HMAC, valores adulterados, consulta sem webhook, estorno, concorrência, timeout e armazenamento. A validação real exige a chave da conta configurada e uma compra controlada pelo responsável; testes simulados não comprovam processamento bancário.

## Arquivos

- index.html, assets/styles.css, assets/site.js: ofertas e modal.
- checkout.html, assets/checkout.js, assets/checkout.css: os três checkouts.
- lib/firebot.js, api/firebot-webhook.js: nova integração.
- lib/payments.js, api/pix-webhook.js: reconciliação dos pedidos antigos.
- api/checkout.js, api/order-status.js, lib/http.js, lib/store.js: rotas e armazenamento.
- obrigado.html, assets/obrigado.*, assets/suporte-config.js e assets/guia-boas-vindas-netfiscal.pdf: pós-compra e suporte.

A adquirente Pix exige no mínimo R$ 6 por cobrança. Valores inferiores são rejeitados antes de criar o pedido. Recusas explícitas por valor mínimo liberam o formulário para uma nova tentativa; falhas incertas continuam protegidas contra cobranças duplicadas.
