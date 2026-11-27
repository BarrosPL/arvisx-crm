# Mapa da IA por plano (Tarefa 8, parte 0)

Data: 25/11/2026. Base: `main` em `402794cc5` (conferido com `git fetch origin main` e `git rev-parse origin/main HEAD`, as duas saídas iguais a `402794cc5690bc9e7eb154727765616ba6654c6b`).

Este arquivo é só o mapa. Nenhum código de produto mudou. Tudo abaixo vem de **leitura** do código, salvo onde está escrito "executado". Não rodei teste, não consultei banco de produção e não abri `.env`.

Convenção: `arquivo:linha` é relativo à raiz do repositório. Para o `supabase/baseline.sql`, a linha citada é a da **última** definição da função (achada por script que ancora na última ocorrência, como o `CLAUDE.md` manda), não a primeira.

## Resumo dos seis pontos

| # | Ponto | Leitura do texto da tarefa | Veredito |
|---|---|---|---|
| 1 | Escada de chave | chave do cliente, chave da instalação, nenhuma | CONFIRMADO, com duas precisões |
| 2 | Onde o teto do plano é lido e aplicado | `rodada.ts` e o motor | CONFIRMADO em parte: a `rodada.ts` só avisa; quem aplica é o motor e o worker legado |
| 3 | Teto vazio com chave da plataforma | segue sem limite | CONFIRMADO, e há mais três casos que seguem sem limite |
| 4 | Aviso antes do bloqueio | só no orçamento da empresa | ERRADO: o teto do plano já tem aviso a 80% |
| 5 | `llm_calls` distingue a origem da chave | não distingue | CONFIRMADO |
| 6 | Janela do gasto e ciclo da assinatura | mês-calendário | CONFIRMADO; o ciclo da assinatura existe, com lacunas |

## 1. Escada de chave de IA hoje

CONFIRMADO. `resolveOrgLlmConfig` em `lib/agent-engine/edge/llm/credentials.ts:305`:

1. **Chave do cliente.** Com `credentialId` na versão publicada, busca aquela credencial, exigindo ativa e validada (`credentials.ts:401-422`). Sem `credentialId`, busca a credencial ativa e validada mais recente do provedor, na organização (`credentials.ts:423-440`). Achou: `origemDaChave = 'credencial_da_organizacao'` (`credentials.ts:447-453`).
2. **Chave da instalação.** Sem credencial, cai na variável de ambiente do provedor: Anthropic (`credentials.ts:454-456`), OpenAI (`:457-459`), OpenRouter (`:460-462`). `origemDaChave = 'chave_da_instalacao'`.
3. **Nenhuma.** `LlmNotConfiguredError` (`credentials.ts:463-465`).

Duas precisões:

- `credential_id: null` na versão **não** quer dizer "chave da instalação" no resolvedor. Quer dizer "sem credencial escolhida": o resolvedor ainda tenta a credencial mais recente da organização para o provedor antes de cair no ambiente (`credentials.ts:423-440`). Já a rota de versões trata `null` como "usa a chave da instalação" e recusa com `credential_required` quando o ambiente não tem a chave do provedor (`app/api/v1/ai/agents/[id]/versions/route.ts:131-141`), sem olhar se a organização tem credencial própria daquele provedor.
- Há um degrau anterior para o provedor por assinatura (login do ChatGPT): lê o par de tokens e, sem ele, recomeça a escada pelo provedor de reserva (`credentials.ts:364-396`). Sai como `credencial_da_organizacao`.

O tipo que carrega a resposta já existe: `OrigemDaChaveLlm = 'credencial_da_organizacao' | 'chave_da_instalacao'` (`credentials.ts:170`), e chega ao gate em `run-model-call.ts:946`.

## 2. Onde o teto do plano é lido e aplicado

CONFIRMADO em parte. A coluna é `cobranca_planos.teto_ia_usd_cents integer check (>= 100)`, nula = sem teto (`supabase/migrations/20261007130926_0583_cobranca_planos_e_assinaturas.sql:41`).

**Quem lê.** A função `fn_limite_do_plano(p_org, 'ia_usd_cents')` (`supabase/baseline.sql:48000-48029`). Ela devolve `null` em três situações diferentes: cobrança desligada na instalação, organização sem linha em `cobranca_assinaturas` (isenta), e plano com a coluna nula.

