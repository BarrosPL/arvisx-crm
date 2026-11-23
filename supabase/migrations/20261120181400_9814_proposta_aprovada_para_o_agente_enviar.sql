-- manifest: **Aprovação da proposta para o agente enviar.** Duas colunas novas em `crm_proposals`, as duas opcionais: `aprovada_em` (quando a equipe aprovou o rascunho) e `aprovada_na_revisao` (a `revision` aprovada). A aprovação só vale enquanto a revisão aprovada for a atual, então editar o rascunho a invalida sem código a mais. É o que a ferramenta `crm_send_proposal` lê no modo `apos_aprovacao`. `fn_crm_proposals_transicao_da_sessao` é recriada com as duas colunas na lista do que só o servidor grava: a sessão não aprova pelo PostgREST. Nenhuma linha existente muda.
--
-- 9814 — a proposta ganha a APROVAÇÃO da equipe.
--
-- Faixa 98xx, a do fork (ArvisX CRM), pela mesma razão da 9800 a 9809.
--
-- ═══ Por quê ═══
--
-- Na Equipe de IA pronta v2 o agente de Propostas ENVIA a proposta. O modo
-- padrão da empresa é `apos_aprovacao`: a equipe aprova o rascunho e o agente
-- envia. A proposta não tinha onde guardar essa aprovação: o status vai de
-- `rascunho` direto a `enviando`, e não existe status "aprovada" (nem no CHECK
-- `crm_proposals_status_check`, nem no tipo do aplicativo).
--
-- ═══ Por que colunas, e não um status novo ═══
--
-- Um status `aprovada` mexeria em tudo o que hoje trata `rascunho` como "o que
-- se edita e se envia": o PATCH, o envio (`decidirVersao`), as policies de RLS
-- desta tabela e de `crm_proposal_items`, o gatilho de transição e as telas. A
-- proposta aprovada CONTINUA sendo um rascunho até sair; o que muda é que
-- alguém da equipe disse "pode enviar". Isso é um fato sobre o rascunho, e cabe
-- em duas colunas.
--
-- ═══ O que muda ═══
--
-- 1. `crm_proposals.aprovada_em` (timestamptz, nula) e
--    `crm_proposals.aprovada_na_revisao` (bigint, nula), sempre juntas (CHECK).
--    A aprovação VALE quando `aprovada_na_revisao = revision`. Toda edição do
--    rascunho soma um em `revision` (PATCH e assistente), então editar depois
--    de aprovar invalida a aprovação: ninguém aprova um valor e o agente envia
--    outro.
--
-- 2. `fn_crm_proposals_transicao_da_sessao` (0464) é recriada com as duas
--    colunas em `v_envio`, a lista do que só o servidor escreve. Sem isso, um
--    atendente (`agent`) aprovaria o próprio rascunho por PostgREST e o agente
--    de IA enviaria, quando enviar pela tela exige `manager`. Quem grava a
--    aprovação é a rota do servidor, depois de conferir o papel.
--
-- ═══ O que NÃO muda ═══
--
-- Nenhuma linha existente é tocada (as colunas nascem nulas e o CHECK aceita
-- o par nulo). Status, RLS, grants e índices ficam como estão. O gatilho segue
-- com o mesmo nome, na mesma tabela; só o corpo da função é trocado.
--
-- Idempotente: pode ser reaplicada.

alter table public.crm_proposals
  add column if not exists aprovada_em timestamptz;

alter table public.crm_proposals
  add column if not exists aprovada_na_revisao bigint;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'crm_proposals_aprovacao_inteira'
       and conrelid = 'public.crm_proposals'::regclass
  ) then
    alter table public.crm_proposals
      add constraint crm_proposals_aprovacao_inteira
      check ((aprovada_em is null) = (aprovada_na_revisao is null));
  end if;
end
$$;

comment on column public.crm_proposals.aprovada_em is
  'Quando a equipe aprovou este rascunho para o agente enviar. Nulo = não aprovada. Só o servidor grava. Migration 9814.';
comment on column public.crm_proposals.aprovada_na_revisao is
  'A revisão (coluna revision) que a equipe aprovou. A aprovação só vale enquanto for igual à revisão atual: editar o rascunho a invalida. Migration 9814.';

-- A sessão não aprova: a aprovação entra na lista do que só o servidor escreve.
-- Corpo igual ao da 0464, com as duas colunas acrescentadas a `v_envio`.
create or replace function public.fn_crm_proposals_transicao_da_sessao()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  -- o que só o ENVIO escreve (numeração, arquivo, mensagem, retorno) e a
  -- aprovação da equipe (9814), que só o servidor grava
  v_envio constant text[] := array['numero', 'ano', 'versao', 'substitui_id', 'sent_at',
    'sent_by_user_id', 'pdf_path', 'message_id', 'retorno_id', 'template_snapshot', 'rendered_snapshot',
    'aprovada_em', 'aprovada_na_revisao'];
  -- o que decidir e descartar mudam
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
    -- editar o rascunho: o conteúdo muda, o que é do envio não
    if exists (select 1 from unnest(v_envio) k where v_new -> k is distinct from v_old -> k) then
      raise exception 'proposta_envio_e_do_servidor' using errcode = '42501';
    end if;
  elsif (old.status = 'enviada' and new.status in ('aceita', 'recusada'))
     or (old.status = 'rascunho' and new.status = 'cancelada'
         and public.fn_role_at_least(new.organization_id, 'manager')) then
    -- decidir (agent) ou descartar (manager): só a decisão muda
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

notify pgrst, 'reload schema';
