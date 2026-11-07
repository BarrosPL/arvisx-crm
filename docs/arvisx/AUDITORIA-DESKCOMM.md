# Auditoria dos resquícios do DeskcommCRM no fork Arvisx CRM

Medido em `main` @ `648336782` (06/11/2026), worktree `Desktop/arvisx-crm-main`. Só leitura: nenhum arquivo além deste foi alterado.

> Observação: durante a auditoria o worktree tinha 13 arquivos modificados e ainda não commitados (`lib/branding.ts`, `lib/branding/saida.ts`, `lib/email/templates/*`, `tests/unit/branding.test.ts`, `deploy/arvisx/supabase/*`...). Não eram de outra sessão: eram a **Frente 1** (e-mails de acesso no visual Arvisx e moldes do GoTrue), já commitada em `1eda267e7` na `main`. Os números acima são de `git grep` (árvore de trabalho), e nenhuma dessas mudanças adiciona ou remove "deskcomm". O commit cria em `lib/branding.ts` as constantes `SITE_DO_PRODUTO`, `SUPORTE_DO_PRODUTO = "suporte@arvisx.com.br"` e `LOGO_DO_PRODUTO_SOBRE_ESCURO_URL`, que viram a fonte natural do contato Arvisx nas trocas da categoria A.

---

## 1. ATENÇÃO (decisão do Lucas)

> **O fork acompanha o upstream.** `git log --oneline | grep -ic upstream` = **101** commits com "upstream" na mensagem; desses, **87** são merges (`git log --merges`), e **9** estão na linha principal do fork (`--first-parent`). Duas branches `atualiza-upstream-*` já foram integradas (a última em 05/11/2026, trazendo 1365 commits do upstream; ver `docs/arvisx/ATUALIZACOES.md`). O remoto `upstream` (`https://github.com/melgarafael/DeskcommCRM.git`, push desativado) está configurado neste clone.
>
> **Renomear "deskcomm" nos 786 arquivos encarece todo merge futuro**: cada arquivo tocado vira conflito potencial na próxima atualização, e a maioria (docs, evidence, loop, skills, testes) o upstream continua editando toda semana.
>
> **Padrão desta tarefa:** executar **A** (o que o usuário vê, identidade e contato), **E** (atualização e infraestrutura apontando para o upstream), as **partes seguras de B** e os **docs de uso**. **C** fica intacto. **D** fica só proposto em tabela (nada é apagado nesta rodada).

---

## 2. Medição

### Comandos usados (git bash, raiz do worktree)

```bash
git grep -il deskcomm | wc -l                                   # 786 arquivos
git grep -ic deskcomm | awk -F: '{s+=$NF} END{print s}'         # 6914 linhas
git grep -il deskcommcrm | wc -l                                # 467 arquivos
git grep -il melgarafael | wc -l                                # 166 arquivos
git ls-files | grep -i deskcomm | wc -l                         # 143 arquivos com deskcomm no NOME
git log --oneline | grep -ic upstream                           # 101
git grep -il deskcomm | awk -F/ '{if(NF==1)print "(raiz)"; else print $1}' | sort | uniq -c | sort -rn
git grep -ohE 'DESKCOMM_[A-Z0-9_]+' | sort | uniq -c            # variáveis de ambiente
```

Os números de referência conferem exatamente: 786 arquivos / 6.914 linhas / 467 / 166 / 143.

### Por área (arquivos com "deskcomm", sem distinção de caixa)

| Área | Arq. | Área | Arq. |
|---|---|---|---|
| docs | 205 | hostgator-setup-kit | 20 |
| tests | 150 | app | 16 |
| evidence | 98 | loop | 14 |
| .agents | 50 | curso | 12 |
| lib | 47 | triagem | 9 |
| .claude | 43 | .github | 7 |
| scripts | 33 | infra | 5 |
| (raiz) | 33 | extensoes | 5 |
| supabase | 24 | plan 3, tasks 2, hooks 2, .specs 2, workers 1, docker 1, deploy 1, components 1, .cursor 1, .codex 1 | |

`docs/` por subpasta: superpowers 31, handoffs 25, specs 20, design-system 15, doctrine 14, research 12, stories 10, runbooks 9, testing 7, saas 6, prd 6, brand 5, outras ≤3 (inclui `white-label*.md`, `ATUALIZANDO.md`, `SETUP.md`, `DEPLOY-CHECKLIST.md`).
`tests/` por subpasta: unit 65, shell 34, e2e 21, invariants 13, sondas e capturas 15, db/setup/fixtures 3.

### Por categoria (classificação por caminho, heurística; soma = 786 arquivos / 6.914 linhas)

| Categoria | Arquivos | Linhas | O que entra |
|---|---|---|---|
| A — substituir | 181 | 1.147 | README*, CONTRIBUTING*, SECURITY, VISION, ARCHITECTURE, Dockerfiles, package.json, .env.example, ISSUE_TEMPLATE, docs de uso (runbooks, white-label, integracao, brand), comentários de código em `lib/` e `app/`, 61 testes unitários que só citam a marca em comentário/fixture |
| B — com compatibilidade | 68 | 189 | cookies, storage, headers de fio, GUCs (no `baseline.sql`), nomes Docker/Traefik, testes e2e/invariants que fixam esses nomes |
| C — não tocar | 27 | 211 | LICENSE, CHANGELOG.md (172 linhas), `.all-contributorsrc`, `.mailmap`, 21 migrations + MANIFEST, fixtures datadas |
| D — processo do upstream | 438 | 4.559 | evidence, loop, triagem, plan, tasks, .specs, .agents, .claude, .cursor, .codex, curso, infra/executor-proprio, AGENTS.md, CLAUDE.md, docs de processo (superpowers, handoffs, specs, stories, research...) |
| E — atualização/infra | 72 | 808 | hostgator-setup-kit, deploy/, extensoes/, docker-compose.prod.yml, .env.hostgator.example, instaladores ubuntu, publish-image/release, scripts de release/colisão, testes shell do kit, painel de atualização |

**57% das linhas (D) são processo do upstream** e não chegam a ninguém de fora. A superfície que embarca na imagem (`app/ components/ hooks/ lib/ workers/`) tem só **~65 arquivos**, a maioria comentário.

---

## 3. Categoria A — substituir sempre

Texto "DeskcommCRM" vira **"Arvisx CRM"**; contato vira **suporte@arvisx.com.br**; links do upstream viram o repositório/canal da Arvisx.

### 3.1 O que as catracas de marca exigem (ler antes de mexer)

**Fonte única do nome:** `lib/branding.ts:18` → `export const DEFAULT_APP_NAME = "ArvisX CRM";` (hoje com **X maiúsculo**).

1. **`tests/unit/marca-do-produto-nao-se-edita-no-codigo.test.ts`** fixa o literal `MARCA_DO_PRODUTO = "ArvisX CRM"` e reprova se `DEFAULT_APP_NAME` mudar. Se a grafia oficial passar a ser "Arvisx CRM", troque **as duas linhas no mesmo commit** (é exatamente o "diff deliberado" que o teste quer). `marcaEhADoProduto()` normaliza caixa, então logo e sidebar continuam iguais.
2. **`tests/unit/branding.test.ts`** (1.468 linhas):
   - `prefixoDoArquivo(DEFAULT_APP_NAME)` tem de dar `"arvisx-crm"` (não muda com a caixa);
   - **catraca de marca hardcoded**: varre `/[\w@.-]*deskcomm[\w@.-]*/gi` em todo `.ts/.tsx` de `app/ components/ hooks/ lib/ workers/` (fora `app/design/`), **ignorando linhas que começam com `//`, `*` ou `/*`**. Cada arquivo com ocorrência precisa estar em `MARCA_CONGELADA` com categoria (`PROTOCOLO | INFRA | DIVIDA | DEV | PADRAO`), motivo e o **conjunto exato** de marcas. Arquivo novo reprova; marca a mais reprova; **marca que some também reprova** até a linha ser apagada ("a lista só encolhe"). `DIVIDA` tem de ser vazia (já está);
   - **catraca do GoTrue**: `supabase/templates/{confirmation,recovery}.html` não podem ter marca (já não têm) e `supabase/config.toml` está congelado como `DEV` com `["deskcomm-crm","deskcommcrm","deskcommcrm"]`;
   - **catraca de hosts**: `deskcomm.app` está declarado como host `PROTOCOLO` (por causa de `SUFIXO_ICAL_UID`).
   - Consequência prática: **comentários podem ser trocados livremente**; trocar qualquer string de código listada em `MARCA_CONGELADA` exige apagar/ajustar a entrada correspondente no mesmo commit.
