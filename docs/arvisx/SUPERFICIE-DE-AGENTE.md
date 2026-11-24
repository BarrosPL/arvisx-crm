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

Este documento cobre a parte 1 (tarefas, notas, anexos e próxima ação), a parte 2 (eventos para sistemas externos,
consulta de proposta, fechar e atribuir, passagem entre colegas) e a parte 3 (convivência entre pessoa e IA, e o
filtro de entrada).

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
  `crm_add_lead_note` e `crm_attach_to_lead`: a mesma chave não grava duas vezes, por 24 horas. A mesma chave
  com outros dados é recusada (`chave_de_idempotencia_em_conflito`). Recusa não vira recibo.
- **Sem o cabeçalho, a chave sai do conteúdo.** Nessas três ferramentas, o mesmo pedido (mesmos argumentos), do
  mesmo autor (token, agente e, no turno, o contato atendido), repetido em até **10 minutos**, devolve o resultado
  do primeiro com `idempotent_replay: true` e `idempotent_replay_reason`, e nada é criado de novo. É o que cobre
  o agente que repete depois de um timeout e o replay do mesmo turno do agente nativo, que não manda cabeçalho.
  Passada a janela, o mesmo pedido cria de novo. Para criar dois iguais em seguida de propósito, mande uma
  `Idempotency-Key` nova em cada pedido.
- **A descrição da tarefa, o resultado, o texto da nota e o nome do arquivo não vão para a auditoria.** A linha
  de auditoria guarda o tamanho (`[123 caracteres]`, e a extensão no caso do arquivo). O conteúdo fica no próprio
  registro, onde vale a proteção do resto do cadastro.

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
- `lead_id` e `contact_id` juntos têm de ser da mesma pessoa. Negócio de um contato com o `contact_id` de outro é
  recusado (`negocio_de_outro_contato`); só com `lead_id`, a tarefa herda o contato do negócio.
- `crm_complete_task` decide no banco: a gravação só acontece se a tarefa ainda estiver aberta. Duas conclusões
  ao mesmo tempo gravam uma vez (um `result`, uma linha de auditoria, uma linha na linha do tempo), e a que chega
  junto com um cancelamento não conclui por cima dele (`tarefa_cancelada`).
- Num turno de atendimento, `crm_complete_task` e `crm_update_task` só alcançam tarefa do cliente da conversa (pelo
  contato dela ou por um negócio dele); a conferência é feita na ponte do turno e de novo no handler.

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
- **O tamanho é conferido antes de baixar.** Para a mídia de uma mensagem ele vem da linha dela; para a URL
  assinada (e quando a linha não diz) o CRM pergunta só os metadados ao Storage. Sem resposta, a chamada é
  recusada (`arquivo_indisponivel`) e nada é baixado. O que chega é medido de novo antes de ser gravado.
- **A extensão do nome também é conferida**, na ferramenta e na tela: só `.pdf`, `.png`, `.jpg`, `.jpeg`, `.jfif`
  e `.webp`. `foo.exe` declarado como PDF é recusado (`extensao_de_arquivo_nao_aceita`). Nome sem extensão segue
  aceito.
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
- **Não fecha conversa que uma pessoa assumiu.** Com atendente humano responsável (`assigned_to_user_id`
  preenchido), a ferramenta recusa com `conversa_com_humano`, diz ao agente que uma pessoa está com a conversa, e
  não escreve nem audita nada. Vale para todo ator desta porta, de qualquer papel: token comum, de gerente, de
  administrador e agente nativo. Quem chama a ferramenta é um agente, e o papel do token não o torna a pessoa que
  assumiu. Conversa assumida é fechada por uma pessoa, pela tela, onde vale a régua `exigirControleDaConversa`.
  Conversa sem responsável humano continua podendo ser fechada. Decisão do dono em 23/11/2026, que troca a de
  20/11 registrada no PR #14. Limite conhecido: a conferência é feita na leitura, e assumir a conversa não muda a
  revisão do atendimento; se uma pessoa assumir no instante entre a leitura e o fechamento, ele ainda passa.
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
- **A passagem vale inteira ou não vale.** O colega é conferido antes de qualquer gravação; o resumo e a troca do
  agente da conversa são gravados na mesma transação.
