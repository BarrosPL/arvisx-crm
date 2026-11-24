# Integração das cinco pilhas (PRs #12 a #24), branch `integracao/2026-11-23`

Branch criado a partir de `correcoes/ci-main-verde` (PR #26, a main com o CI consertado) e não mergeado em lugar nenhum. Quem integra na main e sobe é o Lucas.

## Ordem em que as pilhas entraram, e por quê

| Passo | Pilha | Ponta mergeada | PRs que entram | Por que nesta posição |
|---|---|---|---|---|
| 0 | base | `correcoes/ci-main-verde` | #26 | Deixa a main verde. Tudo herda a correção em vez de copiar. |
| 1 | D | `ajustes/aj-1b-unificar-fechar-conversa` | #13, #14, #17 | O #13 é a base de quatro das cinco pilhas. Entra primeiro, junto com a regra 2.31. |
| 2 | A | `superficie-agente/pr-3-convivencia-e-filtro` | #15, #20 | O #15 é a base das pilhas B e C. |
| 3 | C | `ajustes/aj-4-autoria-do-token` | #19, #21, #23 | Só depende do #15. |
| 4 | B | `equipe-pronta-v2/pr-b-gatilhos` | #22, #24 | Só depende do #15. Fica depois de A e C porque é a que mais mexe em catálogo e traduções. |
| 5 | E | `instagram-comentarios/pr-c-tela` | #12, #16, #18 | Não depende de nenhuma outra. Entra por último (o #13 antes do #12, como combinado em 23/11). |

## Ordem de merge na main que isto recomenda

`#26` → `#13` → `#14` → `#17` → `#15` → `#20` → `#19` → `#21` → `#23` → `#22` → `#24` → `#12` → `#16` → `#18`.

Depois de cada merge, o PR seguinte da mesma pilha troca a base para `main`. Todo PR ainda aberto precisa receber a `main` (merge da main para dentro, nunca rebase) antes de entrar, e é nesse merge que os conflitos abaixo aparecem. O caminho mais curto é o Lucas mergear este branch inteiro de uma vez: ele já contém as 13 pontas com os conflitos resolvidos.

## Conflitos resolvidos e como

Todos eram dos dois lados acrescentando no mesmo ponto. Ficaram os dois lados, na ordem em que entraram.

| Arquivo | Passos | Resolução |
|---|---|---|
| `lib/i18n/dicionario.ts` | 2 | Os dois blocos de chaves ficaram. Nenhuma chave perdida (a cerca `i18n-espanhol-cobre-a-tela` passou). |
| `lib/i18n/traducoes/en.json` | 4 | Os dois conjuntos de chaves ficaram; o arquivo continua JSON válido. |
| `tests/unit/peso-das-ferramentas.test.ts` | 2, 3, 4, 5 | Linha de cada ferramenta: fica a de cada lado. `TETO_TOTAL` = nosso + deles - base em cada passo: 33515, 34375, 35210 e por fim **37000**. A soma medida cabe no teto; ninguém ampliou teto além do que cada PR já declarava. |
| `supabase/baseline.sql` | 3, 4, 5 | Procedimento do projeto (CLAUDE.md, "Migrations & Banco", item 6): o baseline é dump mais apêndice idempotente, e cada migration acrescenta o seu bloco no fim. Os blocos das pilhas ficaram um depois do outro, sem editar nenhum. Não houve dump novo. |
| `deploy/arvisx/crm/migracoes-pos-baseline.txt` | 3, 4, 5 | As linhas ficaram todas; depois a lista foi posta em ordem de número. |
| `lib/mcp/tools/index.ts` | 3 | Os dois registros de ferramenta ficaram. |
| `docs/arvisx/SUPERFICIE-DE-AGENTE.md` | 3, 4 | À mão: a frase de abertura passou a citar a parte 3 e os ajustes; no passo 4 ficou a frase nova da Equipe pronta v2, a seção da parte 3 e as seções novas da v2. |
| `tests/unit/capacidade-alcancavel-pelo-agente.test.ts` | 4 | Os dois lados ficaram. |
| `app/app/webhooks/_components/RuleEditor.tsx`, `labels.ts`, `lib/schemas/webhooks.ts` | 5 | Os gatilhos de cada pilha ficaram. |
| `tests/invariants/rls-completude-varredura.test.ts` | 5 | As tabelas novas de cada pilha ficaram na lista. |

## Migrations 9809 a 9820

- Lista de deploy em ordem de número. Dependências respeitadas: 9809 < 9817; 9810 < 9812 < 9816; 9810 < 9819; 9814 < 9815.
- A 9810 (#12) e a 9811 (#20) tinham o mesmo timestamp `20261120150000`. A 9811 passou a `20261120150100` neste branch. **O #20 precisa da mesma troca de nome** se for mergeado separado.
- Sem colisão de número. Próximo livre: 9821.

## O que cada PR precisa depois, se for mergeado um a um

- #20: renomear a 9811 (acima) e atualizar as duas referências em `tests/unit/convivencia-humano-e-ia.test.ts` e `tests/unit/setor-da-conversa-pela-ia.test.ts`.
- Todo PR que toca `peso-das-ferramentas`: recalcular `TETO_TOTAL` ao receber a main (o teste imprime a tabela sugerida).
- Todo PR com migration: ao receber a main, o bloco do baseline e a linha da lista entram depois dos que já estiverem lá.
