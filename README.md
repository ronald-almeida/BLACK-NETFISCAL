# Black NetFiscal 2026

Landing page estática baseada no HTML e nas imagens fornecidos, com os recursos visuais originais hospedados neste repositório.

## Fluxo de compra

Os botões de oferta abrem um modal com três produtos: MBA, Pós e Imersão. O visitante seleciona o produto e clica em **Ir para o pagamento**. Os botões de cada curso já abrem o modal com o curso marcado.

O modal não solicita nome, e-mail ou WhatsApp e não envia dados para webhooks ou automações. Os links de checkout foram atualizados conforme os destinos fornecidos pelo responsável pela página: MBA (`product=154220`), Pós (`product=154221`) e Imersão (`product=154222`). As informações necessárias à compra são tratadas pelo checkout de destino.

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

## Página de obrigado e guia de boas-vindas

A página está em `obrigado.html` e é publicada em `https://black-netfiscal.vercel.app/obrigado`. Use esse endereço na configuração de redirecionamento após a compra na plataforma de checkout. A página é estática e não consulta ou confirma o status de uma transação.

O botão de download entrega `assets/guia-boas-vindas-netfiscal.pdf`, um guia de cinco páginas com orientações de acesso e os resumos das três formações. O botão de suporte do PDF abre diretamente o WhatsApp da equipe: **+55 75 8839-3783** (`https://wa.me/557588393783`).

### Contato de suporte

O contato **+55 75 8839-3783** está configurado na página principal, nos três botões da página de obrigado e no PDF. Para atualizar o contato, altere `window.NETFISCAL_SUPPORT_URL` em `assets/suporte-config.js`, o link de atendimento em `index.html` e o guia em PDF. Uma URL HTTPS válida ativa os botões da página de obrigado e oculta o aviso temporário automaticamente.

## Visualização local

Sirva a raiz do repositório com um servidor HTTP estático, por exemplo `python -m http.server 3000`, e acesse `http://localhost:3000`.

## Condições atuais da oferta

MBA: R$ 397,00. Pós: R$ 497,00. Imersão: R$ 697,00. Pagamento somente à vista via Pix. Os bônus das especializações são destinados aos 20 primeiros matriculados. Os preços exibidos na página não alteram os valores configurados nas plataformas de checkout.

## Conteúdo preservado

Datas, depoimentos, identidade visual e links institucionais permanecem conforme o material fornecido. Os scripts de coleta do formulário e os scripts específicos do Cloudflare da hospedagem anterior foram removidos.