3. **`tests/unit/nome-da-marca-nas-telas-vem-do-banco.test.ts`**: toda `page.tsx`/`layout.tsx` fora de `app/app/` (>50 páginas, incluindo `/legal` e `/`) **não pode chamar `branding()`** para o nome em texto; tem de usar `marcaDaSaida()` (`lib/branding/saida.ts`, banco acima do `.env`). Pelo menos 7 páginas precisam usar o resolvedor. Não escrever "Arvisx CRM" literal em página pública: o nome vem de `platform_branding`/`APP_NAME`.
4. `tests/unit/marca-sem-divergencia-de-hidratacao.test.tsx`: componente `"use client"` não chama `branding()`; usa `useMarcaDaInstalacao()`.

### 3.2 Código que executa (arquivo:linha)

| Arquivo:linha | Hoje | Trocar por | Catraca |
|---|---|---|---|
| `package.json:2` | `"name": "deskcomm-crm"` | `"arvisx-crm"` | — |
| `package.json:5` | description "DeskcommCRM — sistema operacional..." | descrição Arvisx | — |
| `lib/nuvemshop/config.ts:13` | `APP_USER_AGENT = "DeskcommCRM (rafael@maudibrasil.com.br)"` | `"Arvisx CRM (suporte@arvisx.com.br)"` | apagar entrada `PROTOCOLO` de `lib/nuvemshop/config.ts`. Seguro: a Nuvemshop usa o UA só para contato; o app registrado lá deve ser o da Arvisx |
| `lib/ai/pontos/pkce-da-assinatura.ts:17` | `NOME_DO_CLIENTE_SIWC = "DeskcommCRM"` (vai como `agent_name_hint` na linha 108, **aparece na tela de consentimento da OpenAI**) | `"Arvisx CRM"` | ajustar entrada `PROTOCOLO`. Seguro: só vale para autorizações novas sem `client_id`; tokens já emitidos não mudam |
| `lib/mcp/server.ts:27` | `SERVER_NAME = "deskcomm-crm"` (serverInfo do MCP da Arvisx) | `"arvisx-crm"` | ajustar entrada. Risco baixo: o cliente MCP guarda a URL e o nome que o usuário escolheu; o serverInfo é informativo |
| `lib/mcp/servidor-externo/chamada.ts:118` | `NOME_DO_CLIENTE_MCP = "deskcomm-crm"` (clientInfo enviado a servidores MCP de terceiros; usado também em `do-agente/oauth.ts:205`) | `"arvisx-crm"` | ajustar entrada; avisar quem tiver regra de acesso por clientInfo (improvável) |
| `lib/supabase/admin.ts:47` | `"X-Client-Info": "deskcomm-crm/admin"` | `"arvisx-crm/admin"` | ajustar entrada. Seguro: só telemetria do Supabase |
| `app/design/page.tsx:51,110` | `<h1>DeskcommCRM</h1>`, "Showcase de Design System — DeskcommCRM" | "Arvisx CRM" | fora da catraca (`app/design` está pulado); a rota já responde 404 (commit `df50c8b52`) |
| `app/design/lib/tokens.ts:1`, `app/design/layout.tsx:7`, `app/globals.css:28` | comentários "DeskcommCRM" | "Arvisx CRM" | comentário, livre |
| `app/globals.css:1042,1055` | `@keyframes deskcomm-card-pulse` | pode ficar (nome interno de CSS, invisível) ou `arvisx-card-pulse` (2 linhas, mesmo arquivo) | — |
| `supabase/config.toml:1,5,75,79` | `project_id = "deskcomm-crm"`, assuntos "— DeskcommCRM" | assuntos → "Arvisx CRM"; `project_id` pode ficar (nomeia contêineres locais) | atualizar `CONGELADO_SUPABASE` |
| `Dockerfile:2-3,92,94` | comentário, `-t deskcomm-app`, `LABEL org.opencontainers.image.source="https://github.com/melgarafael/DeskcommCRM"`, `title="DeskcommCRM"` | `https://github.com/BarrosPL/arvisx-crm`, `title="Arvisx CRM"` | — |
| `Dockerfile.worker:9,11`, `Dockerfile.scheduler:10,12`, `Dockerfile.voice-agent:7,9` | mesmo LABEL source + title | idem | — |
| `.env.example:2,96,509,511` | cabeçalho e exemplos `waha.deskcomm.com`, `app.deskcomm.com`, `admin.deskcomm.com` | cabeçalho Arvisx, exemplos `crm.arvisx.com.br` | — |
| `.env.hostgator.example:2` | cabeçalho | Arvisx (as linhas 32/39/41 são E) | — |
| `Caddyfile:1`, `docker-compose.prod.yml:1`, `docker-compose.traefik.yml:1`, `docker-compose.yml:1`, `deploy/arvisx/crm/docker-compose.easypanel.yml:1-2`, `docker/scheduler/entrypoint.sh:2` | comentários de cabeçalho | Arvisx | — |
| `ubuntu-local-installer.sh:2,39,160,173` / `ubuntu-production-installer.sh:3,33` | textos "DeskcommCRM", `OWNER_ORG_NAME="Deskcomm Local"` | Arvisx (a URL de clone da linha 40 é E) | — |
| `scripts/check-user.ts:7`, `scripts/probe-redirect.ts:11` | `demo@deskcomm.com.br` | `demo@arvisx.test` (dev) | — |
| `lib/email/resend.ts:14` | comentário citando `noreply@deskcomm.app` | pode ficar (é histórico do fallback removido) | — |

Comentários em código que só citam o upstream (`lib/agent-engine/*`, `lib/ai/*`, `lib/lgpd/*`, `lib/legal/operador.ts`, `lib/api/errors.ts`, `lib/branding.ts:4`, `lib/waha/*`, `workers/agent-worker/main.ts:10`, `app/api/v1/cron/sync-model-catalog/route.ts:6`, `app/app/agenda/page.tsx:155`, `app/app/ai/agents/[id]/_components/ServidoresMcpDoAgente.tsx:632`, `app/actions/settings/updateMetaApp.ts:51`, `components/agenda/tipos.ts:38`): **não aparecem para ninguém**. Trocar só se o arquivo já for tocado; cada um é conflito a mais no próximo merge.

### 3.3 Identidade, contato e canais (arquivos de repositório)

| Arquivo:linha | O que trocar |
|---|---|
| `.github/ISSUE_TEMPLATE/bug_report.yml:8` | link de relato privado `melgarafael/DeskcommCRM/security/advisories/new` → suporte@arvisx.com.br (ou advisories do BarrosPL/arvisx-crm) |
| `.github/ISSUE_TEMPLATE/config.yml:4,7` | Discussions e Security do upstream → contato Arvisx (suporte@arvisx.com.br) |
| `.github/FUNDING.yml:1` | `github: melgarafael` (botão Sponsor do Rafael no fork) → remover o arquivo ou trocar |
| `SECURITY.md:5,16` | nome e canal de relato → Arvisx, suporte@arvisx.com.br |
| `CONTRIBUTING.md` / `CONTRIBUTING.en.md` (6 linhas cada: 1, 8, 10, 114, 239, 241) | título, Discussions/issues do upstream → canais Arvisx; referências à skill `deskcomm-contribuir` acompanham a decisão de D |
| `README.md` (199), `README.en.md` (196), `README.es.md` (191) | reescrever: logo `docs/brand/deskcomm-logo*.svg`, curso `deskcomm.com.br/curso`, comandos de clone, badges. São o maior bloco de A e o upstream mexe neles sempre; sugestão: README próprio curto da Arvisx + `docs/arvisx/` e manter os READMEs do upstream renomeados (ex. `docs/upstream/README.md`) para não brigar em todo merge |
| `VISION.md` (6), `ARCHITECTURE.md:1,41` | título e etimologia "Desk + comm" → Arvisx; a linha 41 cita o cookie (B, fica) |
| `hostgator-setup-kit/README.md` (5), `hostgator-setup-kit/CLAUDE.md` (7) | instruções com `git clone .../melgarafael/DeskcommCRM.git deskcommcrm` → fork (andam junto com E) |

