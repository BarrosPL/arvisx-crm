-- manifest: **O agente não fecha conversa que uma pessoa assumiu, conferido dentro da função do banco.** `fn_service_status` ganha o quinto parâmetro `p_ator` (`'pessoa'` por padrão, `'agente'` para a ferramenta `crm_close_conversation` e para ator que não é pessoa no `PATCH`). Com `p_ator='agente'`, pedido de estado terminal (`closed`, `resolved`, `archived`) sobre conversa ainda aberta e com `assigned_to_user_id` preenchido é recusado com `PT403 service_assigned_to_human`, COM A LINHA TRAVADA: fecha a janela entre a leitura da ferramenta e o fechamento (assumir não mexe em `service_revision`, então a trava de revisão não a percebia). A tela não manda o parâmetro e segue igual. A assinatura muda, então a função de 4 argumentos é derrubada antes (sem isso nasceria uma sobrecarga que o PostgREST não resolve). Nenhuma coluna, nenhuma linha existente muda.
--
-- 9824 — regra 2.31 dentro do banco: agente não fecha conversa assumida.
--
-- Faixa 98xx, a do fork (ArvisX CRM), pela mesma razão da 9800 a 9820.
--
-- ═══ Por quê (Tarefa 6.1, lacunas 1 e 3 de docs/arvisx/ci/REGRA-2.31-FECHAR-CONVERSA.md) ═══
--
-- A regra do dono (23/11/2026): "o agente NÃO fecha conversa que o humano
-- assumiu". Ela só era conferida na LEITURA, pela ferramenta
-- `crm_close_conversation` e pelo `PATCH /api/v1/conversations/[id]`. Entre a
-- leitura e a chamada desta função existe uma janela: se uma pessoa assume a
-- conversa nesse intervalo, `fn_conversation_assign` grava `claimed`, e o
-- gatilho `fn_service_stamp_status` só soma `service_revision` quando um dos
-- lados é terminal. `open → claimed` não soma, a trava de revisão (`p_expected`)
-- não percebe, e o agente fechava a conversa de quem acabou de assumir.
--
-- ═══ Por que cabe aqui ═══
--
-- A função já faz `select ... for no key update` na linha da conversa, e
-- `fn_conversation_assign` trava a MESMA linha com `for no key update`. As duas
-- se serializam. Em READ COMMITTED, quem espera relê a linha depois do commit do
-- outro e enxerga o responsável. A condição nova roda depois dessa releitura.
--
-- ═══ O que muda ═══
--
--   1. Parâmetro novo `p_ator text default 'pessoa'`. Valor fora de
--      `'pessoa' | 'agente'` é `22023 invalid_actor`.
--   2. `p_ator='agente'` + estado terminal pedido + conversa NÃO encerrada +
--      `assigned_to_user_id` preenchido → `PT403 service_assigned_to_human`.
--      `PT403` vira HTTP 403 no PostgREST, que ninguém reexecuta (a lição da
--      0514 para o `PT409`).
--   3. Conversa JÁ encerrada não recusa: repetir o pedido continua sendo
--      sucesso sem efeito (`if c.status=p_status then return c`).
--   4. A conferência vem ANTES da trava de revisão: com as duas condições
--      verdadeiras, o agente recebe "está com uma pessoa" (não tente de novo),
--      e não "mudou, leia de novo".
--   5. O resto do corpo (UPDATE e o bloco das demandas) é IDÊNTICO ao da 0514.
--
-- ═══ Compatibilidade ═══
--
--   - Imagem antiga com banco novo: manda 4 argumentos nomeados e cai no
--     default `'pessoa'`. Tela igual; a ferramenta antiga fica só com a
--     conferência na leitura, como hoje. Sem regressão.
--   - Imagem nova com banco antigo: a tela não manda o parâmetro e funciona. O
--     agente manda `p_ator` e recebe PGRST202 (função não encontrada); o código
--     trata como falha fechada ("indisponível"), sem voltar ao caminho antigo.
--   - As duas chamadas SQL internas (posicionais, 4 argumentos, em
--     `fn_service_observe`) seguem resolvendo pelo default.
--   - O default é `'pessoa'` de propósito: default `'agente'` quebraria a tela
--     da imagem antiga. O custo (chamador novo de agente que esqueça o
--     parâmetro) é coberto pela cerca
--     `tests/unit/fn-service-status-so-pelo-modulo.test.ts`.
--
-- ═══ Lock ═══
--
-- `drop function` + `create function` pegam lock só no catálogo, por instantes.
-- Nenhuma tabela é reescrita nem varrida. A condição nova roda sob o advisory
-- lock e o row lock que a função já pegava: nenhum lock novo em execução.
--
-- ═══ Reaplicável ═══
--
-- `drop function if exists` da assinatura antiga e `create or replace` da nova:
-- aplicar duas vezes termina no mesmo estado (uma função só, 5 parâmetros).
-- Sem `begin`/`commit` explícitos, como as demais: o aplicador do fork
-- (`deploy/arvisx/crm/init.sh`, `psql -1`) já roda o arquivo numa transação,
-- então o drop e o create valem juntos ou não valem.
--
-- ═══ Reversão ═══
--
-- Só com a imagem anterior NÃO precisa reverter o banco (a imagem antiga cai no
-- default). Para voltar a função: `drop function public.fn_service_status(uuid,
-- uuid,text,bigint,text)` e recriar a de 4 argumentos da 0514 com os mesmos
-- grants. Com a imagem NOVA no ar e a função antiga, o agente não fecha
-- conversa nenhuma (falha fechada). Roteiro em
-- docs/arvisx/ci/SUBIR-COM-SEGURANCA-2026-11.md, seção 6.2.

