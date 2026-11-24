-- manifest: **Editar o rascunho invalida a aprovação da proposta, no banco.** Quem somava um em `crm_proposals.revision` era só o código de duas rotas; a policy `crm_proposal_items_write` (0464) deixa a sessão de um atendente inserir, alterar e apagar item de rascunho pelo PostgREST sem tocar em `crm_proposals`, então a equipe aprovava a revisão R (9814) e o agente de IA enviava outro conteúdo. Dois gatilhos novos: `trg_crm_proposals_zz_edicao_sobe_revisao` (BEFORE UPDATE em `crm_proposals`: coluna de conteúdo alterada num rascunho sem a revisão subir soma um; a revisão nunca volta atrás; revisão que muda limpa `aprovada_em`/`aprovada_na_revisao`) e `trg_crm_proposal_items_sobe_revisao` (AFTER INSERT/UPDATE/DELETE em `crm_proposal_items`: soma um na revisão do rascunho dono do item, uma vez por transação). Função nova `fn_proposta_gravar_edicao` (invoker): a edição das rotas — campos, CAS da revisão e troca dos itens — numa transação só, para uma edição somar um e não três. O envio (numerar, `enviando`, voltar a rascunho na falha) não é alcançado. Nenhuma linha existente muda.
--
-- 9815 — a revisão da proposta passa a ser garantida pelo banco.
--
-- Faixa 98xx, a do fork (ArvisX CRM), pela mesma razão da 9800 a 9814.
--
-- ═══ Por quê (revisão de 20/11/2026, item 1.3) ═══
--
-- A 9814 guardou a aprovação da equipe em duas colunas e definiu que ela vale
-- enquanto `aprovada_na_revisao = revision`: "editar o rascunho soma um na
-- revisão e invalida a aprovação". Só que quem somava era o CÓDIGO de duas
-- rotas (`PATCH /proposals/[id]` e `assistant/apply`). O banco não garantia:
--
--   • `crm_proposal_items_write` (0464) abre INSERT/UPDATE/DELETE de item de
--     rascunho à sessão de um `agent`. Pelo PostgREST, o atendente troca o
--     preço do item sem tocar em `crm_proposals`: a revisão não sobe;
--   • `crm_proposals_update` deixa o `agent` editar o rascunho, e o gatilho de
--     transição só protege as colunas do envio. `update ... set condicoes = …`
--     sem `revision = revision + 1` também não invalida nada;
--   • as rotas do documento (`/documento`, `/modelo`) trocam `briefing_json`,
--     `secoes_editadas` e o modelo sem somar a revisão.
--
-- Resultado: a equipe aprova a revisão R e o agente de IA envia ao cliente um
-- conteúdo que ninguém aprovou.
--
-- ═══ O que muda ═══
--
-- 1. `fn_crm_proposals_edicao_sobe_revisao` + gatilho
--    `trg_crm_proposals_zz_edicao_sobe_revisao` (BEFORE UPDATE, por linha), só
--    para o rascunho que continua rascunho:
--
--      a) mudou coluna de CONTEÚDO (`v_conteudo`) e a revisão não subiu
--         → `revision := old.revision + 1`;
--      b) a revisão desceria → `revision := old.revision + 1` (nunca volta
--         atrás: senão a sessão devolveria o rascunho ao número que a equipe
--         viu, e a aprovação com CAS em `revision` aprovaria outro conteúdo);
--      c) a revisão mudou → a aprovação é LIMPA (as duas colunas nulas), salvo
--         quando o mesmo comando aprova a revisão nova. Limpar, e não só
--         desencontrar, é o que impede uma aprovação velha de voltar a valer;
--      d) a revisão mudou → marca, na transação, que esta proposta já subiu
--         (`arvisx.proposta_revisao_subida`, `set_config(..., true)`).
--
--    Quem já sobe a revisão (as rotas) paga UM: a regra (a) só age quando a
--    revisão ficou igual.
--
--    ⚠️ O NOME começa por `trg_crm_proposals_zz_` DE PROPÓSITO. Gatilhos BEFORE
--    da mesma tabela rodam em ordem alfabética do nome, e este precisa rodar
--    DEPOIS de `trg_crm_proposals_transicao_da_sessao` (0464/9814): aquele
--    confere que a SESSÃO não mexeu em `aprovada_em`/`aprovada_na_revisao`
--    comparando `new` com `old`. Se este rodasse antes, a limpeza da aprovação
--    feita aqui seria lida lá como "a sessão mexeu na aprovação" e toda edição
--    de um rascunho aprovado seria recusada com `proposta_envio_e_do_servidor`.
--
-- 2. `fn_crm_proposal_items_sobe_revisao` + gatilho
--    `trg_crm_proposal_items_sobe_revisao` (AFTER INSERT OR UPDATE OR DELETE,
--    por linha): soma um na revisão do rascunho dono do item. O UPDATE em
--    `crm_proposals` dispara o gatilho 1, que limpa a aprovação e marca a
--    transação; as outras linhas do mesmo comando (e os outros comandos da
--    mesma transação) veem a marca e não somam de novo. Uma edição = +1.
--
--    A marca só dispensa enquanto a proposta NÃO está aprovada: subir a
--    revisão, aprovar e mexer no item, tudo numa transação, paga de novo.
--
--    AFTER, e não BEFORE: só conta a linha que de fato mudou (o BEFORE dispara
--    mesmo quando a RLS ou outro gatilho recusa a linha depois). UPDATE que
--    não altera nada no item não gasta revisão.
--
--    `security definer`: a soma não pode depender do que a RLS de
--    `crm_proposals` deixa a sessão ver ou gravar. Rodando como o dono, o
--    gatilho de transição (que só mede `authenticated`/`anon`) não é
--    acionado, e a função só faz uma coisa, sem parâmetro: `revision + 1` na
--    proposta do item que a própria sessão acabou de gravar (a RLS do item já
--    decidiu que ela podia). EXECUTE revogado de public, anon e authenticated.
--
--    Só rascunho: item de proposta enviada (o servidor clona a v2, a LGPD
--    redige) não mexe na revisão de documento que já saiu.
--
-- 3. `fn_proposta_gravar_edicao(p_org, p_proposta, p_revisao, p_campos,
--    p_itens)` — a edição das rotas numa transação só. Antes eram três
--    chamadas ao PostgREST (UPDATE com CAS, DELETE dos itens, INSERT dos
--    itens), cada uma na sua transação: com o gatilho 2, uma edição somaria
--    três. Aqui o UPDATE sobe a revisão, a marca fica na transação e a troca
--    dos itens não soma. De quebra a edição fica atômica (falha ao gravar os
--    itens não deixa mais o rascunho sem item nenhum).
--
--    `security invoker`: a RLS e o gatilho de transição continuam valendo para
--    a sessão que chama, exatamente como nas três chamadas de antes. Devolve a
--    revisão nova, ou NULL quando o CAS não casa (revisão velha, não é
--    rascunho, outra organização, sem papel): a rota responde o 409 de sempre.
--
-- ═══ O envio não invalida a aprovação ═══
--
-- `enviarProposta` grava, nesta ordem: `numero`/`ano` (ainda em rascunho),
-- `status = 'enviando'`, e na falha volta a `rascunho` com `ultima_falha_envio`,
-- `pdf_path` e `message_id`. Nenhuma dessas colunas é conteúdo, e o gatilho 1
-- só age em rascunho → rascunho; a transição de e para `enviando` passa direto.
-- O reenvio depois de uma falha encontra a mesma revisão e a mesma aprovação.
--
-- ═══ O que NÃO muda ═══
--
-- Nenhuma linha existente é tocada. RLS, grants e o gatilho de transição ficam
-- como estão. Rascunho recém-criado passa a nascer na revisão 2 quando tem
-- itens (o INSERT dos itens soma um): a revisão é só um contador de
-- concorrência, e quem cria não a devolve ao cliente.
--
-- Idempotente: pode ser reaplicada.

