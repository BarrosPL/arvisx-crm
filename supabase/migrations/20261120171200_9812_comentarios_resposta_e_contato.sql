-- manifest: **Comentários do Instagram: o que a resposta precisa guardar.** `social_comments` ganha `contact_id` (o contato que nasceu do comentário, nulo até alguém decidir), `ignore_reason` (o motivo de quem decidiu não agir) e `hidden` (quando e por quem o comentário foi ocultado). Com a ligação ao contato, a tabela entra na anonimização: o gatilho `trg_redigir_comentarios_ao_anonimizar` apaga o texto e o autor dos comentários da pessoa quando o contato é anonimizado. Nenhuma linha existente muda.
--
-- 9812 — os comentários do Instagram passam a poder ser respondidos.
--
-- Faixa 98xx, a do fork (ArvisX CRM). Continua a 9810, que criou a tabela.
--
-- ═══ Por quê ═══
--
-- A 9810 guardou o comentário e deixou de fora, de propósito, a ligação com o
-- contato: nada criava contato a partir de comentário, e uma chave estrangeira
-- para `contacts` põe a tabela no alcance da anonimização (LGPD), que precisa
-- nascer JUNTO com o passo de redação e de exportação. Esta entrega cria o
-- contato (resposta em privado e criação a pedido), então as três coisas
-- entram aqui, no mesmo passo.
--
-- ═══ O que entra ═══
--
--   * `contact_id`: o contato ligado ao comentário. Nulo até alguém responder
--     em privado ou pedir a criação. `on delete set null`: o comentário é
--     registro do canal e sobrevive à ficha.
--   * `ignore_reason`: o motivo, em texto livre, de quem marcou o comentário
--     como sem ação (`estado = 'sem_acao'`).
--   * `hidden`: `jsonb` nulo até o comentário ser ocultado. Forma validada no
--     servidor (`quando`, `quem`, `simulada`), como `public_reply` e
--     `private_reply`.
--   * dois índices: a lista geral por data (sem filtro de estado) e a chave
--     estrangeira do contato.
--
-- ═══ LGPD ═══
--
-- O comentário é texto que a pessoa escreveu, com o nome de usuário dela. Na
-- virada de `is_anonymized` do contato (o mesmo desenho da 0391 e da 0210), o
-- gatilho troca o texto por '(anonimizado)', apaga autor e motivo e redige o
-- texto das duas respostas — nos comentários ligados ao contato E nos outros
-- comentários do MESMO autor naquela organização (mesmo `author_id`: é a mesma
-- pessoa, ainda que só um deles tenha virado contato). A linha fica: que houve
-- comentário, em que publicação e quando é registro de operação. A exportação
-- (`lib/lgpd/export-collector.ts`) entrega os mesmos comentários.
--
-- ═══ Reversão ═══
--
--   drop trigger if exists trg_redigir_comentarios_ao_anonimizar on public.contacts;
--   drop function if exists public.fn_redigir_comentarios_ao_anonimizar();
--   alter table public.social_comments
--     drop column if exists contact_id,
--     drop column if exists ignore_reason,
--     drop column if exists hidden;

alter table public.social_comments
  add column if not exists contact_id uuid references public.contacts(id) on delete set null,
  add column if not exists ignore_reason text,
  add column if not exists hidden jsonb;

comment on column public.social_comments.contact_id is
  'O contato ligado ao comentário. Nulo até alguém responder em privado ou pedir a criação do contato. Migration 9812.';
comment on column public.social_comments.ignore_reason is
  'Motivo, em texto livre, de quem marcou o comentário como sem ação (estado = sem_acao). Migration 9812.';
comment on column public.social_comments.hidden is
  'Nulo até o comentário ser ocultado na rede. Forma (quando, quem, simulada) validada no servidor. Migration 9812.';

-- A lista geral, sem filtro de estado, do mais recente.
create index if not exists social_comments_org_quando_idx
  on public.social_comments (organization_id, commented_at desc, id desc);

-- A chave estrangeira do contato (e a exportação do titular).
create index if not exists social_comments_contato_idx
  on public.social_comments (organization_id, contact_id)
  where contact_id is not null;

create or replace function public.fn_redigir_comentarios_ao_anonimizar()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.social_comments
     set text = case when text is null then null else '(anonimizado)' end,
         author_id = null,
         author_username = null,
         ignore_reason = null,
         public_reply = case
           when public_reply is null then null
           else public_reply || jsonb_build_object('texto', '(anonimizado)')
         end,
         private_reply = case
           when private_reply is null then null
           else private_reply || jsonb_build_object('texto', '(anonimizado)')
         end
   where organization_id = new.organization_id
     and (
       contact_id = new.id
       or author_id in (
         select s.author_id
           from public.social_comments s
          where s.organization_id = new.organization_id
            and s.contact_id = new.id
            and s.author_id is not null
       )
     );
  return new;
end;
$$;

revoke execute on function public.fn_redigir_comentarios_ao_anonimizar() from public, anon, authenticated;
grant  execute on function public.fn_redigir_comentarios_ao_anonimizar() to service_role;

drop trigger if exists trg_redigir_comentarios_ao_anonimizar on public.contacts;
create trigger trg_redigir_comentarios_ao_anonimizar
  after update of is_anonymized on public.contacts
  for each row
  when (new.is_anonymized is true and old.is_anonymized is distinct from true)
  execute function public.fn_redigir_comentarios_ao_anonimizar();

notify pgrst, 'reload schema';
