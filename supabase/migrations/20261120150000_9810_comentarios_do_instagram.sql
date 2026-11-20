-- manifest: **Comentários do Instagram: a tabela que guarda o que chega.** `social_comments`, uma linha por comentário recebido pelo webhook da conexão direta (provider `meta_social`), única por `(organization_id, comment_id)` — é o que absorve a notificação repetida da Meta. Guarda canal, mídia, anúncio, autor, texto inteiro, quando, o estado (`novo`/`ignorado`/`respondido`/`sem_acao`) e as duas respostas (pública e privada, preenchidas pela API de resposta). RLS: membros da organização leem; só o servidor escreve. Nenhuma linha existente muda.
--
-- 9810 — os comentários do Instagram que a conexão direta recebe.
--
-- Faixa 98xx, a do fork (ArvisX CRM), pela mesma razão da 9800 a 9808. A 9809
-- foi pulada de propósito: está reservada por outra frente em voo.
--
-- ═══ Por quê ═══
--
-- O webhook da conexão direta (`lib/channels/meta-social/webhook.ts`) só lia
-- mensagens. Comentário em publicação é a outra porta por onde gente chega, e
-- quem decide o que responder é um agente externo, pela API. O CRM precisa de
-- um lugar para guardar o comentário, dizer em que pé ele está e impedir que a
-- mesma notificação vire dois registros.
--
-- ═══ O que entra ═══
--
-- `social_comments` — UMA linha por comentário.
--
--   * `comment_id`: o id do comentário na rede. Com `organization_id` forma a
--     chave única, e é ela que dá a idempotência: a Meta reentrega o que não
--     recebe 2xx e, em anúncio, pode notificar o mesmo comentário mais de uma
--     vez. O segundo INSERT estoura `23505` e o servidor o trata como repetido.
--   * `channel_session_id`: o canal que recebeu. `on delete restrict`, como
--     `conversations` e `messages`: canal se arquiva, não se apaga com o
--     histórico pendurado.
--   * `parent_comment_id`: preenchido quando o comentário é resposta a outro.
--   * `media_id`, `media_product_type`, `ad_id`, `ad_title`: a publicação (e o
--     anúncio, quando houver) onde o comentário foi feito.
--   * `ao_vivo`: veio do campo `live_comments` (transmissão ao vivo). A
--     resposta privada a comentário de Live só vale durante a transmissão.
--   * `author_id`, `author_username`: quem comentou (id com escopo do
--     Instagram e o nome de usuário público).
--   * `text`: o texto INTEIRO, sem corte.
--   * `commented_at`: a hora que a Meta carimbou na notificação. O payload não
--     traz a hora do comentário em si; a da notificação é a mais próxima que
--     existe, e é dela que se conta o prazo de 7 dias da resposta privada.
--   * `estado`: `novo` (chegou), `respondido`, `sem_acao` (alguém decidiu não
--     agir) e `ignorado`. É `text` + CHECK, e o vocabulário é o mesmo de
--     `ESTADOS_DO_COMENTARIO` em `lib/channels/meta-social/comentarios.ts`.
--   * `public_reply`, `private_reply`: `jsonb` nulo até existir resposta. A
--     forma (`id`, `texto`, `quando`, `quem`, `simulada`, e `message_id` na
--     privada) é validada no servidor, por quem grava.
--
-- ═══ O que NÃO entra, de propósito ═══
--
-- A ligação com o contato (`contact_id`). Nada nesta entrega cria contato a
-- partir de comentário, então a coluna nasceria sempre nula; e uma chave
-- estrangeira para `contacts` põe a tabela no alcance da anonimização (LGPD),
-- que precisa nascer JUNTO com o passo de redação e de exportação. Ela entra
-- com a entrega que cria o contato.
--
-- ═══ RLS e privilégios ═══
--
-- Membros da organização LEEM. Não há policy de INSERT, UPDATE nem DELETE: quem
-- grava é o servidor (webhook e, depois, a API de resposta), com a chave de
-- serviço e a organização tirada da sessão do canal. `authenticated` recebe só
-- `select`; `anon`, nada.
--
-- ═══ Reversão ═══
--
--   drop table if exists public.social_comments;

create table if not exists public.social_comments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  channel_session_id uuid not null references public.channel_sessions(id) on delete restrict,
  comment_id text not null,
  parent_comment_id text,
  media_id text,
  media_product_type text,
  ad_id text,
  ad_title text,
  ao_vivo boolean not null default false,
  author_id text,
  author_username text,
  text text,
  commented_at timestamptz not null,
  estado text not null default 'novo' check (estado in ('novo', 'ignorado', 'respondido', 'sem_acao')),
  public_reply jsonb,
  private_reply jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_comments_org_comment_unique unique (organization_id, comment_id)
);

comment on table public.social_comments is
  'Comentários recebidos em publicações do Instagram pela conexão direta. Uma linha por comentário, única por (organization_id, comment_id). estado = novo|ignorado|respondido|sem_acao (espelhado em lib/channels/meta-social/comentarios.ts); public_reply e private_reply ficam nulos até existir resposta. Só o servidor escreve. Migration 9810.';

-- A fila de trabalho: "os comentários novos deste canal, do mais recente".
create index if not exists social_comments_org_estado_quando_idx
  on public.social_comments (organization_id, estado, commented_at desc);

-- A chave estrangeira do canal, e a lista por canal.
create index if not exists social_comments_canal_quando_idx
  on public.social_comments (channel_session_id, commented_at desc);

-- A poda por idade varre pela ponta mais velha, sem organização.
create index if not exists social_comments_poda_idx
  on public.social_comments (commented_at);

drop trigger if exists trg_social_comments_updated_at on public.social_comments;
create trigger trg_social_comments_updated_at
  before update on public.social_comments
  for each row execute function public.fn_set_updated_at();

alter table public.social_comments enable row level security;

drop policy if exists tenant_isolation_social_comments_select on public.social_comments;
create policy tenant_isolation_social_comments_select on public.social_comments
  for select using (
    (organization_id in (select public.fn_user_org_ids())) or (select public.fn_is_platform_admin())
  );

-- `ALTER DEFAULT PRIVILEGES … GRANT ALL ON TABLES TO anon` do baseline alcança
-- toda tabela criada depois dele. Sem este revoke, o comentário e quem o
-- escreveu ficariam legíveis pela anon key, que vai para o browser.
revoke all on public.social_comments from anon, authenticated;
grant select on public.social_comments to authenticated;
grant all on public.social_comments to service_role;

notify pgrst, 'reload schema';
