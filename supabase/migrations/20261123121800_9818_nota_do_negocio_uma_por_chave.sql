-- manifest: **A nota do negócio não entra em dobro.** Índice único parcial em `crm_lead_activities` sobre (organização, negócio, `payload->>'idempotency_key'`), só para as notas gravadas pelo módulo de notas (`type = 'note'`, `source_module = 'notas'`) que trazem a chave. Antes a repetição era barrada por uma leitura seguida de uma gravação, e duas chamadas simultâneas com a mesma `Idempotency-Key` gravavam a nota duas vezes. Notas já duplicadas não são apagadas: a mais antiga fica com a chave e as demais passam a guardá-la em `idempotency_key_repetida`.
--
-- 9818 — a nota do negócio: UMA por chave de idempotência.
--
-- Faixa 98xx, a do fork (ArvisX CRM), pela mesma razão da 9800 a 9809.
--
-- ═══ Por quê ═══
--
-- `crm_add_lead_note` (`lib/mcp/tools/notas-do-negocio.ts`) grava a nota com a
-- `Idempotency-Key` do pedido dentro do `payload`, para o agente que repete a
-- chamada depois de um timeout não deixar o recado duas vezes. Quem barrava a
-- repetição era o aplicativo: uma leitura ("já existe nota com esta chave neste
-- negócio?") seguida do INSERT. Duas chamadas simultâneas passam as duas pela
-- leitura antes de qualquer uma gravar — e a nota entra em dobro, com o mesmo
-- texto, o mesmo autor e a mesma chave (revisão de 20/11, item 2.13).
--
-- Quem decide corrida é o banco. Com o índice único, a segunda gravação recebe
-- `23505`, e o aplicativo devolve a nota que a primeira gravou
-- (`registrarNotaDoNegocio`, `lib/leads/notas-do-negocio.ts`).
--
-- ═══ O que muda ═══
--
-- 1. As notas que JÁ estão em dobro (mesma organização, mesmo negócio, mesma
--    chave) são corrigidas antes do índice — senão ele não sobe num banco com
--    dados. Nada é apagado: a nota é registro com autoria. A mais antiga de
--    cada grupo fica como está; nas demais a chave sai de `idempotency_key` e
--    passa para `idempotency_key_repetida`. O texto, o autor e a data não mudam.
--
-- 2. `uq_crm_lead_activities_nota_idempotencia`: único e PARCIAL. Só alcança
--    `type = 'note'` com `source_module = 'notas'` e chave presente. As outras
--    linhas da timeline (mudança de etapa, tarefa, documento, nota de formulário)
--    não entram no índice e não mudam de comportamento.
--
-- ═══ O que NÃO muda ═══
--
-- Nenhuma coluna, nenhuma policy, nenhum grant. Nota sem chave (a maioria)
-- continua podendo se repetir: quem cuida dela é o recibo do pedido
-- (`idempotency_keys`), no aplicativo.
--
-- Idempotente: pode ser reaplicada. Na segunda passada não há repetida para
-- corrigir e o índice já existe.

with repetidas as (
  select id,
         row_number() over (
           partition by organization_id, lead_id, payload->>'idempotency_key'
           order by performed_at, created_at, id
         ) as ordem
    from public.crm_lead_activities
   where type = 'note'
     and source_module = 'notas'
     and payload->>'idempotency_key' is not null
)
update public.crm_lead_activities a
   set payload = (a.payload - 'idempotency_key')
                 || jsonb_build_object('idempotency_key_repetida', a.payload->>'idempotency_key')
  from repetidas r
 where r.id = a.id
   and r.ordem > 1;

create unique index if not exists uq_crm_lead_activities_nota_idempotencia
  on public.crm_lead_activities (organization_id, lead_id, (payload->>'idempotency_key'))
  where type = 'note'
    and source_module = 'notas'
    and payload->>'idempotency_key' is not null;

comment on index public.uq_crm_lead_activities_nota_idempotencia is
  'Uma nota do negócio por Idempotency-Key (migration 9818): decide no banco a corrida entre duas chamadas simultâneas de crm_add_lead_note. Parcial — só type=note, source_module=notas, com chave.';
