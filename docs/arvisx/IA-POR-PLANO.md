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
| `assinatura_plataforma` | o assistente da plataforma rodando na assinatura dela (tokens reais, `cost_cents = 0`) | não | não |
| `assistente_chave_plataforma` | o assistente da plataforma rodando pela chave dela, quando a assinatura não pode ser usada | não | não |

O par TypeScript é `ORIGENS_DA_CHAVE`, em `lib/ai/usage/origem-da-chave.ts`.
Os dois últimos são do assistente da plataforma. Nada neste repositório os grava
ainda: a coluna e as somas ficaram prontas para quem for gravar.
`assistente_chave_plataforma` usa a mesma chave que `plataforma` e mesmo assim
não conta no teto do plano: quem decide é o valor da coluna, não a chave.

**O padrão é `plataforma`.** Vale para a linha antiga e para o escritor que não
informa a origem. Com esse padrão, a chamada de origem desconhecida conta no
teto do plano: erra para o lado que protege quem paga a chave, e o erro aparece
(o uso sobe). Com `cliente`, ela sumiria da conta em silêncio. O custo é
limitado: o teto do plano só bloqueia quem chama com a chave da plataforma,
então a empresa que usa a própria chave nunca é parada por linha antiga.

### As duas somas

- **Orçamento da empresa** (`ai_budgets`, `fn_gasto_de_ia_do_mes`, o gatilho
  `fn_update_budget_consumption`): a regra de sempre. Soma `cliente` e
  `plataforma`, no mês-calendário. Ignora os dois valores do assistente.
- **Plano** (`fn_ia_do_plano`): soma só `plataforma`, no ciclo.

**Isto inverte uma decisão antiga.** Até a 9825, o teto do plano comparava o
gasto do mês de todas as chaves e só bloqueava a chave da instalação (decisão
D-9 da cobrança do revendedor). Agora ele soma só o que a chave da plataforma
pagou. O que não mudou: o bloqueio continua valendo só para quem chama com a
chave da instalação, e `AI_BUDGET_ENFORCEMENT=off` continua desligando tudo.

### Todo lugar que soma `llm_calls` para teto, pausa ou orçamento

Varredura de 25/11/2026: `grep -n "sum(" supabase/baseline.sql` nas linhas que leem `llm_calls`, e `grep -rn 'from("llm_calls")' app lib workers`.

| Onde | Para que serve | Filtro de origem |
|---|---|---|
| `fn_gasto_de_ia_do_mes` | A régua do orçamento da EMPRESA: é ela que o motor lê para pausar (`SQL_ORCAMENTO`, `lib/ai/budget/check.ts`, `pode-gastar.ts`) | Ignora `assinatura_plataforma` e `assistente_chave_plataforma`. Soma `cliente` e `plataforma` |
| `fn_update_budget_consumption` (gatilho de `llm_calls`) | Incrementa o contador `ai_budgets.current_month_consumed_cents` | Ignora os dois valores do assistente. Soma `cliente` e `plataforma` |
| Recomputo de `ai_budgets` no baseline (blocos das migrations 0035 e 0140) | Atribui o contador a partir de `llm_calls`, a cada reaplicação do baseline | **Não tinham filtro.** Corrigido: a 9825 dá a última palavra com um recomputo que ignora os dois valores do assistente (bloco C2). Os dois antigos ficaram como eram, porque a coluna nasce depois deles no arquivo |
| `fn_ia_do_plano`, gasto | Teto em dólar do PLANO (motor, worker legado, rodada do aviso de 80%, telas) | Só `plataforma` |
| `fn_ia_do_plano`, conversas | Franquia do PLANO | Só `plataforma` |
| `fn_contato_na_franquia` | Diz se o contato já está na franquia do ciclo | Só `plataforma` |
| `fn_cobranca_avisar_uso_de_ia` | Aviso de 80% | Não soma: recebe o que a rodada leu de `fn_ia_do_plano` |
| `fn_uso_de_ia` (tela Uso de IA) | Relatório de uso por dia e por ponto. Não pausa nem limita nada | **Sem filtro, e não mexi.** Enquanto nada gravar os valores do assistente, não muda nada. Quando o assistente passar a gravar em `llm_calls`, as chamadas dele apareceriam no relatório da empresa: tratar antes de ligar essa gravação |
| `lib/ai/budget/check.ts:186` | Conta linhas `ok` sem preço, para o aviso de "medição incompleta" | Não é soma de gasto. O assistente grava `cost_cents = 0`, não nulo, então não acende o aviso |

