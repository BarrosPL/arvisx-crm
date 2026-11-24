-- manifest: **A junção de contatos feita por agente guarda o que juntou e pode ser desfeita.** Tabela `fusoes_de_contatos` (só do servidor: RLS ligada sem policy, nada para `anon` nem `authenticated`), um registro por contato absorvido, com os ids das linhas que mudaram de contato (`vinculos`) e o que a ficha que ficou herdou (`estado_anterior`: nomes de campo, ids e contagens, nunca o valor). `fn_mesclar_contatos_com_registro` tira o retrato, chama a `fn_mesclar_contatos` de sempre (a regra da junção não muda) e grava o registro na mesma transação; recusa contato pessoal e contato de grupo. `fn_desfazer_fusao_de_contatos` devolve a ficha absorvida à vida, as linhas registradas ao contato de origem e tira da ficha que ficou o que ela herdou e ninguém alterou depois; em conflito de unicidade nada muda. `fn_colunas_que_apontam_para_contato` é a lista, tirada do catálogo, que as duas percorrem. As três funções são só do `service_role`. Nenhuma linha existente muda; a junção pela tela continua igual e não gera registro.
--
-- 9813 — o registro da junção de contatos, para poder desfazer.
--
-- Faixa 98xx, a do fork (ArvisX CRM), pela mesma razão da 9800 a 9809.
--
-- ═══ Por quê ═══
--
-- `fn_mesclar_contatos` (0215 e seguintes) reponta toda linha que aponta para a
-- ficha absorvida e devolve só a CONTAGEM por tabela. Depois dela não há como
-- saber quais conversas, negócios, tarefas e mensagens eram de qual ficha: a
-- junção não tinha desfazer. Pela tela, quem junta é uma pessoa olhando as duas
-- fichas. Por agente (`crm_merge_contacts`), o dono pediu que ficasse o
-- registro do que foi juntado, para poder voltar atrás.
--
-- ═══ O que muda ═══
--
-- 1. `fusoes_de_contatos` — um registro por ficha absorvida.
--    * `vinculos` (jsonb): `{"tabela.coluna": ["id", ...]}`, as linhas que
--      passaram da ficha absorvida para a que ficou. Só ids.
--    * `estado_anterior` (jsonb): o que a ficha que ficou ganhou. Guarda NOMES
--      de campo, ids e contagens. O valor de cada campo continua na ficha
--      absorvida, que a junção não apaga. Por isso a tabela não guarda dado da
--      pessoa: nem telefone, nem e-mail, nem etiqueta.
--    * `criado_por_token_id`, `desfeito_por_token_id`: o token que agiu.
--    * `desfeito_em`, `resultado_do_desfazer`: preenchidos ao desfazer.
--    As duas colunas de contato têm chave estrangeira com `on delete cascade`.
--
-- 2. `fn_colunas_que_apontam_para_contato()` — toda coluna de `public` com
--    chave estrangeira para `contacts.id`, mais `crm_lead_links.target_id`
--    (`target_kind = 'contact'`). É a mesma consulta do passo 5 de
--    `fn_mesclar_contatos`, com o tipo da coluna `id` de cada tabela.
--
-- 3. `fn_mesclar_contatos_com_registro(org, principal, absorvido, token)` —
--    pega as mesmas travas da junção e na mesma ordem, anota as linhas da ficha
--    absorvida, chama `fn_mesclar_contatos` e grava o registro com o que de
--    fato mudou de ficha.
--
-- 4. `fn_desfazer_fusao_de_contatos(org, registro, token)` — o caminho de volta.
--
-- ═══ O que o desfazer NÃO devolve ═══
--
-- * As etiquetas: a ficha que ficou continua com a união das etiquetas das
--   duas. Saber quais eram só da absorvida exigiria guardar etiqueta aqui, e
--   etiqueta descreve a pessoa.
-- * O telefone extra da absorvida que repetia o número da ficha que ficou: a
--   junção o apaga (9043), e o número é da ficha que ficou.
-- * Linha de tabela sem coluna `id`: não há como nomeá-la no registro.
-- * O que nasceu depois da junção na ficha que ficou continua nela. As
--   exceções são as mensagens das conversas devolvidas e as atividades dos
--   negócios devolvidos, que acompanham a conversa e o negócio.
-- * Campo herdado que alguém alterou depois fica como está.
--
-- ═══ O que NÃO muda ═══
--
-- `fn_mesclar_contatos` e a rota da tela (`POST /api/v1/contacts/merge`).