### 3.4 Docs de uso real (contar, não listar linha a linha)

Trocar marca e links nos docs que um operador/cliente da Arvisx usa: `docs/white-label*.md` (3), `docs/integracao/*` (2; webhooks de saída citam `X-Deskcomm-*`, que fica, ver B), `docs/runbooks/*` (9), `docs/ATUALIZANDO.md`, `docs/SETUP.md`, `docs/DEPLOY-CHECKLIST.md`, `docs/threat-model.md`, `docs/brand/*` (5: são os logos do upstream; substituir pelos da Arvisx ou mover para `docs/upstream/`). Os demais 180 arquivos de `docs/` são processo do upstream (D).

---

## 4. Categoria B — substituir com compatibilidade

**Achado que muda o plano:** `deskcommapp` **não é schema nem role** do Postgres (é o prefixo do `google_event_id`), e `deskcomm_private` **não é schema** (é rede Docker do modo single-server). Não existe `CREATE SCHEMA`/`CREATE ROLE` com "deskcomm" no repositório.

| Item | Definido em | Lido/escrito em | Dependência externa | Recomendação |
|---|---|---|---|---|
| Cookie de sessão `sb-deskcomm-auth` | `lib/supabase/browser.ts:144`, `lib/supabase/server.ts:29`, `proxy.ts:14` | todo request autenticado; 6 testes e2e (`tests/e2e/*`), `.github/workflows/e2e.yml:1054,1097` (grep no bundle) | navegadores de todos os usuários logados | **MANTER e documentar.** Invisível (só no DevTools). Trocar desloga todo mundo na virada; dupla leitura exigiria interceptar o storage do `@supabase/ssr` nos 3 pontos e migrar o cookie, para ganho zero de marca |
| Cookie `deskcomm-impersonate` | `lib/impersonate/cookie.ts:23`, `lib/impersonate/cookie-edge.ts:14` | `proxy.ts:130,140`, `app/api/v1/admin/tenants/[id]/impersonate/route.ts:52`, `app/api/v1/admin/impersonate/end/route.ts:30` | só sessões de suporte abertas (TTL curto) | **MANTER** (invisível). Se quiser trocar: ler os dois nomes em `proxy.ts` e no `end`, escrever só o novo, remover o legado após o TTL. Baixo valor |
| localStorage `deskcomm-theme` | `lib/theme.tsx:11`, `app/layout.tsx:186` (script anti-flash) | os mesmos; 5 testes | preferência local de cada navegador | **MANTER**. Se trocar: o script lê `arvisx-theme ?? deskcomm-theme` e grava só o novo (par obrigatório nos dois arquivos) |
| localStorage `deskcomm.designshowcase.v1` | `app/design/lib/variant-context.tsx:23` | só `/design` (hoje 404) | nenhuma | trocar livremente (tela bloqueada) ou deixar |
| localStorage `deskcomm.show_ai_citations` | `hooks/ai/useDebugToggle.ts:5` | o mesmo | modo debug local | **MANTER** (invisível) |
| Header de entrada `x-deskcomm-signature` | `lib/webhooks/assinatura.ts:13` | `app/api/v1/webhooks/in/[token]/route.ts:222`; **exibido na tela** em `app/app/webhooks/_components/SourceDetail.tsx:87,568`; `lib/webhooks/inbound.ts:266` (comentário) | integradores que já enviam webhooks ao CRM | **Trocar com dupla leitura:** aceitar `x-arvisx-signature` **ou** `x-deskcomm-signature` na rota (o primeiro que vier), e a tela passa a ensinar o novo. Atualizar a entrada `PROTOCOLO` da catraca e `docs/integracao`. É o único header de marca que aparece na interface |
| Headers de saída `X-Deskcomm-Event`, `X-Deskcomm-Signature` | `lib/automation/actions/call-webhook.ts:45,50` | envio de toda ação `call_webhook`; guardado por `call-webhook.test.ts` | receptores dos clientes casam por igualdade | **Emitir os dois:** acrescentar `X-Webhook-Event` (neutro, no padrão dos `X-Webhook-*` que já existem) mantendo `X-Deskcomm-Event`; `X-Deskcomm-Signature` já é legado ao lado de `X-Webhook-Signature`. Não remover nada sem aviso |
| Headers MCP `X-Deskcomm-Contato-Id`, `X-Deskcomm-Contato-Telefone`, `X-Deskcomm-Canal` | `lib/mcp/servidor-externo/chamada.ts:110-112` | `carregar.ts:30,83`, `do-agente/carregar.ts:11,14`; teste de não-forjamento `externo.test.ts` | servidores MCP externos filtram dados do contato **por esse nome** | **Emitir os dois** (`X-Arvisx-*` + legado) e estender o teste de não-forjamento aos dois nomes; nunca só renomear (o servidor externo deixaria de filtrar) |
| `X-Client-Id: deskcomm-worker` | `lib/wacalls/events-bridge.ts:727` | processo WaCalls (exclusividade de chamada) | WaCalls | **MANTER** (sem telefonia ligada na Arvisx; invisível) |
| GUC `deskcomm.desfecho_pelo_negocio` | `supabase/baseline.sql:46581-46607` (set/restore) | `baseline.sql:46644,47174,53425,59776,59920` + 5 migrations (última `20261105012125_9206`) | nenhuma (variável de transação dentro de funções SQL) | **MANTER e documentar.** Invisível, sem consumidor externo. Trocar exige migration que recria ~10 funções de uma vez; toda migration futura do upstream que mexer nelas voltaria com o nome antigo |
| GUC `deskcomm.cliente_pela_agenda` | `baseline.sql:26130,26141` | `baseline.sql:26226`; migrations `0262`, `0581`; 2 testes db | nenhuma | **MANTER** (mesmo motivo) |
| GUC `deskcomm.meta_capi_birth_lead_id` | `baseline.sql:58883,58891` | `baseline.sql:58823`; migration `0803`; 1 teste | nenhuma | **MANTER** |
| Prefixo do id de evento Google `deskcommapp` | derivado de `SUFIXO_ICAL_UID = "deskcomm.app"` (`lib/agenda/google/evento.ts:60`) em `lib/agenda/google/escrita.ts:3` | `idDeEventoDoGoogle`, `ehEventoNosso`; **escrito em SQL** em `baseline.sql:21552,22010,22120,53128,58441` e migrations `0225, 0226, 0578, 0654, 0716` | **eventos já gravados no Google Calendar dos clientes** | **MANTER.** Trocar faz eventos antigos deixarem de ser reconhecidos (compromisso fantasma). Detalhe técnico: id do Google só aceita `a-v0-9`, então "arvisx" viraria "arvis". Invisível ao usuário |
| `PREFIXO_PROPRIEDADE = "deskcomm"` (`deskcomm_org`, `deskcomm_appointment`, `deskcomm_v`) | `lib/agenda/google/evento.ts:63` | `evento.ts:392-394`, `sync-executor.ts:317-318` | `extendedProperties.private` gravadas no Google | **MANTER** (privadas, invisíveis; dupla leitura possível mas sem ganho) |
| Rede Docker `deskcomm_single_server` / `deskcomm_private` / `deskcomm_proxy` | `docker-compose.single-server.yml:47`, `hostgator-setup-kit/supabase-single-server.override.yml:23,49,113,142,152,154`, `supabase-single-server.traefik.yml:9,14` | kit single-server | VPS instaladas pelo kit | **MANTER** (`SINGLE_SERVER_NETWORK` já permite outro nome). Não usado no Easypanel |
| Routers/middlewares Traefik `deskcomm`, `deskcomm-compress`, `deskcomm-waha-block`, `deskcomm-deny`, `deskcomm-http`, `deskcomm-https` | `docker-compose.traefik.yml:74-110` | Traefik do host | Traefik de quem usa esse override | trocar é seguro numa instalação nova; numa existente cria routers duplicados até o `up -d`. **MANTER** (não usado no Easypanel) |
| Contêineres `deskcomm-waha`, `deskcomm-agent-worker`; imagens locais `deskcomm-app:local` etc. | `docker-compose.yml:23,73`, `docker-compose.local.yml:17,47,78`, `docker-compose.build.yml:20,32,39` | dev local | nenhuma | trocar se quiser (dev); baixo valor |
| CA `/etc/deskcomm/ca/supabase-ca.crt`, `/run/deskcomm-cron` | `docker-compose.supabase-ca.yml:31-53`, `docker/scheduler/entrypoint.sh:186,210` | dentro do contêiner | nenhuma | **MANTER** (caminho interno) |
| Marcadores do kit no disco da VPS: `.deskcomm-instalado`, `.deskcomm-update-diagnostico.log`, `.deskcomm-env-antes-do-update`, `.deskcomm-segredo-do-cron-trocado`, `.deskcomm-site-url-avisado`, `.deskcomm-manutencao*`, `.deskcomm-traefik`, `.deskcomm-supabase*`, `.deskcomm-banco`, `.deskcomm-fonte`, `.deskcomm-guia`, `.deskcomm-regras-faltando` | `hostgator-setup-kit/_common.sh:93` (`MARCA_INSTALACAO_NOME`) e outros; `.gitignore:156-184` | kit | VPS já instaladas | **MANTER** (renomear faz o kit achar que a VPS nunca foi instalada) |
| `SUFIXO_ICAL_UID` / `PREFIXO_PROPRIEDADE` | ver acima | — | Google | **NÃO trocar sem dupla leitura** (pedido da tarefa); recomendação final: MANTER |

