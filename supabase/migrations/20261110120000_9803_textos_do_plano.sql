-- manifest: **Textos do plano.** `cobranca_planos` ganha os textos que vendem o plano, escritos pelo dono em /admin/cobranca (`descricao_curta`, `para_quem`, `destaques`, `limites`, `como_funciona`), todos opcionais e sem default, e o marcador `inclui_agentes_arvisx` (default false). Nenhuma linha muda de valor.
--
-- 9803 — os textos de cada plano e o marcador do Equipe Completa.
--
-- Faixa 98xx, a do fork (ArvisX CRM), pela mesma razão da 9800 a 9802.
--
-- ═══ Por quê ═══
--
-- O plano só guardava preço, moeda, limites e telas: nada dizia PARA QUEM ele é,
-- e a tela de assinatura comparava planos por nome técnico de tela. O cliente
-- não via o que justifica o plano maior (relato do Dr. Renan, 10/11/2026). Os
-- textos passam a morar no PLANO, escritos pelo dono; o código não tem texto
-- de plano fixo nem valor.
--
-- ═══ O que muda ═══
--
-- 1. Colunas de texto, TODAS nullable e SEM default (nenhum texto inventado):
--      descricao_curta  text    até 140 caracteres
--      para_quem        text    até 200
--      destaques        text[]  até 8 frases de até 120 ("o que você tem")
--      limites          text[]  até 5 frases de até 200 ("o que você não tem")
--      como_funciona    text    até 600 (o parágrafo em destaque no card; usado
--                               pelo Equipe Completa para dizer como os agentes
--                               são criados depois da assinatura)
--    Texto vazio não é texto: o CHECK recusa string vazia e frase vazia na lista
--    (o TypeScript já converte vazio em null antes de gravar).
--
-- 2. `inclui_agentes_arvisx boolean not null default false` — o plano inclui os
--    4 agentes de IA feitos sob medida pela equipe da Arvisx (Equipe Completa).
--    É INFORMATIVO: o CRM não liga nem desliga agente nenhum por ele; ele mostra
--    o selo e dispara o aviso à equipe (migration 9804).
--
-- 3. `fn_frases_do_plano_ok(text[], int, int)` — a régua da lista (quantidade,
--    tamanho e nenhuma frase vazia), IMMUTABLE para caber no CHECK.
--
-- ═══ Dados ═══
--
-- Nenhuma linha é apagada nem alterada: os textos nascem nulos e o marcador
-- nasce false. Segura sobre o banco atual. Idempotente: `add column if not
-- exists`, `create or replace function`, constraints com `drop ... if exists`.

create or replace function public.fn_frases_do_plano_ok(p_frases text[], p_max_itens int, p_max_caracteres int)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_frases is null or (
    coalesce(cardinality(p_frases), 0) between 1 and p_max_itens
    and not exists (
      select 1 from unnest(p_frases) as f(frase)
       where f.frase is null or btrim(f.frase) = '' or char_length(f.frase) > p_max_caracteres
    )
  );
$$;

-- Só quem grava o plano (o service_role) precisa dela; o CHECK roda como quem grava.
revoke execute on function public.fn_frases_do_plano_ok(text[], int, int) from public, anon, authenticated;
grant execute on function public.fn_frases_do_plano_ok(text[], int, int) to service_role;

alter table public.cobranca_planos
  add column if not exists descricao_curta text,
  add column if not exists para_quem text,
  add column if not exists destaques text[],
  add column if not exists limites text[],
  add column if not exists como_funciona text,
  add column if not exists inclui_agentes_arvisx boolean not null default false;

alter table public.cobranca_planos drop constraint if exists cobranca_planos_descricao_curta_tamanho;
alter table public.cobranca_planos
  add constraint cobranca_planos_descricao_curta_tamanho
  check (descricao_curta is null or (btrim(descricao_curta) <> '' and char_length(descricao_curta) <= 140));

alter table public.cobranca_planos drop constraint if exists cobranca_planos_para_quem_tamanho;
alter table public.cobranca_planos
  add constraint cobranca_planos_para_quem_tamanho
  check (para_quem is null or (btrim(para_quem) <> '' and char_length(para_quem) <= 200));

alter table public.cobranca_planos drop constraint if exists cobranca_planos_como_funciona_tamanho;
alter table public.cobranca_planos
  add constraint cobranca_planos_como_funciona_tamanho
  check (como_funciona is null or (btrim(como_funciona) <> '' and char_length(como_funciona) <= 600));

alter table public.cobranca_planos drop constraint if exists cobranca_planos_destaques_frases;
alter table public.cobranca_planos
  add constraint cobranca_planos_destaques_frases
  check (public.fn_frases_do_plano_ok(destaques, 8, 120));

alter table public.cobranca_planos drop constraint if exists cobranca_planos_limites_frases;
alter table public.cobranca_planos
  add constraint cobranca_planos_limites_frases
  check (public.fn_frases_do_plano_ok(limites, 5, 200));

comment on column public.cobranca_planos.descricao_curta is
  'A promessa do plano numa frase (até 140), escrita pelo dono em /admin/cobranca. Migration 9803.';
comment on column public.cobranca_planos.para_quem is
  'Para quem o plano é (até 200), escrito pelo dono. Migration 9803.';
comment on column public.cobranca_planos.destaques is
  'O que o plano tem: até 8 frases de até 120, escritas pelo dono. Migration 9803.';
comment on column public.cobranca_planos.limites is
  'O que o plano NÃO tem: até 5 frases de até 200, escritas pelo dono. Migration 9803.';
comment on column public.cobranca_planos.como_funciona is
  'Parágrafo em destaque no card do plano (até 600), escrito pelo dono; no Equipe Completa diz como os agentes são criados. Migration 9803.';
comment on column public.cobranca_planos.inclui_agentes_arvisx is
  'O plano inclui os 4 agentes de IA feitos pela equipe da Arvisx (Equipe Completa). Informativo: mostra o selo e dispara o aviso à equipe (9804); não liga nem desliga agente. Migration 9803.';

notify pgrst, 'reload schema';