- **Se o colega deixar de atender entre a passagem e a resposta** (foi pausado, mudou para o modo assistido ou perdeu
  a versão publicada nesse intervalo), a passagem é desfeita: a conversa volta para quem passou, que responde ao
  cliente na mesma rodada, avisado do que houve e sem poder passar a vez de novo. Ele responde com o que souber ou
  chama a equipe (`request_human_handoff`). O cliente não fica sem resposta e a conversa não fica presa num agente
  parado.
- **Agente externo não tem colega no CRM.** A passagem equivalente é `crm_request_human_handoff` mais uma nota com
  `recipient`.

Os papéis da Equipe de IA pronta ainda não usam a passagem nem as ferramentas novas: a liberação vem numa entrega
própria.

## Convivência entre pessoa e IA

Quando uma pessoa da equipe assume ou responde uma conversa, a IA não responde por cima. Isto já valia para o agente
nativo antes desta entrega. O que a parte 3 acrescenta é o agente **externo** ficar sabendo, e um prazo que faltava
ser da empresa.

### O que já existia

| O quê | Onde |
|---|---|
| Assumir a conversa pausa a IA sem prazo | `fn_conversation_assign` grava `bot_silenced_until = 'infinity'` |
| Pausar pela tela, sem trocar o dono | `POST /api/v1/conversations/[id]/pause-ai` |
| Responder pela tela pausa por um prazo curto, renovado a cada resposta | `app/api/v1/messages/_handler.ts` |
| Responder pelo celular pausa por um prazo da empresa (padrão 60 min) | `lib/escalacao/atendimento-manual.ts`, `routing.manual_reply_silence_minutes` |
| "A conversa fica com quem atendeu": responder pela tela assume a conversa | `routing.conversation_stays_with_attendant` |
| O motor não responde conversa pausada nem conversa com dono humano | `lib/ai/elegibilidade/gate.ts`, lido no drain e no começo de todo turno |
| Assumir no meio de um turno interrompe o turno | gatilho `trg_interromper_turnos_ao_assumir` |
| A IA só volta por comando: "Devolver ao automático" ou `#on` pelo celular | `lib/escalacao/retomada.ts` |
| Ou depois de um prazo da empresa sem sinal de pessoa (padrão: nunca) | `routing.handoff_return_after_minutes`, cron `handoff-devolucao` |

Os prazos ficam em Configurações › Atendimento. O padrão do produto é conservador: depois que alguém assume, a IA não
volta sozinha.

### O que esta entrega acrescenta

- **O estado por MCP.** `crm_get_conversation` devolve o bloco `ai`.
- **Dois eventos** para o agente externo obedecer: `conversation.ai_paused` e `conversation.ai_resumed`.
- **O prazo da resposta pela tela passa a ser da empresa** (`routing.screen_reply_silence_minutes`). Era fixo em
  5 minutos no código. O padrão continua 5; a faixa é de 5 minutos a 24 horas.
- **A trava vale para o colega.** Na passagem entre colegas, se uma pessoa assume entre o turno de quem passou a vez e
  a resposta do colega, o colega não responde.

### O bloco `ai` de `crm_get_conversation`

| Campo | O que diz |
|---|---|
| `paused` | A IA não responde esta conversa agora, por causa de uma pessoa ou de uma trava. |
| `human_in_command` | Uma pessoa é a dona da conversa. |
| `reason` | Por quê (lista abaixo). `null` quando não está pausada. |
| `since` | Desde quando. `null` quando o banco não guardou a hora. |
| `by` | Quem assumiu: `user_id` e `name`. Só em `human_assigned`. |
| `until` | Quando a pausa acaba sozinha. `null` = não tem prazo. |
| `resumes_automatically` | `true` = volta sozinha em `until`. `false` = só por comando, ou pelo prazo de devolução da empresa. |
| `detail` | O motivo escrito na conversa, quando há. |

`reason`:

| Valor | Quando |
|---|---|
| `human_assigned` | uma pessoa assumiu a conversa |
| `human_replied` | uma pessoa respondeu sem assumir; a pausa tem prazo |
| `human_replied_outside_crm` | uma pessoa respondeu pelo celular e a pausa não tem prazo |
| `handed_to_team` | pausada sem dono: o agente passou o caso para a equipe |
| `contact_locked` | a passagem para humano travou o contato inteiro e ninguém assumiu ainda |
| `contact_always_human` | o contato é marcado como sempre atendimento humano |
| `contact_opted_out` | o contato pediu para não receber mensagens |

Um agente externo que vai responder um cliente lê `ai.paused` antes. Com `true`, não responde.

Conversa de grupo e conversa encerrada vêm com `paused: false`: ali a IA não atende por outra razão, e devolver ao
automático não mudaria nada.

