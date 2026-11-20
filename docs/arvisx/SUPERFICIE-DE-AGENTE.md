# Superfície de agente

O que um agente consegue ler e fazer no CRM. Vale para os dois tipos:

- **agente externo**: fala com o CRM por token de API (`Authorization: Bearer dsk_...`) no MCP, em `/api/mcp`;
- **agente nativo**: os agentes criados no próprio CRM (a Equipe de IA pronta, por exemplo).

Os dois usam as mesmas ferramentas. Não existe versão paralela para um ou para outro.

**Por que só o MCP.** As rotas REST de tarefa, anexo e próxima ação (`app/api/v1/tasks`,
`app/api/v1/leads/[id]/attachments`, `app/api/v1/leads/[id]/next-action`) autenticam por sessão de usuário e
servem a tela. Um token de API não entra nelas. A regra é uma só: ela foi extraída das rotas para `lib/` e é
chamada pelos dois lados (`lib/tarefas/servico.ts`, `lib/leads/anexos-do-negocio.ts`,
`lib/leads/proposta-de-proxima-acao.ts`).

Este documento cobre a parte 1 (tarefas, notas, anexos e próxima ação). Eventos para sistemas externos, consulta de
proposta e passagem entre colegas vêm nas partes seguintes.

## Regras que valem para todas

- **A organização vem do token**, nunca de um argumento. Nenhuma ferramenta aceita `organization_id`.
- **Nenhuma fala com o cliente.** Tudo o que elas escrevem é lido pela equipe, dentro do CRM.
- **Papel mínimo `agent`**, que é o papel de um token de API sem escopo `role:`. Leitura pede o escopo `mcp:read`;
  escrita pede `mcp:write`.
- **Toda escrita fica na auditoria com o agente como autor**: `actor_api_token_id` é o token, e `metadata` leva
  `via: "mcp"`, o tipo do ator e, no agente nativo, o `agent_id`.
- **Recusa tem código.** A resposta vem com `permitido: false`, `motivo` (o código) e `mensagem` (o que fazer).
- **Num turno de atendimento**, o agente nativo só alcança o que é do cliente da conversa. Registro de outro
  cliente e registro inexistente recebem a mesma recusa (`fora_da_conversa`).
- **Repetição segura.** O cabeçalho `Idempotency-Key` (UUID) da requisição MCP vale para `crm_create_task`,
  `crm_add_lead_note` e `crm_attach_to_lead`: a mesma chave não grava duas vezes. Recusa não vira recibo.

## Tarefas

Tarefa é um combinado de trabalho interno com prazo. Aparece na tela de Tarefas e, quando presa a um negócio, na
linha do tempo dele.

| Ferramenta | O que faz |
|---|---|
| `crm_create_task` | Cria. `title` obrigatório; `description`, `due_date`, `priority`, `kind` (tipo, texto livre), `assigned_to`, `lead_id`, `contact_id` opcionais. |
| `crm_list_tasks` | Lista, da mais antiga para a mais nova. Filtros: `lead_id`, `contact_id`, `assigned_to`, `state` (`open`, `completed`, `all`), `overdue`, `since`. Paginada por `cursor`. |
| `crm_complete_task` | Conclui, com `result` em texto. Concluir de novo não muda nada e responde `already_completed: true`. Tarefa cancelada não é concluída. |
| `crm_update_task` | Muda `due_date` e/ou `assigned_to`. |

- `assigned_to` aceita o `user_id` de um atendente ou a palavra `equipe` (sem responsável). O atendente tem de ser
  da equipe da organização e não pode ser só leitor: é a mesma conferência da tela.
- Datas são ISO-8601 com fuso (`2026-01-31T15:00:00-03:00`).
- `kind` e `result` são colunas novas de `crm_tasks` (migration 9809). A tela de Tarefas ainda não as mostra.

## Notas do negócio

| Ferramenta | O que faz |
|---|---|
| `crm_add_lead_note` | Escreve uma nota no negócio: `lead_id`, `text` e, opcional, `recipient`. |
| `crm_list_lead_notes` | Lê as notas do negócio em ordem cronológica. Filtros: `since`, `author` (id ou nome), `recipient`. Paginada por `cursor`. |

- O texto é gravado e devolvido inteiro, até 20 mil caracteres.
- O autor não é argumento: sai do cadastro. É o nome do agente (`ai_agents.name`) quando o turno sabe qual agente
  é, senão o nome do token (`api_tokens.name`).
- A nota aparece na linha do tempo do negócio como "Anotação", com o nome de quem escreveu no começo do texto.
- `recipient` é um marcador de texto livre ("financeiro") para um agente deixar recado a outro. O CRM só grava e
  filtra: não avisa ninguém, não roteia e não restringe quem lê. O filtro ignora maiúsculas e espaços nas pontas.
- A nota não é editada nem apagada.

### Nota do negócio e ficha do agente são coisas diferentes

O produto tem duas coisas chamadas "nota". Elas não foram unificadas, de propósito:

