-- manifest: **Comentários do Instagram: a anonimização alcança quem já era contato por mensagem direta.** O gatilho da 9812 só redigia os comentários ligados ao contato (`contact_id`) e os do mesmo autor desses. Quem já conversava por mensagem direta e comentou numa publicação, sem que ninguém ligasse o comentário ao contato, ficava de fora: o texto e o nome de usuário sobreviviam à anonimização. `fn_redigir_comentarios_ao_anonimizar` passa a achar também os comentários pela identidade social do contato (`instagram:<conta>:<author_id>`) e a regravar `hidden` só com os campos conhecidos. Nenhuma linha muda ao aplicar; o efeito é na próxima anonimização.
--
-- 9816 — a redação dos comentários acha a pessoa também pela identidade social.
--
-- Faixa 98xx, a do fork (ArvisX CRM). Número reservado para a revisão de
-- 20/11/2026 (item 2.22). Continua a 9812, que NÃO é editada: ela já pode
-- estar aplicada em ambiente, então a correção vem como migration nova, com o
-- corpo inteiro da função (`create or replace`).
--
-- ═══ O buraco ═══
--
-- A 9812 redige, na virada de `is_anonymized` do contato:
--   (a) os comentários com `contact_id` = o contato;
--   (b) os outros comentários do MESMO `author_id` de (a).
--
-- Só que o contato de quem escreve por mensagem direta nasce pela ingestão
-- social, com `contacts.social_identity = 'instagram:<conta>:<id da pessoa>'`,
-- e nada liga a ele o comentário que a mesma pessoa fez numa publicação: o
-- `contact_id` do comentário só é preenchido quando alguém responde em privado
-- ou pede a criação do contato. Para essa pessoa, (a) é vazio e (b) também. O
-- titular pedia a anonimização e os comentários dele ficavam inteiros.
--
-- ═══ O que muda ═══
--
--   (c) NOVO: os comentários cujo autor, na conta que os recebeu, forma a
--       identidade social do contato: `'instagram:' || <conta do canal> || ':'
--       || author_id` = a identidade. A conta vem de
--       `channel_sessions.meta_social_account_id`, do canal do próprio
--       comentário, na MESMA organização — canal arquivado inclusive, porque
--       comentário antigo continua sendo da pessoa.
--
--       A identidade é lida de OLD e de NEW: o gatilho irmão
--       `trg_redigir_conversas_ao_anonimizar` (0494) apaga
--       `contacts.social_identity` num UPDATE próprio, e este gatilho não pode
--       depender de rodar antes dele. Entram também as identidades dos
--       contatos que foram unidos a este (`is_merged_into`).
--
--       O id do autor no comentário não é PROVA do id da pessoa nas mensagens
--       (é por isso que o servidor não liga contato por ele). Para redigir, a
--       coincidência basta: errar para mais aqui apaga o texto de um
--       comentário; errar para menos mantém dado de quem pediu para sair.
--
--   `hidden` é regravado só com os campos conhecidos (`quando`, `quem`,
--   `simulada`). Hoje a ocultação não guarda nada do titular (quem ocultou é
--   da equipe), então o conteúdo não muda; o que muda é que qualquer chave a
--   mais que venha a existir ali não sobrevive à anonimização.
--
-- O resto do corpo é o da 9812, igual: texto, autor, motivo e o texto das duas
-- respostas. A linha fica (publicação, hora e estado são registro de operação).
--
-- ═══ Reversão ═══
--
-- Reaplicar o corpo da função que está na migration 9812.

create or replace function public.fn_redigir_comentarios_ao_anonimizar()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_identidades text[];
begin
  -- As identidades sociais da pessoa: a do contato (antes e depois da virada)
  -- e as dos contatos unidos a ele. Só as do Instagram interessam aqui.
  select coalesce(array_agg(distinct i.identidade), '{}'::text[])
    into v_identidades
    from (
      select old.social_identity as identidade
      union all
      select new.social_identity
      union all
      select c.social_identity
        from public.contacts c
       where c.organization_id = new.organization_id
         and c.is_merged_into = new.id
    ) i
   where i.identidade like 'instagram:%';

  update public.social_comments sc
     set text = case when sc.text is null then null else '(anonimizado)' end,
         author_id = null,
         author_username = null,
         ignore_reason = null,
         public_reply = case
           when sc.public_reply is null then null
           else sc.public_reply || jsonb_build_object('texto', '(anonimizado)')
         end,
         private_reply = case
           when sc.private_reply is null then null
           else sc.private_reply || jsonb_build_object('texto', '(anonimizado)')
         end,
         hidden = case
           when sc.hidden is null then null
           else jsonb_build_object(
             'quando', sc.hidden -> 'quando',
             'quem', sc.hidden -> 'quem',
             'simulada', sc.hidden -> 'simulada'
           )
         end
   where sc.organization_id = new.organization_id
     and (
       sc.contact_id = new.id
       or sc.author_id in (
         select s.author_id
           from public.social_comments s
          where s.organization_id = new.organization_id
            and s.contact_id = new.id
            and s.author_id is not null
       )
       or (
         sc.author_id is not null
         and cardinality(v_identidades) > 0
         and exists (
           select 1
             from public.channel_sessions cs
            where cs.id = sc.channel_session_id
              and cs.organization_id = new.organization_id
              and cs.meta_social_account_id is not null
              and ('instagram:' || cs.meta_social_account_id || ':' || sc.author_id) = any (v_identidades)
         )
       )
     );
  return new;
end;
$$;

revoke execute on function public.fn_redigir_comentarios_ao_anonimizar() from public, anon, authenticated;
grant  execute on function public.fn_redigir_comentarios_ao_anonimizar() to service_role;

-- O gatilho é o da 9812; recriá-lo aqui deixa a migration inteira reaplicável
-- e garante que ele existe em quem aplicar só esta.
drop trigger if exists trg_redigir_comentarios_ao_anonimizar on public.contacts;
create trigger trg_redigir_comentarios_ao_anonimizar
  after update of is_anonymized on public.contacts
  for each row
  when (new.is_anonymized is true and old.is_anonymized is distinct from true)
  execute function public.fn_redigir_comentarios_ao_anonimizar();

notify pgrst, 'reload schema';
