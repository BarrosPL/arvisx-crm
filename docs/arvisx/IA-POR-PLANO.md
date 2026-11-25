# IA por plano

Como a IA incluída no plano é medida, limitada e avisada. Tarefa 8, parte 1
(migration 9825), com as decisões do Lucas de 25/11/2026.

## O que o plano inclui

A IA vem incluída no plano e é paga pela **chave da plataforma**
(`ANTHROPIC_API_KEY`; ver `EQUIPE-PRONTA.md`). O plano tem dois limites:

- a **franquia**, em conversas com IA por ciclo
  (`cobranca_planos.franquia_conversas_ia`). É o que o cliente vê;
- o **teto**, em centavos de dólar por ciclo
  (`cobranca_planos.teto_ia_usd_cents`). É a trava de baixo.

Estourar um dos dois, o que vier primeiro, para a IA. Quem usa a própria chave
de IA não gasta nenhum dos dois.

"Conversa com IA" é um contato distinto atendido por um agente no ciclo: uma
chamada que deu certo, com contato, num dos pontos em que o agente fala com a
pessoa (`agent_turn`, `followup_turn`, `bot_respond`, `automation_ai_message`),
paga pela chave da plataforma. O mesmo contato conta uma vez no ciclo.

A franquia mora em `cobranca_planos` porque é atributo do plano, lido junto com
os outros limites dele (`max_assentos`, `max_canais`, `teto_ia_usd_cents`).

## De quem é a chave: `llm_calls.origem_da_chave`

Coluna `text not null`, com `CHECK`. Valores exatos:

| Valor | Significa | Conta no orçamento da empresa | Conta no teto e na franquia do plano |
|---|---|---|---|
| `cliente` | credencial da organização (inclusive o login por assinatura que a própria empresa conecta) | sim | não |
| `plataforma` | a chave da instalação, que o plano paga | sim | sim |
| `assinatura_plataforma` | chamada feita com a assinatura da plataforma; hoje só o assistente dela usa | não | não |

O par TypeScript é `ORIGENS_DA_CHAVE`, em `lib/ai/usage/origem-da-chave.ts`.
Nada neste repositório grava `assinatura_plataforma` ainda: a coluna e as somas
ficaram prontas para quem for gravar.

**O padrão é `plataforma`.** Vale para a linha antiga e para o escritor que não
informa a origem. Com esse padrão, a chamada de origem desconhecida conta no
teto do plano: erra para o lado que protege quem paga a chave, e o erro aparece
(o uso sobe). Com `cliente`, ela sumiria da conta em silêncio. O custo é
limitado: o teto do plano só bloqueia quem chama com a chave da plataforma,
então a empresa que usa a própria chave nunca é parada por linha antiga.

### As duas somas

- **Orçamento da empresa** (`ai_budgets`, `fn_gasto_de_ia_do_mes`, o gatilho
  `fn_update_budget_consumption`): a regra de sempre. Soma `cliente` e
  `plataforma`, no mês-calendário. Ignora `assinatura_plataforma`.
- **Plano** (`fn_ia_do_plano`): soma só `plataforma`, no ciclo.

**Isto inverte uma decisão antiga.** Até a 9825, o teto do plano comparava o
gasto do mês de todas as chaves e só bloqueava a chave da instalação (decisão
D-9 da cobrança do revendedor). Agora ele soma só o que a chave da plataforma
pagou. O que não mudou: o bloqueio continua valendo só para quem chama com a
chave da instalação, e `AI_BUDGET_ENFORCEMENT=off` continua desligando tudo.

### Quem grava em `llm_calls`

| Escritor | Chave que usa | O que grava |
|---|---|---|
| O motor, sucesso e falha (`lib/agent-engine/edge/llm/run-model-call.ts`) | a que o resolvedor carregou | `cliente` ou `plataforma` |
| A recusa do motor por teto ou por endereço (`run-model-call.ts`) | a que estava carregada | `cliente` ou `plataforma` |
| Worker legado, três linhas de `bot_respond` (`workers/ai-response-worker.ts`, por `logInvocation`) | a do ponto resolvido | `cliente` ou `plataforma`, e o contato |
| Visão de imagem (`workers/media-derive-worker.ts`) | a que o resolvedor carregou | `cliente` ou `plataforma` |
| Transcrição de áudio (`workers/media-derive-worker.ts`) | não rastreada nesta entrega | padrão, `plataforma` |
| Sentimento, quatro linhas (`workers/ai-sentiment-worker.ts`, por `logInvocation`) | não rastreada | padrão, `plataforma` |
| Sessão de voz (`workers/voice-agent/index.ts`, por `registrarChamadaDeIa`) | não rastreada | padrão, `plataforma` |
| Síntese de voz (`lib/agent-engine/edge/crm/send-voice.ts`) | não rastreada | padrão, `plataforma` |
| Conferência de fato, duas linhas (`lib/ai/decisao/afirmacao-de-fato.ts`) | não rastreada | padrão, `plataforma` |
| Conferência de campo, duas linhas (`lib/ai/decisao/campo-do-negocio.ts`) | não rastreada | padrão, `plataforma` |
| Pedidos do cliente, duas linhas (`lib/ai/decisao/pedidos.ts`) | não rastreada | padrão, `plataforma` |

