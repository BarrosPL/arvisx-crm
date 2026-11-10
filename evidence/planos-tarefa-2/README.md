# Prova pela tela — tarefa 2 dos planos (10/11/2026)

Ambiente: worktree `arvisx-crm-main`, `next dev -p 3100`, Supabase local de
desenvolvimento `arvisx-treinamento` com o cenário de `cenario-local.sql` (cobrança
ligada, os quatro planos com os textos de `docs/arvisx/PLANOS.md`, a distribuição
12 / 31 / 63 e o Equipe Completa). Roteiro Playwright logado como
`dono@treinamento.local`; medidas por ferramenta em `medidas.json`. O "pago" é a
assinatura gravada como a releitura da Stripe em modo teste grava (`estado = ativa`,
`provedor = stripe`, assinatura viva): não houve chamada à Stripe.

| Captura | O que mostra |
|---|---|
| `01-teste-comparativo-dos-quatro-planos.png` | No teste grátis: os quatro cards com os textos do plano, "Mais completo" no Premium, selo e "Como funciona" só no Equipe Completa; nenhum botão de assinar antes de escolher. |
| `02-teste-escolhe-standard-o-que-sai-antes-do-assinar.png` | Escolhido o Standard: diferença de preço, limites e o que sai em relação ao teste, antes do "Assinar Standard". |
| `03-celular-390-comparativo.png` | 390 px: cards empilhados (310 px), sem rolagem horizontal. |
| `04-essencial-para-premium-o-que-entra.png` | Troca Essencial → Premium: "+140,00 € por mês", limites que caem e o que entra por bloco. |
| `05-premium-para-standard-o-que-sai-antes-de-confirmar.png` | Troca Premium → Standard: "−70,00 € por mês" e o que sai, acima do "Confirmar troca". |
| `06-equipe-completa-pago-mensagem-ao-cliente.png` | Equipe Completa pago: "Recebemos sua assinatura. Nossa equipe entrará em contato…". |
| `07-admin-equipe-completa-aguardando-contato.png` | /admin/cobranca: a empresa na lista "Equipe Completa aguardando contato" (SMTP desligado: "e-mail não enviado: o aviso está só aqui"). |
| `08-admin-planos-textos-do-equipe-completa.png` | O formulário do plano com a seção "Textos do plano" e o marcador dos agentes. |
| `09-depois-do-contato-cliente-ve-que-o-plano-inclui-os-agentes.png` | Contato marcado: sai da lista; o cliente vê que o plano inclui os agentes. |
| `10-downgrade-equipe-avisada-da-saida.png` | Downgrade para o Premium: selo some do cliente e a saída aparece para a equipe. |

Também aqui: `prova-9804.sql` / `prova-9804.txt` (o gatilho da 9804 numa transação
desfeita) e `cenario-local.sql`.

Medidas que importam:
- telas que saem de Premium para Standard nesta instalação: 27 (as 32 menos as 5 de módulos/capacidades desligados aqui: Propostas (Organização), Comandas, Cold Call, Honorários e Dados externos — o comparativo mostra só o que a instalação tem); perda acima do botão: True
- linhas do gatilho ao pagar: `entrada:Equipe Completa`; depois do downgrade: `entrada,saida`; selo depois do downgrade: 0; contato gravado: true
- rolagem horizontal em todas as capturas: 0
