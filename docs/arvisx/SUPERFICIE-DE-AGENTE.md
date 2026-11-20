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

Este documento cobre a parte 1 (tarefas, notas, anexos e próxima ação) e a parte 2 (eventos para sistemas externos,
consulta de proposta, fechar e atribuir, passagem entre colegas). A convivência entre humano e IA vem na parte 3.

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

## Em que pacote cada uma aparece

Em "O que o agente pode fazer", na tela do agente:

| Pacote | Ferramentas |
|---|---|
| Organizar a operação | as quatro de tarefa |
| Passar para um humano | as duas de nota |
| Não perder o cliente | as duas de anexo, a de próxima ação e a consulta de proposta |

Elas não couberam num pacote só: um pacote sozinho não pode passar do teto de ferramentas por agente
(`TETO_TOOLS_POR_AGENTE`), e "Organizar a operação" já ocupava 22 das 27 vagas. Nenhuma entra em "Vender e mover o
funil", que é o pacote com que todo agente nasce.

## Consulta de proposta

`crm_get_proposal` lê uma proposta comercial. Só leitura (`mcp:read`, papel `agent`).

- Entrada: `proposal_id` ou `lead_id`, exatamente um. Com `lead_id` vêm as propostas daquele negócio, da mais recente
  para a mais antiga (até 10).
- Cada proposta traz número, versão, título, `status`, `valid_until`, `total_cents` e `currency`, condições, prazo,
  datas de envio e de decisão, e os itens (descrição, quantidade, preço unitário, desconto).
- `status` é o do banco: `rascunho`, `enviando`, `enviada`, `aceita`, `recusada`, `vencida`, `cancelada`,
  `substituida`.
- **O link.** Não existe página pública de proposta: o cliente a recebe como PDF, na conversa. `pdf_url` é um link
  assinado desse PDF, que vence em 60 segundos, e só existe para proposta que já saiu (nunca para rascunho).
- Num turno de atendimento, proposta de outro cliente e proposta inexistente recebem a mesma recusa.
- Some para a organização que desligou propostas.

## Fechar o negócio e atribuir a conversa

As duas já existiam e um token de agente (papel `agent`, escopo `mcp:write`) as alcança:

| Ferramenta | O que faz | Pacote |
|---|---|---|
| `crm_close_demand` | Fecha como ganho (`won`) ou perdido (`lost`); na perda o motivo é obrigatório. | Não perder o cliente. É de risco crítico: aparece no pacote para ser marcada à mão, e o botão do pacote não a liga. |
| `crm_assign_conversation` | Atribui a conversa a um atendente. | Passar para um humano e Atender. |

## Eventos para sistemas externos

Um sistema de fora recebe o que acontece no CRM pela ação "Avisar outro sistema (webhook)" das automações: uma regra
por evento que ele quer ouvir. O guia de quem recebe, com o corpo, os cabeçalhos e a lista dos eventos, é
[`docs/integracao/webhooks-de-saida.md`](../integracao/webhooks-de-saida.md).

Gatilhos desta entrega: `lead.tag_removed`, `lead.field_changed`, `lead.note_added`, `lead.task_created`,
`lead.attachment_added` e `task.completed`. Eles nascem no ponto único de cada escrita
(`lib/tarefas/servico.ts`, `lib/leads/notas-do-negocio.ts`, `lib/leads/anexos-do-negocio.ts`, o PATCH do negócio e
`crm_manage_tags`), então valem igual para a tela e para o agente.

Dois nomes pedidos não foram criados porque o fato já tinha gatilho: trocar o responsável é `lead.assigned` e perder o
negócio é `lead.lost` (com `lost_reason`).

O que a entrega garante, e de onde vem:

| Garantia | Como |
|---|---|
| Assinatura | HMAC-SHA256 no cabeçalho `X-Webhook-Signature`, cobrindo a hora, o id da entrega e o corpo. Já existia. |
| Retentativa | 3 tentativas por entrega, esperando 1 s e 5 s; depois, o botão Reenviar da atividade. Já existia. |
| Id único | `delivery_id` / `X-Webhook-Delivery`, o mesmo em toda tentativa e no Reenviar. Já existia. |
| Texto inteiro | Mensagem, nota e tarefa saem completas, lidas da linha na hora do envio. Novo. |
| Ordem | `happened_at` é a hora do fato. A entrega não garante ordem de chegada. |
| Organização suspensa | Não envia nada. Já existia; agora tem teste para os eventos novos. |

- **O texto não é copiado para a fila de eventos.** O evento guarda os ids, e a entrega lê o texto da tabela de
  origem. Assim a anonimização de um contato alcança o que ainda não foi entregue.
- **`lead.field_changed` leva antes-e-depois só dos campos de valor e de data.** Título, descrição e campos do funil
  saem pelo nome: o produto não guarda o valor anterior deles em lugar nenhum, de propósito
  (`lib/leads/valores-audit.ts`).
- **Ação que fala com o cliente** (enviar WhatsApp, por exemplo) numa regra destes gatilhos não tem a origem do
  atendimento carimbada pelo banco, como já acontece com `lead.won`, `lead.lost` e `lead.assigned`. Estes gatilhos
  servem ao webhook e às ações internas.

## Passagem entre colegas (agentes nativos)

`passar_para_colega(papel, motivo, resumo)` é ferramenta interna do motor, não do catálogo MCP. Um agente de um número
com roteador passa a vez a outro agente do mesmo roteador.

- **Quem é colega.** Os outros agentes do roteador do número. O `papel` é o nome da intenção do membro
  (`ai_router_members.intent_name`). O motor não conhece papel nenhum pelo nome.
- **Como se liga.** No roteador: `ai_routers.config.passagem_entre_colegas = true`. Nasce desligada e ainda não tem
  botão na tela. A ferramenta não usa a lista de ferramentas do agente (que é validada contra o catálogo MCP) nem
  conta no teto de 27.
- **O que ela faz.** Atualiza a nota "Resumo do atendimento" da ficha do contato (substitui a anterior, não duplica),
  fixa o colega como o agente da conversa e registra a passagem no traço do turno.
- **O colega responde na mesma rodada**, no mesmo job, com o motivo e o resumo na abertura. O cliente não é avisado da
  troca. Quem passou a vez não envia mais nada naquele turno.
- **Até o assunto mudar.** O colega fica na conversa enquanto o roteador classificar o assunto dele ou o assunto de
  quem passou a vez. Uma terceira intenção, com confiança, troca o agente. Vale mesmo com a aderência do roteador
  desligada.
- **Limites.** Uma passagem por rodada (o colega não devolve a vez no mesmo job). Se quem passou já tinha enviado
  mensagem naquele turno, o colega assume na mensagem seguinte. Colega pausado, em modo assistido ou sem versão
  publicada: a ferramenta recusa e nada muda.
- **Agente externo não tem colega no CRM.** A passagem equivalente é `crm_request_human_handoff` mais uma nota com
  `recipient`.

Os papéis da Equipe de IA pronta ainda não usam a passagem nem as ferramentas novas: a liberação vem numa entrega
própria.