-- ── 1. conteúdo de crm_proposals ──────────────────────────────────────────
create or replace function public.fn_crm_proposals_edicao_sobe_revisao()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  -- O que o cliente recebe, ou decide para quem e por onde a proposta sai.
  -- Coluna nova de conteúdo ENTRA AQUI (a cerca
  -- tests/invariants/proposta-edicao-invalida-aprovacao.test.ts reprova a
  -- coluna de crm_proposals que ninguém classificou).
  v_conteudo constant text[] := array['titulo', 'condicoes', 'valid_until', 'total_cents', 'moeda',
    'prazo_dias_uteis', 'pagamento', 'pricing_status', 'briefing_json', 'resumo_comercial',
    'secoes_editadas', 'template_slug', 'template_version', 'destinatario_nome', 'version_reason',
    'lead_id', 'contact_id', 'conversation_id'];
  v_new jsonb;
  v_old jsonb;
  v_marca text;
begin
  -- Só o rascunho que continua rascunho. Entrar em `enviando`, voltar dele,
  -- decidir, vencer e cancelar não são edição.
  if old.status is distinct from 'rascunho' or new.status is distinct from 'rascunho' then
    return new;
  end if;

  v_new := to_jsonb(new);
  v_old := to_jsonb(old);

  if new.revision < old.revision then
    -- a revisão nunca volta atrás
    new.revision := old.revision + 1;
  elsif new.revision = old.revision
        and exists (select 1 from unnest(v_conteudo) k where v_new -> k is distinct from v_old -> k) then
    -- conteúdo mudou e quem escreveu não subiu a revisão: o banco sobe
    new.revision := old.revision + 1;
  end if;

  if new.revision is distinct from old.revision then
    -- A aprovação era de outra revisão. Só fica a que o MESMO comando gravou
    -- para a revisão nova (o servidor aprovando; a sessão não chega aqui com
    -- isso, o gatilho de transição já recusou).
    if new.aprovada_na_revisao is distinct from new.revision then
      new.aprovada_em := null;
      new.aprovada_na_revisao := null;
    end if;
    -- Marca da transação: os itens gravados a seguir são desta mesma edição.
    v_marca := coalesce(current_setting('arvisx.proposta_revisao_subida', true), '');
    if strpos(v_marca, new.id::text) = 0 then
      perform set_config('arvisx.proposta_revisao_subida', v_marca || ' ' || new.id::text, true);
    end if;
  end if;

  return new;
