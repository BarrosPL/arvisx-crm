# Vix, Fase 1: tabela de capacidades

Capacidade × nível × papel × plano × teste × tem inverso, como está no código em `lib/assistente/capacidades/`. Regra do catálogo: sem teste, não entra. Quem cobra é `tests/unit/assistente-catalogo-cerca.test.ts`.

Esta tabela diz o que os testes provam. Ela não declara o assistente seguro.

Como ler as colunas:

- **Papel**: o mínimo para a capacidade. É o mais restrito entre a tela e o MCP.
- **Plano**: a rota da tela equivalente. O plano da empresa é perguntado com ela, pela mesma classificação que a tela usa (`lib/cobranca/rotas-do-plano.ts`). "Livre" quer dizer que hoje o plano não decide aquela rota para ninguém, não que a capacidade ignora o plano.
- **Teste**: o arquivo que prova a capacidade. Os de `tests/invariants/` rodam contra Postgres de verdade, com PostgREST real, RLS e o JWT de uma pessoa (`tests/db/postgrest-efemero.ts`).

## 1. Capacidades próprias (8)

| Capacidade | Nível | Papel | Plano (rota) | Teste | Inverso |
|---|---|---|---|---|---|
| `ajuda_buscar` | ler | viewer | não decide | `lib/assistente/capacidades/proprias.test.ts` | não se aplica |
| `telas_apontar` | ler | viewer | a própria tela apontada | `lib/assistente/capacidades/proprias.test.ts` | não se aplica |
| `configuracao_plano` | ler | viewer | não decide | `lib/assistente/capacidades/proprias.test.ts` | não se aplica |
| `diagnostico_canais` | ler | viewer | `/api/v1/channel-sessions` (livre) | `tests/invariants/assistente-proprias-isolamento.test.ts` | não se aplica |
| `diagnostico_turno` | ler | manager | `/api/v1/ai/turn-traces` (tela Execuções) | `tests/invariants/assistente-proprias-isolamento.test.ts` | não se aplica |
| `configuracao_credencial_de_ia` | ler | manager | `/api/v1/ai/credentials` | `tests/invariants/assistente-proprias-isolamento.test.ts` | não se aplica |
| `configuracao_agentes` | ler | manager | `/api/v1/ai/agents` | `tests/invariants/assistente-proprias-isolamento.test.ts` | não se aplica |
| `suporte_abrir_chamado` | escrever (cartão) | viewer | não decide | `tests/invariants/assistente-proprias-isolamento.test.ts` | não: o chamado não é apagado |

`configuracao_credencial_de_ia` lê a view `ai_provider_credentials_safe` e devolve só estado (provedor, nome, ativa, validada). O teste confere que a resposta não traz o fim da chave, o envelope cifrado nem o nome das colunas dele.

`suporte_abrir_chamado` grava só na tabela do próprio assistente e por isso fica disponível mesmo com as ações do assistente desligadas. Continua sendo cartão: só abre no clique.

## 2. Leituras reaproveitadas do MCP que ENTRARAM (25 de 49)

Todas são nível ler, inverso não se aplica, e o teste é `tests/invariants/assistente-leituras-isolamento.test.ts`. Cada uma tem três casos próprios: controle positivo (a pessoa da empresa A lê o dado marcado da empresa A), ataque por id, lista e texto da empresa B, e todo campo de id da entrada apontado para a empresa B.