### 4.1 Todas as variáveis `DESKCOMM_*` (21) e onde são lidas

**Achado:** nenhuma é lida pelo app, worker ou scheduler (`git grep DESKCOMM_ -- lib app workers components hooks proxy.ts docker deploy docker-compose* Dockerfile*` = 0). Todas são de scripts de shell (kit, dev, hooks do processo) e testes. Recomendação geral: aceitar `ARVISX_*` **só nas que um operador da Arvisx digita** (marcadas com ★), com `${ARVISX_X:-${DESKCOMM_X:-}}`; as do processo do upstream ficam como estão.

| Variável | Lida em (arquivo:linha) | Uso | Recomendação |
|---|---|---|---|
| ★ `DESKCOMM_BUILD_LOCAL` | `hostgator-setup-kit/_common.sh:1340,1346,1371`; `update.sh:220,259,859,867`; `install.sh:2466,2477,2481` | permite construir imagens na VPS | aceitar `ARVISX_BUILD_LOCAL` também |
| ★ `DESKCOMM_IDIOMA_CLI` | `_i18n.sh:587-645` (lê do `.env` e do ambiente); gravada em `install.sh:1865` | idioma do instalador | aceitar as duas; continuar gravando a antiga no `.env` (VPS existentes) |
| ★ `DESKCOMM_RELEASES_LATEST_URL` | `_common.sh:3300` | URL da "última release" usada pelo agente e pelo `update.sh` | aceitar as duas; **é a alavanca para apontar a atualização para o fork** (ver E) |
| ★ `DESKCOMM_ASSUMIR_PROJETO` | `_common.sh:1834`; doc em `install.sh:1042` | assumir projeto Docker de outra cópia | aceitar as duas |
| `DESKCOMM_AGENT_REPORT`, `DESKCOMM_AGENT_REPORT_CMD`, `DESKCOMM_AGENT_PREV_IMAGE` | exportadas em `agent.sh:517-519`; lidas em `update.sh:308,319,359,684`, `_common.sh:3009` | comunicação interna agente → update.sh | MANTER (interno ao kit) |
| `_DESKCOMM_AVISO_ARQ_DADO` | `_common.sh:204-205` | flag interna | MANTER |
| `DESKCOMM_REPO_URL` | `scripts/instalar-guias.sh:57` (default `https://github.com/melgarafael/DeskcommCRM.git`) | instalador de guias de IA | E: trocar default para o fork ou desativar |
| `DESKCOMM_GUIAS_HOME` | `scripts/instalar-guias.sh:59` | pasta de cache das guias | MANTER (D) |
| `DESKCOMM_REPO_ESPERADO` | `infra/executor-proprio/so-o-que-e-nosso.sh:20` (default `melgarafael/DeskcommCRM`) | runner próprio do upstream | D |
| `DESKCOMM_REPO` | `.agents/skills/deskcomm-operacao/scripts/buscar.sh:73-74`, `conferir-mapa.sh:35-36` (e cópias em `.claude/skills/`) | achar o repo | D |
| `DESKCOMM_ENV_MODE` | `scripts/local-env.sh:39,81,103`; `ubuntu-local-installer.sh:113,125` | marca `.env.local` de dev | MANTER (dev) |
| `DESKCOMM_MIGRATIONS_BACKUP_DIR` | `scripts/local-supabase.sh:28-37` | interna | MANTER |
| `DESKCOMM_MIGRATION_EDIT` | `.agents/skills/deskcomm-contribuir/scripts/hooks/check-migration-triple.sh:23` | bypass de hook | D |
| `DESKCOMM_GOV_MIGRATION_EDIT` | `loop/hooks/check-migration-triple.sh:14` | bypass de hook | D |
| `DESKCOMM_GOV_INVARIANTS_EDIT` | `loop/hooks/guard-invariants.sh:55` | bypass de hook | D |
| `DESKCOMM_GOV_PLAN_EDIT` | `loop/hooks/validate-features.sh:9` | bypass de hook | D |
| `DESKCOMM_GOV_PHASE_MERGE` | `loop/hooks/pre-push:72` | libera push na virada de fase | D |
| `DESKCOMM_GOV_HOOKS_ATRASADOS_OK` | `loop/hooks/guard-hooks-atualizados.sh:39` | bypass | D |
| `DESKCOMM_INVARIANTS_DB_RESET` | escrita em `tests/db/banco-limpo-por-arquivo.ts:72`, lida em `tests/invariants/harness-isola-por-arquivo.test.ts:77` | marcador de teste | MANTER |

Nota: os hooks de `loop/hooks/` **não estão armados** neste clone (`git config core.hooksPath` vazio).

---

## 5. Categoria C — não tocar

- `LICENSE` (MIT, "Copyright (c) 2026 Rafael Melgaço"): obrigatório manter pela própria licença MIT.
- `CHANGELOG.md` (172 linhas com deskcomm): histórico de versões do upstream com links de compare.
- `.all-contributorsrc`, `.mailmap` (identidades e e-mails de contribuidores do upstream, inclusive `rafael@maudibrasil.com.br`, `rafael@automatiklabs.com.br`).
- `supabase/migrations/*` (21 arquivos + `MANIFEST.md`): nomes e conteúdo nunca mudam (o deploy lista as aplicadas em `deploy/arvisx/crm/migracoes-pos-baseline.txt`).
- `supabase/baseline.sql`: comentários `COMMENT ON SCHEMA public IS 'DeskcommCRM v0.1...'` (linha 22) e `organizations` (1788), créditos a issues `jmpo/DeskcommCRM#89` (55365). O baseline vem do upstream e é reaplicado a cada atualização; editar aqui gera conflito certo. Os GUCs e o prefixo Google estão na seção B.
- Fixtures datadas: `lib/waha/__fixtures__/grupos-noweb-2026.7.2.json`, `tests/fixtures/*`, `lib/system/changelog.test.ts` (congelado como `DEV` na catraca).
- Créditos `@melgarafael` em comentários (`lib/agent-engine/queue/loop.ts:17`, `soneca.ts:5`, testes): atribuição de achados, manter.

---

## 6. Categoria D — processo de desenvolvimento do upstream

Proposta (nada apagado agora). "Renomear" só vale se a Arvisx for de fato usar a ferramenta; caso contrário, manter intacto evita conflito.

