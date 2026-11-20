-- manifest: **A pausa e a retomada da IA numa conversa viram evento.** Um gatilho em `conversations` grava `conversation.ai_paused` quando o atendimento automático para naquela conversa (alguém assumiu, respondeu, pausou, ou o próprio agente passou o caso) e `conversation.ai_resumed` quando ele volta. São gatilhos de automação como os outros: saem pelo webhook de saída, para um agente externo saber que deve ficar calado. Nenhuma tabela nem coluna nova; nenhuma linha existente muda.
--
-- 9811 — a pausa e a retomada da IA viram evento.
--
-- Faixa 98xx, a do fork (ArvisX CRM), pela mesma razão da 9800 a 9809.
--
-- ═══ Por quê ═══
--
-- O agente NATIVO já obedece a quem assume a conversa: o motor lê
-- `conversations.bot_silenced_until` e `assignee_kind` no começo de todo turno
-- (`lib/ai/elegibilidade/gate.ts`) e não responde. O agente EXTERNO, que fala
-- com o CRM por token e roda fora dele, não lê essas colunas: até aqui ele só
-- descobria que uma pessoa assumiu se perguntasse, conversa por conversa.
--
-- ═══ Por que no banco, e não na aplicação ═══
--
-- A pausa tem mais de uma dúzia de escritores, e um deles é o próprio banco:
-- `fn_conversation_assign` grava o silêncio quando alguém assume. Emitir na
-- aplicação seria lembrar de cada um deles, e esquecer um deixa o agente
-- externo falando por cima de uma pessoa, sem erro em lugar nenhum. O gatilho
-- olha o estado da linha, então vale para todo escritor, os de hoje e os que
-- vierem.
--
-- ═══ O que conta como pausa ═══
--
-- A mesma leitura do motor, só com o que mora na conversa:
--
--   * `bot_silenced_until` no futuro (`'infinity'` é a pausa sem prazo); ou
--   * `assignee_kind = 'user'` (uma pessoa é a dona da conversa).
--
-- As travas do CONTATO (`contacts.force_human`, `ai_opt_out`, `is_blocked`) não
-- entram: valem para todas as conversas da pessoa, e quem as arma pela passagem
-- para humano grava também o silêncio da conversa, que este gatilho vê.
--
-- ═══ Quando sai cada evento ═══
--
--   * `conversation.ai_paused`: a conversa passa a estar pausada; ou continua
--     pausada e o prazo ou o dono mudou (`renewed = true`). A renovação sai
--     porque o prazo anterior deixou de valer: sem ela, quem obedece ao evento
--     voltaria a falar na hora antiga.
--   * `conversation.ai_resumed`: estava pausada e deixou de estar por uma
--     ESCRITA (devolver ao automático, liberar a conversa).
--
-- Pausa com prazo que simplesmente vence não escreve na linha, então não gera
-- `ai_resumed`: o `paused_until` do último `ai_paused` é a hora da volta.
--
-- ═══ O que vai no evento ═══
--
-- Só ids e fatos curtos, sem texto livre e sem a identidade de quem atende: o
-- `event_log` fica fora da anonimização, e o corpo do webhook repassa o payload
-- inteiro. Quem assumiu e o motivo escrito são lidos da linha atual na hora da
-- entrega (`lib/automation/detalhe-do-evento.ts`), o nome só com a opção
-- "incluir o responsável" da regra.
--
-- ═══ O que NÃO muda ═══
--
-- Nenhuma coluna, tabela, policy ou grant. Conversa de grupo não emite (o
-- automático nunca a atende). O gatilho nunca derruba a escrita que o disparou:
-- qualquer erro ao gravar o evento é engolido, e a conversa é atualizada do
-- mesmo jeito.
--
-- Idempotente: pode ser reaplicada.

create or replace function public.fn_anunciar_pausa_da_ia()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_antes  boolean;
  v_depois boolean;
  v_ate    timestamptz;
begin
  if coalesce(new.is_group, false) then
    return new;
  end if;

  v_antes := (old.bot_silenced_until is not null and old.bot_silenced_until > now())
             or coalesce(old.assignee_kind, '') = 'user';
  v_depois := (new.bot_silenced_until is not null and new.bot_silenced_until > now())
              or coalesce(new.assignee_kind, '') = 'user';

  begin
    if v_depois and (
         not v_antes
         or new.bot_silenced_until is distinct from old.bot_silenced_until
         or new.assigned_to_user_id is distinct from old.assigned_to_user_id
       ) then
      -- Prazo finito no futuro; nulo quando a pausa não tem prazo.
      v_ate := case
                 when new.bot_silenced_until is not null
                  and isfinite(new.bot_silenced_until)
                  and new.bot_silenced_until > now()
                 then new.bot_silenced_until
                 else null
               end;
      insert into public.event_log (organization_id, event_type, entity_kind, entity_id, payload)
      values (new.organization_id, 'conversation.ai_paused', 'conversation', new.id,
        jsonb_build_object(
          'conversation_id', new.id,
          'contact_id', new.contact_id,
          'channel_session_id', new.channel_session_id,
          'paused_until', v_ate,
          'durable', v_ate is null,
          'human_assigned', new.assigned_to_user_id is not null,
          'renewed', v_antes
        ));
    elsif v_antes and not v_depois then
      insert into public.event_log (organization_id, event_type, entity_kind, entity_id, payload)
      values (new.organization_id, 'conversation.ai_resumed', 'conversation', new.id,
        jsonb_build_object(
          'conversation_id', new.id,
          'contact_id', new.contact_id,
          'channel_session_id', new.channel_session_id
        ));
    end if;
  exception when others then
    -- O aviso nunca derruba a escrita da conversa: quem assume tem de conseguir
    -- assumir mesmo que o evento não possa ser gravado.
    raise warning 'fn_anunciar_pausa_da_ia: evento não gravado (%)', sqlerrm;
  end;

  return new;
end;
$$;

comment on function public.fn_anunciar_pausa_da_ia() is
  'Gatilho de conversations (migration 9811): grava conversation.ai_paused / conversation.ai_resumed no event_log quando o atendimento automático para ou volta naquela conversa. Lê bot_silenced_until e assignee_kind, a mesma régua do motor. Nunca derruba a escrita que o disparou.';

revoke execute on function public.fn_anunciar_pausa_da_ia() from public, anon, authenticated, service_role;

drop trigger if exists trg_anunciar_pausa_da_ia on public.conversations;
create trigger trg_anunciar_pausa_da_ia
  after update on public.conversations
  for each row
  when (
    old.bot_silenced_until is distinct from new.bot_silenced_until
    or old.assignee_kind is distinct from new.assignee_kind
    or old.assigned_to_user_id is distinct from new.assigned_to_user_id
  )
  execute function public.fn_anunciar_pausa_da_ia();