create table if not exists public.fusoes_de_contatos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contato_principal_id uuid not null references public.contacts(id) on delete cascade,
  contato_absorvido_id uuid not null references public.contacts(id) on delete cascade,
  vinculos jsonb not null default '{}'::jsonb,
  estado_anterior jsonb not null default '{}'::jsonb,
  criado_por_token_id uuid references public.api_tokens(id) on delete set null,
  created_at timestamptz not null default now(),
  desfeito_em timestamptz,
  desfeito_por_token_id uuid references public.api_tokens(id) on delete set null,
  resultado_do_desfazer jsonb
);

comment on table public.fusoes_de_contatos is
  'Registro da junção de contatos feita por agente (crm_merge_contacts), para poder desfazer. vinculos = ids das linhas que mudaram de ficha, por tabela.coluna; estado_anterior = nomes de campo herdados, ids e contagens (nunca o valor). Só o servidor lê e grava. Migration 9813.';

create index if not exists idx_fusoes_de_contatos_org_absorvido
  on public.fusoes_de_contatos (organization_id, contato_absorvido_id, created_at desc);
create index if not exists idx_fusoes_de_contatos_org_principal
  on public.fusoes_de_contatos (organization_id, contato_principal_id);

alter table public.fusoes_de_contatos enable row level security;

revoke all on public.fusoes_de_contatos from public, anon, authenticated;
grant select, insert, update on public.fusoes_de_contatos to service_role;

create or replace function public.fn_colunas_que_apontam_para_contato()
returns table (tabela text, coluna text, filtro text, tipo_do_id text)
language sql
stable
security definer
set search_path = ''
as $$
  select alvo.tabela, alvo.coluna, alvo.filtro,
         (select pg_catalog.format_type(i.atttypid, i.atttypmod)
            from pg_catalog.pg_attribute i
           where i.attrelid = pg_catalog.to_regclass(pg_catalog.format('public.%I', alvo.tabela))
             and i.attname = 'id'
             and i.attnum > 0
             and not i.attisdropped) as tipo_do_id
    from (
      select distinct c.relname::text as tabela, a.attname::text as coluna, ''::text as filtro
        from pg_catalog.pg_constraint co
        join pg_catalog.pg_class c on c.oid = co.conrelid
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        left join lateral (
          select k.ord
            from pg_catalog.unnest(co.confkey) with ordinality as k(attnum, ord)
            join pg_catalog.pg_attribute fa
              on fa.attrelid = co.confrelid and fa.attnum = k.attnum
           where fa.attname = 'id'
           limit 1
        ) pos on true
        join pg_catalog.pg_attribute a
          on a.attrelid = co.conrelid
         and a.attnum = co.conkey[coalesce(pos.ord, 1)]
       where co.contype = 'f'
         and co.confrelid = 'public.contacts'::regclass
         and co.conrelid <> 'public.contacts'::regclass
         and c.relkind = 'r'
         and n.nspname = 'public'
      union all
      select 'crm_lead_links'::text, 'target_id'::text, ' and target_kind = ''contact'''::text
       where pg_catalog.to_regclass('public.crm_lead_links') is not null
    ) as alvo
   order by 1, 2;
$$;

revoke execute on function public.fn_colunas_que_apontam_para_contato() from public, anon, authenticated;
grant execute on function public.fn_colunas_que_apontam_para_contato() to service_role;

comment on function public.fn_colunas_que_apontam_para_contato() is
  'Toda coluna de public com chave estrangeira para contacts.id, mais crm_lead_links.target_id (target_kind = contact), com o tipo da coluna id da tabela (nulo = tabela sem id). A mesma lista do passo 5 de fn_mesclar_contatos. Migration 9813.';