| Item | Arquivos | Proposta | Motivo |
|---|---|---|---|
| `evidence/` | 98 | **manter** | provas de sessões do upstream; não executa; cada merge traz mais |
| `loop/` (gov-loop, hooks `pre-push`, `guard-invariants`, `validate-features`, `check-migration-triple`) | 14 | **manter**, não armar | processo do mantenedor upstream; hooks não estão armados aqui |
| `triagem/` (triagem de PR do upstream) | 9 | **manter** | só serve a PRs do melgarafael |
| `plan/`, `tasks/`, `.specs/` | 3 / 2 / 2 | **manter** | planejamento do upstream |
| `.github/workflows/acolhida.yml` | 1 | **manter** (já se desliga: `if: github.repository_owner == 'melgarafael'`) | — |
| `.github/workflows/vigia-de-colisao.yml` + `scripts/vigia-colisao-de-migration.ts:152` | 2 | **manter**; roda no fork a cada 2 h e usa `GITHUB_REPOSITORY` (fork) | útil para PRs do fork |
| `.github/workflows/release.yml` + `scripts/cortar-release.ts:28` (`REPO = "melgarafael/DeskcommCRM"`) | 2 | **desligar no fork** (ver E) | falha em todo push na `main` do fork (execuções de 05-06/11 todas `failure`) |
| `infra/executor-proprio/*` (runner do upstream: `instalar.sh:81,83,157`, `vaga.sh:14`, `so-o-que-e-nosso.sh:20`) | 5 | **manter, não usar** | registra runner no repo do upstream; `EXECUTOR_PROPRIO` não está ligado no fork |
| `curso/` (curso visual servido em deskcomm.com.br/curso) | 12 | **manter** | conteúdo e capturas do upstream |
| `AGENTS.md` (24), `CLAUDE.md` (20) | 2 | **manter** como doutrina técnica; criar `docs/arvisx/` como entrada da Arvisx | o upstream reescreve sempre |
| `docs/` de processo (superpowers, handoffs, specs, stories, research, audits, doctrine, design-system, testing, prd, adr...) | ~180 | **manter** | — |
| `.cursor/rules/deskcomm-guias.mdc`, `.agents/rules/deskcomm-guias.md` | 2 | renomear só se renomear as skills | apontam para as skills |
| `.claude/commands/deskcomm-gov-loop.md`, `.claude/agents/gov-*`, `triagem-*` | 6 | **manter** | processo upstream |
| `.claude/settings.json:2,9`, `.codex/hooks.json:2,9` | 2 | **manter** (o hook `sessao.sh` só fala em clone de contribuidor) | — |
| `scripts/migration-populacao.sh:88,104-105,274` | 1 | **manter**; ele procura o remoto que aponta para `melgarafael/deskcommcrm` (aqui é o `upstream`) para medir colisão de número de migration com o upstream, o que é **útil** ao fork | ver E |
| `scripts/checar-colisao-de-migration.sh`, `conferir-isolamento-do-kit.sh`, `qa-wave-12.ts`, `spike-*`, `sonda-*`, `duble-saas-*`, `seed-e2e-*`, `dbg-login.ts` | ~15 | **manter** | ferramental de teste/dev |

### Skills `deskcomm-*` (`.agents/skills/` 50 arq., cópia em `.claude/skills/` 43 arq.)

| Skill | Proposta | Referências fora de `.agents/.claude/docs/evidence/loop` que mudariam junto com um rename |
|---|---|---|
| `deskcomm-operacao` | renomear → `arvisx-operacao` **só se** o time usar | `.github/workflows/ci.yml:404` (`bash .agents/skills/deskcomm-operacao/scripts/conferir-mapa.sh --ci`), `ci.yml:396` (comentário), `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/deskcomm-guias.mdc`, `tests/unit/skill-operacao-mapa-e-busca.test.ts`; variável `DESKCOMM_REPO` nos scripts |
| `deskcomm-contribuir` | **manter** (fluxo de PR para o upstream) | `.claude/settings.json:9`, `.codex/hooks.json:9`, `package.json:30` (`tests/shell/deskcomm-contribuir.test.sh` no `test:shell`), `CONTRIBUTING*.md:8,10`, `.mailmap`, `scripts/checar-colisao-de-migration.sh`, `scripts/instalar-guias.sh`, `tests/shell/hooks-nao-acusam-a-main.test.sh`, `tests/unit/{hooks-nao-acusam-o-merge-da-main,populacao-do-proximo-nnnn,prova-em-par-esta-escrita,skills-embutidas}.test.ts`, `tests/e2e/modelos-do-parceiro-editar-apagar.spec.ts` (49 arquivos no total) |
| `deskcomm-cliente-novo` | renomear → `arvisx-cliente-novo` se usada para onboarding de clientes Arvisx | `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/...`, `scripts/instalar-guias.sh`, `tests/unit/gates-fixos-so-no-legado.test.ts` (28 no total) |
| `deskcomm-instalar` | manter (instala o upstream via kit) até E ser resolvido | `README.md`, `README.en.md`, `hostgator-setup-kit/{CLAUDE,README}.md`, `scripts/instalar-guias.sh`, `tests/shell/instalar-guias.test.sh`, `tests/unit/kit-e-guia-de-instalacao.test.ts` (29) |
| `deskcomm-prompt`, `deskcomm-metricas`, `deskcomm-doutrina`, `deskcomm-curso` | manter | `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/...`, `scripts/instalar-guias.sh` (+ `tests/shell/instalar-guias.test.sh` para prompt) |
| `deskcomm-extensao`, `deskcomm-saas` | manter | `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/...` |
| `deskcomm-guias` (nome de conjunto) | manter | `tests/unit/skills-embutidas.test.ts` |

Recomendação: **não renomear skills nesta rodada.** Se o time quiser um nome próprio, criar `arvisx-*` novas (cópias enxutas) em vez de renomear as do upstream.

---

## 7. Categoria E — atualização e infra apontando para o upstream (risco real)

### 7.1 Estado real verificado no GitHub (`gh run list -R BarrosPL/arvisx-crm`)

- `publish-image.yml` **roda no fork** a cada push na `main` (última: `42295232123`, 06/11 21:15, sucesso) e publica **`ghcr.io/barrospl/deskcommcrm`, `deskcomm-worker`, `deskcomm-scheduler`, `deskcomm-voice-agent`** com tags `:latest` e `:main` (o dono vem de `github.repository_owner`). Ou seja, as imagens do fork **já existem**, só que com nome deskcomm.
- `release.yml` dispara em todo push na `main` e **falha** (05/11 e 06/11). O passo que publica a LP (`release.yml:490`) já se limita a `github.repository == 'melgarafael/DeskcommCRM'`.
- `vigia-de-colisao` roda a cada 2 h com sucesso; `relogio` é pulado; `acolhida` é pulada.

### 7.2 Itens