| Capacidade | Papel no Vix | Papel no MCP | Plano (rota) |
|---|---|---|---|
| `crm_list_leads` | agent | agent | `/api/v1/leads` (livre) |
| `crm_get_lead` | agent | agent | `/api/v1/leads` (livre) |
| `crm_list_at_risk_leads` | agent | agent | `/api/v1/leads` (livre) |
| `crm_list_lead_notes` | agent | agent | `/api/v1/leads` (livre) |
| `crm_list_pipelines` | manager | agent | `/api/v1/pipelines` (livre) |
| `crm_get_pipeline_forecast` | manager | agent | `/api/v1/pipelines` (livre) |
| `crm_list_stages` | manager | agent | `/api/v1/pipelines` (livre) |
| `crm_search_contacts` | agent | agent | `/api/v1/contacts` (livre) |
| `crm_get_contact` | agent | agent | `/api/v1/contacts` (livre) |
| `crm_list_conversations` | agent | agent | `/api/v1/conversations` (livre) |
| `crm_get_conversation` | agent | agent | `/api/v1/conversations` (livre) |
| `crm_get_conversation_history` | agent | agent | `/api/v1/conversations` (livre) |
| `crm_get_queue_status` | agent | agent | `/api/v1/conversations` (livre) |
| `crm_list_tasks` | agent | agent | `/api/v1/tasks` (livre) |
| `crm_list_appointments` | agent | agent | `/api/v1/agenda` (livre) |
| `crm_list_event_types` | agent | agent | `/api/v1/agenda` (livre) |
| `crm_list_human_cases` | agent | agent | `/api/v1/ai/cases` (livre) |
| `crm_get_human_case` | agent | agent | `/api/v1/ai/cases` (livre) |
| `crm_list_followups` | agent | agent | `/api/v1/ai/followups` (livre) |
| `crm_search_products` | agent | agent | `/api/v1/products` (tela Produtos) |
| `crm_list_tags` | agent | agent | `/api/v1/tags` (livre) |
| `crm_list_message_templates` | agent | agent | `/api/v1/message-templates` (livre) |
| `crm_list_team_members` | agent | agent | `/api/v1/team` (livre; só a leitura) |
| `crm_get_honorarios_contrato` | **manager** | agent | `/api/v1/honorarios` (tela Honorários) |
| `crm_list_honorarios_parcelas` | **manager** | agent | `/api/v1/honorarios` (tela Honorários) |

Notas sobre a prova:

- `crm_list_at_risk_leads`, `crm_list_lead_notes` e `crm_list_followups` tinham controle positivo fraco. Agora a semente cria, nas duas empresas, um negócio parado há 60 dias, uma nota e um retorno agendado, todos com a marca, e o controle positivo exige a marca da própria empresa na resposta.
- As duas de honorários são dado restrito e entram como `manager`: atendente e leitor são recusados com `papel_insuficiente` (caso "leituras de gerente recusam o atendente e o leitor"). O contrato não tem campo de texto, então a marca é o valor: a resposta de A traz o valor de A e nunca o de B. As tabelas são do módulo de honorários; o teste as cria pela função provisionadora, como numa instância que instalou o módulo. Onde o módulo não está instalado, a leitura devolve a recusa do próprio handler, sem dado (isto **não** tem teste próprio pelo Vix).
- O papel dos funis (`manager`) vem da tela (`app/api/v1/pipelines/route.ts`), que é mais restrita que o MCP.
- Nenhuma leitura é oferecida a `viewer`. Onde a tela aceita viewer (contatos, tarefas) e o MCP pede `agent`, ficou `agent`.

## 3. Leituras do MCP que ficaram FORA (24 de 49), e por quê

