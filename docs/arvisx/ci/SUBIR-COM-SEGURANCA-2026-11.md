# Subir com segurança: migrations 9809 a 9820 (PRs #12 a #24)

Data da leitura: 24/11/2026. Base de comparação: `origin/main` em `f48146edb`.
Tudo aqui foi LIDO com `git show` e `git ls-tree`. Nada foi executado: nenhum SQL, teste, build ou banco.
Os números de linha das migrations são do próprio arquivo, na ponta indicada. "baseline da main" é `supabase/baseline.sql` em `origin/main`.

## Tabela-resumo

| Migration | PR (ponta) | Só aditiva? | Muda o banco para o app antigo? | Reversível só com a imagem? | Lock | Depende de |
|---|---|---|---|---|---|---|
| 9809 tarefa tipo e resultado | #13 | Sim | Não | Sim | `ALTER` curto em `crm_tasks`, mais varredura para validar 2 CHECKs | nada |
| 9810 comentários do Instagram | #12 | Sim | Não (ressalva: FK `restrict` no canal) | Sim | Só tabela nova | nada |
| 9811 pausa da IA vira evento | #20 | Não (gatilho em `conversations`) | Sim: toda pausa ou posse grava linha em `event_log` | Sim, com ressalva (os eventos continuam nascendo) | `CREATE TRIGGER` curto em `conversations` | nada |
| 9812 comentários: contato e LGPD | #16 | Não (gatilho em `contacts`) | Sim: anonimizar e juntar contato passam a tocar `social_comments` | Sim | `CREATE TRIGGER` e FK curtos em `contacts` | 9810 |
| 9813 registro da fusão | #21 | Sim | Quase não (ressalva: a junção da tela reponta os registros) | Sim | Só tabela nova, FKs curtas | nada |
| 9814 aprovação da proposta | #22 | Não (função substituída) | Não (mesma assinatura, mesmo efeito para o app antigo) | Sim | `ALTER` curto em `crm_proposals`, mais varredura do CHECK | nada |
| 9815 edição invalida a aprovação | #22 | Não (2 gatilhos) | **Sim: o editor de proposta antigo passa a receber 409** | **NÃO** | `CREATE TRIGGER` curto em 2 tabelas | 9814 |
| 9816 LGPD pela identidade social | #16 | Não (função substituída) | Sim, só na anonimização (redige mais linhas) | Sim | `CREATE TRIGGER` curto em `contacts` | 9812 (e 9810) |
| 9817 seguimento do ganho único | #24 | Não (UPDATE e índice único) | Não | Sim | **Índice único sem CONCURRENTLY em `crm_tasks`** | 9809 |
| 9818 nota única por chave | #13 | Não (UPDATE e índice único) | Não | Sim | **Índice único sem CONCURRENTLY em `crm_lead_activities`** (o mais pesado do lote) | nada |
| 9819 comentários só para gerente | #12 | Não (policy trocada, mais restrita) | Não | Sim | `ACCESS EXCLUSIVE` curto em `social_comments` | 9810 |
| 9820 preencher campo personalizado | #22 | Sim | Não | Sim | Nenhum | nada |
| 9824 agente não fecha conversa assumida (Tarefa 6.1, PR à parte) | Tarefa 6.1 | Não (função `fn_service_status` trocada: `drop` da de 4 argumentos e `create` da de 5) | Não (o app antigo manda 4 argumentos nomeados e cai no default `'pessoa'`) | Sim. O contrário é que pede atenção: imagem NOVA com banco SEM a 9824 deixa o agente sem fechar conversa nenhuma (falha fechada) | Só catálogo, por instantes. Nenhuma tabela varrida nem reescrita | nada |

Única migration que NÃO volta só com a imagem: **9815**. Se a imagem do app voltar com ela aplicada, é preciso rodar a reversão da seção 6.2.

## Como a produção aplica (lido em `deploy/arvisx/crm/init.sh`, `origin/main`)

O `init.sh` é idêntico à main em todas as 13 pontas. O serviço `init` roda em `postgres:17-alpine` a cada deploy (`deploy/arvisx/crm/docker-compose.easypanel.yml`, linhas 10 a 31).

1. Ele espera o banco responder (linhas 7 a 12).
2. Se `public.organizations` já existe, ele pula o baseline (linhas 14 e 15). Em banco novo, cria as extensões e aplica `/baseline.sql` (linhas 17 a 21).
3. Ele cria `public.arvisx_migracoes_aplicadas (nome, aplicada_em)` se faltar (linhas 26 e 27).
4. Ele lê `/migracoes-pos-baseline.txt` linha a linha e junta as que não estão registradas (linhas 28 a 33). Em banco novo a tabela nasce vazia, então TODAS as migrations da lista rodam por cima do baseline. Por isso cada uma precisa ser reaplicável.
5. Se há pendentes, ele faz `pg_dump -Fc` em `/backup/antes-migracoes-<data>.dump` (volume `crm-backups`, linhas 35 a 39).
6. Cada pendente roda com `psql -v ON_ERROR_STOP=1 -q -1 -f` (linha 42). O `-1` põe o arquivo inteiro numa transação. Só depois do sucesso o nome é registrado (linha 43), num comando separado.
7. Na primeira falha ele para o laço (linha 45) e **segue o script**. O deploy não é derrubado.
8. Se o `pg_dump` falhar, nenhuma migration roda e o script também segue (linhas 49 e 50).
9. Depois ele chama `fn_aplicar_trava_de_org_suspensa()` (linhas 59 a 65), semeia chaves e cria o admin.

Consequências exatas para este lote:

- A ordem é a da LISTA, não a do timestamp nem a do número.
- `CREATE INDEX CONCURRENTLY` é impossível com `-1`. As 12 migrations não usam CONCURRENTLY (conferi por grep).
- Falha de migration ou de backup NÃO impede o app novo de subir. O app novo sobe em schema antigo ou parcial. Leia o log do `init` antes de liberar o tráfego.
- O registro (linha 43) é um segundo comando. Se ele falhar depois do sucesso da migration, ela roda de novo no próximo deploy. As 12 se declaram idempotentes.
- A lista e a pasta de migrations vêm do checkout do repositório (volumes do compose), não da imagem do app. Voltar `APP_IMAGE` não muda a lista.
- A trava de org suspensa (passo 9) não cria policy em `social_comments` nem em `fusoes_de_contatos`: nenhuma das duas tem policy permissiva de escrita (baseline da main, linhas 69540 a 69611).

## Conferências pedidas