"Não rastreada" quer dizer que não segui de onde vem a chave daquele caminho.
Essas linhas caem no padrão e contam no gasto do plano. Nenhuma delas conta
como conversa, porque nenhuma usa um ponto de conversa. `logInvocation` e
`registrarChamadaDeIa` já aceitam `origem_da_chave`: classificar um caminho é
passar o valor.

## O ciclo

`fn_ciclo_de_ia` devolve o período em que o uso é somado:

- **o período pago da assinatura** (`periodo_pago_desde` até
  `proximo_vencimento`), quando os dois existem, o plano é mensal e agora está
  dentro dele;
- **o mês-calendário**, nos demais casos: teste grátis, plano anual, período
  já vencido, dado faltando e empresa sem assinatura.

A diferença, na prática: numa assinatura mensal paga, a franquia zera no dia da
cobrança; no teste grátis e no plano anual, zera no dia 1º. Uma empresa que sai
do teste grátis para o período pago no meio do mês começa um ciclo novo nesse
dia, e o que usou antes não entra na conta. O período só é tão recente quanto a
última releitura do provedor de cobrança.

O orçamento da empresa não muda: continua no mês-calendário.

## O bloqueio

Quem decide é `decidirTetoDoPlano` (`lib/agent-engine/edge/llm/orcamento.ts`),
com o que `fn_ia_do_plano` leu. Só alcança quem chama com a chave da plataforma.

| Situação | O que acontece |
|---|---|
| Cobrança desligada na instalação | segue, sem limite de plano |
| Empresa sem assinatura (isenta) | segue, sem limite de plano |
| Leitura do plano que falha | segue, com aviso no log |
| Assinatura em plano **sem teto** | **bloqueia** (falha fechada) |
| Gasto da plataforma no teto | bloqueia |
| Franquia cheia e contato novo | bloqueia |
| Franquia cheia e contato que já estava nela | segue |

Antes, o plano sem teto seguia sem limite com a chave da plataforma.

No bloqueio, o agente não chama o modelo, a conversa vai para a equipe com
`last_handoff_reason = 'ia_do_plano'` (o orçamento da empresa grava
`orcamento_de_ia`), e a Central recebe um aviso crítico com as duas saídas:
falar com a ArvisX para um pacote extra, ou cadastrar uma chave própria em
IA › Credenciais. O aviso se fecha sozinho quando o bloqueio perde a razão. Não
há cobrança nem checkout de pacote: o pacote é combinado por fora.

A conversa que já foi para a equipe não volta sozinha: cada uma volta ao
automático pelo botão "Devolver ao automático".

O mesmo vale no app e no worker, porque os dois chamam o modelo pelo mesmo
ponto (`runModelCall`). Os caminhos que chamam o provedor por fora dele usam o
mesmo portão (`aplicarOrcamento`): visão de imagem e voz. O worker legado tem a
decisão espelhada, com a mesma função do banco.

## O aviso de 80%

A rodada horária da cobrança (`lib/cobranca/rodada.ts`) abre um aviso na
Central quando a franquia ou o teto, o que estiver mais perto do fim, passa de
80%. Um por empresa por ciclo: fechar o aviso à mão ou o uso oscilar não abre
outro (`fn_cobranca_avisar_uso_de_ia`). De 100% em diante quem fala é o
bloqueio.

Limite conhecido: a rodada é horária. Uma empresa que vai de 80% a 100% em
menos de uma hora pode ser bloqueada sem ter recebido o aviso.

## Na tela

O mesmo bloco, `components/cobranca/IaDoPlano.tsx`, aparece em Uso de IA e em
Plano e cobrança: conversas usadas e total, percentual do uso incluído, quando o
ciclo renova, e o aviso (perto do fim, esgotada, ou plano sem teto).

## Limites conhecidos

- A faixa de 5 vezes do Claude Haiku 5.5 para prompt acima de 100 mil tokens
  não entra no custo calculado (ver `EQUIPE-PRONTA.md`). Decisão do Lucas:
  documentar, não mexer.
- A tela de planos do administrador não tem campo para o teto nem para a
  franquia. Os dois entram por SQL (`docs/arvisx/ci/PLANOS-NOVOS-2026-11.sql`).
- Os agentes já instalados em outro modelo continuam nele.