| Ferramenta MCP | Por que ficou fora |
|---|---|
| `crm_get_proposal` | **Depende da chave de serviço, medido.** Pergunta se o módulo "propostas" está ligado com o cliente que recebeu; o módulo mora em `platform_config`, que a sessão não lê. Em `tests/invariants/assistente-leituras-que-dependem-da-chave-de-servico.test.ts`, com o módulo LIGADO no banco: a chave de serviço lê "ligado" e a sessão de um gerente lê "desligado" |
| `crm_preparar_proposta` | **Depende da chave de serviço**, pelo mesmo módulo e pela mesma medida |
| `crm_query_external_data` | **Depende da chave de serviço, medido.** Dado restrito (só gerente). `abrirAcesso` pergunta pelo módulo "banco_externo" com o cliente que recebeu. No mesmo teste, com o módulo ligado: com a sessão a recusa é `modulo_desligado` antes de olhar a conexão; com a chave de serviço passa dessa porta |
| `crm_describe_external_data` | **Depende da chave de serviço**, pela mesma porta (`abrirAcesso`) e pela mesma medida |
| `crm_consultar_receita` | **Depende da chave de serviço**, pela mesma porta (`abrirAcesso`) e pela mesma medida |
| `crm_list_privacy_requests` | Decisão: LGPD é só pela tela |
| `crm_get_prospecting_site_audit` | É do turno de atendimento: só responde com o contato da conversa |
| `crm_list_comments` | Onda 2. Papel `manager`. Sem prova escrita |
| `crm_get_comment` | Onda 2, mesmo motivo |
| `crm_find_free_slots` | Onda 2. Sem prova: precisa de agenda com horários configurados |
| `crm_search_knowledge` | Onda 2. Exige o id de um assistente; sem prova escrita |
| `crm_list_knowledge_sources` | Onda 2. Sem prova escrita |
| `crm_get_org_memory` | Onda 2. Sem prova escrita |
| `crm_list_improvement_proposals` | Onda 2. Sem prova escrita |
| `crm_list_lead_attachments` | Onda 2. Sem prova escrita |
| `crm_list_lead_events` | Onda 2. Sem prova escrita; é uma das duas leituras que usam o id do token |
| `crm_find_duplicate_contacts` | Onda 2. Sem prova escrita |
| `crm_list_contact_orders` | Onda 2. Sem prova escrita |
| `crm_render_message_template` | Onda 2. Sem prova escrita |
| `crm_list_available_attendants` | Onda 2. Sem prova escrita |
| `crm_list_automation_rules` | Onda 2. Sem prova escrita |
| `crm_list_automation_runs` | Onda 2. Sem prova escrita |
| `crm_list_webhook_sources` | Onda 2. Sem prova escrita |
| `crm_list_webhook_source_events` | Onda 2. Sem prova escrita |

"Sem prova escrita" quer dizer só isso: o teste de isolamento daquela ferramenta não foi escrito. Numa sonda exploratória (não commitada), as 49 leituras responderam com o cliente de sessão sem erro de permissão, mas responder não é prova de isolamento, e por isso não entraram.

Das seis leituras de dado restrito, as duas de honorários entraram (como `manager`) e as três de banco externo e receitas ficaram fora porque não funcionam com o cliente de sessão. Para entrarem, a pergunta do módulo precisaria ser feita pelo servidor antes de chamar a ferramenta, o que é mudança no núcleo e não foi feita aqui. A de LGPD está fora por decisão.

## 4. Escritas de exemplo (2), atrás de chave desligada

Só são oferecidas com o módulo "Ações do assistente" ligado na instalação (`MODULO_ASSISTENTE_ESCRITAS`, desligado por padrão). O modelo só propõe; a execução é no clique, pelo código da tela.

| Capacidade | Nível | Papel | Plano (rota) | Teste | Inverso | Executa por |
|---|---|---|---|---|---|---|
| `etiquetas_adicionar` | escrever | agent | `/api/v1/leads` (livre) | `tests/invariants/assistente-escritas-so-no-clique.test.ts` | parcial: a etiqueta é removida pela tela do negócio; não há capacidade de remover | `updateLeadHandler` (`app/api/v1/leads/_handler.ts`), que audita e grava atividade |
| `tarefas_criar` | escrever | agent | `/api/v1/tasks` (livre) | `tests/invariants/assistente-escritas-so-no-clique.test.ts` | parcial: a tarefa é concluída ou editada pela tela; não é apagada | `criarTarefa` (`lib/tarefas/servico.ts`), que audita |

Nenhuma capacidade de nível sensível existe na Fase 1. O mecanismo (cartão reforçado, palavra digitada) está implementado e é testado com capacidades de teste.

## 5. O que o Vix nunca faz

Lista em `lib/assistente/proibidas.ts`, aplicada em código pelo executor e conferida pela cerca: nenhuma capacidade pode apontar para `/api/v1/admin`, `/api/v1/tenants`, `/api/v1/cobranca`, `/api/v1/lgpd`, `/api/v1/modulos`, `/api/v1/voip`, `/api/v1/channels/official`, `/api/v1/settings/security`, `/api/v1/mcp`, nem escrever em `/api/v1/ai/credentials` ou `/api/v1/team`. As ferramentas MCP de envio a cliente final, de passagem para humano e de LGPD são recusadas pelo nome, mesmo que alguém as declare.
