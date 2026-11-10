begin;
select set_config('prova.org', (select id::text from public.organizations order by created_at limit 1), true);
insert into public.cobranca_planos (nome, preco_cents, moeda, intervalo, trial_dias, inclui_agentes_arvisx)
values ('Equipe Completa (prova)', 49990, 'EUR', 'mes', 0, true);
-- 1) assina em teste: nada
insert into public.cobranca_assinaturas (organization_id, plano_id, estado)
values (current_setting('prova.org')::uuid, (select id from public.cobranca_planos where nome='Equipe Completa (prova)'), 'trial');
select '1 trial', count(*) from public.cobranca_equipe_completa;
-- 2) pagamento confirmado: entrada + evento
update public.cobranca_assinaturas set estado='ativa' where organization_id=current_setting('prova.org')::uuid;
select '2 ativa', tipo, plano_nome from public.cobranca_equipe_completa order by criado_em;
select '2 evento', event_type, payload->>'tipo' from public.event_log where event_type='cobranca.equipe_completa';
-- 3) atraso e volta: nenhum aviso novo
update public.cobranca_assinaturas set estado='em_atraso' where organization_id=current_setting('prova.org')::uuid;
update public.cobranca_assinaturas set estado='ativa' where organization_id=current_setting('prova.org')::uuid;
select '3 atraso+volta', count(*) from public.cobranca_equipe_completa;
-- 4) downgrade para o Premium: saída
update public.cobranca_assinaturas set plano_id=(select id from public.cobranca_planos where nome='Premium') where organization_id=current_setting('prova.org')::uuid;
select '4 downgrade', string_agg(tipo, ',' order by criado_em, id) from public.cobranca_equipe_completa;
-- 5) volta ao Equipe Completa: nova entrada
update public.cobranca_assinaturas set plano_id=(select id from public.cobranca_planos where nome='Equipe Completa (prova)') where organization_id=current_setting('prova.org')::uuid;
select '5 volta', string_agg(tipo, ',' order by criado_em, id) from public.cobranca_equipe_completa;
select '5 eventos', count(*) from public.event_log where event_type='cobranca.equipe_completa';
-- 6) anon não lê a tabela
select '6 anon le?', has_table_privilege('anon','public.cobranca_equipe_completa','select');
rollback;
