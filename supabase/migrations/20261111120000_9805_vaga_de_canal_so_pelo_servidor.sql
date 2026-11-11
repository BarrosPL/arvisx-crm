-- manifest: **A vaga de canal do plano deixa de ser burlável pelo banco.** Gatilho `trg_channel_sessions_vaga_e_do_servidor` em `channel_sessions`: a sessão (`authenticated`/`anon`) não muda `provider` nem `organization_id`, não muda `status` nem `phone_number` de uma conexão WAHA, e não cria conexão WAHA que nasce fora da contagem (morta e sem número). Quem grava essas colunas é o servidor (service role e as funções da reserva). Nenhuma linha existente muda.
--
-- 9805 — as colunas que contam vaga são do servidor.
--
-- Faixa 98xx, a do fork (ArvisX CRM), pela mesma razão da 9800 a 9804.
--
-- ═══ Por quê (auditoria de 11/11/2026, reproduzido em produção) ═══
--
-- A vaga do plano é conferida em três lugares: o gatilho de CRIAÇÃO
-- (`fn_trava_canais_do_plano`, 0583/0809), a reserva
-- (`fn_reserve_channel_connection`) e o "Reconectar"
-- (`fn_vaga_ao_reviver_canal`, 9036). A régua de quem ocupa (0809) deixa de
-- fora a conexão WAHA morta e sem número (`FAILED`/`STOPPED`, `phone_number`
-- nulo), e o gatilho NÃO observa `status` nem `phone_number`, de propósito: o
-- espelho do webhook não pode virar PT402 no meio de uma reconexão.
--
-- Só que `channel_sessions` tem GRANT ALL para `authenticated`, e as policies
-- `channel_sessions_tenant_insert`/`_update` (0752) deixam o admin da empresa
-- escrever a própria linha direto pela API do banco. Com a chave pública e a
-- sessão do dono, no Essencial (3 canais):
--
--   1. INSERT de uma conexão `STOPPED` e sem número: não conta vaga, passa;
--   2. PATCH `status = 'WORKING'` + `phone_number`: o gatilho não olha, passa.
--
-- Resultado: 4 conexões. O caminho inverso também furava: PATCH de `STOPPED` +
-- número nulo numa conexão VIVA a tirava da contagem, a empresa conectava mais
-- uma pela API, e o espelho do servidor devolvia a primeira a `WORKING`.
--
-- ═══ O que muda ═══
--
-- `fn_channel_sessions_vaga_e_do_servidor()`, gatilho BEFORE INSERT OR UPDATE,
-- no molde da 9093/9104 (`security invoker`, lê `current_user`). Para a sessão:
--
--   · UPDATE não muda `provider` nem `organization_id` (em qualquer conexão);
--   · UPDATE não muda `status` nem `phone_number` de conexão WAHA. Só no WAHA:
--     nos outros provedores a linha ocupa a vaga com qualquer status e número
--     (0809), então essas colunas não decidem nada, e as telas que as gravam
--     pela sessão seguem como estão. Voz (`wacalls`) não conta vaga;
--   · INSERT não cria conexão WAHA morta e sem número. Conexão WAHA nasce pela
--     reserva (`fn_reserve_channel_connection`), que confere a vaga.
--
-- O que NÃO muda: o INSERT de conexão que ocupa vaga já era contado pelo
-- gatilho da 0583 (PT402 no teto) e segue sendo; desarquivar (`archived_at`
-- nulo de novo) já era contado e segue sendo; arquivar e apagar seguem com a
-- sessão (liberam a vaga e o webhook deixa de achar a linha). Nome, metadados,
-- limite diário e o resto da linha seguem graváveis pelo admin.
--
-- Service role e funções `security definer` (a reserva, o fim da conexão, o
-- reviver) não são alcançados: neles `current_user` é o dono. O espelho do
-- webhook e o cron de saúde seguem gravando status e número como sempre.
--
-- ═══ O código que acompanha ═══
--
-- Quatro escritas da API gravavam status/número de conexão WAHA com a sessão
-- de quem chamou. Passam ao service role, com o mesmo filtro de organização
-- resolvido da sessão: a leitura de saúde (`GET /channel-sessions/[id]`), a
-- falha ao excluir (`DELETE /channel-sessions/[id]`), o "Reconectar" e a
-- conferência do primeiro acesso (`GET /onboarding/whatsapp/session`).
--
-- UPDATE compara com `is distinct from`: reenviar o mesmo valor não é
-- alteração e não é recusado. Idempotente: `create or replace`,
-- `drop trigger if exists`. Sem BEGIN/COMMIT.
-- Gate: `tests/invariants/arvisx-canais-vaga-so-pelo-servidor.test.ts`.

create or replace function public.fn_channel_sessions_vaga_e_do_servidor()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- A conexão WAHA que nasce morta e sem número não ocupa vaga (0809): pela
    -- sessão, ela seria a linha de reserva para furar o teto depois.
    if new.provider = 'waha' and new.phone_number is null and new.status in ('FAILED', 'STOPPED') then
      raise exception 'canal_vaga_e_do_servidor'
        using errcode = '42501',
              detail = 'Conexão de WhatsApp nasce pela reserva do servidor, que confere a vaga do plano.';
    end if;
    return new;
  end if;

  if new.provider is distinct from old.provider
     or new.organization_id is distinct from old.organization_id then
    raise exception 'canal_vaga_e_do_servidor'
      using errcode = '42501',
            detail = 'Provedor e empresa de uma conexão não mudam pela sessão.';
  end if;

  if old.provider = 'waha'
     and (new.status is distinct from old.status
          or new.phone_number is distinct from old.phone_number) then
    raise exception 'canal_vaga_e_do_servidor'
      using errcode = '42501',
            detail = 'Status e número de uma conexão de WhatsApp são gravados pelo servidor: são eles que contam a vaga do plano.';
  end if;

  return new;
end;
$$;

revoke execute on function public.fn_channel_sessions_vaga_e_do_servidor() from public, anon, authenticated;

drop trigger if exists trg_channel_sessions_vaga_e_do_servidor on public.channel_sessions;
create trigger trg_channel_sessions_vaga_e_do_servidor
  before insert or update on public.channel_sessions
  for each row execute function public.fn_channel_sessions_vaga_e_do_servidor();

comment on function public.fn_channel_sessions_vaga_e_do_servidor() is
  'A sessão (authenticated/anon) não grava as colunas que contam a vaga de canal do plano: provider, organization_id e, em conexão WAHA, status e phone_number; nem cria conexão WAHA morta e sem número. Migration 9805.';

notify pgrst, 'reload schema';