**Quem aplica (bloqueia).**

- Motor: `aplicarOrcamento` em `lib/agent-engine/edge/llm/run-model-call.ts:456`. A ordem está em `:460-501`: chave de emergência, depois teto do plano, depois orçamento da empresa. O teto do plano só é consultado quando `origemDaChave === 'chave_da_instalacao'` e a cobrança está ligada (`:475`). A leitura é `lerTetoDoPlano` (`lib/agent-engine/edge/llm/orcamento.ts:527-546`, SQL em `:497-516`) e a decisão pura é `decidirTetoDoPlano` (`orcamento.ts:462-475`). O bloqueio abre o aviso `budget_exceeded` com `ref_kind = 'plano'`, grava a recusa em `llm_calls` e lança `LlmBudgetExceededError` (`run-model-call.ts:587-643`).
- Worker legado: `workers/ai-response-worker.ts:450-456` chama `vetoPorTetoDoPlano` (`:563-607`), com a mesma decisão pura.

**O que a `lib/cobranca/rodada.ts` faz.** Não aplica nada. Ela só abre o aviso de 80% (`rodada.ts:123-198`), pela rodada horária da cobrança. Ver o ponto 4.

**Diferença para o orçamento da empresa (`ai_budgets`).**

| | Teto do plano | Orçamento da empresa |
|---|---|---|
| Onde mora | `cobranca_planos.teto_ia_usd_cents` | `ai_budgets.monthly_limit_cents` |
| Quem define | o dono da instalação (nós) | o administrador da empresa, em Uso de IA |
| Quando vale | só com a chave da instalação (`orcamento.ts:470`) | com qualquer chave |
| Modos | bloqueia ao atingir, sem modo | `off`, `avisar`, `bloquear`, com carência e limiar (`orcamento.ts:217-277`) |
| Bloqueia sem ter avisado? | sim, não exige aviso prévio (`orcamento.ts:473-474`) | não: a condição 6 exige aviso no mês (`orcamento.ts:271-274`) |
| Desligado pelo `modo 'off'` da empresa? | não (`run-model-call.ts:467-468`) | sim (`run-model-call.ts:511-513`) |
| Chamadas isentas | `connection_test`, `jailbreak_detect`, `promise_semantic` (`orcamento.ts:56-60`, `:471`) | as mesmas |
| Aviso na Central | `budget_exceeded`, `ref_kind 'plano'` | `budget_warning` e `budget_exceeded`, `ref_kind 'ai_budget'` |

A chave de emergência `AI_BUDGET_ENFORCEMENT=off` desliga os dois (`run-model-call.ts:463-465`).

Um detalhe que pesa na parte 1: o gasto que o teto do plano compara é o do mês inteiro, de todas as chaves, inclusive a do cliente. O comentário em `orcamento.ts:434-435` registra isso como decisão ("conta o mês inteiro, inclusive BYOK, mas só BLOQUEIA a chave da instalação"). A parte 1 pede o contrário (somar só a chave da plataforma), então essa decisão antiga muda.

## 3. Teto vazio e chave da plataforma

CONFIRMADO: segue sem limite. `decidirTetoDoPlano` devolve `seguir` com `sem_teto` quando o teto é nulo (`orcamento.ts:472`), e o SQL nem soma o gasto nesse caso (`orcamento.ts:503`).

Há mais três casos em que a chave da plataforma segue sem limite hoje, e a falha fechada da parte 1 precisa decidir cada um:

1. **Cobrança desligada na instalação.** O gate nem consulta (`run-model-call.ts:475`).
2. **Organização isenta** (sem linha em `cobranca_assinaturas`). `fn_limite_do_plano` devolve `null` (`baseline.sql:48020-48022`). O comentário de `lib/cobranca/telas-do-plano.ts:15-16` cita a Você na Europa como exemplo de isenta.
3. **Leitura do teto falhou.** A chamada segue, com log (`run-model-call.ts:477-481`).