-- Novo parâmetro muda a assinatura: sem o drop nasceria uma SOBRECARGA, e o
-- PostgREST não escolhe entre as duas com 4 argumentos nomeados.
-- Precedente de drop por troca de assinatura: migration 9103.
drop function if exists public.fn_service_status(uuid,uuid,text,bigint);

create or replace function public.fn_service_status(
  p_org uuid, p_conversation uuid, p_status text,
  p_expected bigint default null,
  p_ator text default 'pessoa')
returns public.conversations language plpgsql security definer set search_path=public as $$
declare c public.conversations; terminal boolean; pre_contact uuid;
begin
 if p_status not in ('closed','resolved','archived','open','pending','ai_handling','claimed') then
  raise exception 'invalid_status' using errcode='22023'; end if;
 if p_ator is null or p_ator not in ('pessoa','agente') then
  raise exception 'invalid_actor' using errcode='22023'; end if;
 select * into c from public.conversations where id=p_conversation and organization_id=p_org;
 if not found then raise exception 'service_not_found' using errcode='P0002'; end if;
 pre_contact:=c.contact_id;
 perform public.fn_service_lock(p_org,c.contact_id);
 select * into c from public.conversations where id=p_conversation and organization_id=p_org for no key update;
 if c.contact_id is distinct from pre_contact then raise exception 'service_contact_changed' using errcode='40001'; end if;
 terminal := p_status in ('closed','resolved','archived');
 -- Regra 2.31, conferida COM A LINHA TRAVADA. Conversa já encerrada não recusa:
 -- repetir o pedido continua sendo sucesso sem efeito.
 if p_ator='agente' and terminal
    and c.status not in ('closed','resolved','archived')
    and c.assigned_to_user_id is not null then
   raise exception 'service_assigned_to_human' using errcode='PT403';
 end if;
 if p_expected is not null and c.service_revision<>p_expected then raise exception 'service_stale' using errcode='PT409'; end if;
 if c.status=p_status then return c; end if;
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

comment on function public.fn_service_status(uuid,uuid,text,bigint,text) is
  'Porta única do estado do atendimento. p_ator (migration 9824): ''pessoa'' (default, a tela) ou ''agente''. Agente pedindo estado terminal sobre conversa aberta com assigned_to_user_id preenchido recebe PT403 service_assigned_to_human, conferido com a linha travada.';

revoke execute on function public.fn_service_status(uuid,uuid,text,bigint,text) from public,anon,authenticated;
grant execute on function public.fn_service_status(uuid,uuid,text,bigint,text) to service_role;

notify pgrst, 'reload schema';
