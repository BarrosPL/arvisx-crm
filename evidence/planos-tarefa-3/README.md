# Prova pela tela — tarefa 3 dos planos (10/11/2026)

Ambiente: worktree `arvisx-crm-main`, `next dev -p 3100`, Supabase local de
desenvolvimento `arvisx-treinamento` com o cenário da tarefa 2
(`evidence/planos-tarefa-2/cenario-local.sql`) mais `cenario-local.sql` desta pasta,
que só troca os textos do Standard e do Premium pelos de `docs/arvisx/PLANOS.md`.
Roteiro Playwright; a landing sem login, o comparativo logado como
`dono@treinamento.local` (empresa fictícia "Clínica Bem Viver", assinatura Premium
gravada no banco local; nenhuma chamada à Stripe). Medidas por ferramenta em
`medidas.json`. Sem dados pessoais.

| Captura | O que mostra |
|---|---|
| `01-landing-planos-desktop.png` | Landing, seção de planos (1440 px): os quatro planos do cadastro e, abaixo da grade, o aviso "Quem cuida dos agentes de IA" em três colunas, a linha do consumo e o link "Como funciona o Equipe Completa". |
| `02-landing-planos-celular-390.png` | A mesma seção em 390 px: cards e aviso empilhados (351 px), rolagem horizontal 0. |
| `03-comparativo-plano-e-cobranca.png` | Plano e cobrança › Trocar de plano: o mesmo aviso acima dos quatro cards; o "Como funciona" segue em destaque no card do Equipe Completa. |
| `04-landing-secao-equipe-completa-desktop.png` | A seção `#agentes`, agora do Equipe Completa: os três passos e o botão de cadastro no lugar de "Agendar reunião". |

Nas capturas da landing o cabeçalho fixo, o aviso de cookies e o indicador do
`next dev` foram escondidos por CSS só no roteiro, para não cobrirem a seção.

Medidas que importam (`medidas.json`):
- o texto do aviso é idêntico nas três telas (`mesmoTextoNosTres: true`);
- na landing o aviso vem depois da grade; no comparativo, antes dos cards;
- links para `/agendar` na landing: 0; frases "contratado à parte", "orçados em reunião", "combinadas na reunião" e "Agentes Arvisx": 0;
- o botão da seção do Equipe Completa leva a `/signup`;
- rolagem horizontal em todas as capturas: 0.

Não provado pela tela: o comparativo no fim do teste (conta suspensa) e no Assinar
(teste grátis) — a empresa local está com assinatura ativa; os três usos estão
cobertos em `tests/unit/planos-comparativo.test.tsx`. A troca Equipe Completa →
outro plano (frase da perda do serviço sob medida) também só no teste unitário.
