-- manifest: **O agente preenche campo personalizado do contato no banco, sem perder a escrita de quem gravou ao mesmo tempo.** `crm_update_contact` lia `contacts.custom_fields`, juntava as chaves novas na memória e regravava o mapa INTEIRO: duas escritas simultâneas (dois turnos, o agente e a tela) terminavam com a segunda apagando a chave da primeira. Função nova `fn_contato_preencher_campos_personalizados(p_org, p_contato, p_campos)` (invoker): trava a linha do contato, grava SÓ as chaves que estão vazias (ausente, nula ou texto vazio) e devolve quais gravou e quais já tinham outro valor. O agente não sobrescreve campo já preenchido (decisão da revisão de 20/11, item 2.3). Nenhuma coluna, nenhuma linha existente muda.
--
-- 9820 — campo personalizado do contato: preencher no banco, só onde está vazio.
--
-- Faixa 98xx, a do fork (ArvisX CRM), pela mesma razão da 9800 a 9815.
--
-- ═══ Por quê (revisão de 20/11/2026, item 2.3) ═══
--
-- A ferramenta `crm_update_contact` (Equipe pronta v2) grava direto no cadastro
-- o que a pessoa informou. Para os campos personalizados ela fazia
-- leitura-modifica-grava na aplicação: lia o mapa, juntava as chaves novas e
-- mandava o mapa inteiro pelo `patchContactHandler`, que SUBSTITUI
-- `custom_fields` (é o contrato da tela: o editor manda o objeto completo).
-- Entre a leitura e a gravação, qualquer outra escrita no mesmo contato era
-- perdida em silêncio.
--
-- A mesma revisão pediu para decidir o que o agente faz com campo JÁ
-- preenchido. Decisão (a conservadora): o agente só preenche o que está vazio.
-- Valor que já está no cadastro não é trocado pelo texto que o cliente mandou
-- na conversa; a ferramenta devolve o nome do campo e o agente deixa a
-- conferência para a equipe.
--
-- ═══ O que muda ═══
--
-- `fn_contato_preencher_campos_personalizados(p_org, p_contato, p_campos)`:
--
--   1. trava a linha do contato (`for update`): duas chamadas simultâneas
--      entram uma depois da outra, e a segunda lê o que a primeira gravou;
--   2. separa as chaves de `p_campos` em três grupos, pelo valor ATUAL:
--        · vazia (ausente, `null` ou `""`)      → grava;
--        · igual ao que veio                     → nada a fazer;
--        · preenchida com outro valor            → NÃO grava, devolve o nome;
--   3. grava `custom_fields || <só as vazias>` e `updated_at`;
--   4. devolve `{"gravados": [...], "ja_preenchidos": [...]}`. NULL quando o
--      contato não existe nesta organização ou foi anonimizado.
--
-- Nunca devolve valor: nem o que estava, nem o que entrou. Só nomes de chave.
--
-- `security invoker`, com EXECUTE só para `service_role`: quem chama é a
-- ferramenta, com o cliente de serviço do contexto MCP (o mesmo que já fazia o
-- UPDATE), filtrando a organização do contexto. A sessão do usuário não tem
-- chamador para ela, então não recebe o grant.
--
-- A régua de formato do campo personalizado (o "padrão" do funil) e a
-- conferência "a IA só grava o que a pessoa disse" continuam na ferramenta,
-- antes desta chamada: a função só faz a gravação atômica.
--
-- ═══ O que NÃO muda ═══
--
-- A tela e a rota `PATCH /contacts/[id]` continuam substituindo o mapa (é o
-- que deixa a pessoa APAGAR um campo pela tela). Nenhuma linha é tocada por
-- esta migration.
--
-- Idempotente: pode ser reaplicada.

create or replace function public.fn_contato_preencher_campos_personalizados(
  p_org uuid,
  p_contato uuid,
  p_campos jsonb
) returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_atual jsonb;
  v_novos jsonb;
  v_gravados jsonb;
  v_ocupados jsonb;
begin
  if p_campos is null or jsonb_typeof(p_campos) <> 'object' then
    return jsonb_build_object('gravados', '[]'::jsonb, 'ja_preenchidos', '[]'::jsonb);
  end if;

  -- A trava da linha é o que torna a mescla atômica.
  select coalesce(c.custom_fields, '{}'::jsonb)
    into v_atual
    from public.contacts c
   where c.organization_id = p_org
     and c.id = p_contato
     and coalesce(c.is_anonymized, false) = false
     for update;
  if not found then
    return null;
  end if;
  if jsonb_typeof(v_atual) <> 'object' then
    v_atual := '{}'::jsonb;
  end if;

  select coalesce(jsonb_object_agg(e.key, e.value) filter (where e.vazia), '{}'::jsonb),
         coalesce(jsonb_agg(e.key order by e.key) filter (where e.vazia), '[]'::jsonb),
         coalesce(jsonb_agg(e.key order by e.key) filter (where not e.vazia and e.value is distinct from e.atual), '[]'::jsonb)
    into v_novos, v_gravados, v_ocupados
    from (
      select n.key,
             n.value,
             v_atual -> n.key as atual,
             coalesce(v_atual -> n.key, 'null'::jsonb) in ('null'::jsonb, '""'::jsonb) as vazia
        from jsonb_each(p_campos) n
       -- valor vazio que veio não é dado a gravar
       where n.value not in ('null'::jsonb, '""'::jsonb)
    ) e;

  if v_novos <> '{}'::jsonb then
    update public.contacts c
       set custom_fields = v_atual || v_novos,
           updated_at = now()
     where c.organization_id = p_org
       and c.id = p_contato;
  end if;

  return jsonb_build_object('gravados', v_gravados, 'ja_preenchidos', v_ocupados);
end;
$$;
revoke execute on function public.fn_contato_preencher_campos_personalizados(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.fn_contato_preencher_campos_personalizados(uuid, uuid, jsonb) to service_role;

comment on function public.fn_contato_preencher_campos_personalizados(uuid, uuid, jsonb) is
  'Preenche campos personalizados do contato SÓ onde estão vazios, com a linha travada (sem perder escrita concorrente). Devolve os nomes gravados e os que já tinham outro valor; nunca devolve valor. Invoker. Migration 9820.';

notify pgrst, 'reload schema';