O problema de desenho: para o motor, "plano sem teto" e "organização isenta" chegam iguais, como `null`. Se a falha fechada for "teto nulo bloqueia", as isentas que usam a chave da plataforma param junto. Está nas perguntas, no fim.

## 4. Aviso antes do bloqueio

ERRADO. O teto do plano já tem aviso a 80%.

- Onde: `avisarTetoDeIa` em `lib/cobranca/rodada.ts:123-198`, limiar em `:36` (`LIMIAR_DO_AVISO_DE_IA = 0.8`).
- Quando roda: na rodada horária da cobrança, `app/api/v1/cron/cobranca/route.ts` agendada em `docker/scheduler/entrypoint.sh:153` (`43 * * * *`, uma vez por hora).
- Como grava: `fn_cobranca_avisar_teto_de_ia` (`supabase/baseline.sql:49619-49636`) insere em `agent_inbox_items` com `kind = 'cobranca'`, `ref_kind = 'plano'`, severidade `warn`. Deduplica por organização e mês-calendário (`created_at >= date_trunc('month', now())`), com trava consultiva. Então já é "uma vez por mês, sem duplicar se o gasto oscilar".
- Texto: título "O uso de IA do plano chegou a 80%", corpo em dólares (`rodada.ts:184-189`).
- Destino na Central: leva a Plano e cobrança, só para administrador (`lib/ai/inbox-destino.ts:163-168`, `:307-311`).

Limites do aviso de hoje, que a parte 1 precisa tratar:

- Roda por hora, não a cada chamada. Entre 80% e 100% em menos de uma hora o cliente não é avisado antes de parar.
- Só avisa entre 80% e 100%: de 100% em diante cala (`rodada.ts:179`), e quem fala é o bloqueio.
- Soma o gasto do mês inteiro de todas as chaves (`rodada.ts:173`), não só o da plataforma.
- A janela é o mês-calendário, não o ciclo.
- Mostra dólar, não conversas.
- Só para empresas operantes e planos com teto (`rodada.ts:127`, `:164`).

O orçamento da empresa tem o aviso próprio, `budget_warning`, aberto pelo SQL do gate a cada chamada, no limiar `alarm_threshold_pct` (`orcamento.ts:402-421`).

## 5. `llm_calls` distingue a origem da chave?

CONFIRMADO: não distingue.

- As colunas de `llm_calls` não têm origem de chave nem `credential_id` (leitura de `lib/database.types.ts`, bloco `llm_calls`, e dos `alter table` em `supabase/baseline.sql:11591-11635` e `:75665-75671`).
- `origem_da_escolha` existe, mas é a origem da escolha do **modelo** (ponto, agente, padrão), não da chave (`run-model-call.ts:1439`, `:1459`).
- Os dois inserts do seam não gravam origem de chave: sucesso em `run-model-call.ts:1436-1469`, falha em `:1645-1665`.

O que muda o desenho da parte 1: o seam não é o único escritor de `llm_calls`. Há pelo menos mais oito pontos que inserem direto (saída de `git grep` em 25/11):

```
lib/agent-engine/edge/crm/send-voice.ts:156
lib/ai/decisao/afirmacao-de-fato.ts:380 e :409
lib/ai/decisao/campo-do-negocio.ts:415 e :446
lib/ai/decisao/pedidos.ts:423 e :613
lib/ai/log-invocation.ts:95
lib/ai/usage/registrar-chamada.ts:59
workers/media-derive-worker.ts:1094
```

A coluna nova precisa de um valor padrão que não deixe esses escritores furarem o teto, e cada um precisa ser classificado. Não classifiquei os oito nesta etapa.

## 6. Janela do gasto e ciclo da assinatura

CONFIRMADO: mês-calendário. `fn_gasto_de_ia_do_mes` soma `llm_calls.cost_cents` com `created_at >= date_trunc('month', now())` (`supabase/baseline.sql:13471-13482`), no fuso da sessão do banco. É a mesma função para o gate, a tela de uso, o painel da assinatura e o aviso de 80%. O "já avisei neste mês" também é mês-calendário (`orcamento.ts:361-366`, `baseline.sql:49629`).

O ciclo da assinatura existe em `cobranca_assinaturas`:

- `proximo_vencimento`: fim do período pago (`0583:75`, comentário em `:96-97`).
- `periodo_pago_desde`: início do período pago (`supabase/baseline.sql:55925-55927`), gravado na releitura do provedor (`lib/cobranca/sincronizar.ts:236-237`), vindo de `current_period_start` da Stripe (`lib/cobranca/provedores/stripe.ts:695`) e da última cobrança paga no Asaas (`lib/cobranca/provedores/asaas.ts:639`).
- `trial_ate`: fim do teste grátis (`0583:69`).

Lacunas para alinhar a janela ao ciclo:

- No teste grátis não há período pago: `periodo_pago_desde` pode estar nulo.
- Organização isenta não tem linha.
- Plano anual (`intervalo = 'ano'`) tem ciclo de um ano, e a franquia é mensal.
- O par só é tão fresco quanto a última releitura do provedor.

Então a parte 1 precisa de uma regra de queda: usar o ciclo quando os dois campos existem e o período é mensal, e cair no mês-calendário no resto. Proposta nas perguntas.

## Premissas das partes 1 a 5

### Variável da chave da plataforma

Nome: `ANTHROPIC_API_KEY` (só o nome; não li valor).

- App: declarada em `lib/env.ts:329` (opcional, vazio por padrão).
- Worker: declarada em `lib/agent-engine/env.ts:41` (opcional; vazio vira ausente em `:333-339`).
- Vira config em `llmEdgeConfigFromEnv` (`credentials.ts:101-135`, a chave em `:123`).
- Quem monta a config no worker: `workers/agent-worker/main.ts:391` e `:659`. No app: `lib/agent-engine/agent/request-deps.ts:12` e as rotas que chamam `llmEdgeConfigFromEnv(env)` direto.
- Outros leitores do mesmo nome: `lib/instalacao/ambiente.ts:52` (`lerAmbiente().chavesDeProvedor`, usado pela rota de versões), `lib/ai/runtime/agent.ts:173-180` (`chaveDePlataforma`, usado pelo instalador para escolher modelo) e `lib/ai/gateway.ts:80-81`.
- Onde configurar: `.env` da instalação. Os serviços `app` e `worker` do `docker-compose.prod.yml` usam `env_file: .env` (`:63` e `:180`). Modelos em `.env.example:264` e `.env.hostgator.example:208`.

### Caminho do worker até a chamada do modelo

1. `workers/agent-worker/main.ts:683` registra o handler de `inbound_turn`.
2. O handler chama `runAgentTurn` em `lib/agent-engine/agent/inbound-turn.ts`, que envolve o turno inteiro em `comHandoffSeOrcamentoAcabar` (`inbound-turn.ts:1011-1088`).
3. Toda chamada de modelo passa por `runModelCall` (`run-model-call.ts:784`): resolve a config e a chave (`:792`, `:830-835`), valida o par provedor e modelo (`:857-868`), e chama o gate `aplicarOrcamento` logo antes de sair byte (`:933-954`).
4. Gate recusa: `LlmBudgetExceededError`, com `terminal = true` (`run-model-call.ts:89-108`).
5. A escolta pega o erro, avisa o lead, faz `performHumanHandoff` com `reason: HANDOFF_REASON_ORCAMENTO` (`inbound-turn.ts:1071-1082`) e relança.
6. A fila lê `terminal` e cancela o job em vez de tentar de novo (`workers/agent-worker/main.ts:179`, `:508-527`).

A trava da parte 1 entra no passo 3, dentro de `aplicarOrcamento`, no bloco do teto do plano (`run-model-call.ts:475-501`), e a decisão pura em `orcamento.ts:462-475`. O app usa o mesmo `runModelCall`, então o mesmo ponto vale nos dois.

Fora do seam, três lugares repetem o gate ou a decisão e precisam acompanhar:

- `workers/media-derive-worker.ts:706` (chama `aplicarOrcamento`).
- `lib/agent-engine/agent/voz-do-turno.ts:147` e `app/api/v1/ai/voz/preview/route.ts:87` (chamam `aplicarOrcamento`).
- `workers/ai-response-worker.ts:450-456` e `:563-607` (caminho legado, decisão própria com a mesma função pura).