end;
$$;
revoke execute on function public.fn_crm_proposals_edicao_sobe_revisao() from public, anon, authenticated;

drop trigger if exists trg_crm_proposals_zz_edicao_sobe_revisao on public.crm_proposals;
create trigger trg_crm_proposals_zz_edicao_sobe_revisao
  before update on public.crm_proposals
  for each row execute function public.fn_crm_proposals_edicao_sobe_revisao();

-- ── 2. itens ──────────────────────────────────────────────────────────────
create or replace function public.fn_crm_proposal_items_sobe_revisao()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ids uuid[];
  v_id uuid;
begin
  if tg_op = 'INSERT' then
    v_ids := array[new.proposal_id];
  elsif tg_op = 'DELETE' then
    v_ids := array[old.proposal_id];
  else
    -- UPDATE que não muda nada não é edição.
    if to_jsonb(new) = to_jsonb(old) then
      return null;
    end if;
    v_ids := array[old.proposal_id];
    -- Item levado de uma proposta para outra: as duas mudaram.
    if new.proposal_id is distinct from old.proposal_id then
      v_ids := v_ids || new.proposal_id;
    end if;
  end if;

  foreach v_id in array v_ids loop
    -- A revisão desta proposta já subiu nesta transação (a edição pela função
    -- fn_proposta_gravar_edicao, ou outra linha deste mesmo comando) e ninguém
    -- a aprovou depois: é a mesma edição, não soma de novo.
    if strpos(coalesce(current_setting('arvisx.proposta_revisao_subida', true), ''), v_id::text) > 0
       and not exists (select 1 from public.crm_proposals p where p.id = v_id and p.aprovada_em is not null) then
      continue;
    end if;
    -- Só rascunho. O gatilho de crm_proposals limpa a aprovação e marca a
    -- transação. Proposta apagada junto (cascata) não casa linha nenhuma.
    update public.crm_proposals
       set revision = revision + 1
     where id = v_id
       and status = 'rascunho';
  end loop;

  return null;