### Os eventos `conversation.ai_paused` e `conversation.ai_resumed`

São gatilhos de automação como os outros: uma regra com a ação "Avisar outro sistema (webhook)". O corpo está em
[`docs/integracao/webhooks-de-saida.md`](../integracao/webhooks-de-saida.md).

- **Nascem no banco**, de um gatilho em `conversations` (migration 9811), e não na aplicação. A pausa tem mais de uma
  dúzia de caminhos (assumir, pausar, responder, o agente passar o caso, o rodízio entregar), e um deles é o próprio
  banco. O gatilho olha o estado da linha, então vale para todos.
- **`ai_paused` sai de novo quando o prazo ou o dono muda**, com `renewed: true`. Cada resposta de uma pessoa renova o
  prazo, e o prazo anterior deixa de valer.
- **Pausa com prazo que vence não gera `ai_resumed`**: ninguém escreve na conversa quando o tempo passa. O
  `paused_until` do último `ai_paused` é a hora da volta. `ai_resumed` sai quando alguém devolve a conversa.
- **Como o agente externo calcula se pode falar** (revisão de 20/11, item 2.30). Os dois pontos acima querem dizer
  que contar eventos não funciona: chegam vários `ai_paused` para uma pausa só, e a volta por prazo não tem evento.
  A conta certa, por conversa:
  1. guarde só o `ai_paused` mais recente (o de maior `happened_at`). Um `ai_paused` com `renewed: true` não é
     pausa nova: ele SUBSTITUI o prazo anterior;
  2. o agente externo fica calado enquanto esse evento valer. Ele deixa de valer quando chega um `ai_resumed`
     posterior, ou quando `paused_until` não é nulo e já passou;
  3. `paused_until: null` (`durable: true`) não vence: só um `ai_resumed` libera;
  4. não espere um `ai_resumed` para liberar uma pausa com prazo: ele não vem. Compare o relógio com `paused_until`;
  5. na dúvida (evento perdido, reinício do agente), pergunte: `crm_get_conversation` devolve o bloco `ai`, com
     `paused`, `until` e `resumes_automatically`, que é sempre o estado do momento.
- **O evento reflete a conversa.** As travas do contato (`contact_locked`, `contact_always_human`,
  `contact_opted_out`) aparecem no bloco `ai`, lido na hora da entrega, e não geram evento próprio.
- **Regra destes gatilhos não pode atribuir responsável nem definir setor**: a troca de dono gravaria outro
  `ai_paused`, e duas regras se realimentariam.

## Filtro de entrada

Ofensa, spam e assunto claramente fora do que a empresa atende podem ser tratados por regra, antes de qualquer modelo.
A mensagem barrada não gasta token: nem o roteador, que escolhe o agente, é consultado.

- **As listas são da empresa.** O produto não traz palavra nenhuma. Sem lista configurada, o filtro não existe.
- **Três categorias**, só para organizar as listas e nomear o bloqueio: `offense`, `spam` e `out_of_scope`.
- **Cada categoria escolhe a ação**: `reply` envia uma resposta curta escrita pela empresa; `silence` não envia nada.
  Nos dois casos, `tag` grava um marcador na conversa.
- **A resposta curta passa pelas mesmas travas de todo envio** (opt-out, LGPD, janela de envio, ritmo do número) e
  não se repete: se a última mensagem que saiu na conversa já é esse texto, o filtro fica em silêncio.
- **Só barra quando todas as mensagens pendentes do cliente casam uma regra.** Uma mensagem legítima no meio basta
  para o agente responder. Mensagem sem texto (áudio, imagem) nunca é barrada.
- **Pedido de pessoa e pedido para parar passam direto**, mesmo com um termo da lista: quem os trata são as regras
  fixas do produto, que chamam a equipe.
- **Conversa assumida por uma pessoa nem chega ao filtro.**
- **A conversa não muda de dono nem de estado.** A mensagem continua na caixa de entrada.
- **Fica no traço do turno** (`agent_turn_traces`): `abort_reason = filtro_de_entrada` e uma entrada
  `filtro_de_entrada` com a categoria, a ação, se a resposta saiu, o marcador e o termo da lista que casou. A fala do
  cliente não entra no traço.

Como casa: sem diferença de maiúsculas. `match: "contains"` (o padrão) casa o termo como palavra ou expressão inteira
dentro da mensagem: o termo "sala" não casa "salada". `match: "whole_message"` exige que a mensagem inteira seja o
termo.

