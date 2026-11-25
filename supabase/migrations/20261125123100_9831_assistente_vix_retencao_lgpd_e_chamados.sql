-- manifest: **Vix: o histórico some com 30 dias, a anonimização de LGPD alcança o texto do assistente e o chamado ganha "visto" e "resolvido".** `fn_expurgar_historico_do_assistente` (piso de 7 dias no corpo, só `service_role`) apaga em lotes mensagens, cartões, conversas vazias e chamados resolvidos vencidos, chamada pelo cron `data-retention`. O gatilho `trg_assistente_esquece_ao_anonimizar` em `contacts` apaga o texto do assistente da organização quando um contato é anonimizado. `assistente_chamados` ganha `visto_em`, `visto_por`, `resolvido_em` e `resolvido_por`.
--
-- 9831 — retenção e LGPD do histórico do Vix, e a leitura do chamado.
--
-- Faixa 98xx, a do fork (ArvisX CRM).
--
-- ═══ Por quê ═══
--
-- A 9830 criou o histórico do assistente sem prazo e sem ligação com a
-- anonimização de contato. A resposta do assistente pode citar o nome, o
-- telefone ou o assunto de um contato, e esse texto ficava guardado para
-- sempre, inclusive depois de o contato ser anonimizado.
--
-- ═══ O que muda ═══
--
-- A. PRAZO. `fn_expurgar_historico_do_assistente(dias, limite)`: apaga, da
--    ponta mais velha, cartões e mensagens com mais de N dias, depois as
--    conversas que ficaram vazias e os chamados RESOLVIDOS há mais de N dias.
--    Padrão 30, piso 7 NO CORPO (quem chama não consegue encurtar abaixo
--    disso). Sem seletor de linha: não recebe organização, usuário nem id.
--    `assistente_usos` NÃO entra: não guarda texto e é a conta do limite do mês.
--    Chamado aberto ou em andamento NÃO é apagado por idade.
--
-- B. LGPD. O histórico do assistente não tem chave para o contato: o texto é
--    livre. Não há como apagar "as mensagens daquele contato" sem adivinhar
--    por semelhança de texto, e adivinhar deixa passar. Por isso a regra é
--    larga de propósito: quando um contato da organização é anonimizado, o
--    TEXTO do assistente daquela organização inteira é apagado (mensagens e
--    cartões apagados; título das conversas, resumo e diagnóstico dos chamados
--    trocados por um marcador). É o mesmo desenho de gatilho da 0391/0494
--    (`fn_redigir_conversas_ao_anonimizar`): roda nos dois caminhos de
--    anonimização, dentro da mesma transação, e NÃO reescreve
--    `fn_lgpd_cascade_redact_contact`.
--    O que NÃO cobre: contato apagado por DELETE comum (sem anonimização).
--
-- C. CHAMADO. `visto_em/visto_por` e `resolvido_em/resolvido_por`, escritos só
--    pelo servidor, na tela da equipe da plataforma. A leitura da empresa não
--    muda (policy da 9830: o autor e gerente para cima, só da própria empresa).
--
-- Gate: tests/invariants/assistente-retencao-lgpd-e-chamados.test.ts.

-- ── C. o chamado ganha visto e resolvido ─────────────────────────────────────
alter table public.assistente_chamados
  add column if not exists visto_em timestamptz,
  add column if not exists visto_por uuid references auth.users(id) on delete set null,
  add column if not exists resolvido_em timestamptz,
  add column if not exists resolvido_por uuid references auth.users(id) on delete set null;

create index if not exists idx_assistente_chamados_estado
  on public.assistente_chamados (estado, created_at desc);

-- ── A. o prazo do histórico ──────────────────────────────────────────────────
create index if not exists idx_assistente_mensagens_idade
  on public.assistente_mensagens (created_at);
create index if not exists idx_assistente_acoes_idade
  on public.assistente_acoes (created_at);