| Arquivo:linha | O que faz | Risco | Proposta |
|---|---|---|---|
| `deploy/arvisx/crm/docker-compose.easypanel.yml:31,59,124` | `image: ${APP_IMAGE:-ghcr.io/melgarafael/deskcommcrm:stable}` (idem worker/scheduler) com `pull_policy: ${APP_PULL_POLICY:-always}` | **ALTO**: se a variável `APP_IMAGE` sumir do `.env` do Easypanel, o próximo deploy baixa a imagem **do upstream** e o CRM perde o redesign Arvisx sem erro nenhum | trocar os defaults para `ghcr.io/barrospl/arvisx-crm:<tag>` (ou `deskcommcrm` enquanto o pacote não for renomeado) e, de preferência, tag por SHA; conferir hoje o `APP_IMAGE`, `WORKER_IMAGE`, `SCHEDULER_IMAGE` no Easypanel |
| `docker-compose.prod.yml:39,147,309,476` | mesmos defaults `ghcr.io/melgarafael/...:stable` | médio (só instalações pelo kit) | trocar junto com `IMG_NS` (catraca abaixo) |
| `.env.hostgator.example:32,39,41` | `APP_IMAGE=ghcr.io/melgarafael/deskcommcrm:stable` etc. | médio | idem |
| `hostgator-setup-kit/_common.sh:2478-2484` | `IMG_NS="ghcr.io/melgarafael"`, `IMG_APP=${IMG_NS}/deskcommcrm`, `deskcomm-worker`, `deskcomm-scheduler`, `deskcomm-voice-agent`; `trio_publicado` (`:2557`) lista os quatro nomes | **ALTO** para qualquer VPS instalada pelo kit: grava imagens do upstream no `.env` (`gravar_imagens`, `:2690`) | `IMG_NS="ghcr.io/barrospl"`; nomes dos pacotes acompanham a matriz do `publish-image.yml`. **Catraca:** `tests/unit/namespace-das-imagens.test.ts` exige que `IMG_NS`, os defaults de `docker-compose.prod.yml`, `.env.hostgator.example` e a matriz de `publish-image.yml` concordem, e que `IMG_NS` seja igual a `NAMESPACE_DESTE_REPO` em `tests/unit/_identidade-deste-repo.ts` (`"ghcr.io/melgarafael"`); no Actions, `namespace-das-imagens-runtime-owner.test.ts` cobra que o dono de `IMG_NS` seja o `GITHUB_REPOSITORY_OWNER` (no fork ele **defere**: não cobra). `tests/unit/listas-de-imagens-seguem-matriz.test.ts` cobra a lista de nomes. Trocar tudo num commit só |
| `hostgator-setup-kit/_common.sh:2497-2507` | `ultima_versao_publicada()` faz `git ls-remote --tags` em `${1:-https://github.com/melgarafael/DeskcommCRM.git}`; chamada em `install.sh:1418` com `$REPO_URL` | **ALTO**: mesmo rodando o kit dentro do clone do fork, a instalação nova escolhe a **versão do upstream** e pina as imagens do upstream | default → URL do fork (ou derivar de `git config remote.origin.url`) |
| `hostgator-setup-kit/install.sh:18,22,1011` | `REPO_URL="${REPO_URL:-https://github.com/melgarafael/DeskcommCRM.git}"`, `REPO_DIR=deskcommcrm`, `git clone --depth 1 "$REPO_URL"` | ALTO (instala o upstream) | `REPO_URL` → `https://github.com/BarrosPL/arvisx-crm.git` (repo privado: o clone pede credencial; decidir se o kit é usado pela Arvisx) |
| `hostgator-setup-kit/comecar.sh:12,16` | `curl ... raw.githubusercontent.com/melgarafael/.../comecar.sh \| bash`; `REPO_URL` default upstream | ALTO | idem |
| `hostgator-setup-kit/comecar.sh:20`, `install.sh:21` | `COMUNIDADE_URL="https://lp-comunidade.automatiklabs.com.br"` (comunidade do Rafael mostrada ao final da instalação) | médio (marca de terceiro) | trocar para canal Arvisx ou remover |
| `hostgator-setup-kit/diagnostico.sh:22` | instrução `curl .../melgarafael/.../diagnostico.sh \| bash` | baixo (texto) | trocar URL |
| `hostgator-setup-kit/extensao.sh:32-34,52` | baixa `https://extensoes.deskcomm.com.br/catalogo.json` (default de `EXTENSOES_ORIGEM`) | médio: busca catálogo no domínio do upstream | default → origem Arvisx ou desligar; `scripts/gerar-catalogo-de-extensoes.ts:38` e `extensoes/catalogo.json:3,6,32-33,...`, `extensoes/loja.json:4,14,24` (publisher "Deskcomm", repo do upstream) acompanham. O **app** não busca catálogo pela rede (só aceita upload em `app/api/v1/extensions/catalogs/route.ts`) |
| `ubuntu-local-installer.sh:40` | `git clone https://github.com/melgarafael/DeskcommCRM.git` | médio | URL do fork |
| `scripts/instalar-guias.sh:42-43,57` | `curl .../melgarafael/.../instalar-guias.sh`, `REPO_URL=${DESKCOMM_REPO_URL:-https://github.com/melgarafael/DeskcommCRM.git}` (clona skills do upstream na máquina do dev) | baixo/médio | default → fork, ou deixar (ferramenta de dev) |
| `.github/workflows/publish-image.yml:195-207,329-332,412-417` | matriz `deskcommcrm`, `deskcomm-worker`, `deskcomm-scheduler`, `deskcomm-voice-agent` | nomes de pacote com marca do upstream | renomear para `arvisx-crm`, `arvisx-worker`, `arvisx-scheduler`, `arvisx-voice-agent`: cria **pacotes GHCR novos** (os antigos ficam); tornar públicos ou dar credencial ao Easypanel; trocar `APP_IMAGE` etc. no Easypanel **no mesmo deploy**. Arquivos que mudam junto: `publish-image.yml`, `release.yml:429,455`, `_common.sh:2479-2484,2557,2677`, `docker-compose.prod.yml`, `.env.hostgator.example`, `deploy/arvisx/crm/docker-compose.easypanel.yml`, `tests/unit/{namespace-das-imagens,listas-de-imagens-seguem-matriz}.test.ts`, `tests/unit/_identidade-deste-repo.ts`, testes shell do kit que derivam de `IMG_NS` |
| `.github/workflows/release.yml` | corta release (CHANGELOG + tag) a cada push na `main`; usa GitHub App do upstream | falha sempre no fork; ruído | desligar no fork (`if: github.repository == 'melgarafael/DeskcommCRM'` no job, ou desativar o workflow no GitHub) |
| `scripts/cortar-release.ts:28` | `REPO = "melgarafael/DeskcommCRM"` (links de compare no CHANGELOG) | baixo | só se o fork passar a cortar releases próprias |
| `scripts/vigia-colisao-de-migration.ts:152` | `GITHUB_REPOSITORY ?? "melgarafael/DeskcommCRM"` | baixo (no Actions usa o fork) | manter |
| `scripts/migration-populacao.sh:88,104-105,274` | procura o remoto do "produto" `melgarafael/deskcommcrm` | **útil** ao fork (mede colisão com o upstream) | manter |
| `infra/executor-proprio/*` | registra runner em `melgarafael/DeskcommCRM` | nenhum (não usado) | D |
| `lib/sentry/dsn.ts:16-17` | `DEFAULT_SENTRY_DSN = "https://58fabf...@o4509908078559232.ingest.us.sentry.io/4509908083212288"`; `resolveSentryDsn` usa esse padrão quando `SENTRY_DSN` está **vazio ou ausente** | **ALTO (LGPD)**: por padrão, erros do servidor e do navegador do CRM Arvisx (stack trace, URL, contexto) vão para o **Sentry do upstream** | no Easypanel: `SENTRY_DSN=off` (ou DSN da Arvisx) **já**; no código: trocar o padrão para `undefined` (desligado) ou DSN Arvisx; `.env.example:442` e `.env.hostgator.example:339-345` acompanham. Conferir testes de `lib/sentry` |

### 7.3 O painel "Atualizar pela UI" (`/app/settings/atualizacao`) em detalhe

**Quem vê:** só `is_platform_admin` (`app/app/settings/atualizacao/page.tsx:16`, senão `notFound()`), com MFA. Desde 05/11 está fora do menu (decisão do Lucas), mas acessível por URL e ⌘K. O rodapé da sidebar (`components/shell/VersionFooter.tsx`) mostra a versão e um link "Nova versão X disponível" para o dono quando `update_available`.

**O app nunca consulta o GitHub nem executa nada.** Todo o ciclo é de um script no host:

1. **Agente do host** `hostgator-setup-kit/agent.sh`, instalado pelo kit no **cron do host a cada 5 min**. Precisa de `INTERNAL_CRON_SECRET` (ou `INTERNAL_SECRET`) e `NEXT_PUBLIC_APP_URL` no `.env`; sem eles sai calado (`agent.sh:11-13`).
2. Descobre a versão: `git fetch --tags --quiet origin` (`agent.sh:165`) no clone do host e `ultima_release_estavel()` (`_common.sh:3297+`), que:
   - usa `DESKCOMM_RELEASES_LATEST_URL` se definida;
   - senão deriva do `remote.origin.url` do clone: `https://api.github.com/repos/<dono>/<repo>/releases/latest` e lê o `tag_name` com `curl -fsSL` (sem token);
   - origin fora do GitHub: maior tag `v*` local.
   Portanto ela **segue o `origin` do clone**: num clone do fork aponta para `BarrosPL/arvisx-crm`, que é **privado e sem releases** (a API devolve 404 sem token), e o resultado é "não sei" (`compare_failed`). Num clone feito pelo kit (default `melgarafael`), aponta para o upstream.
3. Anuncia por `POST $NEXT_PUBLIC_APP_URL/api/v1/system/agent` (Bearer do segredo interno) um heartbeat com `current_version`, `latest_version`, `compare_failed`, changelog, `runtime_confirmation` (`agent.sh:404`). A rota grava em `system_version` (`app/api/v1/system/agent/route.ts`).
4. A tela lê `GET /api/v1/system/version` e mostra o botão. O clique faz `POST /api/v1/system/update` (`app/api/v1/system/update/route.ts`), que **só grava** um run `dispatched` em `system_update_runs` (com `{rollback}` ou `{force}` opcionais). Recusa se a imagem é "personalizada" (`identity.customized`) ou se a execução não foi confirmada.
5. No próximo heartbeat o agente lê o booleano e roda `bash hostgator-setup-kit/update.sh [--to <tag>] [--force]` (`agent.sh:520`; volta em `agent.sh:387`).
6. `update.sh`: `git fetch --tags origin` (`:121`), alvo = `ultima_release_estavel` (`:127`), backup, `git checkout <tag>` (`:323`), grava as imagens `${IMG_NS}/...:<versão>` no `.env` (**IMG_NS = ghcr.io/melgarafael**), `docker compose pull` e `up -d`, aplica migrations, verifica e faz rollback se falhar.
7. O comando manual mostrado na tela é `bash hostgator-setup-kit/update.sh` (`UpdatePanel.tsx:19`).

