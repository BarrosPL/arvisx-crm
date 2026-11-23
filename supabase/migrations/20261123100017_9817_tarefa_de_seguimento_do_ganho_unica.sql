-- manifest: **Uma tarefa de seguimento por negócio ganho, garantida pelo banco.** O gatilho "negócio ganho" da Equipe de IA pronta cria a tarefa "Dar seguimento ao negócio ganho" (`crm_tasks.kind = 'dar_seguimento'`) e evitava a duplicata com um SELECT antes do INSERT; o evento `lead.won` é entregue ao menos uma vez (o dreno do `event_log` reexecuta a linha), e duas entregas simultâneas passavam as duas pelo SELECT e criavam duas tarefas. Índice único parcial novo `crm_tasks_seguimento_do_ganho_uidx` em `(organization_id, lead_id)` onde `kind = 'dar_seguimento'` e `lead_id` não é nulo: a segunda inserção falha com 23505 e o gatilho devolve a tarefa que já existe. Antes de criar o índice, as tarefas repetidas que já existirem (a mais antiga de cada negócio fica) têm o tipo trocado para `dar_seguimento_repetida`: nenhuma tarefa é apagada.
--
-- 9817 — a tarefa de seguimento do negócio ganho é única por negócio.
--
-- Faixa 98xx, a do fork (ArvisX CRM), pela mesma razão da 9800 a 9815.
--
-- ═══ Por quê (revisão de 20/11/2026, item 2.8) ═══
--
-- `lib/ai/equipe-pronta/gatilhos/negocio-ganho.ts` consome o evento `lead.won`
-- e cria UMA tarefa de seguimento por negócio ("uma por negócio, para sempre":
-- reabrir e ganhar de novo não cria a segunda). A idempotência era
-- "procura a tarefa do negócio com o tipo `dar_seguimento`; não achou, cria".
-- Procurar e criar são duas idas ao banco: o dreno do `event_log` entrega ao
-- menos uma vez, e duas execuções do mesmo evento (ou do ganho regravado) que
-- rodem juntas leem "não existe" e criam duas.
--
-- ═══ O que muda ═══
--
-- 1. Correção do que já existe, ANTES do índice (senão a criação dele falha num
--    banco que já tem a repetição): em cada negócio com mais de uma tarefa
--    `dar_seguimento`, a mais antiga (`created_at`, depois `id`) fica como
--    está; as outras passam a `kind = 'dar_seguimento_repetida'`. Nenhuma
--    tarefa é apagada, concluída ou cancelada: quem a recebeu continua vendo.
--
-- 2. `crm_tasks_seguimento_do_ganho_uidx`: único em `(organization_id,
--    lead_id)`, parcial em `kind = 'dar_seguimento' and lead_id is not null`.
--    Tarefa sem negócio e tarefa de qualquer outro tipo não entram no índice.
--    Negócio apagado deixa `lead_id` nulo (FK `on delete set null`) e a linha
--    sai do índice sozinha.
--
-- `dar_seguimento` passa a ser um tipo RESERVADO: quem tentar criar à mão (ou
-- pela ferramenta `crm_create_task`) a segunda tarefa desse tipo no mesmo
-- negócio recebe a recusa de gravação. O campo `kind` continua texto livre para
-- todo o resto.
--
-- ═══ O que NÃO muda ═══
--
-- Colunas, RLS, grants e os outros índices de `crm_tasks`. Sem função nova.
--
-- Idempotente: pode ser reaplicada (a correção não acha mais repetição, e o
-- índice é `if not exists`).

-- ── 1. o que já estiver repetido deixa de ter o tipo reservado ────────────
update public.crm_tasks t
   set kind = 'dar_seguimento_repetida'
  from (
    select id,
           row_number() over (
             partition by organization_id, lead_id
             order by created_at asc, id asc
           ) as ordem
      from public.crm_tasks
     where kind = 'dar_seguimento'
       and lead_id is not null
  ) r
 where t.id = r.id
   and r.ordem > 1;

-- ── 2. o índice ───────────────────────────────────────────────────────────
create unique index if not exists crm_tasks_seguimento_do_ganho_uidx
  on public.crm_tasks (organization_id, lead_id)
  where kind = 'dar_seguimento' and lead_id is not null;

comment on index public.crm_tasks_seguimento_do_ganho_uidx is
  'Uma tarefa de seguimento do ganho (kind = dar_seguimento) por negócio: o gatilho da Equipe pronta é entregue ao menos uma vez. Migration 9817.';

notify pgrst, 'reload schema';