| | Nota do negócio | Ficha do agente |
|---|---|---|
| Onde mora | `crm_lead_activities`, tipo `note` | `lead_notes` |
| É de quem | do **negócio** | do **contato** (vale para todos os negócios dele) |
| Quem escreve | qualquer agente, por `crm_add_lead_note` | só o agente nativo, por `save_lead_note` (ferramenta do motor) |
| Autor e data | sim | não |
| Tamanho | texto inteiro | orçamento fixo: o índice inteiro entra no prompt de cada turno |
| Muda depois | não | sim: o agente consolida, e uma nota substitui e apaga as anteriores |
| Para que serve | registro para a equipe e recado entre agentes | memória do agente sobre a pessoa |

Unificar quebraria a ficha ou a nota: um registro com autoria não pode ser podado para caber no prompt, e uma
memória por contato não pode ser lida como se fosse de um negócio só.

As duas podem ser lidas por MCP. `crm_list_lead_notes` com `include_agent_memory: true` devolve também
`agent_memory`, a ficha do contato daquele negócio. A ficha não é escrita por MCP: quem escreve nela é o motor, que
controla o orçamento.

## Anexos

| Ferramenta | O que faz |
|---|---|
| `crm_attach_to_lead` | Anexa ao negócio um arquivo que já está no CRM. |
| `crm_list_lead_attachments` | Lista os anexos: nome, tipo, tamanho, campo e um link assinado que vence em 60 segundos. |

- O arquivo vem de um de dois lugares: a mídia de uma mensagem da conversa (`message_id`) ou uma URL assinada que
  este CRM devolveu (`signed_url`). Informe exatamente um.
- **Endereço de fora não é aceito.** A URL assinada é só lida para saber qual objeto ela aponta: host do Storage
  desta instalação, bucket do CRM e caminho que começa pela organização do token. O servidor nunca busca a URL.
- Num turno de atendimento só vale `message_id`: a mensagem tem dono conferível (o cliente da conversa), a URL não.
- Formatos e tamanho são os da tela: PDF, PNG, JPG e WebP, até 50 MB.
- O anexo entra num campo de arquivo que o funil do negócio declara (`field_key`). Com um campo só, o argumento é
  dispensável; com mais de um, a recusa lista os campos; sem nenhum, não há onde anexar.

## Próxima ação

`crm_set_next_action` grava a proposta de próxima ação do negócio (`lead_id`, `next_action`). Ela aparece no card
para uma pessoa aprovar ou descartar. Nada é executado sozinho. `next_action: null` retira a proposta.

- A proposta é guardada por **contato**. Se o contato tem mais de um negócio aberto, ela pode aparecer em outro card
  ou ficar com a equipe para escolher: a resposta diz qual dos casos foi (`shown`).
- Frase sem ação concreta ("responder o cliente") não é gravada, e a resposta avisa (`recorded: false`).

## Fechar conversa

`crm_close_conversation` fecha uma conversa (`conversation_id`; `reason` opcional, até 300 caracteres) para ela sair
da caixa de entrada. O uso previsto: o agente falou por último e o cliente não respondeu há dias.

- **Nada é enviado ao cliente.** Se ele escrever de novo, a conversa reabre, como sempre.
- **Não fecha chamado nem negócio** (`crm_close_human_case` e `crm_close_demand` continuam sendo as ferramentas
  disso) e não solta a trava de atendimento humano do contato: devolver ao automático segue sendo escolha da tela.
- **Idempotente.** Conversa já encerrada (fechada, resolvida ou arquivada) responde `already_closed: true`, sem
  escrever nada e sem nova linha de auditoria. Conversa arquivada continua arquivada.
- **Auditoria** `conversation.closed`, a mesma ação da tela, com o token como ator e, no `metadata`, `via: "mcp"`,
  o estado anterior e o `reason`.
- Se o atendimento mudou entre a leitura e o fechamento, a recusa é `conversa_mudou`: leia de novo e decida.
- A regra é a da rota `POST /api/v1/conversations/[id]/close` (`lib/inbox/fechar-conversa.ts`, chamada pelos dois
  lados, e também pelo `PATCH /api/v1/conversations/[id]` com `status: "closed"` e pelo marcar contato como pessoal).
- Aparece no pacote "Não perder o cliente". "Organizar a operação" não tinha vaga: com as ferramentas que só a
  pessoa liga, ele já exige 26 das 27 vagas por agente.

## Em que pacote cada uma aparece

Em "O que o agente pode fazer", na tela do agente:

| Pacote | Ferramentas |
|---|---|
| Organizar a operação | as quatro de tarefa |
| Passar para um humano | as duas de nota |
| Não perder o cliente | as duas de anexo e a de próxima ação |

Elas não couberam num pacote só: um pacote sozinho não pode passar do teto de ferramentas por agente
(`TETO_TOOLS_POR_AGENTE`), e "Organizar a operação" já ocupava 22 das 27 vagas. Nenhuma entra em "Vender e mover o
funil", que é o pacote com que todo agente nasce.

Os papéis da Equipe de IA pronta ainda não usam estas ferramentas. Eles listam ferramenta por ferramenta, e a
liberação vem numa entrega própria.