**Situação da Arvisx hoje:** o deploy é Easypanel (`deploy/arvisx/crm`), **sem kit, sem cron, sem `agent.sh`**. Logo `system_version` nunca é preenchida: o rodapé some (sem versão), e um clique em "Atualizar" (se alguém chegar pela URL) só cria um run `dispatched` que ninguém executa (ou recebe 409 por execução não confirmada). **Risco atual: baixo.** O risco aparece se alguém instalar uma VPS pelo kit: aí tudo aponta para o upstream (`REPO_URL`, `IMG_NS`, `ultima_versao_publicada`).

**Opções para decidir:**
- **(recomendado) Desligar por padrão:** a página e as rotas `system/update` e `system/agent` respondem 404 salvo `ATUALIZACAO_PELA_TELA=on` no `.env`; o `VersionFooter` não mostra o aviso. A atualização da Arvisx é o merge mensal do upstream + build pelo `publish-image` + deploy no Easypanel, como registrado em `ATUALIZACOES.md`.
- **Apontar para o fork:** `IMG_NS=ghcr.io/barrospl`, `REPO_URL` do fork, criar releases `v*` no fork e definir `DESKCOMM_RELEASES_LATEST_URL` com token (repo privado: o `curl` atual não manda token), pacotes GHCR públicos ou login no host. Só faz sentido se a Arvisx for vender instalações em VPS do cliente.

### 7.4 Outros pull/fetch/clone do upstream em código de execução (busca completa)

`git grep -niE "melgarafael|deskcomm\.com\.br|raw\.githubusercontent|api\.github\.com"` fora de docs/evidence/loop/tests/triagem/curso/README/migrations dá **só** os itens da tabela acima, mais:
- `.github/workflows/e2e.yml:17`, `AGENTS.md:177`, `CLAUDE.md:520,598`, `.mailmap`: comandos `gh api repos/melgarafael/...` em comentário/doc (não executam).
- `hostgator-setup-kit/_supabase-images.sh:13` e `install-single-server.sh:22`: baixam do repositório do **Supabase** (legítimo).
- `infra/executor-proprio/instalar.sh:33`: release do `actions/runner` (legítimo).
- **O app (`app/ lib/ components/ hooks/ workers/`) não faz nenhuma requisição a github.com/melgarafael, ghcr.io/melgarafael ou deskcomm.com.br.** O único "telefone para casa" do runtime é o **Sentry padrão** (7.2).

### 7.5 E-mails de terceiros em código de execução

Busca por `[\w.+-]+@[\w.-]+\.[a-z]{2,}` fora de docs/evidence/tests/CHANGELOG/migrations, descartando placeholders (`empresa.com`, `seudominio`, `suaempresa`, `exemplo`, `.test`, `.local`, ids do WhatsApp):

| Arquivo:linha | E-mail | Ação |
|---|---|---|
| `lib/nuvemshop/config.ts:13` | `rafael@maudibrasil.com.br` (no User-Agent enviado à Nuvemshop) | **trocar** por suporte@arvisx.com.br (A) |
| `lib/sentry/dsn.ts:17` | `58fabf8ad5...@o4509908078559232.ingest.us.sentry.io` (DSN, não é e-mail, mas é endereço do upstream) | **trocar/desligar** (E) |
| `scripts/check-user.ts:7`, `scripts/probe-redirect.ts:11` | `demo@deskcomm.com.br` | trocar (dev) |
| `lib/email/resend.ts:14` | `noreply@deskcomm.app` (só em comentário) | pode ficar |
| `scripts/create-test-user.ts:10`, `scripts/reset-user-onboarding.ts:10` | `teste@gmail.com` | dev, pode ficar |
| `scripts/seed-tenant.ts:11` | `joao@lojadojoao.com.br` | dev, pode ficar |
| `ubuntu-local-installer.sh:166` | `admin@admin.com` | dev, pode ficar |
| `.mailmap:55-116` | e-mails de contribuidores (`rafael@maudibrasil.com.br`, `rafael@automatiklabs.com.br`, `consultores@anbro.com.mx`, `felipe_bnt@hotmail.com`, `pompa.07@gmail.com`, `automatikpg@gmail.com`, `root@vpsbr-15867794.vpshostgator.com.br`) | C, não tocar |

Scripts de seed usam `@deskcomm.test` (TLD reservado, inofensivo).

---

## 8. Plano de substituição proposto

Ordem pensada para tirar risco primeiro e tocar o mínimo de arquivos que o upstream edita.

1. **Hoje, sem código (Easypanel):** conferir `APP_IMAGE`, `WORKER_IMAGE`, `SCHEDULER_IMAGE` apontando para `ghcr.io/barrospl/...`; definir `SENTRY_DSN=off` (ou DSN da Arvisx).
2. **PR 1, E crítico (poucos arquivos):** defaults do `deploy/arvisx/crm/docker-compose.easypanel.yml` para as imagens do fork (tag por SHA, conforme `ATUALIZACOES.md`); padrão do Sentry desligado em `lib/sentry/dsn.ts`; desligar `release.yml` no fork.
3. **PR 2, painel de atualização:** desligado por padrão com `ATUALIZACAO_PELA_TELA` (página, rotas `system/update`/`system/agent`, aviso do `VersionFooter`).
4. **PR 3, A no código:** `lib/nuvemshop/config.ts`, `NOME_DO_CLIENTE_SIWC`, `SERVER_NAME`, `NOME_DO_CLIENTE_MCP`, `X-Client-Info`, `package.json`, Dockerfiles (LABEL + title), `.env.example`, `supabase/config.toml` (assuntos), `app/design`, ISSUE_TEMPLATE, FUNDING, SECURITY, CONTRIBUTING; ajustar `MARCA_CONGELADA`/`CONGELADO_SUPABASE` em `tests/unit/branding.test.ts` no mesmo commit. Se a grafia oficial for "Arvisx CRM", trocar `DEFAULT_APP_NAME` e `MARCA_DO_PRODUTO` juntos.
5. **PR 4, B seguro:** webhook de entrada aceita `x-arvisx-signature` + legado e a tela ensina o novo; webhook de saída acrescenta `X-Webhook-Event`; MCP externo envia `X-Arvisx-*` + legado; testes de contrato estendidos.
6. **PR 5, docs de uso:** README próprio da Arvisx, `docs/white-label*`, runbooks, `docs/integracao`, logos.
7. **PR 6 (opcional, decidir antes):** renomear pacotes GHCR para `arvisx-*` + `IMG_NS` + kit (`REPO_URL`, `ultima_versao_publicada`, `COMUNIDADE_URL`, `extensao.sh`) com as catracas `namespace-das-imagens*` e `listas-de-imagens-seguem-matriz`, trocando as variáveis no Easypanel no mesmo deploy. Só vale se a Arvisx for instalar em VPS de cliente pelo kit; senão, manter os nomes de pacote e apenas o dono `barrospl`.

**Fica "deskcomm" de propósito (e por quê):**
- cookies `sb-deskcomm-auth` e `deskcomm-impersonate`, chaves `deskcomm-theme` e `deskcomm.show_ai_citations`: invisíveis; trocar desloga todos ou perde preferência;
- GUCs `deskcomm.*` no banco: invisíveis, sem consumidor externo, recriar funções brigaria com toda migration do upstream;
- prefixo Google `deskcommapp` / `deskcomm.app` e `extendedProperties` `deskcomm_*`: gravados no Google Calendar dos clientes;
- headers `X-Deskcomm-*` legados: continuam saindo ao lado dos novos enquanto houver integrador;
- `X-Client-Id: deskcomm-worker` (WaCalls), redes/routers Docker, marcadores `.deskcomm-*` do kit, caminhos internos de contêiner;
- variáveis `DESKCOMM_*` (aceitar `ARVISX_*` só nas 4 que um operador digita);
- toda a categoria C e toda a D (processo do upstream), para manter o merge mensal barato.

---

## 9. Decisões tomadas em 06-07/11