Razão do handoff hoje: os dois tetos gravam a **mesma** razão, `orcamento_de_ia` (`orcamento.ts:93`; uso em `inbound-turn.ts:1075` e `ai-response-worker.ts:624`). O resumo fixo que vai ao atendente fala em "Uso de IA › Orçamento" (`inbound-turn.ts:931-935`), que é o remédio do orçamento da empresa, não o do plano. A parte 1 pede razão própria, então isso muda. Não achei `CHECK` em `conversations.last_handoff_reason` (a coluna é `text` em `baseline.sql:1419`), mas o comentário em `baseline.sql:30648` diz que o valor é "chave de negócio em outro módulo"; quem lê a razão precisa ser conferido antes de criar um valor novo.

### Notificação da Central

A Central é a tabela `agent_inbox_items`. Mecanismos que já existem para este assunto:

- Aviso de 80% do plano: `fn_cobranca_avisar_teto_de_ia` (`baseline.sql:49619-49636`), `kind 'cobranca'`, `ref_kind 'plano'`, um por mês.
- Bloqueio do plano: insert em `recusarPorTeto` (`run-model-call.ts:599-616`), `kind 'budget_exceeded'`, `ref_kind 'plano'`, um aberto por organização, garantido pelo índice `agent_inbox_budget_do_plano_aberto_unico` (`0583:764-766`). Texto em `orcamento.ts:442-445`. O laço de retorno fecha o aviso quando o gasto volta a caber (`orcamento.ts:506-514`).
- Destino e rótulo: `lib/ai/inbox-destino.ts:69-70`, `:163-168`, `:307-311`. Títulos por `kind` em `lib/ai/agent-inbox-copy.ts:33`, `:79`, `:115`.

`kind` novo exige reconstruir o `CHECK` de `agent_inbox_items.kind` (bloco único no baseline; ver o comentário em `run-model-call.ts:653-656`). Dá para fazer a parte 1 sem `kind` novo, reusando `cobranca` e `budget_exceeded` com `ref_kind 'plano'`.

O texto atual do bloqueio do plano manda "trocar de plano, cadastrar chave própria ou aguardar o próximo mês" (`orcamento.ts:443-445`). A parte 1 pede duas saídas: falar com a ArvisX para pacote extra e cadastrar chave própria.

### Tela de uso

- Uso de IA: `app/app/ai/usage/page.tsx` (título em `:60`), com `components/ai/BudgetCard.tsx` e `app/app/ai/usage/_client.tsx`. Papel mínimo `manager` (`page.tsx:26-28`). Mostra o orçamento da **empresa** (`getBudgetStatus`, `lib/ai/budget/check.ts`). Não mostra nada do plano (um `grep` por "plano" e "teto" em `page.tsx` e `_client.tsx` não devolveu linha).
- Plano e cobrança: `components/cobranca/PainelDaAssinatura.tsx:76-82` já mostra "Uso de IA no mês" como gasto em dólar sobre o teto do plano, só para administrador. O gasto vem de `fn_gasto_de_ia_do_mes` (`lib/cobranca/painel.ts:238`).

As duas telas comportam a franquia sem tela nova. Qual das duas é "a existente" do texto da tarefa está nas perguntas.

### `lib/cobranca/telas-do-plano.ts`

- "Todas as telas" é valor suportado: `{"preset":"completa"}` sem `destinos`. `portasDaEscolha` devolve `undefined` (`lib/navigation/interface.ts:296-298`) e `destinosDoPlano` devolve o catálogo inteiro (`telas-do-plano.ts:104-110`). É o padrão da coluna (`supabase/baseline.sql:69184-69185`). Não precisa de preset novo.
- Equipe pronta: depende só de o plano liberar a tela `/app/ai/equipe-pronta` (`lib/ai/equipe-pronta/constantes.ts:8`; trava do motor em `lib/cobranca/equipe-pronta-no-plano.ts:44-61`). Não há verificação pelo nome "Premium" no código que li; "Premium" aparece em comentário (`9808:60`). Com `preset completa`, a Equipe pronta fica liberada.
- Atenção: a tela de administração de planos não envia `teto_ia_usd_cents` ao criar nem ao editar (`app/admin/(protected)/cobranca/_planos.tsx:103-108`, com teste em `tests/unit/admin-cobranca-planos.test.tsx:65`). O teto dos planos novos só entra pelo script SQL da parte 2, e editar o plano pela tela não o apaga.

