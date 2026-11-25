# Regra 2.31: a IA não fecha conversa que uma pessoa assumiu (levantamento de 24/11/2026)

> **Atualização de 25/11/2026 (Tarefa 6.1).** O levantamento abaixo é o retrato de 24/11 e fica como estava. O que mudou depois está no fim do arquivo, nas seções "Tarefa 6.1": a lacuna 1 (janela de corrida) e a lacuna 3 do fim desta página (a regra mora nos chamadores), implementadas, e a lacuna 2 (silêncio do bot), não implementada, com tabela e pergunta. As citações `arquivo:linha` do levantamento são das pontas dos PRs de 24/11 e não foram renumeradas.

Levantamento só de leitura no repo `C:\Users\lcsin\Desktop\arvisx-crm`: nada foi executado (nenhum teste, build ou typecheck), nada foi editado, `git fetch origin` feito uma vez. Refs lidas: main `f48146edb`; #14 `d3a64c15a`; #17 `306f82b8f`; #19 `4f2c9a292`; #21 `e81137ba6`; #23 `5979905be`; #20 `bdcd5e15b`; #18 `d520367b3`; #22 `36269338e`; #24 `0c0a8e155`.

## Achados principais

1. **Só existe uma porta de banco que fecha conversa:** `fn_service_status` (terminal = `closed`/`resolved`/`archived`), executável só por `service_role`. Nenhuma outra função SQL e nenhum UPDATE direto em TS grava status terminal em `conversations`, em nenhuma das 13 pontas.
2. **Só existe um caminho de agente que fecha conversa:** a ferramenta `crm_close_conversation`, que só existe em #14 e #17. Ela respeita a regra 2.31 na leitura, com a janela de corrida declarada.
3. **Nenhum cron, gatilho, régua, follow-up, automação de webhook ou agente nativo fecha conversa** na main nem em #12, #13, #15, #16, #18 a #24.
4. **Correção de premissa:** `e4b80adfc` está só em #14 e #17. As outras 11 pontas não o têm (não só #19/#21/#23). Não é brecha: nelas a ferramenta não existe.
5. **Três lacunas para decidir** (detalhe no fim): silêncio do bot não é conferido; `archived`/`resolved` ficam fora da guarda do PATCH no #17; a regra não mora no módulo unificado, mora nos chamadores.

Topologia (`gh pr list`): #13←main; #14←#13; #17←#14; #15←#13; #19←#15; #21←#19; #23←#21; #20←#15; #22←#15; #24←#22; #12←main; #16←#12; #18←#16.

## 4.1 Tabela