- **Os 12 números existem.** 9811 mora em `superficie-agente/pr-3-convivencia-e-filtro` (#20). Ele NÃO está em `pr-2-eventos-e-passagem` (#15).
- **Colisão de número:** nenhuma entre as 12, nenhuma com a main.
- **Colisão de timestamp: SIM.** `20261120150000_9810_comentarios_do_instagram.sql` (#12) e `20261120150000_9811_ia_pausada_e_retomada_viram_evento.sql` (#20) têm o mesmo timestamp. A main hoje não tem timestamp repetido. O `init.sh` não usa timestamp, então a produção não quebra por isso. O vigia do repositório (`scripts/vigia-colisao-de-migration.ts`, linha 74) trata timestamp igual como colisão. O segundo dos dois PRs a entrar na main deve ser reprovado ou avisado. Se o `ci.yml` chama o `checar-colisao-de-migration.sh`, não verifiquei.
- **Linha `-- manifest:`:** as 12 têm, na linha 1.
- **Lista e apêndice do baseline da própria ponta:** as 12 aparecem nos dois, na ponta de origem (grep por `(migration NNNN)`).
- **Blobs iguais entre pontas:** 9809 e 9818 são o mesmo blob nas 6 pontas que os carregam; 9810 e 9819 idem nas 2; 9814, 9815 e 9820 idem nas 2.
- **Nenhuma ponta tem as 12.** São três pilhas: #13 > #15 > (#20, #19 > #21 > #23, #22 > #24) e #13 > #14 > #17; #12 > #16 > #18. A lista final só existe depois dos merges.
- **Conflito de merge certo:** toda ponta acrescenta a partir da linha 67 de `migracoes-pos-baseline.txt`, e cinco pontas abrem bloco na linha 69687 do `baseline.sql`. A ordem final será resolvida à mão.
- **Ordem na lista de cada ponta:** todas respeitam as dependências. Em `equipe-pronta-v2/pr-b-gatilhos` a 9820 (linha 70) vem antes da 9817 (linha 71), fora da ordem de timestamp. Isso não quebra nada: uma não depende da outra.

### Ordem obrigatória na lista final

- 9809 antes de 9817 (a 9817 lê e grava `crm_tasks.kind`).
- 9810 antes de 9812, 9812 antes de 9816.
- 9810 antes de 9819.
- 9814 antes de 9815 (a função da 9815 usa `new.aprovada_em` e `new.aprovada_na_revisao`).
- Em banco NOVO a ordem também decide o estado final, porque a lista inteira roda depois do baseline: se a 9810 rodar depois da 9819, a policy aberta volta; se a 9812 rodar depois da 9816, o corpo antigo da função volta.

Sugestão que cumpre tudo: 9809, 9810, 9811, 9812, 9813, 9814, 9815, 9816, 9817, 9818, 9819, 9820.

A 9824 (Tarefa 6.1) não depende de nenhuma das doze e nenhuma depende dela. Ela vai no fim da lista, depois da 9820 (é onde está em `deploy/arvisx/crm/migracoes-pos-baseline.txt` no branch da Tarefa 6.1).

## 6.1 Uma por uma

"App antigo" é a imagem da main `f48146edb`. "Voltar só a imagem" é reimplantar essa imagem sem desfazer migration.

### 9809 `20261120120000_9809_tarefa_tipo_e_resultado.sql` (PR #13)

- Colunas novas em `crm_tasks`: `kind text` e `result text`, nulas, sem default (linhas 39 a 43).
- Constraints novas: `crm_tasks_kind_tamanho` (linhas 52 a 54) e `crm_tasks_result_tamanho` (linhas 62 a 64).
- Dois comentários de coluna e `notify pgrst`.
- **Só aditiva: sim.** Os CHECKs só olham as colunas novas e aceitam nulo.
- **Voltar só a imagem:** nada acontece. O app antigo não grava essas colunas (a tabela da main, baseline linha 18481, não as tem).
- **Lock:** `ADD COLUMN` sem default não reescreve a tabela. `ADD CONSTRAINT CHECK` valida a tabela inteira sob `ACCESS EXCLUSIVE`. O tamanho de `crm_tasks` em produção, não verifiquei.
- **Dependência:** nenhuma. A 9817 depende dela.

### 9810 `20261120150000_9810_comentarios_do_instagram.sql` (PR #12)

- Tabela nova `social_comments` (linhas 64 a 85), com FK para `organizations` (`cascade`) e `channel_sessions` (`restrict`), CHECK de `estado` e único `(organization_id, comment_id)`.
- Índices: `social_comments_org_estado_quando_idx`, `social_comments_canal_quando_idx`, `social_comments_poda_idx` (linhas 91 a 100).
- Trigger `trg_social_comments_updated_at` (linhas 102 a 105). A função `fn_set_updated_at` existe na main (baseline linha 744).
- RLS ligada; policy `tenant_isolation_social_comments_select` aberta a todo membro (linhas 107 a 113).
- Grants: revoga tudo de `anon` e `authenticated`; `select` para `authenticated`; tudo para `service_role` (linhas 118 a 120).
- **Só aditiva: sim.**
- **Voltar só a imagem:** o app antigo não cita `social_comments` (0 ocorrências em `lib` e `app` da main). Ressalva: comentários gravados enquanto o app novo esteve no ar seguram o canal, porque a FK é `on delete restrict`. Apagar de verdade uma linha de `channel_sessions` com comentário falharia com 23503. Se o app antigo apaga canal com DELETE, não verifiquei.
- **Lock:** só a tabela nova, mais trava curta nas duas tabelas referenciadas ao criar as FKs.
- **Dependência:** nenhuma. 9812, 9816 e 9819 dependem dela.

### 9811 `20261120150000_9811_ia_pausada_e_retomada_viram_evento.sql` (PR #20)

- Função nova `fn_anunciar_pausa_da_ia()`, `security definer` (linhas 64 a 126). EXECUTE revogado de todos (linha 131).
- Trigger novo `trg_anunciar_pausa_da_ia`, AFTER UPDATE em `conversations`, quando muda `bot_silenced_until`, `assignee_kind` ou `assigned_to_user_id` (linhas 133 a 142).
- Nenhuma tabela, coluna, policy ou grant de tabela.
- **Só aditiva: não.** Um gatilho novo numa tabela que o app antigo escreve muda o comportamento do banco.
- **Voltar só a imagem:** cada pausa, posse ou devolução feita pelo app antigo continua gravando uma linha `conversation.ai_paused` ou `conversation.ai_resumed` em `event_log`. O nome passa no CHECK `event_type_format` (baseline linha 1568). O motor antigo procura regras por `trigger_event` (`lib/automation/engine.ts`, linhas 517 a 525) e responde `no_rules` quando não há regra. Erro ao gravar o evento é engolido (linhas 118 a 122 da migration), então a escrita da conversa não cai. Se alguém criou regra de automação com esse gatilho enquanto o app novo esteve no ar, o motor antigo também a executaria; não verifiquei esse caminho.
- **Reversível só com a imagem:** sim, com a ressalva de que `event_log` segue recebendo essas linhas.
- **Lock:** `CREATE TRIGGER` pede `SHARE ROW EXCLUSIVE` em `conversations`, curto. Ele espera transações abertas na tabela.
- **Dependência:** nenhuma entre as 12.

### 9812 `20261120171200_9812_comentarios_resposta_e_contato.sql` (PR #16)

- Colunas novas em `social_comments`: `contact_id uuid` (FK `contacts`, `on delete set null`), `ignore_reason text`, `hidden jsonb` (linhas 49 a 52).
- Índices: `social_comments_org_quando_idx` e `social_comments_contato_idx` (linhas 62 a 68).
- Função nova `fn_redigir_comentarios_ao_anonimizar()`, `security definer` (linhas 70 a 103); EXECUTE só para `service_role` (linhas 105 e 106).
- Trigger novo `trg_redigir_comentarios_ao_anonimizar`, AFTER UPDATE OF `is_anonymized` em `contacts` (linhas 108 a 113).
- **Só aditiva: não.** Há gatilho novo em `contacts`.
- **Voltar só a imagem:** duas mudanças de banco continuam valendo. Primeira: anonimizar um contato pelo app antigo redige os comentários ligados a ele. Segunda: `fn_mesclar_contatos` da main reponta por catálogo toda FK para `contacts.id` (última definição, baseline linha 66173; consulta ao `pg_constraint` na linha 66317), então a junção da tela passa a repontar `social_comments.contact_id`. As duas são o comportamento desejado.
- **Reversível só com a imagem:** sim.
- **Lock:** `ALTER` em `social_comments` (tabela nova e pequena). A FK e o `CREATE TRIGGER` pedem trava curta em `contacts`.
- **Dependência:** 9810.

### 9813 `20261120170000_9813_registro_da_fusao_de_contatos.sql` (PR #21)

- Tabela nova `fusoes_de_contatos` (linhas 58 a 70), com FKs para `organizations`, `contacts` (duas, `cascade`) e `api_tokens` (duas, `set null`).
- Índices `idx_fusoes_de_contatos_org_absorvido` e `idx_fusoes_de_contatos_org_principal` (linhas 75 a 78).
- RLS ligada sem policy (linha 80). Grants: nada para `public`, `anon`, `authenticated`; `select, insert, update` para `service_role` (linhas 82 e 83).
- Funções novas, todas `security definer` e só do `service_role`: `fn_colunas_que_apontam_para_contato()` (linhas 85 a 125), `fn_mesclar_contatos_com_registro(uuid, uuid, uuid, uuid)` (linhas 133 a 365), `fn_desfazer_fusao_de_contatos(uuid, uuid, uuid)` (linhas 373 a 711).
- `fn_mesclar_contatos` NÃO é substituída. As três funções novas não existem na main.
- **Só aditiva: sim.**
- **Voltar só a imagem:** o app antigo não chama nada disso. Ressalva: como a tabela tem FK para `contacts`, a junção feita pela tela (qualquer imagem) reponta `contato_principal_id` e `contato_absorvido_id` dos registros que apontam para a ficha absorvida. A função de desfazer já prevê esse caso (linhas 449 a 452).
- **Lock:** só a tabela nova; trava curta em `contacts`, `organizations` e `api_tokens` ao criar as FKs.
- **Dependência:** nenhuma entre as 12. Usa objetos da main: `fn_service_lock` (19669), `fn_telefone_canonico` (64397), `fn_support_write_allowed` (19013), `contact_phones` (64456), `api_tokens` (1291).

### 9814 `20261120181400_9814_proposta_aprovada_para_o_agente_enviar.sql` (PR #22)

- Colunas novas em `crm_proposals`: `aprovada_em timestamptz` e `aprovada_na_revisao bigint`, nulas (linhas 47 a 51).
- Constraint nova `crm_proposals_aprovacao_inteira` (linhas 60 a 62).
- **Função substituída:** `fn_crm_proposals_transicao_da_sessao()` (linhas 74 a 116). Na main ela tem UMA definição, no baseline linhas 40520 a 40560.
  - Assinatura: igual (sem argumento, `returns trigger`, mesmo `search_path`, sem `security definer`).
  - Diferença no corpo: só a lista `v_envio`, que ganha `'aprovada_em'` e `'aprovada_na_revisao'` (migration linhas 79 a 81; main linhas 40524 e 40525). O resto é igual linha a linha.
  - Efeito para o app antigo: nenhum. Ele nunca grava essas colunas, então `new` e `old` são iguais nelas e nulas no INSERT.
- O `revoke` da linha 117 repete o da main (linha 40561). O trigger `trg_crm_proposals_transicao_da_sessao` não é recriado.
- **Só aditiva: não** (função substituída), mas sem mudança visível para o app antigo.
- **Voltar só a imagem:** nada quebra. Aprovações já gravadas ficam no banco e o app antigo as ignora.
- **Lock:** `ADD COLUMN` curto em `crm_proposals`; o CHECK valida a tabela inteira sob `ACCESS EXCLUSIVE`. Tamanho da tabela em produção, não verifiquei.
- **Dependência:** nenhuma. A 9815 depende dela.

### 9815 `20261123100015_9815_editar_o_rascunho_invalida_a_aprovacao.sql` (PR #22) **NÃO reversível só com a imagem**

- Função nova `fn_crm_proposals_edicao_sobe_revisao()` (linhas 109 a 159) e trigger novo `trg_crm_proposals_zz_edicao_sobe_revisao`, BEFORE UPDATE em `crm_proposals` (linhas 162 a 165).
- Função nova `fn_crm_proposal_items_sobe_revisao()`, `security definer` (linhas 168 a 208), e trigger novo `trg_crm_proposal_items_sobe_revisao`, AFTER INSERT OR UPDATE OR DELETE em `crm_proposal_items` (linhas 211 a 214).
- Função nova `fn_proposta_gravar_edicao(uuid, uuid, bigint, jsonb, jsonb)`, invoker, EXECUTE para `authenticated` e `service_role` (linhas 217 a 272).
- Nenhuma das três funções existe na main. Nenhuma linha é alterada ao aplicar.
- **Só aditiva: não.** Dois gatilhos novos em tabelas que o app antigo escreve.
- **Voltar só a imagem: o editor de proposta quebra.** A rota antiga `PATCH /api/v1/proposals/[id]` faz três chamadas separadas ao PostgREST (main, `app/api/v1/proposals/[id]/route.ts`): UPDATE com `revision: input.revision + 1` (linhas 130 a 147), DELETE dos itens (linhas 159 a 163) e INSERT dos itens (linhas 166 a 178). Cada chamada é uma transação. Com o gatilho dos itens, o DELETE soma mais um e o INSERT soma mais um. A rota devolve `proposta.revision`, que é R+1 (linha 193), e a tela guarda esse número (`app/app/proposals/[id]/_client.tsx`, linha 299). O banco fica em R+2 ou R+3. O próximo salvar na mesma tela manda R+1 e recebe 409 `proposal_context_stale` ("Recarregue antes de editar"). O mesmo vale para `assistant/apply/route.ts` (linhas 93 a 113 e 152).
- Também com o app antigo: `/documento` (linhas 195 e 221) e `/modelo` (linhas 56 e 82) passam a somar um na revisão pelo gatilho 1. Se a tela relê a revisão depois dessas rotas, não verifiquei.
- Rascunho novo com itens nasce na revisão 2. Isso não quebra o app antigo.
- A conclusão do 409 é dedução da leitura do código e do SQL. Ela não foi executada.
- **Lock:** `CREATE TRIGGER` curto em `crm_proposals` e em `crm_proposal_items`.
- **Dependência:** 9814, obrigatória. Sem as colunas `aprovada_*`, a função do gatilho 1 falha em todo UPDATE de rascunho cuja revisão muda.

### 9816 `20261123101600_9816_comentarios_lgpd_pela_identidade_social.sql` (PR #16)

- **Função substituída:** `fn_redigir_comentarios_ao_anonimizar()` (linhas 55 a 126). Ela NÃO existe na main; a definição anterior é a da 9812. Assinatura igual.
- Diferença de comportamento contra a 9812: redige também os comentários cujo autor forma a identidade social do contato (`instagram:<conta>:<author_id>`, linhas 111 a 122) e regrava `hidden` só com `quando`, `quem`, `simulada` (linhas 93 a 100).
- Recria o trigger `trg_redigir_comentarios_ao_anonimizar` igual ao da 9812 (linhas 133 a 138) e repete os grants (linhas 128 e 129).
- **Só aditiva: não** (função substituída).
- **Voltar só a imagem:** o app antigo não chama a função; ela roda pelo gatilho quando ele anonimiza um contato. O efeito é redigir mais comentários, que é o desejado pela LGPD.
- **Reversível só com a imagem:** sim. Redação já feita não tem volta, por desenho.
- **Lock:** `CREATE TRIGGER` curto em `contacts`.
- **Dependência:** 9812 (colunas `contact_id`, `ignore_reason`, `hidden`) e 9810. Usa `channel_sessions.meta_social_account_id`, que existe na main (baseline linha 9610).

### 9817 `20261123100017_9817_tarefa_de_seguimento_do_ganho_unica.sql` (PR #24)

- **Dado alterado:** UPDATE em `crm_tasks` (linhas 44 a 57). Em cada negócio com mais de uma tarefa `kind = 'dar_seguimento'`, a mais antiga fica e as outras passam a `kind = 'dar_seguimento_repetida'`.
- Índice único parcial novo `crm_tasks_seguimento_do_ganho_uidx` em `(organization_id, lead_id)` onde `kind = 'dar_seguimento' and lead_id is not null` (linhas 60 a 62).
- **Só aditiva: não.** Há backfill e restrição de unicidade.
- **Na primeira aplicação em produção o UPDATE não deve achar linha:** a coluna `kind` nasce na 9809, no mesmo deploy, toda nula. Isso deixa de valer se a 9809 subir antes, em outro deploy, com o app novo criando tarefas.
- **Voltar só a imagem:** nada acontece. O app antigo não grava `kind` (0 ocorrências de `dar_seguimento` em `lib` e `app` da main), então o índice nunca o recusa.
- **Lock:** `CREATE UNIQUE INDEX` sem CONCURRENTLY segura as escritas em `crm_tasks` enquanto varre a tabela. CONCURRENTLY não cabe no `psql -1`. Tamanho da tabela em produção, não verifiquei.
- **Dependência:** 9809, obrigatória.

### 9818 `20261123121800_9818_nota_do_negocio_uma_por_chave.sql` (PR #13)

- **Dado alterado:** UPDATE em `crm_lead_activities` (linhas 43 a 59). Nas notas repetidas (`type = 'note'`, `source_module = 'notas'`, mesma organização, negócio e `payload->>'idempotency_key'`), a mais antiga fica; nas outras a chave sai de `idempotency_key` e vai para `idempotency_key_repetida`.
- Índice único parcial novo `uq_crm_lead_activities_nota_idempotencia` em `(organization_id, lead_id, (payload->>'idempotency_key'))` (linhas 61 a 65).
- Este arquivo não tem `notify pgrst`. Ele não muda nada que a API exponha.
- **Só aditiva: não.** Há backfill e restrição de unicidade.
- **Na primeira aplicação em produção o UPDATE não deve achar linha:** não achei na main quem grave `source_module = 'notas'` (grep em `lib` e `app`). Não é prova completa.
- **Voltar só a imagem:** nada acontece, pelo mesmo motivo.
- **Lock: o mais pesado do lote.** `CREATE UNIQUE INDEX` sem CONCURRENTLY segura INSERT, UPDATE e DELETE em `crm_lead_activities` (a linha do tempo de todos os negócios) durante a varredura inteira. O UPDATE anterior também varre a tabela. Tamanho em produção, não verifiquei. Meça antes: `select pg_size_pretty(pg_total_relation_size('public.crm_lead_activities')), (select count(*) from public.crm_lead_activities);`
- **Dependência:** nenhuma.

### 9819 `20261123101900_9819_comentarios_leitura_so_de_gerente.sql` (PR #12)

- **Policy trocada:** `tenant_isolation_social_comments_select` é apagada e recriada (linhas 35 a 41). Antes: todo membro lê. Depois: admin da plataforma, ou membro com papel `manager` ou acima (`fn_role_at_least`, que existe na main, baseline linha 59442).
- **Só aditiva: não.** Ela restringe leitura. A troca é atômica, porque o arquivo roda numa transação.
- **Voltar só a imagem:** nada acontece. O app antigo não lê `social_comments`.
- **Lock:** `ACCESS EXCLUSIVE` curto em `social_comments`.
- **Dependência:** 9810. Em banco novo, precisa vir DEPOIS da 9810 na lista.

### 9820 `20261123100020_9820_contato_preencher_campos_personalizados.sql` (PR #22)

- Função nova `fn_contato_preencher_campos_personalizados(uuid, uuid, jsonb)`, invoker (linhas 56 a 111). EXECUTE só para `service_role` (linhas 112 e 113). Não existe na main.
- **Só aditiva: sim.**
- **Voltar só a imagem:** nada acontece. O app antigo não a chama.
- **Lock:** nenhum.
- **Dependência:** nenhuma.

### 9824 `20261124120000_9824_agente_nao_fecha_conversa_assumida.sql` (Tarefa 6.1, PR à parte)

Escrita em 25/11/2026. Diferente das doze acima, esta foi EXECUTADA: `pnpm test:db tests/invariants/fechar-conversa-por-agente.test.ts` num Postgres 15 descartável (baseline em modo install e em modo update, 19 casos verdes). Os números de linha são do arquivo no branch `tarefa-6.1/agente-nao-fecha-conversa-assumida`.

- `drop function if exists public.fn_service_status(uuid,uuid,text,bigint)` e `create or replace` da mesma função com um quinto parâmetro, `p_ator text default 'pessoa'`. Com `p_ator = 'agente'`, pedido de `closed`, `resolved` ou `archived` sobre conversa aberta e com `assigned_to_user_id` preenchido é recusado com `PT403 service_assigned_to_human`, depois do `select ... for no key update` (linha travada). O resto do corpo é o da 0514. EXECUTE só para `service_role`. Termina com `notify pgrst, 'reload schema'`.
- **Só aditiva: não.** Troca a assinatura de uma função que o app chama. Nenhuma tabela, coluna, índice ou linha muda.
- **Banco novo com o app antigo:** a tela e a ferramenta antigas mandam 4 argumentos nomeados, que casam com a função de 5 pelo default. Comportamento igual ao de hoje (a ferramenta antiga segue só com a conferência na leitura). As duas chamadas SQL internas, posicionais com 4 argumentos (`supabase/baseline.sql`, linhas 19954 e 52673), seguem resolvendo.
- **App novo com banco antigo (sem a 9824):** a tela funciona, porque pessoa não manda `p_ator`. O agente manda `p_ator` e o PostgREST responde `PGRST202` (função não encontrada): `crm_close_conversation` devolve `indisponivel` e NÃO fecha. É falha fechada de propósito; não existe volta ao caminho antigo. Consequência prática: se a 9824 falhar no `init` e a imagem nova subir, o agente para de fechar conversa até a migration entrar.
- **Voltar só a imagem:** funciona, sem reverter o banco.
- **Lock:** `drop function` e `create function` pegam lock só no catálogo. Nenhuma tabela é varrida. Em execução, a condição nova roda sob o advisory lock e o row lock que a função já pegava: nenhum lock novo. NÃO medido em produção.
- **Janela do PostgREST:** entre o commit da migration e o PostgREST recarregar o schema (`notify pgrst`), uma chamada pode pegar o cache antigo. Como o app antigo e a tela nova mandam 4 argumentos, e a função de 5 aceita 4, o efeito esperado é nenhum. NÃO testado contra um PostgREST de verdade (os testes de banco falam direto com o Postgres).
- **Reaplicar:** termina no mesmo estado (uma função só, de 5 parâmetros). Conferido pelo modo update do `test:db` e pelo caso "existe UMA função só".
- **No `baseline.sql`:** o bloco fica antes da VARREDURA anon. Os blocos antigos (0222 e 0514) recriam a função de 4 argumentos a cada aplicação do baseline, e o bloco da 9824 a derruba em seguida. No `update.sh` do kit (sem transação) há um instante com as duas sobrecargas. A produção do fork não reaplica o baseline (o `init.sh` usa a lista), então isso não a alcança.
- **Dependência:** nenhuma.

## 6.2 Reversões propostas

**TODAS abaixo estão NÃO TESTADAS.** Nenhuma foi executada.

Regras que valem para todas:

- Rode cada bloco numa transação (`begin; ... commit;`), com `set lock_timeout = '5s';` no começo.
- Depois de reverter, apague o registro, senão o `init.sh` nunca reaplica a migration: `delete from public.arvisx_migracoes_aplicadas where nome = '<arquivo>.sql';`
- Se a lista do checkout ainda tiver o arquivo, o próximo deploy reaplica. Reverter o banco exige também tirar a linha da lista, ou voltar o checkout.
- Termine com `notify pgrst, 'reload schema';`.
- Ordem de reversão: 9815 antes de 9814; 9816 antes de 9812; 9819 e 9812 antes de 9810; 9817 antes de 9809.

**Como testar cada uma (mesmo roteiro):** num Postgres 17 descartável, crie as extensões do `init.sh` (linha 19) e aplique o `supabase/baseline.sql` da main. Guarde `pg_dump --schema-only` como A. Aplique a migration (e as de que ela depende) com `psql -1`. Aplique a reversão. Guarde outro `pg_dump --schema-only` como B. `diff A B` deve sair vazio, fora os comentários. Para as que mexem em dado (9817, 9818), insira linhas repetidas antes da migration e compare as linhas antes e depois.

### 9815 (a única obrigatória se a imagem voltar) NÃO TESTADO

```sql
begin;
set lock_timeout = '5s';
drop trigger if exists trg_crm_proposal_items_sobe_revisao on public.crm_proposal_items;
drop trigger if exists trg_crm_proposals_zz_edicao_sobe_revisao on public.crm_proposals;
drop function if exists public.fn_proposta_gravar_edicao(uuid, uuid, bigint, jsonb, jsonb);
drop function if exists public.fn_crm_proposal_items_sobe_revisao();
drop function if exists public.fn_crm_proposals_edicao_sobe_revisao();
delete from public.arvisx_migracoes_aplicadas
 where nome = '20261123100015_9815_editar_o_rascunho_invalida_a_aprovacao.sql';
notify pgrst, 'reload schema';
commit;
```

- As revisões que já subiram ficam como estão. `revision` é só contador, e a tela antiga relê o valor ao recarregar.
- Com os gatilhos fora e o app antigo editando, uma aprovação já gravada pode continuar valendo para conteúdo alterado por `/documento`, `/modelo` ou PostgREST. Antes de subir o app novo de novo, limpe as aprovações. Isto apaga dado e não tem volta: `update public.crm_proposals set aprovada_em = null, aprovada_na_revisao = null where aprovada_em is not null;`
- Teste extra: com baseline, 9814 e 9815 aplicadas, repita as três escritas da rota antiga (UPDATE com revisão +1, DELETE dos itens, INSERT dos itens, cada uma em sua transação) e veja a revisão final. Repita depois da reversão: ela deve parar em R+1.

### 9814 NÃO TESTADO (só depois de reverter a 9815)

Não há reversão sem perda: apagar as colunas apaga as aprovações gravadas. O corpo da função abaixo é o da main (baseline linhas 40520 a 40560).

```sql
begin;
set lock_timeout = '5s';
create or replace function public.fn_crm_proposals_transicao_da_sessao()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  v_envio constant text[] := array['numero', 'ano', 'versao', 'substitui_id', 'sent_at',
    'sent_by_user_id', 'pdf_path', 'message_id', 'retorno_id', 'template_snapshot', 'rendered_snapshot'];
  v_decisao constant text[] := array['status', 'decided_at', 'decided_by_user_id',
    'decision_reason', 'updated_at'];
  v_new jsonb := to_jsonb(new);
  v_old jsonb;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if exists (select 1 from unnest(v_envio) k where k <> 'versao' and v_new -> k <> 'null'::jsonb)
       or coalesce(v_new ->> 'versao', '1') <> '1' then
      raise exception 'proposta_envio_e_do_servidor' using errcode = '42501';
    end if;
    return new;
  end if;
  v_old := to_jsonb(old);
  if old.status = 'rascunho' and new.status = 'rascunho' then
    if exists (select 1 from unnest(v_envio) k where v_new -> k is distinct from v_old -> k) then
      raise exception 'proposta_envio_e_do_servidor' using errcode = '42501';
    end if;
  elsif (old.status = 'enviada' and new.status in ('aceita', 'recusada'))
     or (old.status = 'rascunho' and new.status = 'cancelada'
         and public.fn_role_at_least(new.organization_id, 'manager')) then
    if (v_new - v_decisao) is distinct from (v_old - v_decisao) then
      raise exception 'proposta_transicao_negada' using errcode = '42501';
    end if;
  else
    raise exception 'proposta_transicao_negada' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function public.fn_crm_proposals_transicao_da_sessao() from public, anon;
alter table public.crm_proposals drop constraint if exists crm_proposals_aprovacao_inteira;
alter table public.crm_proposals
  drop column if exists aprovada_em,
  drop column if exists aprovada_na_revisao;
delete from public.arvisx_migracoes_aplicadas
 where nome = '20261120181400_9814_proposta_aprovada_para_o_agente_enviar.sql';
notify pgrst, 'reload schema';
commit;
```

Recomendação: não reverta a 9814. Ela não muda nada para o app antigo.

### 9811 NÃO TESTADO

```sql
begin;
set lock_timeout = '5s';
drop trigger if exists trg_anunciar_pausa_da_ia on public.conversations;
drop function if exists public.fn_anunciar_pausa_da_ia();
delete from public.arvisx_migracoes_aplicadas
 where nome = '20261120150000_9811_ia_pausada_e_retomada_viram_evento.sql';
commit;
```

As linhas `conversation.ai_paused` e `conversation.ai_resumed` já gravadas em `event_log` ficam. Apagá-las não é necessário.

### 9816 NÃO TESTADO

A reversão é voltar ao corpo da 9812 (o próprio cabeçalho da 9816 diz isso, linhas 51 a 53). Comentário já redigido não volta.

```sql
begin;
create or replace function public.fn_redigir_comentarios_ao_anonimizar()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.social_comments
     set text = case when text is null then null else '(anonimizado)' end,
         author_id = null,
         author_username = null,
         ignore_reason = null,
         public_reply = case
           when public_reply is null then null
           else public_reply || jsonb_build_object('texto', '(anonimizado)')
         end,
         private_reply = case
           when private_reply is null then null
           else private_reply || jsonb_build_object('texto', '(anonimizado)')
         end
   where organization_id = new.organization_id
     and (
       contact_id = new.id
       or author_id in (
         select s.author_id
           from public.social_comments s
          where s.organization_id = new.organization_id
            and s.contact_id = new.id
            and s.author_id is not null
       )
     );
  return new;
end;
$$;
revoke execute on function public.fn_redigir_comentarios_ao_anonimizar() from public, anon, authenticated;
grant  execute on function public.fn_redigir_comentarios_ao_anonimizar() to service_role;
delete from public.arvisx_migracoes_aplicadas
 where nome = '20261123101600_9816_comentarios_lgpd_pela_identidade_social.sql';
commit;
```

Recomendação: não reverta. A reversão reabre o buraco de LGPD que a 9816 fecha.

### 9812 NÃO TESTADO (só depois de reverter a 9816)

É a reversão do cabeçalho da própria migration (linhas 42 a 47). Ela apaga a ligação comentário e contato, o motivo e a ocultação: esse dado não volta.

```sql
begin;
set lock_timeout = '5s';
drop trigger if exists trg_redigir_comentarios_ao_anonimizar on public.contacts;
drop function if exists public.fn_redigir_comentarios_ao_anonimizar();
alter table public.social_comments
  drop column if exists contact_id,
  drop column if exists ignore_reason,
  drop column if exists hidden;
delete from public.arvisx_migracoes_aplicadas
 where nome = '20261120171200_9812_comentarios_resposta_e_contato.sql';
notify pgrst, 'reload schema';
commit;
```

Os índices `social_comments_contato_idx` e `social_comments_org_quando_idx`: o primeiro cai junto com a coluna; o segundo fica, e pede `drop index if exists public.social_comments_org_quando_idx;` para o schema voltar igual.

### 9819 NÃO TESTADO

É a reversão do cabeçalho da própria migration (linhas 29 a 33). Ela reabre a leitura a todo membro.

```sql
begin;
drop policy if exists tenant_isolation_social_comments_select on public.social_comments;
create policy tenant_isolation_social_comments_select on public.social_comments
  for select using (
    (organization_id in (select public.fn_user_org_ids())) or (select public.fn_is_platform_admin())
  );
delete from public.arvisx_migracoes_aplicadas
 where nome = '20261123101900_9819_comentarios_leitura_so_de_gerente.sql';
notify pgrst, 'reload schema';
commit;
```

### 9817 NÃO TESTADO

```sql
begin;
set lock_timeout = '5s';
drop index if exists public.crm_tasks_seguimento_do_ganho_uidx;
update public.crm_tasks set kind = 'dar_seguimento' where kind = 'dar_seguimento_repetida';
delete from public.arvisx_migracoes_aplicadas
 where nome = '20261123100017_9817_tarefa_de_seguimento_do_ganho_unica.sql';
notify pgrst, 'reload schema';
commit;
```

O UPDATE de volta só é exato se ninguém gravou `dar_seguimento_repetida` à mão: `kind` é texto livre. Se a migration não alterou linha ao aplicar, pule o UPDATE. Para saber, conte antes do deploy: `select count(*) from public.crm_tasks where kind = 'dar_seguimento';` (na primeira aplicação a coluna ainda nem existe).

### 9818 NÃO TESTADO

```sql
begin;
set lock_timeout = '5s';
drop index if exists public.uq_crm_lead_activities_nota_idempotencia;
update public.crm_lead_activities
   set payload = (payload - 'idempotency_key_repetida')
                 || jsonb_build_object('idempotency_key', payload->>'idempotency_key_repetida')
 where type = 'note'
   and source_module = 'notas'
   and payload ? 'idempotency_key_repetida';
delete from public.arvisx_migracoes_aplicadas
 where nome = '20261123121800_9818_nota_do_negocio_uma_por_chave.sql';
commit;
```

O UPDATE devolve a chave ao lugar, mas a ordem das chaves dentro do `jsonb` não é garantida igual (jsonb não guarda ordem; o valor é o mesmo). Se a migration não alterou linha ao aplicar, pule o UPDATE.

### 9824 NÃO TESTADO (só se quiser a função antiga de volta; a imagem antiga não precisa)

Com a imagem ANTERIOR no ar, não reverta: ela funciona com a função de 5 parâmetros. Reverter com a imagem NOVA no ar deixa o agente sem fechar conversa (`PGRST202`, falha fechada); a tela segue funcionando.

```sql
begin;
set lock_timeout = '5s';
drop function if exists public.fn_service_status(uuid,uuid,text,bigint,text);

-- Corpo da migration 0514 (`supabase/baseline.sql`, bloco "a recusa permanente
-- do atendimento não pede repetição"), sem mudança.
create or replace function public.fn_service_status(p_org uuid,p_conversation uuid,p_status text,p_expected bigint default null)
returns public.conversations language plpgsql security definer set search_path=public as $$
declare c public.conversations; terminal boolean; pre_contact uuid;
begin
 if p_status not in ('closed','resolved','archived','open','pending','ai_handling','claimed') then
  raise exception 'invalid_status' using errcode='22023'; end if;
 select * into c from public.conversations where id=p_conversation and organization_id=p_org;
 if not found then raise exception 'service_not_found' using errcode='P0002'; end if;
 pre_contact:=c.contact_id;
 perform public.fn_service_lock(p_org,c.contact_id);
 select * into c from public.conversations where id=p_conversation and organization_id=p_org for no key update;
 if c.contact_id is distinct from pre_contact then raise exception 'service_contact_changed' using errcode='40001'; end if;
 if p_expected is not null and c.service_revision<>p_expected then raise exception 'service_stale' using errcode='PT409'; end if;
 if c.status=p_status then return c; end if;
 terminal := p_status in ('closed','resolved','archived');
 update public.conversations set status=p_status,status_changed_at=clock_timestamp(),
   service_revision=service_revision+case when terminal or c.status in ('closed','resolved','archived') then 1 else 0 end,
   service_closed_at=case when terminal then clock_timestamp() else service_closed_at end,
   service_started_at=case when c.status in ('closed','resolved','archived') and not terminal then clock_timestamp() else service_started_at end,
   bot_silenced_until=case when terminal and last_handoff_at is null then null else bot_silenced_until end,
   current_demanda_id=case when c.status in ('closed','resolved','archived') and not terminal then null else current_demanda_id end
  where id=c.id and organization_id=p_org returning * into c;
 if terminal then
   update public.demandas set proximo_passo=coalesce(proximo_passo,'Revisar atendimento e registrar o desfecho da demanda')
    where organization_id=p_org and id=c.current_demanda_id and fechada_em is null;
 end if;
 return c;
end; $$;

revoke execute on function public.fn_service_status(uuid,uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.fn_service_status(uuid,uuid,text,bigint) to service_role;

delete from public.arvisx_migracoes_aplicadas
 where nome = '20261124120000_9824_agente_nao_fecha_conversa_assumida.sql';
notify pgrst, 'reload schema';
commit;
```

Tire também a linha da 9824 de `deploy/arvisx/crm/migracoes-pos-baseline.txt` no checkout, senão o próximo deploy a reaplica. Esta reversão NÃO foi executada (a aplicação da 9824 foi; a volta, não).

### Aditivas (9809, 9810, 9813, 9820)

Elas não precisam de reversão para o app antigo funcionar. Apagar `social_comments` (reversão do cabeçalho da 9810, linha 62) ou `fusoes_de_contatos` apaga dado recebido e o registro que permite desfazer junções: **não há reversão segura** depois que o app novo gravou nelas.

## Riscos principais, em ordem

1. **9815 com a imagem antiga:** o segundo salvar de uma proposta dá 409 até recarregar. Voltar a imagem exige a reversão da 9815.
2. **9818 e 9817:** índice único sem CONCURRENTLY, dentro de uma transação, com escritas paradas em `crm_lead_activities` e `crm_tasks` durante a varredura. Meça as tabelas e suba fora do horário de pico.
3. **`init.sh` não derruba o deploy** em falha de migration ou de backup. O app novo pode subir em schema parcial. Leia o log do `init` ("FALHOU:" ou "backup falhou").
4. **A lista final não existe em ponta nenhuma.** Os merges vão conflitar em `migracoes-pos-baseline.txt` e em `baseline.sql`. Confira a ordem obrigatória acima no resultado.
5. **Timestamp repetido** entre 9810 e 9811 (`20261120150000`).
6. **9811:** gatilho novo no caminho quente de `conversations`; segue gravando `event_log` com a imagem antiga.

## O que não verifiquei

- Tamanho de `crm_tasks`, `crm_proposals` e `crm_lead_activities` em produção, e portanto a duração real dos locks.
- Qualquer execução: as migrations, as reversões e a dedução do 409 da 9815.
- Se o `ci.yml` chama o checador de colisão.
- Se o app antigo apaga `channel_sessions` com DELETE.
- Se a tela antiga relê a revisão depois de `/documento` e `/modelo`.
- O comportamento do motor antigo com regra de automação criada para `conversation.ai_paused`.
- Worker e scheduler foram tratados como o mesmo código do app (mesma imagem de origem); não li os pontos de entrada deles em separado.

## 6.3 Roteiro de teste de fumaça pós-deploy

Para quem acabou de subir a imagem nova em produção. Tudo abaixo foi LIDO no código das pontas dos PRs #12 a #24 (`git show <ponta>:<arquivo>`), em 24/11/2026. Nada foi executado. Onde o código não confirmou um detalhe, está escrito "(a confirmar)".

Abreviações das pontas usadas nas citações:

- `aj-4` = `origin/ajustes/aj-4-autoria-do-token` (#23, carrega #13, #15, #19, #21).
- `aj-1b` = `origin/ajustes/aj-1b-unificar-fechar-conversa` (#17, carrega #13 e #14).
- `ep-b` = `origin/equipe-pronta-v2/pr-b-gatilhos` (#24, carrega #13, #15, #22).
- `ig-c` = `origin/instagram-comentarios/pr-c-tela` (#18, carrega #12 e #16).
- `pr-3` = `origin/superficie-agente/pr-3-convivencia-e-filtro` (#20, carrega #13 e #15).

### Preparação (uma vez)

- Use uma organização de teste, ou a de produção só com registros de teste. Nomes sugeridos: negócio "TESTE FUMACA 2026-11", contato de teste com o SEU próprio número. Não use cliente real em passo nenhum.
- `$BASE` é o endereço do CRM (`https://crm.arvisx.com.br`).
- `$TOKEN` é um token de API `dsk_...` (tabela `api_tokens`) com os escopos `mcp:read` e `mcp:write`. Sem escopo `role:`, ele vale como papel `agent` (`lib/mcp/auth.ts`, linhas 10 a 14, ponta `aj-4`).
- `$TOKEN_GERENTE` é um segundo token com `mcp:read`, `mcp:write` e `role:manager`. Só os comentários do Instagram o exigem (`app/api/v1/social-comments/_borda.ts`, linhas 44 e 74 a 80, ponta `ig-c`).
- O caminho de cliques para criar o token na tela: (a confirmar).
- O MCP mora em `POST $BASE/api/mcp` (`app/api/mcp/route.ts`, linhas 42 a 85). O caminho passa pelo proxy sem sessão (`lib/auth/public-paths.ts`, linha 104) e a rota confere o bearer. O transporte é sem sessão (linha 62), exige `Accept` com `application/json` e `text/event-stream` (SDK 1.32.2, `webStandardStreamableHttp.js`, linhas 467 a 472) e responde em SSE, com o JSON na linha `data:`.
- Função de apoio para os passos por MCP (bash):

```bash
mcp() { # mcp '<corpo JSON-RPC>' [idempotency-key]
  curl -sS -N -X POST "$BASE/api/mcp" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    ${2:+-H "Idempotency-Key: $2"} \
    -d "$1" | sed -n 's/^data: //p'
}
```

- Se o servidor recusar `tools/list` ou `tools/call` sem um `initialize` antes: (a confirmar; o transporte aceita, linha 738 do mesmo arquivo do SDK, mas a camada do servidor MCP não foi lida). Nesse caso mande primeiro `{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"fumaca","version":"1"}}}`.
- Toda ferramenta devolve o resultado em `.result.structuredContent` e em `.result.content[0].text` (`lib/mcp/server.ts`, linhas 136 a 139). Recusa de regra vem como resultado normal, com `permitido: false`, `motivo` e `mensagem` (`lib/mcp/negocio-do-contexto.ts`, linhas 33 a 39). Erro lançado (escopo, papel, validação) vem com `.result.isError: true` (`lib/mcp/server.ts`, linhas 153 a 156).

### Passo 0. Conferir o log do `init` e o registro das migrations

O que fazer: abra o log do serviço `init` no Easypanel (ele roda `deploy/arvisx/crm/init.sh` a cada deploy) e depois rode a consulta abaixo no banco.

Resultado esperado no log, com as mensagens reais do script:

- `[init] schema ja existe: pulando baseline` (linha 15).
- `[init] backup do banco em /backup/antes-migracoes-<data>.dump` (linha 37).
- Doze linhas `[init] aplicando <arquivo>` (linha 41), uma para cada migration de 9809 a 9820. Se o PR da Tarefa 6.1 subir junto, são treze: a última é `20261124120000_9824_agente_nao_fecha_conversa_assumida.sql` (e a consulta abaixo devolve 13 linhas).
- `[init] fim das migracoes` (linha 48).
- `[init] trava de empresa suspensa: <n> policies novas` (linha 61).
- NÃO pode aparecer `[init] FALHOU: <arquivo> (parei aqui; as seguintes ficam pendentes)` (linha 45), nem `[init] backup falhou; nao migrei nada` (linha 50), nem `[init] AVISO: nao consegui conferir a trava de empresa suspensa` (linha 63).
- Atenção: `[init] fim das migracoes` sai também quando uma migration falhou (o `break` da linha 45 cai na linha 48). Só a ausência de `FALHOU:` e a consulta abaixo provam o sucesso.
- Num segundo deploy seguido, o esperado é `[init] sem migracoes pendentes` (linha 53).

```sql
select nome, aplicada_em
  from public.arvisx_migracoes_aplicadas
 where nome ~ '_98(09|1[0-9]|20)_'
 order by nome;
```

Resultado esperado: 12 linhas, com `aplicada_em` na hora deste deploy. Os nomes são: `20261120120000_9809_tarefa_tipo_e_resultado.sql`, `20261120150000_9810_comentarios_do_instagram.sql`, `20261120150000_9811_ia_pausada_e_retomada_viram_evento.sql`, `20261120170000_9813_registro_da_fusao_de_contatos.sql`, `20261120171200_9812_comentarios_resposta_e_contato.sql`, `20261120181400_9814_proposta_aprovada_para_o_agente_enviar.sql`, `20261123100015_9815_editar_o_rascunho_invalida_a_aprovacao.sql`, `20261123100017_9817_tarefa_de_seguimento_do_ganho_unica.sql`, `20261123100020_9820_contato_preencher_campos_personalizados.sql`, `20261123101600_9816_comentarios_lgpd_pela_identidade_social.sql`, `20261123101900_9819_comentarios_leitura_so_de_gerente.sql`, `20261123121800_9818_nota_do_negocio_uma_por_chave.sql`.

O que prova: o schema está inteiro. O `init.sh` não derruba o deploy quando uma migration ou o backup falha (linhas 38 e 45), então o app novo pode estar no ar sobre schema parcial. Com menos de 12 linhas, pare aqui e não libere o tráfego.

### Passo 1. Saúde e páginas públicas

```bash
curl -sS -o /dev/null -w '%{http_code}\n' "$BASE/"
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' "$BASE/app"
curl -sS -w '\n%{http_code}\n' "$BASE/api/v1/health"
```

Resultado esperado:

- `/` responde `200` (caminho público, `lib/auth/public-paths.ts`, linha 8).
- `/app` sem sessão responde `307` para `$BASE/login?next=%2Fapp` (`proxy.ts`, linhas 126 a 128, ponta `aj-4`).
- `/api/v1/health` responde `200` com `data.status` igual a `"healthy"` ou `"degraded"`, e `data.checks.supabase.status` igual a `"ok"`. `503` com `"unhealthy"` é falha (`app/api/v1/health/route.ts`, linhas 422 a 451). `"degraded"` só é aceitável se já era assim antes do deploy (Redis ou WAHA "not_configured", linhas 276 e 322).
- `data.version` é a versão ou o SHA da imagem NOVA (linha 445). Se vier a anterior, o Easypanel não trocou a imagem.

O que prova: o contêiner novo subiu, fala com o banco e o proxy de autenticação está de pé.

### Passo 2. Login pela tela

O que fazer: abra `$BASE/login` numa janela anônima e entre com um usuário gerente ou administrador da organização de teste.

Resultado esperado: a tela sai do `/login` e abre o app em `/app/...` sem erro. A página exata de chegada: (a confirmar). No menu aparecem "Propostas" (`/app/proposals`), "Webhooks" (`/app/webhooks`) e "Audit Log" (`/app/audit`), conforme `lib/navigation/catalogo.ts` (linhas 425, 840 e 976, pontas `ep-b` e `pr-3`).

O que prova: GoTrue, cookie de sessão e o carregamento da organização funcionam com a imagem nova.

### Passo 3. Criar um negócio de teste com bearer

Não existe `POST /api/v1/leads` com bearer: em `lib/auth/public-paths.ts` só `/api/v1/leads/<uuid>` (linha 150, atualizar) passa pelo proxy sem sessão; `/api/v1/leads` e `/api/v1/tasks` respondem `401 unauthenticated` a um token (`proxy.ts`, linhas 109 a 124). O próprio `docs/arvisx/SUPERFICIE-DE-AGENTE.md` (linhas 10 a 14, ponta `aj-4`) diz que o token entra pelo MCP. Então a criação é pela ferramenta `crm_create_lead` (`lib/mcp/tools/leads.ts`, linhas 318 a 357).

```bash
mcp '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"crm_list_pipelines","arguments":{}}}'
# copie um pipelines[].id para $FUNIL
mcp '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"crm_list_stages","arguments":{"pipeline_id":"'$FUNIL'"}}}'
# copie o id da primeira etapa para $ETAPA
mcp '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"crm_create_lead","arguments":{"pipeline_id":"'$FUNIL'","stage_id":"'$ETAPA'","title":"TESTE FUMACA 2026-11","source":"teste_fumaca"}}}'
```

Resultado esperado: HTTP `200` nas três. A primeira traz `structuredContent.pipelines[]` com `id` e `name` (`lib/mcp/tools/pipelines.ts`, linhas 33 a 45). A terceira traz `structuredContent.lead.id` (`leads.ts`, linhas 411 e 412). Guarde em `$LEAD`. O formato exato da resposta de `crm_list_stages`: (a confirmar; a ferramenta está em `lib/mcp/tools/operacao.ts`, linha 79). Se a etapa exigir campo obrigatório, a recusa é `required_fields_missing`: escolha outra etapa.

Sem token: `curl -sS -X POST "$BASE/api/mcp" -H 'Content-Type: application/json' -d '{}'` responde `401` com `error.code` `-32001` (`lib/mcp/auth.ts`, linha 225).

O que prova: o token é aceito, a organização sai do token e a escrita de negócio pelo agente segue funcionando.

### Passo 4. Nota com chave de repetição (PR #13, migration 9818)

A ferramenta `crm_add_lead_note` não tem campo `external_id` (`lib/mcp/tools/notas-do-negocio.ts`, linhas 114 a 129: só `lead_id`, `text`, `recipient`). A chave de repetição é o cabeçalho `Idempotency-Key`, um UUID (`app/api/mcp/route.ts`, linhas 57 a 60; `lib/api/idempotency.ts`, linhas 85 e 86). Ela é gravada em `payload->>'idempotency_key'` da nota (`lib/leads/notas-do-negocio.ts`, linha 183), que é a coluna do índice único da 9818.

```bash
CHAVE=$(uuidgen)
NOTA='{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"crm_add_lead_note","arguments":{"lead_id":"'$LEAD'","text":"Nota de teste de fumaca. Pode apagar."}}}'
mcp "$NOTA" "$CHAVE"
mcp "$NOTA" "$CHAVE"
```

Resultado esperado:

- Primeira chamada: `structuredContent.note.id` preenchido e `next_action` igual a "Nota gravada na linha do tempo do negócio, com o seu nome." (linhas 194 a 199).
- Segunda chamada: o MESMO `note.id` e `idempotent_replay: true` (`lib/mcp/idempotencia.ts`, linha 119).
- Na tela do negócio, a linha do tempo mostra UMA "Anotação".
- Chave que não é UUID devolve HTTP `400` com "Idempotency-Key deve ser UUID" (`route.ts`, linha 59).

Conferência no banco (é ela que prova a 9818; a repetição em sequência é respondida antes pelo recibo do pedido):

```sql
select count(*) from public.crm_lead_activities
 where lead_id = '<LEAD>' and type = 'note' and payload->>'idempotency_key' = '<CHAVE>';   -- esperado: 1
select indexname from pg_indexes
 where indexname = 'uq_crm_lead_activities_nota_idempotencia';                               -- esperado: 1 linha
```

O que prova: a nota por agente funciona, a repetição não duplica e o índice único da 9818 existe. A corrida entre duas chamadas simultâneas (o caso que só o índice decide, linha 192 de `notas-do-negocio.ts`) não é coberta por este roteiro.

### Passo 5. Tarefa por MCP (PR #13, migration 9809)

```bash
mcp '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"crm_create_task","arguments":{"title":"TESTE FUMACA: tarefa","lead_id":"'$LEAD'","kind":"teste_fumaca"}}}' "$(uuidgen)"
# copie structuredContent.task.id para $TAREFA
mcp '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"crm_complete_task","arguments":{"task_id":"'$TAREFA'","result":"Concluida no teste de fumaca."}}}'
mcp '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"crm_complete_task","arguments":{"task_id":"'$TAREFA'","result":"Concluida no teste de fumaca."}}}'
```

Resultado esperado: a criação devolve `task` com `kind: "teste_fumaca"` (`lib/mcp/tools/tarefas.ts`, linhas 274 a 286 e 359). A primeira conclusão devolve `already_completed: false` e "Tarefa concluída; a conclusão aparece na linha do tempo do negócio dela." (linhas 457 a 461). A segunda devolve `already_completed: true` (linhas 422 a 426). A tarefa aparece na tela de Tarefas e na linha do tempo do negócio.

O que prova: as colunas `kind` e `result` da 9809 existem e o app novo grava nelas. Se a 9809 não tivesse entrado, a criação com `kind` falharia.

### Passo 6. MCP lista as ferramentas novas

```bash
mcp '{"jsonrpc":"2.0","id":8,"method":"tools/list"}' | jq -r '.result.tools[].name' | sort > /tmp/ferramentas.txt
wc -l /tmp/ferramentas.txt
```

DEVEM aparecer estas 21, que não existem em `origin/main` (diferença de `lib/mcp/tools/index.ts` de cada ponta contra a main):

- #13 (`tarefas.ts` linhas 187, 286, 401, 477; `notas-do-negocio.ts` 58 e 132; `anexos-do-negocio.ts` 72 e 334; `proxima-acao.ts` 58): `crm_list_tasks`, `crm_create_task`, `crm_complete_task`, `crm_update_task`, `crm_list_lead_notes`, `crm_add_lead_note`, `crm_list_lead_attachments`, `crm_attach_to_lead`, `crm_set_next_action`.
- #14 (`fechar-conversa.ts` linha 132, ponta `aj-1b`): `crm_close_conversation`.
- #15 (`consulta-de-proposta.ts` linha 215): `crm_get_proposal`.
- #16 (`comentarios.ts` linhas 89, 110, 129, 161, 185, 207, ponta `ig-c`): `crm_list_comments`, `crm_get_comment`, `crm_reply_comment`, `crm_private_reply_comment`, `crm_ignore_comment`, `crm_create_contact_from_comment`.
- #19 (`eventos-do-negocio.ts` linha 46): `crm_list_lead_events`.
- #21 (`contatos-duplicados.ts` linha 78): `crm_find_duplicate_contacts`.
- #22 (`atualizar-contato.ts` linha 168 e `envio-de-proposta.ts` linha 144, ponta `ep-b`): `crm_update_contact`, `crm_send_proposal`.

NÃO devem aparecer: `crm_merge_contacts` e `crm_undo_contact_merge`. Elas saíram do #21 (commit `e31f89575`); na ponta `aj-4` os dois nomes só existem em comentário (`lib/mcp/tools/contatos-duplicados.ts`, linha 14; `lib/contacts/fusao-de-contatos.ts`, linha 20) e não existem na main.

```bash
grep -c -E '^crm_(merge_contacts|undo_contact_merge)$' /tmp/ferramentas.txt   # esperado: 0
```

Observações:

- A lista não depende do escopo nem do papel do token: o servidor registra todas e só confere escopo e papel na chamada (`lib/mcp/server.ts`, linhas 59 a 62 e 110 e 111).
- `crm_get_proposal` e `crm_send_proposal` somem para a organização que desligou propostas (`lib/mcp/tools/catalogo/comercio.ts`, `capacidade: "propostas"`, ponta `ep-b`). Nesse caso a falta das duas é esperada.
- Os PRs #17, #18, #20, #23 e #24 não registram ferramenta nova.

O que prova: os 13 PRs estão na imagem. Faltar um grupo aponta o PR que ficou de fora do merge.

### Passo 7. Fechar conversa (PRs #14 e #17)

Preparação: mande uma mensagem do seu número de teste para o WhatsApp da organização (isso já cobre metade do passo 12). Pegue o id da conversa:

```bash
mcp '{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"crm_list_conversations","arguments":{"status":"open","limit":10}}}'
```

Se a conversa não estiver em `open`, repita com `ai_handling` ou `pending` (`lib/mcp/tools/conversations.ts`, valores do filtro `status`). Guarde em `$CONVERSA`.

7a. Sem responsável:

```bash
FECHAR='{"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"crm_close_conversation","arguments":{"conversation_id":"'$CONVERSA'","reason":"teste de fumaca"}}}'
mcp "$FECHAR"; mcp "$FECHAR"
```

Resultado esperado: a primeira devolve `status: "closed"` e `already_closed: false`, com "Conversa fechada. Nenhuma mensagem foi enviada ao cliente; se ele escrever, ela reabre." (`lib/mcp/tools/fechar-conversa.ts`, linhas 182 a 188, ponta `aj-1b`). A segunda devolve `already_closed: true` (linhas 111 a 118 e 148). Nenhuma mensagem chega ao seu telefone. A conversa sai da caixa de entrada.

7b. Com responsável: mande outra mensagem do telefone de teste (a conversa reabre). Na tela, abra a conversa no Inbox e clique em "Assumir" (`components/inbox/ConversationHeader.tsx`, linha 440). Rode `mcp "$FECHAR"` de novo.

Resultado esperado: `permitido: false` e `motivo: "conversa_com_humano"` (linhas 69 a 74 e 149). A mensagem começa com "uma pessoa da equipe assumiu esta conversa e está com ela: você não pode fechá-la." A conversa continua aberta e nenhuma linha `conversation.closed` nova é gravada. A recusa vale para token de qualquer papel (linhas 24 a 31).

7c. Pela tela, a pessoa que assumiu clica em "Fechar" (linha 554), confirma no diálogo "Fechar esta conversa?" (linha 671) e clica em "Fechar" (linha 750).

Resultado esperado: a conversa fecha (rota `POST /api/v1/conversations/[id]/close`, que chama o mesmo `lib/inbox/fechar-conversa.ts`).

O que prova: a regra de 23/11 (agente não fecha conversa assumida) está no ar, e o caminho da tela não regrediu com a unificação do #17. Limite conhecido, escrito no próprio arquivo (linhas 33 a 36): se a pessoa assumir no instante entre a leitura e o fechamento, o fechamento ainda passa. Esse limite vale só SEM a Tarefa 6.1. Com a migration 9824 e a imagem da Tarefa 6.1, a função do banco recusa com a linha travada (`PT403`) e a ferramenta devolve o mesmo `conversa_com_humano`. A janela não dá para provocar à mão pela tela; a prova dela é o teste de banco `tests/invariants/fechar-conversa-por-agente.test.ts` (casos 1, 2 e 3).

7d (só com a Tarefa 6.1 no ar). Confira no banco que existe uma função só, com 5 parâmetros:

```sql
select pg_get_function_identity_arguments(p.oid)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'fn_service_status';
-- esperado: 1 linha: p_org uuid, p_conversation uuid, p_status text, p_expected bigint, p_ator text
```

Se a consulta devolver a função de 4 parâmetros (a 9824 não entrou) e a imagem for a da Tarefa 6.1, o 7a devolve `motivo: "indisponivel"` em vez de fechar: é a falha fechada da seção 6.1, e o conserto é aplicar a 9824, não voltar a imagem.

### Passo 8. Proposta: salvar duas vezes, consultar por agente e aprovar pela tela (PRs #15, #22, #24; migrations 9814 e 9815)

8a. Criar o rascunho: menu "Propostas" (`/app/proposals`), botão "Nova proposta" (`app/app/proposals/_client.tsx`, linha 81, ponta `ep-b`), ligada ao negócio "TESTE FUMACA 2026-11", com um item e um modelo confirmado. Se a tela exige contato no negócio para criar a proposta: (a confirmar). Se exigir, use um contato de teste SEM conversa aberta.

8b. Salvar DUAS vezes seguidas, sem recarregar: mude o título, clique em "Salvar" (`app/app/proposals/[id]/_client.tsx`, linha 880); mude o título de novo, clique em "Salvar".

Resultado esperado: as duas gravam. Na aba Rede, os dois `PATCH /api/v1/proposals/<id>` respondem `200` e o `data.revision` sobe exatamente 1 de um para o outro (`app/api/v1/proposals/[id]/route.ts`, linhas 131 a 171, que grava por `fn_proposta_gravar_edicao`, `lib/propostas/gravar-edicao.ts`, linha 65). NÃO pode aparecer `409 proposal_context_stale` nem a frase "A proposta mudou desde que você abriu. Recarregue antes de editar." (`_client.tsx`, linha 383).

O que prova: o app novo e a 9815 estão coerentes. O 409 no segundo salvar é a assinatura da imagem ANTIGA rodando sobre a 9815 (seção 6.1, 9815).

8c. Consultar por agente:

```bash
mcp '{"jsonrpc":"2.0","id":11,"method":"tools/call","params":{"name":"crm_get_proposal","arguments":{"lead_id":"'$LEAD'"}}}'
```

Resultado esperado: a proposta do negócio com `status: "rascunho"`, `total_cents`, os itens e sem `pdf_url` (rascunho nunca tem link; `docs/arvisx/SUPERFICIE-DE-AGENTE.md`, linhas 157 a 164, ponta `aj-4`). O nome da chave de topo da resposta: (a confirmar em `lib/mcp/tools/consulta-de-proposta.ts`).

8d. Aprovar pela tela. ATENÇÃO: aprovar faz o agente de Propostas ENVIAR o PDF ao cliente na mesma chamada (`lib/ai/equipe-pronta/gatilhos/proposta-aprovada.ts`, linhas 233 a 236). Só faça com o negócio de teste, sem conversa de cliente real.

- O botão "Aprovar e deixar o agente enviar" (`_client.tsx`, linha 834) só aparece para gestor em organização com o agente de Propostas da Equipe pronta instalado (`app/app/proposals/[id]/page.tsx`, linha 27). Sem a equipe instalada o botão não existe: isso é o esperado, e a aprovação fica fora do roteiro.
- Com o botão: clique nele.

Resultado esperado: `POST /api/v1/proposals/<id>/approve` responde `200` com `data.envio.enviada: false` e uma frase que começa por "Aprovada." Para negócio sem conversa, a frase esperada é "Aprovada. O agente não enviou porque não há conversa ou WhatsApp conectado por onde enviar." (motivo `sem_canal`, linhas 113 e 114); qual trava responde primeiro num negócio sem contato: (a confirmar). Abaixo dos botões aparece "Aprovada para o agente enviar. Editar a proposta desfaz a aprovação." (`_client.tsx`, linha 819). No banco:

```sql
select revision, aprovada_em, aprovada_na_revisao from public.crm_proposals where id = '<PROPOSTA>';
-- esperado: aprovada_em preenchida e aprovada_na_revisao = revision
```

- Depois mude o título e clique em "Salvar". A frase "Aprovada para o agente enviar" some, e `crm_get_proposal` continua mostrando `rascunho`.

O que prova: as colunas da 9814 existem, a rota grava a aprovação e o gatilho da 9815 invalida a aprovação quando o rascunho é editado.

Limpeza: "Descartar rascunho" (`_client.tsx`, linha 838).

### Passo 9. Comentários do Instagram em modo registrar (PRs #12, #16, #18; migrations 9810, 9812, 9816, 9819)

Onde fica a configuração: menu "Conexões" (`/app/connections`), cartão Facebook / Instagram. O cartão de cada conta do Instagram mostra o estado "Desligado", "Registrando" ou "Ativo" e um seletor de modo (`components/connections/ConexaoDiretaMeta.tsx`, linhas 98 e 99, ponta `ig-c`). O padrão é Desligado. A troca chama `POST /api/v1/channels/meta-social` com `{ "acao": "comentarios_modo", "channel_session_id": "...", "modo": "registrar" }` (`app/api/v1/channels/meta-social/route.ts`, linhas 13, 101 e 196) e grava a auditoria `channel.comentarios_modo_alterado` (linha 203).

O que dá para provar SEM a Meta:

```bash
curl -sS -w '\n%{http_code}\n' "$BASE/api/v1/social-comments" -H "Authorization: Bearer $TOKEN_GERENTE"
curl -sS -w '\n%{http_code}\n' "$BASE/api/v1/social-comments" -H "Authorization: Bearer $TOKEN"
curl -sS -w '\n%{http_code}\n' -X POST "$BASE/api/v1/webhooks/meta-social" -H 'Content-Type: application/json' -d '{}'
```

- A primeira responde `200` com `{"data":[...],"meta":{"cursor":...,"has_more":false}}` (`app/api/v1/social-comments/route.ts`, linhas 29 a 33). Isso prova que a tabela `social_comments` (9810, 9812) existe e que o caminho aceita bearer (`lib/auth/public-paths.ts`, linhas 223 a 225, ponta `ig-c`).
- A segunda, com token sem `role:manager`, é recusada com o código `forbidden_role` (`lib/api/auth-dual.ts`, linha 125). O status HTTP exato, que vem do erro: (a confirmar; o esperado é `403`).
- A terceira responde `401` com código `unauthorized` e mensagem `invalid_signature` (`app/api/v1/webhooks/meta-social/route.ts`, linha 55). Por isso não dá para injetar um comentário falso sem o segredo do app da Meta.
- Na tela: `$BASE/app/inbox/comentarios` abre para gerente ou administrador com o título "Comentários" e, sem comentário, a frase "Nenhum comentário por aqui." (`components/comentarios/ComentariosClient.tsx`, linha 373). Para papel menor, redireciona para `/app/inbox` (`app/app/inbox/comentarios/page.tsx`, linha 42).
- No `tools/list` do passo 6 aparecem as seis `crm_*comment*`.

O que só dá para provar COM a Meta real (conta do Instagram conectada, permissão `instagram_manage_comments` concedida e o campo de comentários assinado no painel da Meta, passo manual de `docs/integracao/comentarios-do-instagram.md`):

- Ponha a conta em "Registrando". Comente numa publicação com uma conta pessoal de teste.
- Resultado esperado: o comentário aparece na tela de Comentários com o texto inteiro. Clique em "Responder", escreva e envie: a resposta ganha o selo "Simulada" e a frase "Resposta simulada: a conexão estava em modo de registro, então nada foi publicado." (linhas 128 e 162). No Instagram NADA aparece.
- "Ocultar" nesse modo só anota: o diálogo diz "Com a conexão em modo de registro, a ocultação fica só anotada e nada muda no Instagram." (linha 619).
- No código: `simulada = modo === "registrar"` e a Meta não é chamada (`lib/comentarios/acoes.ts`, linhas 510 a 516). Com a conta em Desligado, responder devolve `409 comentarios_desligados` (linha 345).
- NÃO passe para "Ativo" no teste de fumaça: nesse modo a resposta é publicada à vista de todos.
- Se o comentário não chegar com a conta em Registrando, o primeiro suspeito é a assinatura do campo no painel da Meta, não o deploy: (a confirmar em produção).

O que prova: recebimento, tela e o modo de registro funcionam sem publicar nada. Ao terminar, devolva o modo ao que estava.

### Passo 10. Equipe pronta V2 (PRs #22 e #24) sem falar com cliente real

O que fazer (só leitura e conferência):

1. Abra `$BASE/app/ai/equipe-pronta` como gerente ou administrador (`docs/arvisx/EQUIPE-PRONTA.md`, seção "A tela", ponta `ep-b`).
2. Se a equipe NÃO está instalada na organização: a tela mostra o questionário. O teste termina aqui; não instale em produção como parte do teste de fumaça.
3. Se está instalada: o Painel mostra o modo (ensaio ou ativo), o checklist e um cartão por agente (quatro, publicados). Confira que o modo é o MESMO de antes do deploy.
4. Quem instalou antes dos gatilhos vê o aviso "Os gatilhos da equipe ainda não foram instalados" (`app/app/ai/equipe-pronta/_components/Painel.tsx`, linha 153; campo `gatilhos_que_faltam` do `GET /api/v1/ai/equipe-pronta`, `lib/ai/equipe-pronta/estado.ts`, linha 388). O aviso é ESPERADO numa equipe instalada na V1 e prova que o #24 está no ar. Instalar de novo substitui a régua de silêncio e os fluxos da equipe: é decisão do dono, não passo deste roteiro.
5. No `tools/list` do passo 6 aparecem `crm_update_contact` e `crm_send_proposal`.
6. Conferência do índice da 9817:

```sql
select indexname from pg_indexes where indexname = 'crm_tasks_seguimento_do_ganho_uidx';   -- esperado: 1 linha
```

O que NÃO fazer: clicar em "Ativar"; aprovar proposta de negócio com conversa de cliente real (passo 8d); registrar falta em compromisso de cliente real (dispara o fluxo "Equipe pronta · Faltou ao compromisso"); marcar como ganho um negócio real só para ver a tarefa "Dar seguimento ao negócio ganho".

Teste opcional, só com a equipe em ensaio e o SEU número cadastrado como número de teste: converse pelo telefone de teste e veja a equipe responder. Em ensaio a IA só responde os números de teste (`docs/arvisx/EQUIPE-PRONTA.md`, seção "Ensaio e ativação").

O que prova: a tela e o estado da equipe carregam com o código novo, o modo não mudou sozinho e os gatilhos são detectados.

### Passo 11. Eventos para sistemas externos (PR #15)

O que fazer:

1. Tenha um receptor HTTPS público que VOCÊ controla e que mostre o corpo recebido. Endereço interno é recusado pela trava anti-SSRF (`lib/automation/actions/call-webhook.ts`, linha 5, ponta `pr-3`). Se usar um serviço público de captura de requisições, só mande os registros de teste deste roteiro.
2. Menu "Webhooks" (`/app/webhooks`), aba das automações (nome da aba: (a confirmar)), botão "Nova automação" (`app/app/webhooks/_components/RulesTab.tsx`, linha 99).
3. Gatilho: "Quando alguém escrever uma nota no negócio" (`app/app/webhooks/_components/labels.ts`, linha 79; evento `lead.note_added`, `lib/schemas/webhooks.ts`, linha 113). Ação: "Avisar outro sistema (webhook)" (`labels.ts`, linha 98), com a URL do receptor. Salve e deixe ativa.
4. Grave uma nota NOVA no negócio de teste: repita o passo 4 com outro texto e outra `Idempotency-Key`.

Resultado esperado no receptor, em alguns segundos: um `POST` com os cabeçalhos `X-Webhook-Event: lead.note_added`, `X-Webhook-Delivery: <uuid>` e `X-Webhook-Attempt: 1`, e o corpo com `event: "lead.note_added"`, `happened_at`, `delivery_id`, `data.note_id` e `data.note` com `id`, `lead_id`, `text` (o texto INTEIRO), `author` (`kind`, `id`, `name`), `recipient` e `created_at` (`docs/integracao/webhooks-de-saida.md`, seções 1 e 2 e linhas 270 a 289, ponta `pr-3`). O receptor deve responder `2xx`; fora disso o CRM tenta 3 vezes.

Variante opcional (PR #20, migration 9811): uma segunda regra com o gatilho `conversation.ai_paused`. Ao clicar em "Assumir" no passo 7b, o receptor recebe o evento com `paused_until`, `durable` e `human_assigned`.

O que prova: os gatilhos novos estão na fonte única, a emissão acontece na escrita feita pelo agente e a entrega leva o texto inteiro.

Limpeza: desative ou apague a regra de teste.

### Passo 12. Não-regressão rápida

12a. WhatsApp: do telefone de teste, mande "teste de fumaça" para o número da organização. Pela tela, abra a conversa no Inbox e responda "ok, teste".

Resultado esperado: a mensagem recebida aparece no Inbox em segundos; a resposta chega ao telefone e fica com o estado de enviada ou entregue na tela.

12b. Auditoria: menu "Audit Log" (`/app/audit`, `lib/navigation/catalogo.ts`, linha 976), filtrando o período do teste. Ou no banco:

```sql
select action, actor_api_token_id is not null as por_token, count(*)
  from public.api_audit_log
 where created_at > now() - interval '2 hours'
   and action in ('lead.note_added', 'crm_task.created', 'crm_task.updated',
                  'conversation.closed', 'proposal.aprovada_para_o_agente',
                  'channel.comentarios_modo_alterado')
 group by 1, 2 order by 1;
```

Resultado esperado: `lead.note_added` por token (passos 4 e 11; `lib/mcp/tools/notas-do-negocio.ts`, linha 183), `crm_task.created` e `crm_task.updated` por token (passo 5; `lib/tarefas/servico.ts`, linhas 226 e 338), `conversation.closed` uma vez por token (7a) e uma vez por pessoa (7c), `proposal.aprovada_para_o_agente` (8d, se feito; `proposta-aprovada.ts`, linha 223) e `channel.comentarios_modo_alterado` (passo 9, se o modo foi trocado). A nota repetida do passo 4 e a recusa do passo 7b NÃO geram essas linhas. A tabela é `api_audit_log` (`lib/audit/index.ts`, linha 84); o nome da coluna de data (`created_at`) e se a tela `/app/audit` mostra as chamadas de ferramenta do MCP: (a confirmar).

12c. Evento da 9811, depois do "Assumir" do passo 7b:

```sql
select event_type, created_at from public.event_log
 where event_type in ('conversation.ai_paused', 'conversation.ai_resumed')
 order by created_at desc limit 5;
```

Resultado esperado: ao menos uma linha `conversation.ai_paused` na hora do teste. Os nomes das colunas de `event_log`: (a confirmar).

O que prova: o caminho quente (receber e enviar mensagem) segue de pé com o gatilho novo em `conversations`, e toda escrita do roteiro ficou com autoria.

### Passo 13. Critério de rollback

Volte a imagem se aparecer qualquer um destes:

- Passo 0: `FALHOU:` no log do `init`, ou menos de 12 linhas na consulta. Primeiro tente entender a migration que falhou; o app novo sobre schema parcial não deve receber tráfego.
- Passo 1: `/api/v1/health` em `503`, ou `/` e `/login` com erro 5xx.
- Passo 2: ninguém consegue entrar.
- Passo 8b: `409 proposal_context_stale` no segundo salvar de uma proposta, com a imagem nova no ar.
- Passo 12a: mensagem de WhatsApp não entra ou não sai, e antes do deploy funcionava.
- Erros 5xx em sequência no Inbox, no funil ou no MCP (`-32603` em `tools/list`).

NÃO mandam voltar, só corrigir depois: falta de uma ferramenta nova no passo 6 com o resto funcionando, tela de Comentários vazia, aviso dos gatilhos da Equipe pronta, webhook de teste que não chega por causa do receptor.

Como voltar:

1. Reimplante a imagem anterior (`APP_IMAGE` da main `f48146edb`).
2. **Rode a reversão da 9815 da seção 6.2.** Sem ela, o editor de proposta da imagem antiga dá `409` no segundo salvar (seção 6.1, 9815). É a única migration do lote que não volta só com a imagem.
3. Tire a linha da 9815 de `deploy/arvisx/crm/migracoes-pos-baseline.txt` no checkout, ou volte o checkout. A lista vem do checkout, não da imagem: se a linha ficar, o próximo deploy reaplica a 9815 (regras da seção 6.2).
4. As outras 11 migrations podem ficar aplicadas com a imagem antiga (tabela-resumo), e a 9824 também, se tiver subido (seção 6.1, 9824). Com a 9811 no banco, `event_log` segue recebendo `conversation.ai_paused` e `conversation.ai_resumed`.
5. Repita os passos 1, 2, 8b e 12a com a imagem antiga.

### Limpeza do teste

- Feche como perdido ou arquive o negócio "TESTE FUMACA 2026-11". A nota do negócio não pode ser apagada pelo produto (`docs/arvisx/SUPERFICIE-DE-AGENTE.md`, linha 85, ponta `aj-4`), por isso o negócio de teste deve ser arquivado.
- Descarte o rascunho de proposta, apague a regra de webhook de teste e devolva o modo dos comentários ao valor anterior.
- Revogue `$TOKEN` e `$TOKEN_GERENTE` se foram criados só para o teste.