### Gatilhos de limite de canais e assentos

- Assentos: `fn_trava_assentos_do_plano` (`supabase/baseline.sql:48091-48133`). Mensagem `limite_do_plano:assentos:<teto>`, SQLSTATE `PT402`, `detail` com `{recurso, limite, em_uso}`. Conta membro ativo e não provisório; convite pendente não conta.
- Canais: `fn_trava_canais_do_plano`, última definição em `supabase/baseline.sql:63104-63152` (há uma anterior em `:48156`; vale a última). Mensagem `limite_do_plano:canais:<teto>`, `PT402`. Não conta `wacalls` nem linha morta sem número no WAHA.
- Tradução no app: `lib/cobranca/limites.ts:28-73`, 409 `plan_limit_reached`. Frases prontas em `:41-52` ("Seu plano permite {n} pessoas…", "Seu plano permite {n} números conectados…").

Para o teste da parte 2: com plano de 3 canais o 4º insert devolve `limite_do_plano:canais:3`; com 5 assentos o 6º devolve `limite_do_plano:assentos:5`. Precisa da cobrança ligada e de assinatura na organização, senão `fn_limite_do_plano` devolve `null` e nada trava.

### `app/page.tsx` e `lib/i18n/landing.ts`

As três linhas do texto da tarefa estão certas, com o número exato:

| `app/page.tsx` | Texto | Chave em `lib/i18n/landing.ts` |
|---|---|---|
| `:217` | "IA a partir do Standard, com as credenciais da sua empresa" | `:22` |
| `:658` | "A IA do Arvisx CRM funciona com as credenciais da sua empresa. Você conecta as chaves ou os planos de IA que já tem e usa como quiser." | `:139` |
| `:1025` | "A IA é integrada ao CRM a partir do plano Standard. Você conecta as suas próprias chaves ou planos de IA e é responsável por configurar e gerenciar os seus agentes. O consumo é cobrado pelo seu provedor de IA, nunca pela Arvisx." | `:234` |

A mesma seção tem mais textos que dizem a mesma coisa e ficam contraditórios se só os três mudarem:

- `app/page.tsx:655` "IA com as suas credenciais" (`landing.ts:137`).
- `app/page.tsx:656` "Sua IA, suas chaves, seu controle." (`landing.ts:138`).
- `app/page.tsx:663-664` "Suas credenciais" e "Chaves ou planos de IA" (`landing.ts:141-142`).
- `landing.ts:271` "Assinar o Essencial, o Standard ou o Premium:" cita os nomes dos planos atuais.

Está nas perguntas.

### `lib/ai/equipe-pronta/`