### Onde uma lista de palavras erra, e o que o filtro faz

Uma lista não entende contexto. A regra é a palavra inteira, e nos casos abaixo ela erra para o lado de RESPONDER
(barrar de menos custa uma chamada de modelo; barrar de mais cala um cliente). Decisões da revisão de 20/11, item 2.29:

- **O acento distingue.** "para" e "Pará", "coco" e "cocô" são palavras diferentes: o termo casa como a empresa o
  escreveu, e não a palavra que só se parece com ele. O custo é conhecido: o cliente que digita sem acento não casa
  um termo escrito com acento. Quem quer barrar as duas grafias põe as duas na lista.
- **Nome próprio não casa.** Palavra com inicial maiúscula no meio da frase ("falei com a Dra. Pinto", "sou o João
  Pinto") é nome de gente ou de lugar. Em começo de frase, ou em caixa alta, a caixa não diz nada e o termo casa.
  Limite conhecido: nome escrito todo em minúsculas não tem como ser reconhecido.
- **Termo dentro de outra palavra não casa** ("pinto" não casa "pintor"). Plural também é outra palavra: se quiser
  barrar os dois, liste os dois.
- **Ofensa junto de um pedido legítimo vai para o agente.** Em `contains`, a regra só barra a mensagem que é pouco
  mais que o termo: até `max_extra_words` palavras além dos termos da lista (padrão 3). "Vocês são uma porcaria" é
  barrada; "o atendimento foi uma porcaria, preciso do pedido 123" tem um pedido dentro e segue para o agente
  responder. A empresa pode mudar o teto por categoria: `0` barra só o termo sozinho, `null` tira o limite (barra a
  mensagem de qualquer tamanho que contenha o termo — serve para frase de spam, que costuma vir no meio de um texto
  longo, e traz de volta o risco de calar uma reclamação).
- **A resposta automática respeita o modo assistido.** Num número que tem agente publicado em modo assistido (a mesma
  pergunta que o motor faz antes de enfileirar o turno), regra com `action: "reply"` não decide: nada é enviado
  sozinho, a conversa não é marcada, e o turno segue para o agente assistido propor a resposta que uma pessoa aprova.
  Regra `silence` barra igual nos dois modos. Se o modo do número não puder ser lido, a resposta automática não sai.
- **A rota avisa.** `GET` e `PATCH /api/v1/settings/routing` devolvem `entry_filter_warnings`, uma lista de
  `{ code, message }` no idioma de quem está logado: `falso_positivo` (sempre que o filtro está ligado e tem termo),
  `termo_curto` (há termo de uma palavra só, com até 5 letras), `sem_limite_de_palavras` (há regra `contains` com
  `max_extra_words: null`) e `resposta_e_modo_assistido` (há regra que responde sozinha).

### Como configurar

Ainda não há tela. A configuração mora em `organizations.settings.ai_entry_filter` e é lida e gravada pela rota de
atendimento, com sessão de gerente ou administrador:

```
PATCH /api/v1/settings/routing
{
  "mode": "manual",
  "entry_filter": {
    "enabled": true,
    "rules": {
      "offense":      { "terms": ["..."], "action": "reply", "reply": "Vamos manter o respeito.", "tag": "ofensa" },
      "spam":         { "terms": ["..."], "action": "silence", "tag": "spam" },
      "out_of_scope": { "terms": ["..."], "match": "whole_message", "action": "silence" }
    }
  }
}
```

- `mode` é obrigatório na rota (é o modo de distribuição que já vale; `GET` na mesma rota o devolve).
- `entry_filter` omitido preserva o filtro que já valia. Quando vem, substitui o filtro inteiro.
- Tetos: 200 termos por categoria, 2 a 80 caracteres por termo, 500 caracteres na resposta, 40 no marcador.
- `max_extra_words` (por categoria, opcional): inteiro de 0 a 200, ou `null`. Padrão 3. Só vale para `contains`.
- A resposta traz `entry_filter_warnings`: leia antes de ligar o filtro em produção.
- O prazo da resposta pela tela vai na mesma rota: `"screen_reply_silence_minutes": 30` (`null` volta ao padrão de 5).

O filtro vale para todo agente nativo da empresa, automático ou assistido, e só para mensagem recebida — com a
exceção acima: em número com agente assistido, a regra que responde sozinha não decide. Agente externo não passa por
ele: quem decide o que o agente externo responde é o sistema dele.