O que impede gasto de agente de ser contado como do assistente (o erro que falha em silêncio): os caminhos de agente tiram a origem de `origemDaChaveGravada`, cujo tipo só devolve `cliente` ou `plataforma`, e a cerca `tests/unit/llm-calls-todo-escritor-diz-a-origem-da-chave.test.ts` reprova qualquer arquivo do produto, fora de `lib/ai/usage/origem-da-chave.ts` e de `lib/assistente/`, que escreva um dos dois valores do assistente.

### Quem grava em `llm_calls`

Todo escritor informa a origem. Quem vigia é
`tests/unit/llm-calls-todo-escritor-diz-a-origem-da-chave.test.ts`, que acha
todo ponto do produto que grava na tabela e reprova o que não informar.

| Escritor | De onde vem a chave | O que grava |
|---|---|---|
| O motor: sucesso, falha e recusa (`lib/agent-engine/edge/llm/run-model-call.ts`) | `resolveOrgLlmConfig`: credencial da organização, senão o `.env` | `cliente` ou `plataforma` |
| Worker legado, três linhas de `bot_respond` (`workers/ai-response-worker.ts`) | `resolverModeloDoPonto`: origem `padrao` é o `.env` | `cliente` ou `plataforma`, e o contato |
| Sentimento, a IA de sempre, duas linhas (`workers/ai-sentiment-worker.ts`) | o mesmo `resolverModeloDoPonto` | `cliente` ou `plataforma` |
| Sentimento, o Jev, duas linhas (`workers/ai-sentiment-worker.ts`) | credencial da organização | `cliente` |
| O Jev: pedidos, conferência de fato e de campo, roteador, manipulação, urgência, follow-up e a linha de falha (`lib/ai/decisao/`, doze gravações) | sempre a credencial da organização, nunca o `.env` (`destinoDasTarefas`, em `lib/ai/decisao/ponto.ts`) | `cliente` |
| Visão de imagem (`workers/media-derive-worker.ts`) | `resolveOrgLlmConfig` | `cliente` ou `plataforma` |
| Transcrição pelo serviço da instalação (`TRANSCRIPTION_API_KEY`) | o `.env` | `plataforma` |
| Transcrição pela OpenAI, pela OpenRouter ou pelo modelo de conversa | `resolveOrgLlmConfig` do provedor do degrau | `cliente` ou `plataforma` |
| Transcrição pela ElevenLabs escolhida no painel | credencial da organização | `cliente` |
| Sessão de voz (`workers/voice-agent/index.ts`) | `lib/ai/agents.ts`: credencial OpenAI da organização, senão `OPENAI_API_KEY` | `cliente` ou `plataforma` |
| Síntese de voz (`lib/agent-engine/edge/crm/send-voice.ts`) | credencial da organização: a ElevenLabs não tem chave de instalação | `cliente` |

Um caso continua caindo no padrão da coluna (`plataforma`): a linha da
transcrição quando o degrau escolhido não anotou a origem. Só acontece se a
escada devolver um degrau que o resolvedor não chegou a resolver, o que o código
de hoje não faz; o padrão está lá para o degrau que alguém acrescentar sem
anotar. `logInvocation` e `registrarChamadaDeIa` aceitam `origem_da_chave`.

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