- Papéis: quatro, em `lib/ai/equipe-pronta/index.ts:28-33` (`sdr`, `agendamento`, `proposta`, `recuperador`), todos na `versao: 2` (`papeis/sdr.ts:11`, `agendamento.ts:14`, `proposta.ts:14`, `recuperador.ts:15`). Regras comuns em `papeis/comum.ts`.
- `TERMOS_DE_NICHO`: são **duas** listas, uma por teste, e não são iguais. `lib/ai/equipe-pronta/papeis.test.ts:40-78` (lista longa, com "advog" em `:64`, mais "jurídic", "juridic", "processo judicial", "cidadania", "visto" e "imigra") e `lib/ai/equipe-pronta/gatilhos/fluxos.test.ts:52` (nove radicais, com "advog"). O teste de cerca da parte 4 precisa de uma lista só; hoje não há constante compartilhada.
- `questionario.ts`: seis passos e os blocos de cada um (`questionario.ts:35-78`). O bloco de qualificação está no passo `regras` (`:58-63`). O perfil é `z.strictObject` (`lib/schemas/equipe-pronta.ts:231-244`, rascunho em `:252`), então um campo novo (o nicho) precisa entrar no schema, senão o PUT recusa.
- `instalar.ts`, como evita sobrescrever o que o cliente editou: compara três hashes dos campos que a equipe decide (`renderizar.ts:310-318`): o publicado no banco, o que o renderizador geraria agora e o guardado na última instalação. Publicado igual ao gerado: em dia. Publicado igual ao guardado: desatualizado, reaplicar é seguro. Nenhum dos dois: editado à mão, e a instalação para antes de gravar qualquer coisa com 409 `agentes_editados_a_mao`, salvo `forcar` (`instalar.ts:1327-1356`, exame em `:496-521`). O hash cobre só prompt, ferramentas, palavras de passagem, follow-up, funis, fontes e duas chaves (`renderizar.ts:231-283`); modelo e credencial ficam de fora de propósito (`renderizar.ts:224-226`), então trocar o modelo não conta como edição.
- Modelo na instalação: só é escolhido para agente **novo** (`instalar.ts:1105-1127`), pela porta `escolherModelo` (`portas.ts:99-109`), que chama `resolveSetupModel` (`lib/prospecting/agent-setup.ts:80-171`). Essa função prefere o modelo de um agente já publicado, depois o provedor preferido da organização, e dentro do provedor o modelo curado do catálogo. O curado da Anthropic no baseline é `claude-sonnet-5` (`supabase/baseline.sql:10222-10223`; não perguntei ao banco se uma migration posterior mudou). Ou seja, hoje a Equipe pronta com chave da plataforma nasce em Sonnet 5, que custa 20 vezes o Haiku 5.5 na entrada e na saída. O `claude-haiku-5-5` está no catálogo (`baseline.sql:74227-74229`), com ferramentas. Agente que já existe mantém o modelo que tem (`instalar.ts:1174`, `novaVersaoDoAgente` parte da versão vigente).
- Contexto "Esta empresa": montado em `blocoEstaEmpresa` (`renderizar.ts:137-169`), e juntado ao prompt em `renderizarAgente` (`renderizar.ts:201`). As perguntas de qualificação entram em `:153-155`. É o ponto onde o pacote de nicho complementa o contexto.
- Onde o onboarding pergunta coisas: há dois lugares. O onboarding geral em `app/onboarding/` (passos em `lib/onboarding/passos.ts:66-122`; o passo `welcome` pergunta nome do negócio, o que faz e onde atende, `app/onboarding/welcome/_form.tsx:73-117`). E o questionário da Equipe pronta em `app/app/ai/equipe-pronta/_components/Questionario.tsx`. A pergunta "tipo de negócio" que pré-preenche o questionário cabe no segundo; está nas perguntas.

### Preço do Haiku 5.5

CONFERIDO na página oficial, em 25/11/2026: `https://platform.claude.com/docs/en/about-claude/pricing` (aberta com WebFetch).

| | Página oficial | `pricing.ts:73` |
|---|---|---|
| Entrada | US$ 0,10 por milhão | 0.1 |
| Saída | US$ 0,50 por milhão | 0.5 |
| Leitura de cache | US$ 0,01 | 0.01 |
| Gravação de cache 5 min | US$ 0,125 | 0.125 |
| Gravação de cache 1 h | US$ 0,20 | 0.2 |

Bate. A página também confirma a faixa de 5 vezes: "Claude Haiku 5.5 (for prompts over 100,000 tokens)" a US$ 0,50 de entrada e US$ 2,50 de saída, e diz que o tamanho do prompt conta todos os tokens de entrada, inclusive leitura e gravação de cache, e que cada requisição é cobrada por si.

O que **não** bate é o cálculo: `pricing.ts:70-72` declara que a faixa de 5 vezes fica fora da tabela, porque o `usage` soma os passos do laço de ferramentas. Numa requisição acima de 100 mil tokens, o custo gravado em `llm_calls` sai 5 vezes menor que o cobrado, e o teto em dólar conta a menos. O valor da tabela não precisa de correção; a lacuna é de cálculo. Está nas perguntas.

### Ciclo da assinatura

Existe. Ver o ponto 6: `cobranca_assinaturas.periodo_pago_desde` e `proximo_vencimento`, mais `trial_ate`.

## O que no contexto da tarefa está errado ou muda o desenho