| Ponto (arquivo:linha, ref) | Quem dispara | Checa `assigned_to_user_id`? | Checa `bot_silenced_until`? | Teste que prova | Conclusão |
|---|---|---|---|---|---|
| `supabase/baseline.sql:45636-45663` `fn_service_status` (main e todas as pontas; migrations 0222 e 0514) | qualquer chamador service_role | não | não (só zera o silêncio ao fechar, quando `last_handoff_at is null`) | `tests/invariants/fechar-conversa-por-agente.test.ts` (#14/#17) cobre revisão e organização; nada sobre responsável | porta única; a regra não está no banco; é a origem da janela de corrida |
| `lib/mcp/tools/fechar-conversa.ts:155` (checagem na `:149`), #14 e #17 (arquivo idêntico) | agente MCP por token e agente nativo no turno | sim, `:149`, na leitura | não (o `select` em `lib/inbox/fechar-conversa.ts:70` do #17 nem lê a coluna) | `tests/unit/mcp-fechar-conversa.test.ts` > "⭐ conversa assumida por uma pessoa (revisão 20/11, item 2.31)" > `it.each` "%s: recusa com erro claro, e NADA é alterado nem auditado" (4 atores) | respeita, com janela de corrida; silêncio sem responsável não barra |
| `app/api/v1/conversations/_handler.ts:646`, main, #14 e todas as pontas sem `9693eac1e` | tela (PATCH `[id]`, sessão) | só para pessoa (`exigirControleDaConversa`, `lib/inbox/controle-da-conversa.ts:17` retorna cedo se o ator não é `user`) | não | sem teste do caso agente nessas refs | tela: não se aplica. Violação latente: ator não-pessoa fecharia conversa assumida. Inalcançável hoje: único chamador é `app/api/v1/conversations/[id]/route.ts:135`, com `actor: {type:"user"}` (`:139`) e `requireRole("agent")` (`:113`) |
| `app/api/v1/conversations/_handler.ts:683` (guarda `:621-634`), #17 | tela; guarda para ator não-pessoa | sim, `:625`, só quando `status === "closed"` | não | `tests/unit/patch-fechar-conversa-comportamento.test.ts` > "⭐ conversa assumida por uma pessoa: 403, sem chamar o banco e sem auditar" | respeita para `closed`, na leitura (mesma janela) |
| `app/api/v1/conversations/_handler.ts:703`, #17 (ramo dos outros status, inclui `archived` e `resolved`) | tela | não para ator não-pessoa | não | `patch-fechar-conversa-comportamento.test.ts` > "arquivar continua na chamada direta, com a auditoria própria" (não testa agente) | latente: agente arquivaria ou resolveria conversa assumida; inalcançável hoje |
| `app/api/v1/conversations/[id]/close/route.ts:158` (main); `:159` via `fecharConversa` (#14/#17) | tela (POST, `requireRole("agent")`, sessão) | `exigirControleDaConversa` (pessoa) | não | `app/api/v1/conversations/[id]/close/route.test.ts` existe; não abri os casos | não se aplica (pessoa) |
| `app/api/v1/conversations/bulk/route.ts:155` e `:161` (main) | tela, em lote; reusa o POST close e o PATCH `archived` | herda dos dois acima | não | `app/api/v1/conversations/bulk/route.test.ts` existe; não abri | não se aplica (pessoa) |
| `app/api/v1/contacts/[id]/personal/route.ts:384` (main); `:400` (#17) | tela, gerente (`requireRole("manager")`, `:168`); solta e fecha todas as conversas do contato | não (decisão de gerente; sem trava de revisão) | não | `app/api/v1/contacts/[id]/personal/route-efeitos.test.ts` (asserção `p_status: "closed"` na `:286`) | não se aplica (pessoa) |
| `app/api/v1/cron/snooze-watcher/route.ts:106` (main) | cron | n/a | n/a | não procurei | não fecha: só reabre para `open`, e pula `closed`/`archived` |
| `lib/escalacao/retomada.ts:237-252` (main); usado pelo cron `handoff-devolucao` e pelo botão | cron e tela | sim, `.is("assigned_to_user_id", null)` na `:251` | zera o silêncio (é a devolução) | `tests/unit/escalacao-retomada.test.ts` e `tests/unit/cron-handoff-devolucao.test.ts` existem; não abri | não fecha: grava `ai_handling` ou mantém o status |
| `lib/agent-engine/agent/human-handoff.ts:462` (main) | agente nativo | n/a | grava o silêncio | não procurei | não fecha: `ai_handling` vira `pending` |
| `lib/ai/handoff/orchestrator.ts:293` (main) | agente / worker | n/a | n/a | não procurei | não fecha: `pending` |
| `lib/followup/**` (main e #24, incl. `engine.ts` alterado no #24) | cron / régua | n/a | n/a | n/a | não achei escrita em `conversations` |
| `lib/ai/equipe-pronta/gatilhos/lembrete.ts:118` (#24) | gatilho da Equipe pronta V2 | n/a | n/a | n/a | não fecha: grava `active_ai_agent_id` e intenção |
| `lib/agent-engine/agent/passagem-entre-colegas.ts:289` e `:359` (#15 em diante) | agente nativo | n/a | n/a | n/a | não fecha: troca agente ativo e metadata |
| `lib/agent-engine/agent/filtro-de-entrada-no-turno.ts:234` (#20) | agente nativo | n/a | n/a | n/a | não fecha: só tags |
| `lib/automation/actions/*` e `lib/schemas/webhooks.ts:396-667` (main) | regra de webhook | n/a | n/a | n/a | não achei ação que feche conversa (17 ações, nenhuma de fechar) |
| `lib/grupos/ingest.ts:472`, `lib/wacalls/events-bridge.ts:78` e `:101` (main) | ingestão / ponte de ligação | n/a | n/a | n/a | não fecham: `open` e silêncio |
| MCP `crmCloseHumanCase`, `crmCloseDemand`, `crmArchiveStage` (`lib/mcp/tools/index.ts`, todas as refs) | agente MCP | n/a | n/a | n/a | fecham chamado, negócio e etapa; no SQL não há efeito colateral em `conversations.status` |

Como varri: `git grep` de `fn_service_status`, de `update ... conversations` e de `.from("conversations")` seguido de `.update(` em `app lib workers`, mais `diff` dessas listas de cada ponta contra a main. No SQL, um awk leu cada `update ... conversations` até o `;` no `baseline.sql` e nas migrations novas das pontas: só `open`/`claimed`/`pending`, além do `p_status` da `fn_service_status`. As chamadas SQL internas à função (`baseline.sql:19954` e `:52673`) passam `'open'`.

## 4.2 #19, #21 e #23

Não expõem nenhum caminho de fechar conversa por agente ou token.

- `git merge-base --is-ancestor e4b80adfc <ref>` devolveu exit 1 nas três; `9693eac1e` também exit 1.
- `git grep` de `crm_close_conversation|close_conversation|fechar_conversa|conversa_com_humano` em `lib app workers`: só `lib/mcp/tools/governance.ts` (`conversa_encerrada: "conversation_closed"`, um rótulo). Não existe `lib/mcp/tools/fechar-conversa.ts` nem `lib/inbox/fechar-conversa.ts` nessas refs.
- Chamadores de `fn_service_status` são os mesmos três da main: `close/route.ts:158`, `_handler.ts:646`, `personal/route.ts:384`.
- `git diff --stat origin/main <ref>` saiu vazio para `close/route.ts`, `[id]/route.ts`, `_handler.ts`, `bulk/route.ts`, `personal/route.ts`, `lib/auth/require-role.ts`, `lib/inbox/controle-da-conversa.ts`, `lib/api/auth-dual.ts`, `proxy.ts` e `lib/auth/public-paths.ts`. As portas são idênticas às da main.
- Nenhuma dessas rotas usa `resolveAuthDual` (bearer). A lista de usuários do auth-dual só foi conferida no #23; no #19 e no #21 vale por `lib/api/auth-dual.ts` ser idêntico à main e as rotas de fechar também.
- `lib/mcp/tools/index.ts` registra só `crmCloseHumanCase`, `crmArchiveStage` e `crmCloseDemand`.
- Migrations novas dessa linha (9809, 9813, 9818): sem `fn_service_status` e sem status terminal.

Ressalva: o `_handler.ts:646` dessas refs tem a violação latente da tabela (igual à main), inalcançável porque a rota só monta ator pessoa.

## 4.3 Desenho para fechar a janela de corrida (sem implementar)

**SQL atual** (`supabase/baseline.sql:45636-45666`, igual em todas as pontas):

```sql
create or replace function public.fn_service_status(p_org uuid,p_conversation uuid,p_status text,p_expected bigint default null)
returns public.conversations language plpgsql security definer set search_path=public as $$
declare c public.conversations; terminal boolean; pre_contact uuid;
begin
 if p_status not in ('closed','resolved','archived','open','pending','ai_handling','claimed') then
  raise exception 'invalid_status' using errcode='22023'; end if;
 select * into c from public.conversations where id=p_conversation and organization_id=p_org;
 if not found then raise exception 'service_not_found' using errcode='P0002'; end if;
 pre_contact:=c.contact_id;
 perform public.fn_service_lock(p_org,c.contact_id);
 select * into c from public.conversations where id=p_conversation and organization_id=p_org for no key update;
 if c.contact_id is distinct from pre_contact then raise exception 'service_contact_changed' using errcode='40001'; end if;
 if p_expected is not null and c.service_revision<>p_expected then raise exception 'service_stale' using errcode='PT409'; end if;
 if c.status=p_status then return c; end if;
 terminal := p_status in ('closed','resolved','archived');
 update public.conversations set status=p_status,status_changed_at=clock_timestamp(),
   service_revision=service_revision+case when terminal or c.status in ('closed','resolved','archived') then 1 else 0 end,
   service_closed_at=case when terminal then clock_timestamp() else service_closed_at end,
   service_started_at=case when c.status in ('closed','resolved','archived') and not terminal then clock_timestamp() else service_started_at end,
   bot_silenced_until=case when terminal and last_handoff_at is null then null else bot_silenced_until end,
   current_demanda_id=case when c.status in ('closed','resolved','archived') and not terminal then null else current_demanda_id end
  where id=c.id and organization_id=p_org returning * into c;
 if terminal then
   update public.demandas set proximo_passo=coalesce(proximo_passo,'Revisar atendimento e registrar o desfecho da demanda')
    where organization_id=p_org and id=c.current_demanda_id and fechada_em is null;
 end if;
 return c;
end; $$;
revoke execute on function public.fn_service_status(uuid,uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.fn_service_status(uuid,uuid,text,bigint) to service_role;
```

**Por que a janela existe:** assumir (`fn_conversation_assign`, `baseline.sql:68651`) grava `claimed`. O gatilho `fn_service_stamp_status` (`baseline.sql:19824`) só soma `service_revision` quando um dos lados é terminal. `open → claimed` não soma, então o `p_expected` não percebe.

**Por que cabe dentro da função:** ela já faz `select ... for no key update` na linha. `fn_conversation_assign` trava a mesma linha com `for no key update` (`baseline.sql:68719`). As duas se serializam. Em READ COMMITTED, quem espera relê a linha depois do commit do outro e enxerga o responsável.

**Migration sugerida** `20261124HHMMSS_9824_agente_nao_fecha_conversa_assumida.sql`:

```sql
begin;
-- Novo parâmetro muda a assinatura: sem o drop nasceria uma SOBRECARGA, e o
-- PostgREST não escolhe entre as duas com 4 argumentos nomeados.
-- Precedente de drop por troca de assinatura: migration 9103.
drop function if exists public.fn_service_status(uuid,uuid,text,bigint);

create or replace function public.fn_service_status(
  p_org uuid, p_conversation uuid, p_status text,
  p_expected bigint default null,
  p_ator text default 'pessoa')          -- 'pessoa' (tela) | 'agente'
returns public.conversations language plpgsql security definer set search_path=public as $$
declare c public.conversations; terminal boolean; pre_contact uuid;
begin
 if p_status not in ('closed','resolved','archived','open','pending','ai_handling','claimed') then
  raise exception 'invalid_status' using errcode='22023'; end if;
 if p_ator not in ('pessoa','agente') then
  raise exception 'invalid_actor' using errcode='22023'; end if;
 select * into c from public.conversations where id=p_conversation and organization_id=p_org;
 if not found then raise exception 'service_not_found' using errcode='P0002'; end if;
 pre_contact:=c.contact_id;
 perform public.fn_service_lock(p_org,c.contact_id);
 select * into c from public.conversations where id=p_conversation and organization_id=p_org for no key update;
 if c.contact_id is distinct from pre_contact then raise exception 'service_contact_changed' using errcode='40001'; end if;
 terminal := p_status in ('closed','resolved','archived');
 -- Regra 2.31, conferida COM A LINHA TRAVADA. Conversa já encerrada não recusa:
 -- repetir o pedido continua sendo sucesso sem efeito.
 if p_ator='agente' and terminal
    and c.status not in ('closed','resolved','archived')
    and c.assigned_to_user_id is not null then
   raise exception 'service_assigned_to_human' using errcode='PT403';
 end if;
 if p_expected is not null and c.service_revision<>p_expected then raise exception 'service_stale' using errcode='PT409'; end if;
 if c.status=p_status then return c; end if;
 -- ... UPDATE e bloco das demandas IDÊNTICOS ao corpo atual ...
 return c;
end; $$;

revoke execute on function public.fn_service_status(uuid,uuid,text,bigint,text) from public,anon,authenticated;
grant execute on function public.fn_service_status(uuid,uuid,text,bigint,text) to service_role;
notify pgrst, 'reload schema';
commit;
```

**Distinguir tela de agente:** a tela não manda `p_ator` (vale o default `'pessoa'`, comportamento de hoje). O agente manda `p_ator: 'agente'`. No #17 isso vira um campo obrigatório em `fecharConversa` (`lib/inbox/fechar-conversa.ts:164`), por exemplo `origem: "pessoa" | "agente"`. Chamadores:

- `close/route.ts:159` e `personal/route.ts:400` passam pessoa.
- `lib/mcp/tools/fechar-conversa.ts:155` passa agente.
- `_handler.ts:683` deriva de `ctx.actor.type !== "user"`; o ramo `:703` deve derivar igual, para cobrir `archived` e `resolved`.

**Retorno da recusa:** `PT403` é um código próprio. O PostgREST o devolve como 403, que ninguém reexecuta (a lição da 0514). Em `fecharConversa` o erro ganha um terceiro valor (`"com_humano"`), que a ferramenta traduz para `conversa_com_humano` e o PATCH para 403. A checagem na leitura (`:149`) fica como caminho rápido.

**Alternativas descartadas:**

- UPDATE condicional `where ... and assigned_to_user_id is null` com 0 linhas: não distingue "tem responsável" de "sumiu", e a função devolve a linha (mudar o tipo quebra a compatibilidade).
- Função nova só para agente, embrulhando a atual: zero risco de assinatura, mas deixa a porta principal sem a regra.
- Gatilho lendo `set_config`: o ator não é confiável por conexão do pool do PostgREST.

**Impacto:**

- Chamadores hoje: 3 na main, 4 no #17, mais 2 chamadas SQL internas posicionais com 4 argumentos (`baseline.sql:19954` e `:52673`), que seguem resolvendo pelo default.
- Imagem antiga com banco novo: manda 4 argumentos nomeados e cai no default `'pessoa'`. Tela igual a hoje; ferramenta antiga fica só com a conferência na leitura. Sem regressão.
- Imagem nova com banco antigo: a tela funciona, porque não manda o parâmetro. O agente recebe PGRST202 (função não encontrada). Recomendo tratar como falha fechada ("indisponível"), sem voltar ao caminho antigo.
- Default permissivo é proposital: default `'agente'` quebraria a tela da imagem antiga. O custo é que um chamador novo de agente que esqueça o parâmetro passa. Sugiro uma cerca de teste: todo `rpc("fn_service_status"` fora das rotas de pessoa manda `p_ator`.
- Locks: nenhum lock novo; a condição roda sob o advisory lock e o row lock que a função já pega. `fn_conversation_assign` (linhas 68651-68832) não chama `fn_service_lock`, logo não vi inversão de ordem. Não verifiquei os gatilhos AFTER de `conversations` (`trg_routing_assignment_changed`, `fn_interromper_turnos_ao_assumir`).
- Também entram: o bloco no fim do `baseline.sql`, `supabase/migrations/MANIFEST.md`, `deploy/arvisx/crm/migracoes-pos-baseline.txt` e `lib/database.types.ts` (Args da função).
- Não verifiquei se o aplicador de migrations roda cada arquivo em transação; por isso o `begin/commit` explícito no drop+create.

**Teste de banco** (estender `tests/invariants/fechar-conversa-por-agente.test.ts`, que já usa `pg.Pool` com `max: 4` e o gancho `antesDaFuncao`):

1. Janela declarada, determinístico: `antesDaFuncao` chama `fn_conversation_assign(..., 'claim')` entre a leitura da ferramenta e a RPC. Esperado: `conversa_com_humano`, status `claimed`, `service_revision` e `service_closed_at` intactos, zero auditoria. Hoje esse teste fecha a conversa.
2. Corrida, assumir ganha: conexão A faz `begin` e `fn_conversation_assign` sem commit. Conexão B chama `fn_service_status(org, conv, 'closed', rev, 'agente')`. Conferir em `pg_stat_activity` que B está em `wait_event_type='Lock'`. Commit em A; B falha com SQLSTATE `PT403`; a linha segue `claimed` com o responsável.
3. Corrida, fechar ganha: B em transação fecha, A tenta assumir e bloqueia; commit em B. Conferir que o fechamento aconteceu antes de haver responsável (revisão +1 uma vez).
4. Tela: mesma conversa assumida, chamada sem `p_ator` e com `'pessoa'`, fecha.
5. Idempotência: conversa já `closed` com responsável e `p_ator='agente'` devolve a linha sem erro.
6. Compatibilidade: chamada posicional de 4 argumentos funciona; `select count(*) from pg_proc where proname='fn_service_status'` = 1.

## 4.4 #17: a regra sobrevive?

Sim, mas a checagem não está em `lib/inbox/fechar-conversa.ts`. O módulo (`fecharConversa`, `:164-201`) só chama a RPC e audita; o cabeçalho (`:13-15`) deixa "quem pode fechar" para cada porta. A checagem fica em:

- `lib/mcp/tools/fechar-conversa.ts:149` (agente MCP e nativo), idêntico ao #14.
- `app/api/v1/conversations/_handler.ts:621-634` (commit `9693eac1e`): ator não-pessoa com `status === "closed"` e responsável recebe 403.
- Tela: `close/route.ts:104` (`exigirControleDaConversa`) e `personal/route.ts:168` (gerente).

Os testes cobrem os dois lados, nas duas portas de agente:

- `tests/unit/mcp-fechar-conversa.test.ts` > "⭐ conversa assumida por uma pessoa (revisão 20/11, item 2.31)":
  - recusa: `it.each` "%s: recusa com erro claro, e NADA é alterado nem auditado" (token comum, de gerente, de administrador, agente nativo);
  - fecha: "controle: a MESMA conversa, sem ninguém assumindo, fecha";
  - extra: "conversa assumida que JÁ estava fechada: continua sucesso sem efeito (nada a recusar)".
- `tests/unit/patch-fechar-conversa-comportamento.test.ts` > "PATCH status=closed: ator que não é pessoa × conversa assumida":
  - recusa: "⭐ conversa assumida por uma pessoa: 403, sem chamar o banco e sem auditar";
  - fecha: "controle: a mesma conversa sem responsável fecha";
  - tela: "controle: a PESSOA responsável continua fechando a conversa que assumiu, pela rota".

O que falta:

- Os dois lados só existem com banco dublê. `tests/invariants/fechar-conversa-por-agente.test.ts` (Postgres real) não tem caso de conversa assumida.
- Nenhum teste cobre a janela (assumir entre a leitura e a RPC).
- `lib/inbox/fechar-conversa.test.ts` não tem caso de responsável, coerente com o módulo não ter a regra.

## Lacunas para decisão

1. **Silêncio do bot não é conferido em lugar nenhum.** Conversa em handoff (`pending`, `bot_silenced_until` gravado, ainda sem responsável) ou com atendimento manual pelo celular (`lib/escalacao/atendimento-manual.ts:263`, silêncio sem atribuir) tem `assigned_to_user_id` nulo. `crm_close_conversation` a fecha. Se a 2.31 deve cobrir isso, a condição do banco precisa de um segundo termo (por exemplo `bot_silenced_until > now()`).
2. **`archived` e `resolved` fora da guarda do PATCH no #17** (`_handler.ts:622` só olha `closed`; o ramo `:703` passa). Latente, porque a rota só monta ator pessoa.
3. **A regra depende de cada chamador lembrar.** A migration 9824 resolve isso de vez para quem passar `p_ator`.

## Não verifiquei

- Os casos dos testes da rota close, do bulk, da retomada e do cron handoff-devolucao (só confirmei que os arquivos existem).
- Se o agente nativo chega a ter turno em conversa silenciada.
- Se `requireRole` aceita JWT por cabeçalho `Authorization` além do cookie. Ele usa `createClient` de `lib/supabase/server` com `auth.getUser()`; em qualquer caso o ator montado é pessoa.
- `workers/agent-worker` e `workers/voice-agent` entraram só pelos greps, sem leitura arquivo a arquivo.
- Gatilhos AFTER de `conversations` quanto a locks.
- Comportamento real em execução: nada foi rodado.

## Tarefa 6.1 (25/11/2026): lacuna 1, a janela de corrida. Implementada (migration 9824)

O desenho da seção 4.3 foi implementado como está, com três diferenças, todas declaradas:

1. **Sem `begin`/`commit` explícitos na migration.** A 4.3 os sugeria porque eu não tinha verificado se o aplicador roda cada arquivo em transação. Roda: `deploy/arvisx/crm/init.sh`, linha 42, usa `psql -1`. A doutrina do repo (CLAUDE.md, "Migrations & Banco", item 3) proíbe `BEGIN`/`COMMIT` explícito, e nenhuma das 98xx tem. O `drop` e o `create` valem juntos pela transação do aplicador.
2. **Sem linha nova no `supabase/migrations/MANIFEST.md`.** A 4.3 o listava. O repo mudou a regra: a descrição vai na linha `-- manifest:` do próprio arquivo, e `tests/unit/manifest-x-migrations.test.ts` reprova migration descrita nos dois lugares. Nenhuma 98xx está no MANIFEST.md.
3. **`p_ator` nulo também é `invalid_actor`.** A 4.3 só conferia `not in ('pessoa','agente')`, que com `null` não dispara. Nulo explícito passaria como pessoa; agora é recusado.

O que entrou:

- `supabase/migrations/20261124120000_9824_agente_nao_fecha_conversa_assumida.sql`, com o espelho no `supabase/baseline.sql` (antes da VARREDURA anon), a linha no fim de `deploy/arvisx/crm/migracoes-pos-baseline.txt` e `p_ator?` nos Args de `lib/database.types.ts`.
- `lib/inbox/fechar-conversa.ts`: campo `origem: "pessoa" | "agente"` obrigatório em `fecharConversa`; erro novo `"com_humano"`; função `mudarEstadoDoAtendimento`, a única chamada do produto à `fn_service_status`.
- `lib/mcp/tools/fechar-conversa.ts`: passa `origem: "agente"`; `com_humano` vira `conversa_com_humano`. A conferência na leitura fica como caminho rápido.
- `app/api/v1/conversations/_handler.ts`: os dois ramos (o de `closed` e o dos outros estados) derivam a origem do ator (`origemDoAtor(ctx.actor)`, só `user` é pessoa) e respondem 403 para `com_humano`. Isso fecha a lacuna "`archived` e `resolved` fora da guarda do PATCH" do levantamento. Observação: `resolved` não está no schema do PATCH (`lib/schemas/messaging.ts`, `conversationStatusSchema`), então pela rota ele morre em 422 antes; a guarda cobre o ramo assim mesmo.
- **Imagem nova com banco antigo:** o agente recebe `PGRST202` e o módulo devolve `falha`. A ferramenta responde `indisponivel`; o PATCH, 500. Não existe segunda chamada sem `p_ator`.

Provas (banco de verdade, `pnpm test:db tests/invariants/fechar-conversa-por-agente.test.ts`, Postgres 15 descartável, em 25/11/2026):

- **Antes** (código e baseline do `5cda875b2`, só com os casos novos no teste): `Tests 13 failed | 6 passed (19)`. O caso 1 falha com a conversa FECHADA pelo agente: a ferramenta devolveu `status: "closed"`, `already_closed: false` para uma conversa que a pessoa tinha acabado de assumir.
- **Depois** (com a migration no baseline e o código novo): `Tests 19 passed (19)`, com `install ok` e `update ok (zero erro na re-aplicação)`.

Os seis casos da 4.3 estão no bloco "conversa assumida por uma pessoa: a regra 2.31 dentro da fn_service_status". O caso 3 (fechar ganha) mostrou um comportamento que já existia e não é desta tarefa: assumir uma conversa já encerrada a reabre como `claimed` e soma outra revisão (7 → 8 no fechar, 9 no assumir). O teste afirma isso como está.

## Tarefa 6.1 (25/11/2026): lacuna 2, o silêncio do bot. NÃO implementada: tabela e pergunta

Pedido: o agente também recusar quando `bot_silenced_until > now()` e a pausa veio de uma pessoa. Condição do pedido: se não houver como distinguir com segurança "pausa por pessoa" de "silêncio do próprio bot depois do handoff", não implementar e levar a pergunta.

**Conclusão: hoje não há como distinguir com segurança.** Nada de código mudou para esta lacuna. O que foi lido está abaixo. Linhas do branch `tarefa-6.1/agente-nao-fecha-conversa-assumida` (base `integracao/2026-11-23`, `5cda875b2`).

### Achado que muda a pergunta

O botão de pausar a IA (`POST /api/v1/conversations/[id]/pause-ai`) nunca deixa a conversa sem responsável: se ninguém é dono, ele faz o claim para quem clicou antes de gravar o silêncio (`app/api/v1/conversations/[id]/pause-ai/route.ts`, o claim na linha 103, o silêncio na linha 130). Logo, conversa pausada pela tela tem `assigned_to_user_id` preenchido, e a regra 2.31 que já existe (agora também no banco, migration 9824) a cobre. O caso "pausada por pessoa, sem `assigned_to_user_id`" só nasce por outros caminhos, os da tabela.

### Quem grava `bot_silenced_until` (todos os escritores achados)

Varredura: `grep -rnE 'bot_silenced_until( =|:) '` em `app lib workers scripts` (sem testes) e `grep -n bot_silenced_until supabase/baseline.sql`.

| # | Quem grava (arquivo:linha) | Quem é | Valor | `last_handoff_at` | `last_handoff_reason` | Fica com `assigned_to_user_id`? | Classe |
|---|---|---|---|---|---|---|---|
| 1 | `fn_conversation_assign`, claim e transfer (`supabase/baseline.sql:68792-68797`) | pessoa (tela, MCP de transferência, automação) | `infinity` | não toca | não toca | sim | pessoa. **Já coberta** pela 2.31 |
| 2 | `pause-ai/route.ts:130` | pessoa, botão da tela | `infinity` | não toca | `"Automático pausado pelo atendente"` (constante, linha 49) | sim, sempre (claim na linha 103) | pessoa. **Já coberta** pela 2.31 |
| 3 | `fn_conversation_assign`, release (`baseline.sql:68794-68796`) | pessoa soltando a conversa | `null` se `last_handoff_at` é nulo; senão MANTÉM o que estava | não toca | não toca | não | herda a classe do silêncio anterior (linhas 5 a 9) |
| 4 | reabertura com dono (`baseline.sql:55096`, `keep_owner`) | sistema, quando o cliente escreve em conversa encerrada que tinha dono | `infinity` | não toca | não toca | sim | pessoa. **Já coberta** |
| 5 | handoff do agente nativo (`lib/agent-engine/agent/human-handoff.ts:462-467`) | o próprio bot | `infinity` | `now()` | **texto livre escrito pelo modelo** (`opts.reason`; dito também em `lib/escalacao/handoff-tecnico.ts:23`) | não (status vira `pending`) | bot |
| 6 | `triggerHandoff` (`lib/ai/handoff/orchestrator.ts:291-298`), usado pela ferramenta MCP de handoff e pelo motor | bot ou agente externo | `infinity` | agora | `input.reason` (vocabulário do orquestrador; `orcamento_de_ia` em `lib/agent-engine/edge/llm/orcamento.ts:93`) | não (`pending`) | bot |
| 7 | envio pela tela ou em nome de uma pessoa (`app/api/v1/messages/_handler.ts:1626-1633`, `extendBotSilence`) | pessoa | finito (janela deslizante da empresa, 5 min por padrão) | não toca | **não toca** | só se já tinha | pessoa, **sem marca nenhuma** |
| 8 | resposta pelo celular, fora do CRM (`lib/escalacao/atendimento-manual.ts:261-267`) | pessoa | finito (60 min por padrão) ou `infinity` quando o agente aceita comando de celular (`lib/waha/ingest.ts:1842-1847`) | agora | `"Atendimento manual pelo canal (resposta fora do CRM)"` (constante, linha 169) | não | pessoa |
| 9 | comando `#off` pelo celular (`lib/waha/ingest.ts:1814-1819`) | pessoa | `infinity` | agora | `"Comando #off enviado pelo celular"` (constante, `atendimento-manual.ts:176`) | não | pessoa |
| 10 | ligação de voz (`lib/wacalls/events-bridge.ts:77-90`) | pessoa em ligação | agora + 2 h | `now()` | `"Ligação de voz em andamento"` (constante, linha 51) | não | pessoa |
| 11 | devolução ao automático (`lib/escalacao/retomada.ts:241-246`), fechar sem handoff (`fn_service_status`), fim da ligação (`events-bridge.ts:100-106`) | pessoa, cron ou sistema | `null` | `null` | `null` | n/a | limpa o silêncio |

### Por que isso não distingue com segurança

1. **Não existe coluna que diga quem causou o silêncio.** O único marcador é `last_handoff_reason`, um texto. Nas linhas 8, 9 e 10 ele é uma constante de pessoa. Na linha 5 é texto livre do modelo. Na linha 7 (pessoa respondeu pela tela sem assumir) não é gravado: fica o que estava antes, inclusive o motivo de um handoff antigo do bot.
2. **"Silêncio finito é de pessoa" é coincidência, não contrato.** Hoje todo valor finito vem de pessoa (linhas 7, 8, 10) e todo handoff do bot grava `infinity`. Nenhum teste nem constraint prende isso. E o inverso não vale: `infinity` sem responsável pode ser bot (5, 6) ou pessoa (8 durável, 9).
3. **Um silêncio de bot pode esconder uma pessoa.** Exemplo: a pessoa responde pelo celular (linha 8, 60 min), e dentro dessa hora um agente externo chama a ferramenta de handoff (linha 6). O valor vira `infinity` e o motivo vira o do handoff. A conversa passa a parecer "silêncio do bot", com uma pessoa atendendo há minutos.
4. **A regra precisa valer no banco também** (é o que a parte 1 fez para o responsável). Levar a comparação de texto para dentro da `fn_service_status` duplicaria no SQL quatro frases em português que moram em constantes TypeScript: mudar uma frase num arquivo abriria a brecha sem nenhum teste acusar.
5. O produto já faz UMA comparação dessas, só para escolher o rótulo da tela (`lib/inbox/comando-da-conversa.ts:286`). Errar ali troca um texto; errar aqui fecha a conversa de quem está atendendo.

O erro que importa é o da direção perigosa: classificar pausa de pessoa como silêncio de bot (o agente fecha). Os pontos 1 e 3 produzem exatamente esse erro.

### Pergunta para o Lucas

Como o agente deve tratar conversa SEM responsável e com `bot_silenced_until > now()`?

- **A. Recusar sempre que houver silêncio vigente, venha de quem vier.** Mesmo código de recusa (`conversa_com_humano`). É a única opção segura sem mexer em schema: um termo a mais na `fn_service_status` (`c.bot_silenced_until > now()`) e no caminho rápido do módulo. Custo: o agente também deixa de fechar a conversa que o próprio bot escalou e ninguém pegou (a fila, `pending`). Ele volta a poder fechar quando alguém devolver a conversa ao automático ou quando o prazo do silêncio vencer. Pergunta embutida: o agente DEVE poder fechar uma conversa que está na fila esperando uma pessoa? Se a resposta for não, a opção A resolve tudo e ainda corrige isso.
- **B. Coluna nova que diz quem causou o silêncio** (por exemplo `bot_silenced_by`, com CHECK `'pessoa' | 'bot'`), gravada pelos escritores das linhas 1 a 10, e a regra lendo essa coluna. É o que o pedido descreve, feito do jeito seguro. Custo: migration (9825), mexer em cerca de 9 pontos de escrita (2 deles em SQL do upstream), e as conversas já silenciadas no dia do deploy ficam sem marca (teriam de cair na opção A até o silêncio delas acabar).
- **C. Deixar como está.** O agente segue fechando conversa silenciada sem responsável. Fica escrito como limite conhecido.

Minha recomendação: A agora (pequena, segura, mesma migration de função), e B só se aparecer um caso real em que o agente precise fechar a fila que o bot escalou.

### O que não foi feito nesta lacuna

- Nenhum código e nenhum teste: a instrução era não implementar sem distinção segura. A tabela acima saiu de leitura, não de execução.
- Não li `workers/voice-agent` nem os adapters de canal fora de `lib/waha` (só os greps os alcançaram). Se outro canal chamar `pausarIaPorAtendimentoManual` com um `motivo` próprio, ele entra na classe da linha 8.
- Não verifiquei se o agente nativo chega a ter turno em conversa silenciada (o levantamento de 24/11 também não).
