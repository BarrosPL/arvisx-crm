-- manifest: **Tarefa com tipo e resultado.** Duas colunas novas em `crm_tasks`, as duas opcionais e de texto livre: `kind` (o tipo da tarefa, como a equipe o chama) e `result` (o que foi feito, escrito por quem concluiu). São o que as ferramentas de tarefa do agente (`crm_create_task`, `crm_complete_task`) gravam. Nenhuma linha existente muda: as duas nascem nulas.
--
-- 9809 — a tarefa ganha TIPO e RESULTADO.
--
-- Faixa 98xx, a do fork (ArvisX CRM), pela mesma razão da 9800 a 9808.
--
-- ═══ Por quê ═══
--
-- A tarefa (`crm_tasks`, migration 0210) nasceu para a tela: título, prazo,
-- prioridade, responsável. Os agentes — externos, por token de API, e nativos —
-- passam a criar e concluir tarefa por MCP (`lib/mcp/tools/tarefas.ts`), e
-- precisam dizer duas coisas que a tabela não tinha onde guardar:
--
--  * de que TIPO é a tarefa (uma ligação, um documento a conferir…), para a
--    equipe e outro agente filtrarem;
--  * o RESULTADO: o que foi feito, em texto, quando a tarefa é concluída. Sem
--    isto, "concluída" é só um estado, e quem lê depois não sabe o desfecho.
--
-- ═══ O que muda ═══
--
-- 1. `crm_tasks.kind` (text, nula). Texto LIVRE, sem CHECK de vocabulário de
--    propósito: tipo de tarefa é coisa de cada operação, e uma lista fechada no
--    banco seria o vocabulário de um nicho só. O CHECK é só de tamanho, o mesmo
--    teto que o aplicativo valida (`TIPO_DA_TAREFA_MAX`), para um texto longo
--    demais não entrar por fora da validação.
--
-- 2. `crm_tasks.result` (text, nula). O texto inteiro, sem corte; o teto é o do
--    aplicativo (`RESULTADO_DA_TAREFA_MAX`), repetido aqui pelo mesmo motivo.
--
-- ═══ O que NÃO muda ═══
--
-- Nenhuma linha existente é tocada (as colunas nascem nulas, e os CHECKs
-- aceitam nulo — por isso não há backfill nem risco para quem atualiza um banco
-- com dados). RLS, grants e índices de `crm_tasks` ficam como estão: as colunas
-- herdam a política da tabela. A tela de Tarefas não lê as colunas novas.
--
-- Idempotente: pode ser reaplicada.

alter table public.crm_tasks
  add column if not exists kind text;

alter table public.crm_tasks
  add column if not exists result text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'crm_tasks_kind_tamanho'
       and conrelid = 'public.crm_tasks'::regclass
  ) then
    alter table public.crm_tasks
      add constraint crm_tasks_kind_tamanho
      check (kind is null or (length(btrim(kind)) > 0 and length(kind) <= 60));
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'crm_tasks_result_tamanho'
       and conrelid = 'public.crm_tasks'::regclass
  ) then
    alter table public.crm_tasks
      add constraint crm_tasks_result_tamanho
      check (result is null or length(result) <= 20000);
  end if;
end
$$;

comment on column public.crm_tasks.kind is
  'Tipo da tarefa, em texto livre (como a equipe o chama). Sem vocabulário no banco: cada operação tem os seus. Nulo = sem tipo. Migration 9809.';
comment on column public.crm_tasks.result is
  'O que foi feito, escrito por quem concluiu a tarefa. Texto inteiro, sem corte. Nulo = sem resultado registrado. Migration 9809.';

notify pgrst, 'reload schema';