1. **O aviso de 80% do teto do plano já existe** (ponto 4). A parte 1 não cria o aviso; ela o ajusta (origem da chave, ciclo, conversas, e o caso de subir de 80% a 100% em menos de uma hora).
2. **"Teto nulo" não distingue plano sem teto de organização isenta** (ponto 3). A falha fechada, como está escrita, pararia as organizações isentas que usam a chave da plataforma. O texto da tarefa não cita as isentas.
3. **A decisão antiga era contar tudo e bloquear só a chave da instalação** (`orcamento.ts:434-435`). A parte 1 inverte a soma (só a chave da plataforma). É mudança de decisão registrada, não só de código.
4. **`llm_calls` tem pelo menos oito escritores fora do seam** (ponto 5). A coluna de origem precisa de padrão e de classificação para cada um.
5. **O instalador da Equipe pronta não fixa o modelo; ele herda** de agente publicado, do provedor preferido ou do curado do catálogo (hoje `claude-sonnet-5`). A parte 5 muda só o caso do agente novo; agente já instalado mantém o modelo.
6. **A landing tem mais de três textos sobre credenciais** na mesma seção.
7. **`TERMOS_DE_NICHO` são duas listas diferentes**, uma em cada teste.
8. **A razão do handoff e o resumo ao atendente são os mesmos nos dois tetos**, e o resumo aponta o remédio errado para o caso do plano.
9. **A faixa de 5 vezes do Haiku 5.5 não entra no custo calculado.** O teto em dólar fica otimista em requisição longa.
10. **A tela de planos do administrador não mexe em `teto_ia_usd_cents`.** Coerente com o script SQL da parte 2, mas a franquia nova vai herdar a mesma situação: sem campo na tela, só por SQL.

Não conferi, por não ter acesso ao banco de produção: que há 12 organizações, que os planos atuais são 59,90 / 129,90 / 199,90 e que o teto deles está vazio.

## Perguntas para o Lucas

1. **Organização isenta (sem assinatura) com a chave da plataforma:** bloqueia junto com "plano sem teto", ou continua livre? Minha proposta: a falha fechada vale só para organização **com** assinatura em plano sem teto; isenta e cobrança desligada seguem como hoje. Sem isso, a Você na Europa e qualquer outra isenta param no deploy.
2. **Os planos atuais (teto vazio) têm clientes usando a chave da plataforma hoje?** Se sim, a falha fechada os bloqueia no deploy, e a tarefa manda não mexer nos planos em uso. Precisa de uma destas saídas: dar teto a esses planos antes, ou confirmar que todos usam chave própria.
3. **Leitura do teto que falha (banco oscilou):** hoje segue. Mantém, ou fecha também? Proponho manter: fechar aqui cala o atendimento de todo mundo por uma oscilação.
4. **Qual é "a tela de uso existente":** Uso de IA (`/app/ai/usage`, gerente) ou Plano e cobrança (`/app/settings/billing`, administrador)? Proponho mostrar a franquia nas duas: o número em Plano e cobrança, onde já está o gasto do plano, e um resumo com o aviso em Uso de IA.
5. **Ciclo:** uso `periodo_pago_desde` até `proximo_vencimento` quando os dois existem e o plano é mensal, e mês-calendário no teste grátis, no plano anual e quando falta dado. Pode ser assim?
6. **Landing:** troco só os três textos, ou também o título e os rótulos da mesma seção ("Sua IA, suas chaves, seu controle.", "IA com as suas credenciais", "Suas credenciais")? Proponho trocar a seção inteira, senão ela se contradiz.
7. **Faixa de 5 vezes do Haiku 5.5:** corrijo o cálculo na parte 5 (o seam conhece a entrada do primeiro passo, `run-model-call.ts:1433`, mas não a de cada passo), ou deixo documentado como limite conhecido? Proponho documentar e não mexer agora: prompt de atendimento acima de 100 mil tokens é raro, e a correção exata pede custo por passo.
8. **Pergunta "tipo de negócio":** no questionário da Equipe pronta (primeiro passo, "Seu negócio"), e não no onboarding geral. Confirma?
9. **Modelo dos agentes já instalados:** a parte 5 muda só agente novo. Os que já existem em Sonnet 5 com a chave da plataforma continuam assim e gastam o teto 20 vezes mais rápido. Fica fora de escopo, certo?
