-- manifest: **Comentários do Instagram: só gerente para cima lê pelo banco.** A política de SELECT de `social_comments` (9810) deixava qualquer membro da organização ler o texto e o autor dos comentários pela sessão, enquanto as rotas e as ferramentas exigem gerente. A política passa a exigir `manager` ou acima (ou administrador da plataforma). Nenhuma linha muda; o servidor, que é quem lê e grava de fato, não é afetado.
--
-- 9819 — a leitura de `social_comments` pela sessão pede o mesmo papel das rotas.
--
-- Faixa 98xx, a do fork (ArvisX CRM). Número reservado para a revisão de
-- 20/11/2026 (item 2.19); 9811 a 9818 pertencem a outras frentes em voo.
--
-- ═══ Por quê ═══
--
-- A 9810 criou `tenant_isolation_social_comments_select` aberta a todo membro
-- da organização. Só que tudo o que o produto oferece sobre comentários exige
-- gerente: as rotas `/api/v1/social-comments`, as ferramentas do MCP e a tela.
-- Um `agent` ou `viewer` com a própria sessão lia direto pela REST do banco o
-- que a aplicação lhe recusava: o texto e o nome de usuário de gente de fora.
--
-- ═══ O que muda ═══
--
-- A política é recriada com o papel mínimo: membro da organização COM papel
-- `manager` ou acima (`fn_role_at_least`), ou administrador da plataforma. Em
-- suporte temporário, `fn_user_role_in_org` devolve `admin` no modo completo e
-- `viewer` no modo de leitura; então o suporte de leitura não lê comentário.
--
-- Nada muda para o servidor: ele usa a chave de serviço, que não passa por RLS.
-- Os privilégios da tabela (só `select` para `authenticated`) ficam como a 9810
-- deixou.
--
-- ═══ Reversão ═══
--
--   drop policy if exists tenant_isolation_social_comments_select on public.social_comments;
--   create policy tenant_isolation_social_comments_select on public.social_comments
--     for select using (
--       (organization_id in (select public.fn_user_org_ids())) or (select public.fn_is_platform_admin())
--     );

drop policy if exists tenant_isolation_social_comments_select on public.social_comments;
create policy tenant_isolation_social_comments_select on public.social_comments
  for select using (
    (select public.fn_is_platform_admin())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

notify pgrst, 'reload schema';
