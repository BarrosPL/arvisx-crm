# Linha de base do CI da main em f48146e (Tarefa 6, parte 1)

Medido em 24/11/2026 no PR rascunho #25 (`diag/main-baseline`, commit vazio `d1d6e8071` sobre `f48146edb`; árvore idêntica à da main).

- ci da linha de base: https://github.com/BarrosPL/arvisx-crm/actions/runs/45377467730
- e2e da linha de base: https://github.com/BarrosPL/arvisx-crm/actions/runs/45377467482
- Runs anteriores da própria main (push em `f48146edb`, tentativa 2 em 23/11): ci 44401939007, e2e 44401938890.
- Runs dos PRs: os do head de cada PR em 23/11 (ci 452639xxxxx/452640xxxxx/452641xxxxx/452642xxxxx; e2e do #12 45264158086 e do #13 45263936214).

Como foi lido: `gh run view <id> --log-failed`, nome completo de cada teste (arquivo > descrição). Vitest pela linha ` FAIL `; Playwright pelo bloco `N failed` do resumo final de cada parte (a linha `✘` também marca falha esperada, como `degradacao-silenciosa.spec.ts`, que não conta como falha). `F` = vermelho, `ok` = não vermelho.

## Resultado

- ci: a main tem 17 testes vermelhos, em `verify-parte` 2 (9), 4 (1), 6 (3) e 7 (4). Os 13 PRs têm exatamente os mesmos 17, por nome. Nenhuma falha nova em PR.
- `invariants-majors (15)` e `(17)` são vermelhos na main: param em `FATAL: não consegui saber qual é a última release publicada`, antes de rodar `tests/invariants/`. Nos 13 PRs o job `invariants` está verde (correção `CONFERENCIA_KIT_REPO_PAI` e caso 0087, que vivem no #13 e foram propagados).
- e2e: a main tem 7 partes vermelhas (1, 2, 3, 5, 6, 7, 8), 13 casos no run novo e 14 no anterior. A diferença é `marca-logo.spec.ts › o ícone enviado pela tela identifica também o aplicativo instalado`, que oscila na própria main. O #12 tem 13 e o #13 tem 14, todos dentro da lista da main. Nenhuma falha nova em PR.
- Não medido: na parte 1 do e2e da main 15 testes ficaram em `did not run` e na parte 8, 5 (o Playwright não os lista por nome no resumo). O e2e só rodou nos PRs #12 e #13 (únicos com base `main`).

### ci (vitest): teste × (main, #12 … #24)

| # | parte | teste (arquivo > descrição) | main | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | (4) | `app/actions/admin/salvarConfiguracaoDaInstalacao.test.ts > as chaves da cobrança só se escrevem pela tela de Cobrança > controle: a sonda enxerga as seis chaves da cobrança (Stripe e Asaas)` | F | F | F | F | F | F | F | F | F | F | F | F | F | F |
| 2 | (2) | `components/connections/RedesSociaisClient.test.tsx > asks before removing an account from support and keeps it linked` | F | F | F | F | F | F | F | F | F | F | F | F | F | F |
| 3 | (2) | `components/connections/RedesSociaisClient.test.tsx > asks before unlinking the profile and posts unlink on confirm` | F | F | F | F | F | F | F | F | F | F | F | F | F | F |
| 4 | (2) | `components/connections/RedesSociaisClient.test.tsx > ressincroniza o webhook do canal social pela origem atual, sem desconectar` | F | F | F | F | F | F | F | F | F | F | F | F | F | F |
| 5 | (2) | `components/connections/RedesSociaisClient.test.tsx > shows connected networks and offers inbox only where implemented` | F | F | F | F | F | F | F | F | F | F | F | F | F | F |
| 6 | (2) | `components/connections/RedesSociaisClient.test.tsx > shows errors rather than a false empty or connected state` | F | F | F | F | F | F | F | F | F | F | F | F | F | F |
| 7 | (2) | `components/connections/RedesSociaisClient.test.tsx > shows orphaned channels and removes them through the disconnect action, which deletes the provider webhook` | F | F | F | F | F | F | F | F | F | F | F | F | F | F |
| 8 | (2) | `components/connections/RedesSociaisClient.test.tsx > titles the card with the name typed in Renomear, and keeps the username when nobody renamed it` | F | F | F | F | F | F | F | F | F | F | F | F | F | F |
| 9 | (6) | `tests/unit/convite-revogado-nao-da-acesso.test.ts > porta 3 — recoverOrganization recusa quem teve o acesso revogado > instalação aberta e acesso íntegro: provisiona — vacuidade da porta 3` | F | F | F | F | F | F | F | F | F | F | F | F | F | F |
| 10 | (6) | `tests/unit/convite-revogado-nao-da-acesso.test.ts > porta 3 — recoverOrganization recusa quem teve o acesso revogado > ⭐ instalação fechada também recusa a recuperação — a QUARTA porta` | F | F | F | F | F | F | F | F | F | F | F | F | F | F |
| 11 | (6) | `tests/unit/convite-revogado-nao-da-acesso.test.ts > porta 3 — recoverOrganization recusa quem teve o acesso revogado > ⭐ vínculo revogado não vira tenant novo pela tela de recuperação` | F | F | F | F | F | F | F | F | F | F | F | F | F | F |
| 12 | (7) | `tests/unit/evidencia-citada.test.ts > evidência citada > docs/arvisx/prototipo/GUIA-TELAS.md não cita imagem fora do versionamento` | F | F | F | F | F | F | F | F | F | F | F | F | F | F |
| 13 | (7) | `tests/unit/evidencia-citada.test.ts > evidência citada > nenhuma imagem versionada fica sem documento que a justifique` | F | F | F | F | F | F | F | F | F | F | F | F | F | F |
| 14 | (7) | `tests/unit/i18n-espanhol-cobre-a-tela.test.ts > nenhuma prosa em português escapa de t() > toda tela de produto passa o texto por t() antes de renderizar` | F | F | F | F | F | F | F | F | F | F | F | F | F | F |
| 15 | (7) | `tests/unit/i18n-espanhol-cobre-a-tela.test.ts > toda chave usada na tela tem espanhol > nenhuma chamada t() cai no português por falta de tradução` | F | F | F | F | F | F | F | F | F | F | F | F | F | F |
| 16 | (2) | `tests/unit/stripe-modo-teste-em-euro.test.ts > produto e preço em euro a partir do plano > ⭐ 1º Checkout: cria o produto do plano (id previsível, nome, plano_id) e o preço em eur, mensal, no valor do plano` | F | F | F | F | F | F | F | F | F | F | F | F | F | F |
| 17 | (2) | `tests/unit/stripe-modo-teste-em-euro.test.ts > produto e preço em euro a partir do plano > ⭐ valor mudou (plano sem assinantes): o produto é o MESMO, só renomeado, e o preço sai NOVO com o valor novo` | F | F | F | F | F | F | F | F | F | F | F | F | F | F |

### e2e (Playwright, resumo "failed"): teste × (main nova, main antiga, #12, #13)

| # | parte | teste | main 45377467482 | main 44401938890 | #12 45264158086 | #13 45263936214 |
|---|---|---|---|---|---|---|
| 1 | (1) | `tests/e2e/cobranca-asaas.spec.ts > [P0] Asaas: conectar, assinar com CPF/CNPJ, pagar com Pix e cancelar mantendo o período pago` | F | F | F | F |
| 2 | (1) | `tests/e2e/invite-lifecycle.spec.ts > ciclo de vida do convite (ponta a ponta + adversarial) › 10. sem conta → o caminho existe e leva o convite junto` | F | F | F | F |
| 3 | (1) | `tests/e2e/signup-journey.spec.ts > criar conta: signup → e-mail de confirmação → onboarding → re-login` | F | F | F | F |
| 4 | (1) | `tests/e2e/wizard-do-funcionario.spec.ts > o wizard monta um funcionário › o passo do telefone pergunta COMO se conecta antes de assumir o código` | F | F | F | F |
| 5 | (2) | `tests/e2e/aviso-de-caso-no-whatsapp.spec.ts > aviso de caso no WhatsApp › a tela de uma instalação nova: quem entra, o que ela recusa e por quê` | F | F | F | F |
| 6 | (2) | `tests/e2e/cobranca-revendedor.spec.ts > [P0] primeira cobrança: conectar, assinar, atrasar, suspender e voltar sozinho ao pagar` | F | F | F | F |
| 7 | (2) | `tests/e2e/conversa-do-caso.spec.ts > conversar com a IA que abriu o caso › a equipe pergunta, a resposta fica, e quem não pode ver não vê` | F | F | F | F |
| 8 | (2) | `tests/e2e/modelos-cabem-em-375.spec.ts > o formulário de modelo não estoura a tela em 375px, nas duas abas` | F | F | F | F |
| 9 | (3) | `tests/e2e/passagem-com-contexto.spec.ts > a passagem para humano chega com contexto › quem assume vê o motivo, o que a IA tentou e o que o cliente disse` | F | F | F | F |
| 10 | (5) | `tests/e2e/marca-logo.spec.ts > o logo subido pela tela chega à tela › (2) quem NÃO entrou vê o logo do dono na tela de acesso — a P0` | F | F | F | F |
| 11 | (5) | `tests/e2e/marca-logo.spec.ts > o logo subido pela tela chega à tela › o ícone enviado pela tela identifica também o aplicativo instalado` | ok | F | ok | F |
| 12 | (6) | `tests/e2e/redes-sociais-volta-nao-desloga.spec.ts > voltar da autorização de rede social não manda para o /login e mostra o desfecho` | F | F | F | F |
| 13 | (7) | `tests/e2e/navegacao.spec.ts > navegação agrupada › nenhum grupo fica fora da dobra, e em 900px o menu não rola` | F | F | F | F |
| 14 | (8) | `tests/e2e/logo-moldura-no-tema-escuro.spec.ts > a moldura do logo no tema escuro › (2) tema CLARO + logo ENVIADO: NÃO há moldura — as classes são 'dark:'` | F | F | F | F |