create or replace function public.fn_mesclar_contatos_com_registro(
  p_organization_id uuid,
  p_contato_principal uuid,
  p_contato_absorvido uuid,
  p_token_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_antes public.contacts%rowtype;
  v_abs public.contacts%rowtype;
  v_depois public.contacts%rowtype;
  v_travar uuid;
  v_alvo record;
  v_chave text;
  v_ids jsonb;
  v_movidos jsonb;
  v_qtd integer;
  v_candidatos jsonb := '{}'::jsonb;
  v_vinculos jsonb := '{}'::jsonb;
  v_sem_registro jsonb := '{}'::jsonb;
  v_cadeia jsonb;
  v_extras_antes uuid[];
  v_extras_repetidos integer;
  v_extras_criados jsonb;
  v_herdados text[] := '{}'::text[];
  v_campos_novos jsonb;
  v_lid_herdado boolean;
  v_conflito text;
  v_token uuid;
  v_resultado jsonb;
  v_registro uuid;
begin
  if p_organization_id is null
     or p_contato_principal is null
     or p_contato_absorvido is null
     or p_contato_principal = p_contato_absorvido then
    raise exception using errcode = '22023', message = 'selecao_de_mesclagem_invalida';
  end if;

  -- As travas de `fn_mesclar_contatos`, na mesma ordem (a organização, os
  -- atendimentos, as conversas, as fichas): o retrato abaixo tem de valer até a
  -- junção, e pegar as fichas antes da trava da organização fecharia o ciclo de
  -- espera que a 0262 desfez.
  perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended(p_organization_id::text, 262));
  for v_travar in
    select distinct ids.id from unnest(array[p_contato_principal, p_contato_absorvido]) as ids(id) order by ids.id
  loop
    perform public.fn_service_lock(p_organization_id, v_travar);
  end loop;
  perform 1 from public.conversations
   where organization_id = p_organization_id
     and contact_id in (p_contato_principal, p_contato_absorvido)
   order by id for no key update;

  select * into v_antes from public.contacts
   where id = p_contato_principal
     and organization_id = p_organization_id
     and is_merged_into is null
     and is_anonymized = false
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'contato_principal_indisponivel';
  end if;

  select * into v_abs from public.contacts
   where id = p_contato_absorvido
     and organization_id = p_organization_id
     and is_merged_into is null
     and is_anonymized = false
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'contato_secundario_indisponivel';
  end if;

  -- Contato pessoal está fora da operação, e contato de grupo é o marcador de
  -- uma conversa de grupo: nenhum dos dois é juntado por agente.
  if v_antes.is_personal or v_abs.is_personal then
    raise exception using errcode = '22023', message = 'fusao_de_contato_pessoal';
  end if;
  if v_antes.kind <> 'person' or v_abs.kind <> 'person' then
    raise exception using errcode = '22023', message = 'fusao_de_contato_de_grupo';
  end if;

  v_token := (
    select t.id from public.api_tokens t
     where t.id = p_token_id and t.organization_id = p_organization_id
  );

  -- O retrato: quem já apontava para a absorvida, os telefones extras das duas
  -- e os extras da absorvida que a junção vai apagar por repetirem a que fica.
  select coalesce(jsonb_agg(c.id order by c.id), '[]'::jsonb) into v_cadeia
    from public.contacts c
   where c.organization_id = p_organization_id
     and c.is_merged_into = p_contato_absorvido;

  select coalesce(array_agg(t.id), '{}'::uuid[]) into v_extras_antes
    from public.contact_phones t
   where t.organization_id = p_organization_id
     and t.contact_id in (p_contato_principal, p_contato_absorvido);

  select count(*)::integer into v_extras_repetidos
    from public.contact_phones t
   where t.organization_id = p_organization_id
     and t.contact_id = p_contato_absorvido
     and (
       t.phone_number = public.fn_telefone_canonico(v_antes.phone_number)
       or (t.wa_lid is not null and t.wa_lid = v_antes.wa_lid)
     );

  for v_alvo in select * from public.fn_colunas_que_apontam_para_contato() loop
    v_chave := v_alvo.tabela || '.' || v_alvo.coluna;
    if v_alvo.tipo_do_id is null then
      execute format(
        'select count(*)::integer from public.%I where %I = $1%s',
        v_alvo.tabela, v_alvo.coluna, v_alvo.filtro
      ) into v_qtd using p_contato_absorvido;
      if v_qtd > 0 then
        v_sem_registro := v_sem_registro || jsonb_build_object(v_chave, v_qtd);
      end if;
    else
      execute format(
        'select coalesce(jsonb_agg(id::text), ''[]''::jsonb) from public.%I where %I = $1%s',
        v_alvo.tabela, v_alvo.coluna, v_alvo.filtro
      ) into v_ids using p_contato_absorvido;
      if jsonb_array_length(v_ids) > 0 then
        v_candidatos := v_candidatos || jsonb_build_object(v_chave, v_ids);
      end if;
    end if;
  end loop;

  -- A junção de sempre. A regra não tem cópia aqui.
  v_resultado := public.fn_mesclar_contatos(
    p_organization_id, p_contato_principal, array[p_contato_absorvido]
  );

  -- O que de fato mudou de ficha: a linha anotada que agora aponta para a que
  -- fica. A que colidiu com um índice único continuou na absorvida e não entra.
  for v_alvo in select * from public.fn_colunas_que_apontam_para_contato() loop
    v_chave := v_alvo.tabela || '.' || v_alvo.coluna;
    v_ids := v_candidatos -> v_chave;
    continue when v_ids is null;
    execute format(
      'select coalesce(jsonb_agg(id::text), ''[]''::jsonb) from public.%I '
      || 'where %I = $1 and id::text in (select jsonb_array_elements_text($2))%s',
      v_alvo.tabela, v_alvo.coluna, v_alvo.filtro
    ) into v_movidos using p_contato_principal, v_ids;
    if jsonb_array_length(v_movidos) > 0 then
      v_vinculos := v_vinculos || jsonb_build_object(v_chave, v_movidos);
    end if;
  end loop;

  select * into v_depois from public.contacts
   where id = p_contato_principal and organization_id = p_organization_id;

  -- Só o NOME do campo herdado: o valor está na ficha absorvida.
  if v_antes.display_name is null and v_depois.display_name is not null then
    v_herdados := array_append(v_herdados, 'display_name'::text);
  end if;
  if v_antes.birthdate is null and v_depois.birthdate is not null then
    v_herdados := array_append(v_herdados, 'birthdate'::text);
  end if;
  if v_antes.email is null and v_depois.email is not null then
    v_herdados := array_append(v_herdados, 'email'::text);
  end if;
  if v_antes.phone_number is null and v_depois.phone_number is not null then
    v_herdados := array_append(v_herdados, 'phone_number'::text);
  end if;
  if v_antes.social_identity is null and v_depois.social_identity is not null then
    v_herdados := array_append(v_herdados, 'social_identity'::text);
  end if;

  v_lid_herdado := (v_antes.source_metadata ->> 'waha_lid') is null
                   and (v_depois.source_metadata ->> 'waha_lid') is not null;

  -- O aviso de telefone em conflito que a junção tirou da ficha que fica. Volta
  -- no desfazer só quando o número era o da absorvida (lido dela, não daqui).
  if (v_antes.source_metadata ? 'telefone_em_conflito')
     and not (v_depois.source_metadata ? 'telefone_em_conflito') then
    if v_abs.phone_number is not null
       and public.fn_telefone_canonico(v_antes.source_metadata ->> 'telefone_em_conflito')
           is not distinct from public.fn_telefone_canonico(v_abs.phone_number) then
      v_conflito := 'do_absorvido';
    else
      v_conflito := 'de_outro';
    end if;
  end if;

  select coalesce(jsonb_agg(k.chave order by k.chave), '[]'::jsonb) into v_campos_novos
    from jsonb_object_keys(
           case when jsonb_typeof(v_depois.custom_fields) = 'object'
                then v_depois.custom_fields else '{}'::jsonb end
         ) as k(chave)
   where not (
     case when jsonb_typeof(v_antes.custom_fields) = 'object'
          then v_antes.custom_fields else '{}'::jsonb end ? k.chave
   );

  select coalesce(jsonb_agg(t.id order by t.id), '[]'::jsonb) into v_extras_criados
    from public.contact_phones t
   where t.organization_id = p_organization_id
     and t.contact_id = p_contato_principal
     and not (t.id = any(v_extras_antes));

  insert into public.fusoes_de_contatos
    (organization_id, contato_principal_id, contato_absorvido_id, vinculos,
     estado_anterior, criado_por_token_id)
  values
    (p_organization_id, p_contato_principal, p_contato_absorvido, v_vinculos,
     jsonb_build_object(
       'campos_herdados', to_jsonb(v_herdados),
       'campos_personalizados_herdados', v_campos_novos,
       'waha_lid_herdado', v_lid_herdado,
       'telefone_em_conflito', v_conflito,
       'cadeia', v_cadeia,
       'telefones_extras_criados', v_extras_criados,
       'telefones_extras_repetidos_apagados', v_extras_repetidos,
       'sem_registro', v_sem_registro,
       'nao_repontado', coalesce(v_resultado -> 'nao_repontado', '{}'::jsonb)
     ),
     v_token)
  returning id into v_registro;

  return v_resultado || jsonb_build_object(
    'registro_id', v_registro,
    'sem_registro', v_sem_registro,
    'telefones_extras_repetidos_apagados', v_extras_repetidos
  );
