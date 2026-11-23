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
consulta de proposta, fechar e atribuir, passagem entre colegas) e os ajustes que o uso real dos agentes externos pediu
(linha do tempo por MCP, filtros de negócio, autoria no histórico e contatos duplicados). A convivência entre humano e
IA vem na parte 3.

## Regras que valem para todas

- **A organização vem do token**, nunca de um argumento. Nenhuma ferramenta aceita `organization_id`.
- **Nenhuma fala com o cliente.** Tudo o que elas escrevem é lido pela equipe, dentro do CRM.
- **Papel mínimo `agent`**, que é o papel de um token de API sem escopo `role:`. Leitura pede o escopo `mcp:read`;
  escrita pede `mcp:write`. Nenhuma ferramenta desta página pede papel maior: juntar contatos não é feito por
  agente (ver [Contatos duplicados](#contatos-duplicados)).
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
| Não perder o cliente | as duas de anexo, a de próxima ação, a consulta de proposta, a linha do tempo e as três de contatos duplicados |

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

## Linha do tempo do negócio

`crm_list_lead_events` lê o que aconteceu num negócio, ou em todos os negócios de um funil, do mais antigo para o mais
novo. Só leitura (`mcp:read`, papel `agent`). Serve ao resumo do dia ou da semana e a "quem mexeu neste negócio".

| Argumento | O que faz |
|---|---|
| `lead_id` ou `pipeline_id` | Exatamente um. Com `pipeline_id` vêm os negócios do funil, cada linha com `lead_id` e `lead_title`. |
| `since`, `until` | ISO-8601 com fuso. `since` inclui o instante, `until` não. |
| `type` | Lista: `etapa`, `responsavel`, `tag`, `campo`, `nota`, `tarefa`, `outro`. Sem ele, vem tudo. |
| `author` | Lista: `pessoa`, `agente`, `sistema`, `cliente`. Linha com autor `nao_registrado` (a troca de responsável) nunca casa: ver abaixo. |
| `limit`, `cursor` | Até 100 por página. Repita com o `cursor` enquanto `has_more` for `true`. |

Cada linha traz `kind` (a categoria), `type` (o tipo cru), `label`, `happened_at`, `text` (inteiro, sem corte),
`author` (`kind`, `id`, `name`), `details` e `source`.

**De onde vem cada categoria.** Nada novo é gravado: a ferramenta lê duas fontes que já existiam e as devolve numa
ordem só.

| Categoria | Fonte (`source`) | O que traz |
|---|---|---|
| `etapa` | linha do tempo do card (`timeline`) | Entrada no funil, mudança de etapa, correção de movimento da IA, troca de funil, reabertura e encerramento. `details` leva `from_stage_id` e `to_stage_id`. |
| `campo` | `timeline` | Edição do negócio. `details.fields` são os **nomes** dos campos alterados. |
| `nota` | `timeline` | A nota inteira, com o autor e, em `details.recipient`, o destinatário. |
| `tarefa` | `timeline` | Tarefa criada, concluída ou plano aplicado. `details` leva `task_id`, `due_date` e `priority`. |
| `outro` | `timeline` | O resto da linha do tempo: agenda, retorno, proposta, passagem para humano, ligação. |
| `tag` | fila de eventos (`event_log`) | `lead.tag_added` e `lead.tag_removed`, com as tags em `details`. |
| `responsavel` | `event_log` | `lead.assigned`, com de quem para quem (`from_name`, `to_name`: só o nome). |

As tags e o responsável saem da fila de eventos porque a linha do tempo não sustenta os dois: ela registra "Alterou as
tags" sem dizer qual (de propósito), e a tag posta por `crm_manage_tags`, em massa ou por automação não gera linha no
card. Por isso uma edição pela tela que mexe em tag aparece duas vezes, com informações diferentes: uma linha `campo`
(quem editou, quais campos) e uma linha `tag` (qual tag).

**O que não entra, e por quê.**

- **Mensagem.** Mensagem é da conversa, que é do contato: um contato com dois negócios teria as mesmas mensagens nos
  dois. Leia a conversa com `crm_get_conversation_history`.
- **Quem trocou o responsável.** `lead.assigned` nasce de um gatilho do banco e não guarda o autor: sai
  `author.kind: "nao_registrado"`. Quando a troca veio pela edição do negócio, a linha `campo` vizinha tem o autor.
- **Qual pessoa pôs ou tirou a tag.** A fila de eventos guarda que foi uma pessoa, não qual (`id` e `name` nulos). O
  agente por token sai com o nome do token.
- **Remoção de tag antiga.** `lead.tag_removed` existe desde a parte 2; remoção anterior só aparece como "Alterou as
  tags".
- **O valor anterior de um campo.** O produto não guarda o antes de título, descrição, tags e campos do funil
  (`lib/leads/valores-audit.ts`). A linha diz o campo, não o valor.
- **O agente externo como autor de uma mudança de etapa.** A linha do tempo grava a escrita feita por token como
  `sistema` (a linha não guarda o token). A nota é a exceção: ela leva o autor.

**Custo.** A consulta por funil exige `since` e aceita janela de até 31 dias. Ela sempre filtra por tipo e por data,
que são os índices que já existem, e confere por lote quais negócios são do funil. Cada chamada faz no máximo quatro
idas ao banco por fonte: com filtro que descarta muita linha, a página pode vir menor que o limite (até vazia) com
`has_more: true`, e o cursor continua de onde a varredura parou. Negócio de contato marcado como pessoal fica de fora.

**O filtro `author` e o autor `nao_registrado`.** `author` aceita só `pessoa`, `agente`, `sistema` e `cliente`. A
troca de responsável (`lead.assigned`) sai com `author.kind: "nao_registrado"`, que não é um valor do filtro: qualquer
chamada com `author` deixa essas linhas de fora, e não há como pedir só elas por autor. Quem quer as trocas de
responsável pede `type: ["responsavel"]` **sem** `author`. O filtro de autor (como o de funil) é aplicado depois da
busca, dentro do teto de quatro idas ao banco: é o caso em que a página curta ou vazia com `has_more: true` mais
aparece (por exemplo `type: ["responsavel"]` com `author`, que nunca devolve nada). `has_more: true` com página vazia
não é fim: repita com o `cursor` até `has_more: false`. O teto de idas ao banco é o que limita o custo da consulta por
funil e não foi mexido.

## Filtros de `crm_list_leads`

Além de funil, etapa, status, responsável e motivo de perda:

| Filtro | O que faz |
|---|---|
| `created_since` | Criados a partir do instante. |
| `moved_since` | Entraram na etapa **atual** a partir do instante. O negócio recém-criado conta: ele entrou na primeira etapa ao nascer. |
| `last_activity_before` | Sem movimento desde o instante: a última atividade é anterior a ele, ou o negócio nunca teve atividade e foi criado antes dele. |
| `tag` | Só os que têm a tag. |
| `sem_tag` | Só os que não têm a tag. |

- Os instantes são ISO-8601 com fuso.
- "Atividade" é o que o banco carimba em `last_activity_at` do negócio: turno da IA, nota, edição, mudança de etapa,
  próxima ação aprovada, ligação atendida (`fn_update_last_activity_at`) e mensagem enviada por uma pessoa da equipe
  (`fn_mensagem_do_vendedor_e_atividade`). Ligação que ninguém atendeu não conta, e mensagem do cliente que ninguém
  respondeu também não: o negócio continua "parado".
- `tag` e `sem_tag` não diferenciam caixa nas grafias em que uma pessoa escreve o mesmo nome: a pedida, minúsculas,
  MAIÚSCULAS, Inicial maiúscula e Iniciais Maiúsculas. `vip`, `VIP` e `Vip` acham os mesmos negócios, e
  `sem_tag: "vip"` deixa de fora quem tem `VIP`. A tela grava a tag do negócio como foi digitada, e `crm_manage_tags`
  grava em minúsculas. **Limite:** a coluna é uma lista de textos e a consulta compara cada grafia inteira; caixa
  misturada fora dessas formas (`viP`) só casa se pedida exatamente assim. Fechar esse resto pede uma função no banco
  (migration), que este PR não tem.
- Os filtros entram na consulta, antes do limite. O cursor e `has_more` descrevem o conjunto filtrado.
- O responsável continua saindo só pelo nome (`owner_user_name`), sem e-mail nem telefone.

## Quem escreveu cada mensagem do histórico

`crm_get_conversation_history` devolve, em cada mensagem, `author` e `channel` (o canal da conversa: `whatsapp`,
`instagram`...). `direction` e `sent_via` continuam na resposta.

| `author.kind` | Quando | `id` e `name` |
|---|---|---|
| `cliente` | Mensagem recebida. | `id` é o contato. Em grupo, `name` é o participante que falou (`detail: "participante_de_grupo"`). |
| `ia` | Escrita por um agente de IA. | O nome gravado na mensagem ou, sem ele, o do cadastro. `id` só sai quando é de um agente desta organização. |
| `equipe` | Escrita por uma pessoa. | `id` e o nome da pessoa (nunca e-mail nem telefone). |
| `sistema` | Ninguém escreveu na hora. | `detail: "automacao"` (texto fixo de regra, follow-up ou lembrete) ou `detail: "integracao"` (enviada por token de API). |

Dois casos de `equipe` têm `detail`: `celular` (saiu do aparelho ligado ao número, fora do CRM, e a mensagem não diz
quem digitou) e `em_nome_de` (um sistema enviou por decisão daquela pessoa; `via_token` diz qual).

A autoria é lida da própria mensagem, como o balão da caixa de entrada lê. **Limite:** a mensagem enviada por token de
API não guarda o token. Um agente externo distingue com certeza o que foi a equipe, o cliente e a IA do CRM, mas não
separa a própria fala da de outra integração (as duas saem `sistema` / `integracao`).

## Contatos duplicados

| Ferramenta | O que faz | Papel |
|---|---|---|
| `crm_find_duplicate_contacts` | Lista os grupos de contatos que parecem a mesma pessoa. Só leitura. | `agent` |

O agente **acha** duplicados; **juntar é da tela**. A detecção é a da tela de Duplicados
(`lib/contacts/varredura-de-duplicados.ts`). Não existe ferramenta de agente para juntar contatos nem para desfazer
uma junção (ver [Juntar e desfazer](#juntar-e-desfazer-não-são-do-agente)).

### Achar

`crm_find_duplicate_contacts` varre os contatos vivos da organização do token. Contato não pertence a um funil: a
varredura é da base inteira, e cada contato vem com `leads_count`, a soma dos negócios dele em todos os funis.

| Motivo (`reasons`) | Quando |
|---|---|
| `telefone` | O mesmo número, com ou sem o nono dígito. |
| `email` | O mesmo e-mail, sem diferenciar maiúsculas. |
| `telefone_em_conflito` | A entrada de mensagens achou, para um contato, um número que já era de outro. |
| `nome_parecido` | Duas palavras raras em comum, ou um nome inteiro dentro do outro. **É sugestão, não prova.** |

- Argumentos: `reason` (lista, para filtrar), `limit` (até 50) e `offset`. A resposta traz `total_groups` e `has_more`.
- Cada grupo traz `suggested_primary_id`: o contato com atividade mais recente. É sugestão.
- Cada contato traz `id`, `name`, `phone`, `email`, `leads_count`, `created_at` e `last_activity_at`: os campos de
  `crm_search_contacts`. CPF, endereço e o que a entrada de mensagens guardou não saem.
- A varredura alcança os 2.000 contatos mais antigos. Com base maior, `scanned_all` vem `false`.
- Contato marcado como pessoal, contato de grupo de WhatsApp, contato anonimizado e contato já juntado ficam de fora.
  O par que alguém dispensou na tela ("não são a mesma empresa") também.
- Contato de outra organização nunca entra, nem quando o telefone e o e-mail são os mesmos.
- **Num turno de atendimento a ferramenta recusa** (`fora_do_atendimento`): a lista traz telefone e e-mail de outras
  pessoas, e a conversa é com uma só. Ela serve ao agente externo e à limpeza da base.

### Juntar e desfazer não são do agente

`crm_merge_contacts` e `crm_undo_contact_merge` existiram no PR AJ-3 e **foram retiradas** do servidor MCP, do
catálogo e dos pacotes antes do merge (revisão de 20/11, item 1.2, Opção A, decidida pelo dono em 23/11). A tarefa só
previa a junção por agente com autorização do dono, e o servidor MCP não aplica a marca "operada por pessoa" do
catálogo: bastava um token de API marcado como "tratado como gerente" com escopo de escrita para unir contatos.

Juntar contatos continua sendo um gesto da tela de Duplicados (`POST /api/v1/contacts/merge`, papel `manager`, sessão
de usuário), auditado como `contact.merged`. **A junção pela tela não guarda registro e não tem desfazer.**

**O que ficou no banco, sem porta.** A migration 9813 não foi revertida: a tabela `fusoes_de_contatos` e as funções
`fn_colunas_que_apontam_para_contato`, `fn_mesclar_contatos_com_registro` e `fn_desfazer_fusao_de_contatos` continuam
instaladas, executáveis só por `service_role`. Nenhum caminho do produto as chama hoje. Os envoltórios em
`lib/contacts/fusao-de-contatos.ts` (`mesclarContatosComRegistro`, `desfazerFusaoDeContatos`, `registroAbertoDaFusao`)
ficaram para a tela poder passar a gravar registro. A ação de auditoria `contact.merge_undone` existe no vocabulário e
não tem emissor.

**As duas funções de junção não recusam as mesmas coisas.** Vale conhecer a diferença antes de ligar a função com
registro a qualquer porta:

| Caso | `fn_mesclar_contatos` (a tela, hoje) | `fn_mesclar_contatos_com_registro` (sem porta) |
|---|---|---|
| Contato anonimizado, nas duas posições | recusa (`contato_principal_indisponivel` / `contato_secundario_indisponivel`) | recusa (as mesmas) |
| Contato já juntado em outro | recusa (as mesmas) | recusa (as mesmas) |
| Contato marcado como **pessoal** | **não recusa** | recusa (`fusao_de_contato_pessoal`) |
| Contato de **grupo** de WhatsApp (`kind` diferente de `person`) | **não recusa** | recusa (`fusao_de_contato_de_grupo`) |
| Papel de quem chama | confere gerente dentro da função (`insufficient_role`), com a sessão do usuário | não confere papel: é só de `service_role`, e quem chama responde por isso |
| Pares por chamada | um principal e vários secundários | um par |

A tela de Duplicados também não esconde contato pessoal nem contato de grupo da lista (o recorte `soDaOperacao` da
varredura é só da leitura por agente). Então um gerente consegue, pela tela, juntar um contato pessoal ou um contato
de grupo com outro. A regra não foi unificada no banco neste PR (a migration 9822, reservada para isso, não foi
usada): a porta que recusava saiu, e mudar o que a tela aceita é decisão de produto fora do item.

O desfazer (`fn_desfazer_fusao_de_contatos`) só desfaz junção que tem registro em `fusoes_de_contatos`, recusa quando
um dos dois contatos foi anonimizado depois (`fusao_de_contato_anonimizado`) e quando outro contato passou a usar o
telefone, o e-mail ou a identidade de canal do absorvido (`conflito_ao_desfazer_fusao`). As etiquetas não voltam: o
registro guarda ids e nomes de campo, nunca telefone, e-mail ou etiqueta.

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