end;
$$;
revoke execute on function public.fn_crm_proposal_items_sobe_revisao() from public, anon, authenticated;

drop trigger if exists trg_crm_proposal_items_sobe_revisao on public.crm_proposal_items;
create trigger trg_crm_proposal_items_sobe_revisao
  after insert or update or delete on public.crm_proposal_items
  for each row execute function public.fn_crm_proposal_items_sobe_revisao();

-- ── 3. a edição das rotas, numa transação só ──────────────────────────────
create or replace function public.fn_proposta_gravar_edicao(
  p_org uuid,
  p_proposta uuid,
  p_revisao bigint,
  p_campos jsonb,
  p_itens jsonb
) returns bigint
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_campos jsonb := coalesce(p_campos, '{}'::jsonb);
  v_nova bigint;
begin
  -- CAS: só o rascunho desta organização, na revisão que quem edita leu. Campo
  -- ausente de `p_campos` fica como está; `total_cents` e `pricing_status`
  -- vêm sempre (são recalculados dos itens pelo servidor).
  update public.crm_proposals p
     set titulo = case when v_campos ? 'titulo' then v_campos ->> 'titulo' else p.titulo end,
         condicoes = case when v_campos ? 'condicoes' then v_campos ->> 'condicoes' else p.condicoes end,
         valid_until = case when v_campos ? 'valid_until' then (v_campos ->> 'valid_until')::date else p.valid_until end,
         prazo_dias_uteis = case when v_campos ? 'prazo_dias_uteis' then (v_campos ->> 'prazo_dias_uteis')::int else p.prazo_dias_uteis end,
         pagamento = case when v_campos ? 'pagamento' then v_campos ->> 'pagamento' else p.pagamento end,
         briefing_json = case when v_campos ? 'briefing_json' then nullif(v_campos -> 'briefing_json', 'null'::jsonb) else p.briefing_json end,
         total_cents = case when v_campos ? 'total_cents' then (v_campos ->> 'total_cents')::bigint else p.total_cents end,
         pricing_status = case when v_campos ? 'pricing_status' then v_campos ->> 'pricing_status' else p.pricing_status end,
         revision = p.revision + 1
   where p.organization_id = p_org
     and p.id = p_proposta
     and p.revision = p_revisao
     and p.status = 'rascunho'
  returning p.revision into v_nova;

  if v_nova is null then
    return null;
  end if;

  delete from public.crm_proposal_items i
   where i.organization_id = p_org
     and i.proposal_id = p_proposta;

  insert into public.crm_proposal_items
    (organization_id, proposal_id, product_id, descricao, quantidade, preco_unitario_cents, desconto_cents, position)
  select p_org,
         p_proposta,
         (it ->> 'product_id')::uuid,
         it ->> 'descricao',
         (it ->> 'quantidade')::numeric,
         (it ->> 'preco_unitario_cents')::bigint,
         coalesce((it ->> 'desconto_cents')::bigint, 0),
         (it ->> 'position')::numeric
    from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) as t(it);

  return v_nova;
end;
$$;
revoke execute on function public.fn_proposta_gravar_edicao(uuid, uuid, bigint, jsonb, jsonb) from public, anon;
grant execute on function public.fn_proposta_gravar_edicao(uuid, uuid, bigint, jsonb, jsonb) to authenticated, service_role;

comment on function public.fn_proposta_gravar_edicao(uuid, uuid, bigint, jsonb, jsonb) is
  'Edição do rascunho da proposta numa transação: CAS em revision, campos e troca dos itens. Devolve a revisão nova, ou NULL quando o CAS não casa. Invoker: RLS e gatilho de transição valem para quem chama. Migration 9815.';

notify pgrst, 'reload schema';
