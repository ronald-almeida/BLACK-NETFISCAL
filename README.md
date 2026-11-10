# Black NetFiscal

Página de ofertas, três checkouts Pix nativos e boas-vindas. Publicação automática na Vercel a partir de main.

| Página | URL | Preço |
| --- | --- | --- |
| Ofertas | / | MBA, Pós e Imersão |
| MBA | /checkout/mba | R$ 5 à vista via Pix (temporário para teste; preço original R$ 397) |
| Pós | /checkout/pos | R$ 497 à vista via Pix |
| Imersão | /checkout/imersao | R$ 697 por ingresso, à vista via Pix |
| Obrigado | /obrigado | Guia e suporte para liberação |

O modal da página inicial só seleciona o produto. Os dados pessoais são preenchidos no checkout. Os valores são determinados no servidor em lib/catalog.js; valores enviados pelo navegador não alteram a cobrança. A Imersão aceita de 1 a 5 ingressos por pedido, com os respectivos participantes. A condição Black já está incluída no preço, sem desconto adicional por cupom.

O suporte de todas as páginas e do PDF é **+55 75 8839-3783** (https://wa.me/557588393783). A equipe faz a liberação do curso ou orienta a participação na Imersão. Não há envio automático de credenciais nem matrícula automática numa plataforma de ensino.

## Vercel

Node.js 24; preset Other; diretório raiz ./; instalação pnpm install --frozen-lockfile; build node scripts/build.mjs; saída public. Functions na região gru1.

Somente HTML e assets são copiados para a saída pública. APIs, bibliotecas de servidor, testes, scripts e variáveis de ambiente não são publicados como arquivos estáticos.

O armazenamento **privado** Vercel Blob netfiscal-checkout-orders está conectado ao projeto. O SDK utiliza OIDC e BLOB_STORE_ID.

Cadastre as variáveis no projeto, em Production (e em Preview somente se for usar uma conta de teste):

| Variável | Conteúdo |
| --- | --- |
| POSEIDON_PUBLIC_KEY | Chave pública da conta do vendedor |
| POSEIDON_SECRET_KEY | Chave secreta da conta do vendedor, como Secret/Sensitive |
| BLOB_STORE_ID | Criada ao conectar o armazenamento privado |
| SITE_URL | Opcional; padrão https://black-netfiscal.vercel.app |

Faça novo deploy depois de alterar variáveis. Nunca coloque chaves em assets, HTML, commits, capturas ou mensagens. O checkout permanece indisponível se faltar configuração.

## Integração Poseidon

Documentação: https://app.poseidonpay.site/docs/v1/llms-full.txt

1. POST /api/checkout valida produto, quantidade, CPF/CNPJ e campos. O identificador de tentativa permanece na sessão do navegador para evitar duplicidade em reenvios.
2. O servidor reserva o pedido privado e chama POST https://app.poseidonpay.site/api/v1/gateway/pix/receive, com valores em reais, credenciais no servidor e callbackUrl fixo https://black-netfiscal.vercel.app/api/pix-webhook.
3. O QR Code é gerado localmente a partir de pix.code, sem serviços externos de QR.
4. POST /api/pix-webhook compara o token da cobrança, ID, identificador, moeda, método, valor e status. Apenas TRANSACTION_PAID com COMPLETED confirma o pagamento. Notificações repetidas são idempotentes e não desfazem estornos.
5. O navegador consulta **nosso armazenamento**, por /api/order-status, com token de pedido assinado. Não faz polling da Poseidon. O redirecionamento para /obrigado?origem=checkout acontece após a confirmação por webhook.

Informações do aluno, pagador e participantes ficam no Blob privado. Não são retornadas na consulta de status nem escritas em logs. O pagador é enviado como client; aluno, endereço e participantes são enviados nos metadados. A equipe pode consultar a transação e os metadados no painel Poseidon para atender o comprador.

Falhas ambíguas do gateway ficam em REVIEW; outra cobrança não é criada automaticamente. Consulte a transação no painel pelo identificador nf-... antes de orientar nova tentativa. O limite é de seis novas tentativas por IP a cada hora. Escritas do pedido usam ETags para evitar sobrescrever atualizações simultâneas.

O Blob mantém os registros até remoção pelo responsável. Defina a retenção da operação; preserve os registros necessários e remova apenas dados operacionais antigos após revisão. Não há exclusão automática.

## Desenvolvimento e testes

Execute pnpm install, pnpm test, pnpm build e pnpm dev.

Para testar sem cobranças reais, execute node scripts/dev.mjs --mock. Esse modo existe somente no servidor local, usa dados em memória e gera um QR de teste sem valor de pagamento. O endpoint local /__test__/paid simula um webhook para testes do navegador. Nenhum endpoint de simulação é publicado.

Os testes cobrem os três preços, participantes, documentos inválidos, reenvios simultâneos, token/valor adulterado, ordem das notificações, estorno, timeout, falta de configuração e limite de tentativas. Antes de enviar tráfego comercial, o responsável deve concluir uma compra controlada, conferindo o recebedor no banco e a confirmação na Poseidon.

## Arquivos

- index.html, assets/styles.css, assets/site.js: ofertas e modal.
- assets/checkout-config.js: destinos dos botões da oferta.
- checkout.html, assets/checkout.js, assets/checkout.css: os três checkouts.
- api/ e lib/: integração Pix e armazenamento privado.
- obrigado.html, assets/obrigado.*, assets/suporte-config.js: pós-compra e suporte.
- assets/guia-boas-vindas-netfiscal.pdf: guia de cinco páginas.

Banners fornecidos são usados localmente, com sobreposição em HTML para atualizar a condição de 200 para 20 primeiros. Não são exibidas marcas de processadores que não participam deste checkout. O guia é material explicativo e a página de obrigado não concede acesso automaticamente.