end;
$$;

revoke execute on function public.fn_mesclar_contatos_com_registro(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.fn_mesclar_contatos_com_registro(uuid, uuid, uuid, uuid) to service_role;

comment on function public.fn_mesclar_contatos_com_registro(uuid, uuid, uuid, uuid) is
  'Junta dois contatos chamando fn_mesclar_contatos e grava em fusoes_de_contatos o que mudou de ficha, na mesma transação. Recusa contato pessoal e contato de grupo. Só o service_role executa: quem confere o papel é a ferramenta crm_merge_contacts. Migration 9813.';

create or replace function public.fn_desfazer_fusao_de_contatos(
  p_organization_id uuid,
  p_registro_id uuid,
  p_token_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reg public.fusoes_de_contatos%rowtype;
  v_pri public.contacts%rowtype;
  v_abs public.contacts%rowtype;
  v_principal uuid;
  v_absorvido uuid;
  v_travar uuid;
  v_est jsonb;
  v_meta jsonb;
  v_lista jsonb;
  v_custom jsonb;
  v_campo text;
  v_herdados text[];
  v_anular text[] := '{}'::text[];
  v_mantidos text[] := '{}'::text[];
  v_par record;
  v_tabela text;
  v_coluna text;
  v_filtro text;
  v_tipo text;
  v_qtd integer;
  v_total integer;
  v_voltou jsonb := '{}'::jsonb;
  v_nao_voltou jsonb := '{}'::jsonb;
  v_conflito_voltou boolean := false;
  v_leads integer := 0;
  v_token uuid;
  v_resultado jsonb;
begin
  if not public.fn_support_write_allowed(p_organization_id) then
    raise exception 'support_readonly' using errcode = '42501';
  end if;

  -- Primeira leitura, sem trava, só para saber quais fichas travar: a trava da
  -- organização e a dos atendimentos vêm antes de qualquer linha.
  select r.contato_principal_id, r.contato_absorvido_id into v_principal, v_absorvido
    from public.fusoes_de_contatos r
   where r.id = p_registro_id and r.organization_id = p_organization_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'registro_de_fusao_nao_encontrado';
  end if;

  perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended(p_organization_id::text, 262));
  for v_travar in
    select distinct ids.id from unnest(array[v_principal, v_absorvido]) as ids(id) order by ids.id
  loop
    perform public.fn_service_lock(p_organization_id, v_travar);
  end loop;
  perform 1 from public.conversations
   where organization_id = p_organization_id
     and contact_id in (v_principal, v_absorvido)
   order by id for no key update;

  select * into v_reg from public.fusoes_de_contatos
   where id = p_registro_id and organization_id = p_organization_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'registro_de_fusao_nao_encontrado';
  end if;

  -- Repetir não desfaz duas vezes: devolve o resultado da primeira.
  if v_reg.desfeito_em is not null then
    return coalesce(v_reg.resultado_do_desfazer, '{}'::jsonb)
      || jsonb_build_object('ja_desfeita', true, 'registro_id', v_reg.id);
  end if;

  -- Outra junção repontou o registro entre a leitura e a trava.
  if v_reg.contato_principal_id <> v_principal or v_reg.contato_absorvido_id <> v_absorvido then
    raise exception using errcode = '40001', message = 'registro_de_fusao_em_mudanca';
  end if;

  select * into v_pri from public.contacts
   where id = v_principal and organization_id = p_organization_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'contato_da_fusao_indisponivel';
  end if;
  select * into v_abs from public.contacts
   where id = v_absorvido and organization_id = p_organization_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'contato_da_fusao_indisponivel';
  end if;

  -- Anonimização não tem volta (L-04): ficha anonimizada não volta a ser duas.
  if v_pri.is_anonymized or v_abs.is_anonymized then
    raise exception using errcode = '22023', message = 'fusao_de_contato_anonimizado';
  end if;
  if v_pri.is_merged_into is not null then
    raise exception using errcode = '22023', message = 'principal_da_fusao_foi_absorvido';
  end if;
  if v_abs.is_merged_into is distinct from v_pri.id then
    raise exception using errcode = '22023', message = 'absorvido_fora_desta_fusao';
  end if;

  v_token := (
    select t.id from public.api_tokens t
     where t.id = p_token_id and t.organization_id = p_organization_id
  );
  v_est := v_reg.estado_anterior;

  -- a) O telefone da absorvida que virou telefone extra da que fica.
  delete from public.contact_phones t
   where t.organization_id = p_organization_id
     and t.contact_id = v_pri.id
     and t.id::text in (
       select jsonb_array_elements_text(
         case when jsonb_typeof(v_est -> 'telefones_extras_criados') = 'array'
              then v_est -> 'telefones_extras_criados' else '[]'::jsonb end)
     );

  -- b) O que a ficha que fica herdou. Só sai o campo que continua IGUAL ao da
  --    absorvida: o que alguém alterou depois fica como está.
  select coalesce(array_agg(x.campo), '{}'::text[]) into v_herdados
    from jsonb_array_elements_text(
           case when jsonb_typeof(v_est -> 'campos_herdados') = 'array'
                then v_est -> 'campos_herdados' else '[]'::jsonb end
         ) as x(campo)
   where x.campo in ('display_name', 'birthdate', 'email', 'phone_number', 'social_identity');

  foreach v_campo in array v_herdados loop
    if (to_jsonb(v_pri) ->> v_campo) is not distinct from (to_jsonb(v_abs) ->> v_campo) then
      v_anular := array_append(v_anular, v_campo);
    else
      v_mantidos := array_append(v_mantidos, v_campo);
    end if;
  end loop;

  v_meta := v_pri.source_metadata;

  select coalesce(jsonb_agg(e.valor), '[]'::jsonb) into v_lista
    from jsonb_array_elements(
           case when jsonb_typeof(v_meta -> 'mesclado_de') = 'array'
                then v_meta -> 'mesclado_de' else '[]'::jsonb end
         ) as e(valor)
   where (e.valor #>> '{}') is distinct from v_abs.id::text;
  if jsonb_array_length(v_lista) = 0 then
    v_meta := v_meta - 'mesclado_de' - 'mesclado_em';
  else
    v_meta := v_meta || jsonb_build_object('mesclado_de', v_lista);
  end if;

  select coalesce(jsonb_agg(e.valor), '[]'::jsonb) into v_lista
    from jsonb_array_elements(
           case when jsonb_typeof(v_meta -> 'nomes_absorvidos') = 'array'
                then v_meta -> 'nomes_absorvidos' else '[]'::jsonb end
         ) as e(valor)
   where (e.valor ->> 'contato_id') is distinct from v_abs.id::text;
  if jsonb_array_length(v_lista) = 0 then
    v_meta := v_meta - 'nomes_absorvidos';
  else
    v_meta := v_meta || jsonb_build_object('nomes_absorvidos', v_lista);
  end if;

  if coalesce((v_est ->> 'waha_lid_herdado')::boolean, false)
     and (v_meta ->> 'waha_lid') is not distinct from (v_abs.source_metadata ->> 'waha_lid') then
    v_meta := v_meta - 'waha_lid';
  end if;

  if (v_est ->> 'telefone_em_conflito') = 'do_absorvido'
     and v_abs.phone_number is not null
     and not (v_meta ? 'telefone_em_conflito') then
    v_meta := v_meta || jsonb_build_object('telefone_em_conflito', v_abs.phone_number);
    v_conflito_voltou := true;
  end if;

  v_custom := v_pri.custom_fields;
  if jsonb_typeof(v_custom) = 'object' and jsonb_typeof(v_abs.custom_fields) = 'object' then
    for v_campo in
      select jsonb_array_elements_text(
        case when jsonb_typeof(v_est -> 'campos_personalizados_herdados') = 'array'
             then v_est -> 'campos_personalizados_herdados' else '[]'::jsonb end)
    loop
      if (v_custom ? v_campo)
         and (v_custom -> v_campo) is not distinct from (v_abs.custom_fields -> v_campo) then
        v_custom := v_custom - v_campo;
      end if;
    end loop;
  end if;

  update public.contacts set
    display_name = case when 'display_name' = any(v_anular) then null else display_name end,
    birthdate = case when 'birthdate' = any(v_anular) then null else birthdate end,
    email = case when 'email' = any(v_anular) then null else email end,
    phone_number = case when 'phone_number' = any(v_anular) then null else phone_number end,
    social_identity = case when 'social_identity' = any(v_anular) then null else social_identity end,
    custom_fields = v_custom,
    source_metadata = v_meta,
    updated_at = now()
  where id = v_pri.id and organization_id = p_organization_id;

  -- c) A ficha absorvida volta a existir. É aqui que um conflito de unicidade
  --    aparece (alguém cadastrou o mesmo telefone ou e-mail nesse meio tempo).
  update public.contacts set
    is_merged_into = null,
    merged_at = null,
    updated_at = now()
  where id = v_abs.id and organization_id = p_organization_id;

  -- d) Quem já tinha sido absorvido por ela volta a apontar para ela.
  update public.contacts set is_merged_into = v_abs.id
   where organization_id = p_organization_id
     and is_merged_into = v_pri.id
     and id::text in (
       select jsonb_array_elements_text(
         case when jsonb_typeof(v_est -> 'cadeia') = 'array'
              then v_est -> 'cadeia' else '[]'::jsonb end)
     );

  -- e) As linhas registradas voltam para a ficha de origem. O nome da tabela e
  --    o da coluna só valem se ainda estiverem na lista tirada do catálogo.
  for v_par in
    select t.chave, t.ids from jsonb_each(v_reg.vinculos) as t(chave, ids)
     where jsonb_typeof(t.ids) = 'array'
     order by t.chave
  loop
    v_tabela := null;
    v_coluna := null;
    v_filtro := null;
    v_tipo := null;
    select a.tabela, a.coluna, a.filtro, a.tipo_do_id into v_tabela, v_coluna, v_filtro, v_tipo
      from public.fn_colunas_que_apontam_para_contato() a
     where a.tabela || '.' || a.coluna = v_par.chave
     limit 1;
    v_total := jsonb_array_length(v_par.ids);
    if v_tabela is null or v_tipo is null then
      v_nao_voltou := v_nao_voltou || jsonb_build_object(v_par.chave, v_total);
      continue;
    end if;
    execute format(
      'update public.%I set %I = $1 where %I = $2 '
      || 'and id::text in (select jsonb_array_elements_text($3))%s',
      v_tabela, v_coluna, v_coluna, v_filtro
    ) using v_abs.id, v_pri.id, v_par.ids;
    get diagnostics v_qtd = row_count;
    if v_qtd > 0 then
      v_voltou := v_voltou || jsonb_build_object(v_par.chave, v_qtd);
    end if;
    if v_total - v_qtd > 0 then
      v_nao_voltou := v_nao_voltou || jsonb_build_object(v_par.chave, v_total - v_qtd);
    end if;
  end loop;

  -- f) O que nasceu depois da junção DENTRO do que voltou acompanha o dono: a
  --    mensagem da conversa devolvida e a atividade do negócio devolvido.
  if jsonb_typeof(v_reg.vinculos -> 'conversations.contact_id') = 'array' then
    update public.messages m set contact_id = v_abs.id
     where m.organization_id = p_organization_id
       and m.contact_id = v_pri.id
       and m.conversation_id in (
         select c.id from public.conversations c
          where c.organization_id = p_organization_id
            and c.contact_id = v_abs.id
            and c.id::text in (
              select jsonb_array_elements_text(v_reg.vinculos -> 'conversations.contact_id'))
       );
    get diagnostics v_qtd = row_count;
    if v_qtd > 0 then
      v_voltou := v_voltou || jsonb_build_object(
        'messages.contact_id',
        coalesce((v_voltou ->> 'messages.contact_id')::integer, 0) + v_qtd);
    end if;
  end if;

  if jsonb_typeof(v_reg.vinculos -> 'crm_leads.contact_id') = 'array' then
    update public.crm_lead_activities a set contact_id = v_abs.id
     where a.organization_id = p_organization_id
       and a.contact_id = v_pri.id
       and a.lead_id in (
         select l.id from public.crm_leads l
          where l.organization_id = p_organization_id
            and l.contact_id = v_abs.id
            and l.id::text in (
              select jsonb_array_elements_text(v_reg.vinculos -> 'crm_leads.contact_id'))
       );
    get diagnostics v_qtd = row_count;
    if v_qtd > 0 then
      v_voltou := v_voltou || jsonb_build_object(
        'crm_lead_activities.contact_id',
        coalesce((v_voltou ->> 'crm_lead_activities.contact_id')::integer, 0) + v_qtd);
    end if;
  end if;

  -- g) A linha do tempo de cada negócio das duas fichas diz que a junção voltou.
  insert into public.crm_lead_activities
    (organization_id, lead_id, contact_id, source_module, source_id, type,
     payload, metadata, performed_at, performed_by_user_id)
  select p_organization_id, l.id, l.contact_id, 'crm', v_pri.id,
         'contacts_unmerged',
         jsonb_build_object(
           'registro_id', v_reg.id,
           'contato_principal', v_pri.id,
           'contato_restaurado', v_abs.id
         ),
         '{}'::jsonb, now(), null
    from public.crm_leads l
   where l.organization_id = p_organization_id
     and l.contact_id in (v_pri.id, v_abs.id);
  get diagnostics v_leads = row_count;

  v_resultado := jsonb_build_object(
    'registro_id', v_reg.id,
    'contato_principal_id', v_pri.id,
    'contato_restaurado_id', v_abs.id,
    'voltou', v_voltou,
    'nao_voltou', v_nao_voltou,
    'campos_devolvidos', to_jsonb(v_anular),
    'campos_mantidos', to_jsonb(v_mantidos),
    'telefone_em_conflito_voltou', v_conflito_voltou,
    'sem_registro', coalesce(v_est -> 'sem_registro', '{}'::jsonb),
    'telefones_extras_repetidos_apagados',
      coalesce((v_est ->> 'telefones_extras_repetidos_apagados')::integer, 0),
    'atividades_emitidas', v_leads
  );

  update public.fusoes_de_contatos set
    desfeito_em = now(),
    desfeito_por_token_id = v_token,
    resultado_do_desfazer = v_resultado
  where id = v_reg.id;

  return v_resultado || jsonb_build_object('ja_desfeita', false);
exception
  when unique_violation or exclusion_violation then
    -- Tudo o que o bloco fez é desfeito pelo banco antes de chegar aqui: ou a
    -- junção volta inteira, ou nada muda.
    raise exception using errcode = '23505', message = 'conflito_ao_desfazer_fusao';
end;
$$;

revoke execute on function public.fn_desfazer_fusao_de_contatos(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.fn_desfazer_fusao_de_contatos(uuid, uuid, uuid) to service_role;

comment on function public.fn_desfazer_fusao_de_contatos(uuid, uuid, uuid) is
  'Desfaz uma junção registrada em fusoes_de_contatos: a ficha absorvida volta a existir, as linhas registradas voltam para ela e a ficha que ficou perde o que herdou e ninguém alterou. Conflito de unicidade: nada muda. Repetir devolve o resultado da primeira vez. Só o service_role executa. Migration 9813.';

notify pgrst, 'reload schema';
