# Black NetFiscal 2026

Landing page estática baseada no HTML e nas imagens fornecidos, com os recursos visuais originais hospedados neste repositório.

## Fluxo de compra

Os botões de oferta abrem um modal com três produtos: MBA, Pós e Imersão. O visitante seleciona o produto e clica em **Ir para o pagamento**. Os botões de cada curso já abrem o modal com o curso marcado.

O modal não solicita nome, e-mail ou WhatsApp e não envia dados para webhooks ou automações. Os links de checkout foram preservados do HTML original. As informações necessárias à compra são tratadas pelo checkout de destino.

## Alterar os links

Edite `assets/checkout-config.js`: `mba`, `pos` e `imersao` correspondem às três opções. Use URLs completas HTTPS. Os parâmetros das ofertas são preservados no redirecionamento.

## Estrutura

- `index.html`: conteúdo da página e modal.
- `assets/styles.css`: estilos e regras responsivas.
- `assets/site.js`: interação do modal e efeitos da página.
- `assets/checkout-config.js`: destinos de pagamento.
- `assets/`: imagens, ícones e fonte locais.
- `vercel.json`: configuração de hospedagem estática.

## Vercel

Importe este repositório com preset **Other**, diretório raiz `./`, sem comandos de instalação ou build. A pasta de saída é `.`. A configuração está em `vercel.json`; não há dependências, banco de dados ou variáveis de ambiente.

## Visualização local

Sirva a raiz do repositório com um servidor HTTP estático, por exemplo `python -m http.server 3000`, e acesse `http://localhost:3000`.

## Condições atuais da oferta

MBA: R$ 397,00. Pós: R$ 497,00. Imersão: R$ 697,00. Pagamento somente à vista via Pix. Os bônus das especializações são destinados aos 20 primeiros matriculados. Os preços exibidos na página não alteram os valores configurados nas plataformas de checkout.

## Conteúdo preservado

Datas, depoimentos, identidade visual e links institucionais permanecem conforme o material fornecido. Os scripts de coleta do formulário e os scripts específicos do Cloudflare da hospedagem anterior foram removidos.