- **Grafia do nome:** **"ArvisX CRM"** (X maiúsculo), a mesma de `DEFAULT_APP_NAME` em `lib/branding.ts` e de `MARCA_DO_PRODUTO` no teste. Onde as seções acima dizem "Arvisx CRM", vale "ArvisX CRM"; `DEFAULT_APP_NAME` e `MARCA_DO_PRODUTO` não mudam.
- **Pacotes GHCR mantêm os nomes** (`deskcommcrm`, `deskcomm-worker`, `deskcomm-scheduler`, `deskcomm-voice-agent`); só o dono passa a ser `barrospl` (`ghcr.io/barrospl/...`). Motivos: a produção já usa esses pacotes por digest; renomear cria pacotes novos e gera conflito com o upstream a cada merge mensal; o Hermes não precisa trocar nomes de imagem no Easypanel. O PR 6 opcional da seção 8 fica descartado.
- **Contato e relato de segurança:** `suporte@arvisx.com.br` (issue template, `SECURITY.md`, `CONTRIBUTING*.md`, README).
- **Painel de atualização pela tela:** desligado por padrão; `ATUALIZACAO_PELA_TELA=on` liga.
- **Sentry:** padrão desligado (sem DSN do upstream).
- **Categoria D:** só proposta (tabela da seção 6); nada apagado nesta rodada.

## 10. Fechamento da Frente 3 (07/11/2026)

### 10.1 O que foi substituído nesta rodada

- **A (repo/identidade):** `package.json` (name/description), README (o original foi para `docs/upstream/`), `SECURITY.md`, `CONTRIBUTING*.md`, `VISION.md`, `ARCHITECTURE.md`, `.github/ISSUE_TEMPLATE` (contato `suporte@arvisx.com.br`), `.github/FUNDING.yml` removido, `LICENSE` com "Copyright (c) 2026 Arvisx" **abaixo** do copyright original de Rafael Melgaço (MIT mantida), LABEL `org.opencontainers.image.source` e títulos dos 4 Dockerfiles, `app/design`, comentários de CSS, `lib/nuvemshop/config.ts` (User-Agent com `suporte@arvisx.com.br`, sem e-mail de terceiro), `SERVER_NAME`/`NOME_DO_CLIENTE_MCP`/`NOME_DO_CLIENTE_SIWC`, `X-Client-Info: arvisx-crm/admin`, `.env.example`, `.env.hostgator.example`, instaladores Ubuntu, `supabase/config.toml`, docs de uso (`docs/SETUP.md`, `ATUALIZANDO.md`, runbooks, `docs/integracao`, `docs/white-label*`), `scripts/check-user.ts`/`probe-redirect.ts`.
- **B (com compatibilidade):** webhook de entrada aceita `x-arvisx-signature` e continua aceitando `x-deskcomm-signature` (teste `webhook-de-entrada-aceita-o-cabecalho-novo-e-o-legado`); webhook de saída envia `X-Webhook-Event` ao lado dos `X-Deskcomm-*`; MCP externo envia `X-Arvisx-*` ao lado dos legados; kit aceita `ARVISX_BUILD_LOCAL`, `ARVISX_IDIOMA_CLI`, `ARVISX_RELEASES_LATEST_URL`, `ARVISX_ASSUMIR_PROJETO` (vencem os `DESKCOMM_*`, que continuam valendo).
- **E (infra/atualização):** defaults de imagem em `docker-compose.prod.yml`, `.env.hostgator.example` e `IMG_NS` do kit = `ghcr.io/barrospl` (mesmos nomes de pacote, decisão do Lucas); `deploy/arvisx/crm/docker-compose.easypanel.yml` com default `ghcr.io/barrospl/...:main` (a produção continua fixando por digest); âncora `NAMESPACE_DESTE_REPO` e `URL_DESTE_REPO` em `tests/unit/_identidade-deste-repo.ts`; `REPO_URL` de `install.sh`/`comecar.sh`/`ultima_versao_publicada` = `BarrosPL/arvisx-crm` (com `GIT_TERMINAL_PROMPT=0`, porque o repo é privado); link da comunidade do upstream trocado por `suporte@arvisx.com.br`; `extensao.sh` sem origem padrão (exige `EXTENSOES_ORIGEM`); `release.yml` (`cortar-tag`) só roda no upstream; painel "Atualizar pela tela" desligado por padrão (`ATUALIZACAO_PELA_TELA=on` liga; `lib/system/atualizacao-pela-tela.ts`); **Sentry desligado por padrão** (sem DSN embutido; vazio/ausente/`off` = nada é enviado; `lib/sentry/dsn.ts`, linha de boot do servidor e do worker; o `install.sh` não oferece mais "Sentry da comunidade": pergunta só pelo DSN do próprio operador, Enter grava `off`).
- **Catraca nova:** `tests/unit/sem-upstream-em-codigo-de-execucao.test.ts` falha se `melgarafael` ou e-mail de terceiro voltar a código de execução.
- **Fragmento:** `.changes/arvisx-sem-upstream-por-padrao.md` (`exige_acao`).

### 10.2 Lista final do que ficou "deskcomm" de propósito

| O quê | Onde | Motivo |
|---|---|---|
| Nomes dos pacotes GHCR `deskcommcrm`, `deskcomm-worker`, `deskcomm-scheduler`, `deskcomm-voice-agent` | `publish-image.yml`, compose, kit | decisão do Lucas (06/11): a produção usa esses pacotes por digest; renomear cria pacotes novos e conflita com o upstream a cada merge |
| Cookie de sessão `sb-deskcomm-auth` | `lib/supabase/browser.ts:144` e gêmeos | trocar desloga todos os usuários |
| Cookie `deskcomm-impersonate` | `lib/impersonate/cookie*.ts` | invisível; trocar encerra impersonações em curso sem ganho |
| `localStorage` `deskcomm-theme`, `deskcomm.designshowcase.v1`, `deskcomm.show_ai_citations` | front | invisível; trocar só reseta preferência |
| `SUFIXO_ICAL_UID = "deskcomm.app"` e `PREFIXO_PROPRIEDADE = "deskcomm"` | `lib/agenda/google/evento.ts:60,63` | gravados nos eventos já criados no Google Calendar dos clientes; trocar sem dupla leitura duplica/órfã eventos |
| Headers `X-Deskcomm-*` e `x-deskcomm-signature` | webhooks, MCP | legado aceito/enviado ao lado do novo enquanto houver integrador |
| GUCs `deskcomm.*`, schema/role `deskcommapp`/`deskcomm_private` | banco | exigem migração nova que brigaria com toda migration do upstream; invisíveis, sem consumidor externo |
| Variáveis `DESKCOMM_*` | kit e app | lidas em dezenas de pontos; só as 4 que o operador digita ganharam `ARVISX_*` |
| `REPO_DIR=deskcommcrm`, redes/routers Docker, marcadores `.deskcomm-*` do kit, `X-Client-Id: deskcomm-worker` (WaCalls) | kit, compose | viram nome de projeto Compose, cron e contêiner de instalações existentes |
| `scripts/gerar-catalogo-de-extensoes.ts:38` (`extensoes.deskcomm.com.br`), `extensoes/*.json` | dev | o catálogo commitado é o do upstream e `catalogo-de-extensoes-em-dia` o confere; o host (`extensao.sh`) já não tem origem padrão e o app só aceita upload |
| `scripts/cortar-release.ts`, `vigia-colisao-de-migration.ts`, `migration-populacao.sh` | dev | ferramentas do processo do upstream; a última é útil ao fork (mede colisão com o upstream) |
| Comentários históricos (`@melgarafael`, issues `melgarafael/DeskcommCRM#…`, `.github/workflows/e2e.yml`, `scripts/gerar-env-e2e.sh`) | código | contexto histórico, não executa; reescrever encarece o merge |
| Categoria C inteira | LICENSE (copyright original), CHANGELOG, `.all-contributorsrc`, `.mailmap`, baseline/migrations, fixtures | exigência da licença MIT / história |
| Categoria D inteira | evidence/, loop/, triagem/, skills `deskcomm-*`, hooks | só proposta (seção 6); nada apagado sem lista aprovada pelo Lucas |

Depois desta rodada, `git grep -il deskcomm | wc -l` dá 770 arquivos (eram 786); o restante é C, D, B mantido e prosa de docs do processo do upstream.