create or replace function public.fn_expurgar_historico_do_assistente(
  p_retencao_dias int default null,
  p_limite int default null
) returns int
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_dias int := greatest(coalesce(p_retencao_dias, 30), 7);
  v_limite int := least(greatest(coalesce(p_limite, 1000), 1), 10000);
  v_corte timestamptz := now() - make_interval(days => v_dias);
  v_total int := 0;
  v_n int;
begin
  with vencidas as (
    select id from public.assistente_acoes
     where created_at < v_corte
     order by created_at limit v_limite
  )
  delete from public.assistente_acoes a using vencidas v where a.id = v.id;
  get diagnostics v_n = row_count;
  v_total := v_total + v_n;

  if v_total < v_limite then
    with vencidas as (
      select id from public.assistente_mensagens
       where created_at < v_corte
       order by created_at limit (v_limite - v_total)
    )
    delete from public.assistente_mensagens m using vencidas v where m.id = v.id;
    get diagnostics v_n = row_count;
    v_total := v_total + v_n;
  end if;

  -- Só a conversa que ficou VAZIA e é velha: a que ainda tem mensagem ou
  -- cartão dentro do prazo continua, com o que sobrou.
  if v_total < v_limite then
    with vazias as (
      select c.id from public.assistente_conversas c
       where c.updated_at < v_corte
         and c.created_at < v_corte
         and not exists (select 1 from public.assistente_mensagens m where m.conversa_id = c.id)
         and not exists (select 1 from public.assistente_acoes a where a.conversa_id = c.id)
       order by c.created_at limit (v_limite - v_total)
    )
    delete from public.assistente_conversas c using vazias v where c.id = v.id;
    get diagnostics v_n = row_count;
    v_total := v_total + v_n;
  end if;

  if v_total < v_limite then
    with vencidos as (
      select id from public.assistente_chamados
       where estado = 'resolvido'
         and coalesce(resolvido_em, updated_at) < v_corte
       order by created_at limit (v_limite - v_total)
    )
    delete from public.assistente_chamados h using vencidos v where h.id = v.id;
    get diagnostics v_n = row_count;
    v_total := v_total + v_n;
  end if;

  return v_total;
end;
$$;
revoke all on function public.fn_expurgar_historico_do_assistente(int,int) from public;
revoke execute on function public.fn_expurgar_historico_do_assistente(int,int) from anon, authenticated;
grant execute on function public.fn_expurgar_historico_do_assistente(int,int) to service_role;

comment on function public.fn_expurgar_historico_do_assistente(int,int) is
  'Apaga em lotes o histórico do Vix com mais de N dias (padrão 30, piso 7 no corpo): cartões, mensagens, conversas vazias e chamados resolvidos. Sem seletor de linha. Chamada pelo cron data-retention. Migration 9831.';

-- ── B. a anonimização de contato alcança o texto do assistente ───────────────
create or replace function public.fn_assistente_esquece_ao_anonimizar()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  delete from public.assistente_acoes where organization_id = new.organization_id;
  delete from public.assistente_mensagens where organization_id = new.organization_id;
  update public.assistente_conversas
     set titulo = null, updated_at = now()
   where organization_id = new.organization_id and titulo is not null;
  update public.assistente_chamados
     set resumo = '[texto removido: anonimização de contato]',
         diagnostico = '{}'::jsonb,
         updated_at = now()
   where organization_id = new.organization_id
     and resumo <> '[texto removido: anonimização de contato]';
  return null;
end;
$$;
revoke all on function public.fn_assistente_esquece_ao_anonimizar() from public;
revoke execute on function public.fn_assistente_esquece_ao_anonimizar() from anon, authenticated;

drop trigger if exists trg_assistente_esquece_ao_anonimizar on public.contacts;
create trigger trg_assistente_esquece_ao_anonimizar
  after update of is_anonymized on public.contacts
  for each row
  when (new.is_anonymized is true and old.is_anonymized is distinct from true)
  execute function public.fn_assistente_esquece_ao_anonimizar();
