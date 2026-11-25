-- VIX: A MARCA "ISENTA" DE UMA ORGANIZAÇÃO (Tarefa 7)
-- Script para o Lucas rodar À MÃO, depois do deploy, uma vez por organização.
--
-- NÃO é migration e não entra no baseline: é dado de produção desta instalação.
-- A migration 9830 cria a coluna com `false` para todas: nenhuma organização
-- nasce marcada, e NENHUM nome de organização está escrito no código.
--
-- ⚠️ NADA AQUI LIGA O ASSISTENTE. O Vix continua desligado até a chave
-- `VIX_PAGADOR` ser trocada em Painel › Configuração. Este arquivo só diz QUEM
-- tem direito a ele quando for ligado.
--
-- Quem tem o Vix (as duas portas, e só elas):
--   1. a organização tem ASSINATURA ATIVA, em qualquer plano, novo ou antigo
--      (assinatura que não está em atraso nem cancelada, empresa não suspensa,
--      cobrança ligada na instalação);
--   2. a organização tem a marca `isenta`, que é o que este script grava.
-- Sem as duas, o Vix não responde para aquela organização.
--
-- NÃO há limite de mensagens por plano. O que existe é um freio técnico contra
-- abuso (mensagens por minuto e tamanho da mensagem), em Painel › Configuração.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- COMO RODAR
--
-- O slug entra por variável do psql (é o mesmo da URL da organização). SEM a
-- variável, o psql para com erro e nada é gravado.
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 \
--     -v org_slug=<SLUG-DA-ORGANIZACAO> \
--     -f docs/arvisx/ci/VIX-MARCA-DE-ISENTA-2026-11.sql
--
-- Variável vazia = nada é feito. Idempotente: rodar de novo não muda nada.
-- Sem BEGIN/COMMIT.
-- ─────────────────────────────────────────────────────────────────────────────

select set_config('vix.org_slug', :'org_slug', false);

-- A marca é da PLATAFORMA: a tela da empresa não a escreve, e a sessão só lê.
-- Preserva o `ligado` que a empresa já tiver escolhido.
do $marca$
declare
  v_slug text := btrim(coalesce(current_setting('vix.org_slug', true), ''));
  v_org uuid;
begin
  if v_slug = '' then
    raise notice 'Vix: marca PULADA (nenhuma organização informada).';
    return;
  end if;
  select o.id into v_org from public.organizations o where o.slug = v_slug;
  if v_org is null then
    raise exception 'Vix: não existe organização com o slug "%".', v_slug;
  end if;

  insert into public.assistente_estado_da_empresa (organization_id, isenta)
  values (v_org, true)
  on conflict (organization_id) do update set isenta = true, updated_at = now();
  raise notice 'Vix: organização "%" marcada como isenta.', v_slug;
end
$marca$;

-- ── CONFERIR ─────────────────────────────────────────────────────────────────
select o.slug as organizacao, e.ligado, e.isenta
  from public.assistente_estado_da_empresa e
  join public.organizations o on o.id = e.organization_id
 where e.isenta
 order by o.slug;

-- ── DESFAZER ─────────────────────────────────────────────────────────────────
-- Tirar a marca de uma organização (ela volta a depender da assinatura):
--   update public.assistente_estado_da_empresa e set isenta = false
--     from public.organizations o where o.id = e.organization_id and o.slug = '<SLUG>';
