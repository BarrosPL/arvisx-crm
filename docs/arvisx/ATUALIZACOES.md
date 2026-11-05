# Atualizações do upstream (DeskcommCRM → fork Arvisx)

Registro de cada vez que o fork trouxe o que o upstream tem de novo: data, SHA do upstream e decisões.
Regra: uma atualização por mês ou por versão, nunca por commit; sempre num merge em branch, nunca direto na `main`.

## 05/11/2026: upstream `04eeb386c` (branch `atualiza-upstream-2026-11`)

Base comum: `820d7e489`. O upstream tinha 1365 commits que o fork não tinha; o fork tinha 30 que o upstream não tem.
Remote `upstream` criado neste clone (`https://github.com/melgarafael/DeskcommCRM.git`, push desativado).

### Conflitos (2) e como foram resolvidos

| Arquivo | Conflito | Decisão |
|---|---|---|
| `components/shell/Sidebar.tsx` | rodapé do menu: borda e padding | Arvisx (`border-sidebar-border p-2`). O resto do arquivo (hunks do upstream) entrou sozinho. |
| `components/ui/tabs.tsx` | fila de abas: `justify-center-safe` (upstream) contra `justify-start` com filete (Arvisx) | Arvisx. Alinhada ao início, a primeira aba nunca sai da rolagem, então o defeito que o upstream corrigiu não existe aqui. Comentário no código. |

Arquivos de identidade que o upstream também mexeu e o Git juntou sem conflito (revisados, nada reverte a marca):
`app/globals.css` (barra de rolagem passou a usar `--color-border`; classes `.cc-onda` do Cold Call), `app/layout.tsx`
(`EstiloDoTemaDaPlataforma`), `components/auth/SignupForm.tsx` (idioma e fuso no cadastro),
`lib/auth/public-paths.ts` (retorno do provedor parceiro e OAuth de servidor MCP), `lib/i18n/dicionario.ts` (chaves novas),
`components/shell/{CommandPalette,PaletaDeDestinos,ContadorDeTarefas,UserMenu}.tsx`.

### Testes que acompanharam a identidade (código intacto, teste ou referência ajustados)

Nenhum teste de identidade (`branding*`, `marca-do-produto`, `tailwind-tokens`) foi alterado. Os ajustes foram só estes:

- `tests/unit/toque-nos-primitivos.test.tsx` (1 linha): a cerca das abas aceita `justify-start` (nossa fila) no lugar de `justify-center-safe`; continua barrando o `justify-center` puro.
- `tests/fixtures/respostas-rapidas-lista-plana-antes-dos-grupos.html` (fixture, o teste `grupos-sem-grupo-e-a-lista-de-hoje.test.tsx` não mudou): a referência byte a byte trazia as classes do upstream e foi regerada com a saída dos componentes Arvisx. Diferença medida tag a tag: mesmo número de tags, texto visível idêntico, mudaram só atributos `class` em 15 tags: 7 chips (Badge: `rounded-full px-3 font-medium` do upstream contra `rounded-md px-2 font-semibold` nosso) e 8 botões fantasma (`rounded-sm text-text hover:bg-accent-soft hover:text-accent font-medium` contra `rounded-md text-text-muted hover:bg-surface-elevated hover:text-text font-semibold`).
- `tests/unit/ajuda-leva-a-telas-que-existem.test.ts`: ver a decisão da Ajuda abaixo.

### Varredura de marca (telas novas)

- Textos visíveis ao usuário, domínios, e-mails de suporte, links de ajuda e vídeos do upstream: **nenhum** achado nos arquivos novos ou alterados (busca por `deskcomm`, `deskcomm.com`, `deskcommcrm.com`, `youtube`, `instagram.com/`, `suporte@`, `rafael`).
- As 24 ocorrências de "deskcomm" que sobraram são identificadores internos e comentários (`sb-deskcomm-auth`, `deskcomm-theme`, `SERVER_NAME = "deskcomm-crm"`, comentários de código). Não aparecem na tela.
- A tela de Ajuda (`/app/ajuda`) não tem link externo nem marca, mas o índice fala de agente de IA e traz o item "Atualizar esta instalação" (bloco "Para quem instala e mantém", só para o dono do servidor, rota `/app/settings/atualizacao`). **Decisão do Lucas (05/11): fora do menu do cliente.** Removido `sidebar: true` do item em `lib/navigation/catalogo.ts` (comentário no código explica como repor); a tela continua no catálogo e alcançável por ⌘K e URL. O teste do upstream (`tests/unit/ajuda-leva-a-telas-que-existem.test.ts`) agora exige o oposto do original: Ajuda no catálogo, no grupo do rodapé, como último item, e SEM `sidebar: true`.
- Cold Call (`modulo: "cold_call"`, desligado por padrão) e Chamadas (`capacidade: "telefonia"`) ficam fora do menu até alguém ligar o módulo. Não entram na landing.

### Migrações

35 migrações novas em `supabase/migrations/` (de `20261029150500_9046` a `20261105215904_9219`), acrescentadas em ordem a
`deploy/arvisx/crm/migracoes-pos-baseline.txt` (agora 57 linhas). Nenhuma migração existente foi editada ou renomeada.
`supabase/baseline.sql` foi atualizado pelo upstream (merge limpo).

Testadas numa cópia descartável (Postgres 17 com pgvector, prelude do `scripts/test-db.sh`):
- Cenário A, banco já implantado (baseline antigo + as 22 migrações atuais, depois as 35 novas): **35 de 35 aplicadas sem erro**.
- Cenário B, instalação nova (baseline novo + 22 + 35): **tudo aplicado sem erro**.
No deploy, o `init.sh` aplica as pendentes com `pg_dump` antes e registra em `public.arvisx_migracoes_aplicadas`.

### Verificação automática (Windows, clone local)

- `pnpm typecheck`: limpo. `pnpm lint`: 0 erros (668 avisos). `pnpm build`: ok.
- `pnpm test:unit`: 3138 arquivos passam, 72 falharam. Reexecutados com timeout alto e comparados com a `main` antes do merge: dos 32 que continuaram vermelhos, 26 também falham na `main` (ambiente Windows: scripts de shell, `curso/*`, timeouts, caminhos com `\`). Os 6 que só falhavam com o merge: `ajuda-leva-a-telas-que-existem` (decisão da Ajuda, acima), `grupos-sem-grupo-e-a-lista-de-hoje` e `toque-nos-primitivos` (corrigidos, acima), e `acesso-revogado-nao-espera-o-cache`, `lgpd-export-endereco`, `lgpd-pacote-do-titular-paridade` (separador de caminho `\` e URL do `pdfjs-dist` no Windows; não tocam em identidade).
- Testes de identidade (`branding*`, `marca-do-produto`, `tailwind-tokens`) passam; nenhum foi alterado.
- Ainda **não** rodado: `pnpm test:db` e e2e (precisam do ambiente de CI), verificação visual na conta `teste-modelo`.

### Protótipos da landing no mesmo commit de registro

`docs/arvisx/prototipo/landing/`: `novo-modelo.html` (landing do novo modelo comercial, ainda protótipo), `exclusao-de-dados.html` (página nova, com os campos de contato da Arvisx em aberto) e rodapé com os três links legais em `termos-de-uso.html` e `privacidade-e-cookies.html`. Não afetam o app. Os textos legais seguem pendentes de revisão do Dr. Renan.

### Antes do deploy (Lucas aprova)

1. Backup do banco do CRM e teste de restauração.
2. Tags de imagem por SHA para app, worker e scheduler (hoje o deploy usa `:latest`).
3. Verificação visual na conta `teste-modelo` (login, menu, kanban, caixa de entrada, agenda, contatos, faturamento, configurações, celular).
4. Deploy com os três serviços juntos e teste de fumaça; volta atrás por tags de SHA.

## Para não repetir o problema

- Atualizar uma vez por mês ou por versão.
- Teste de identidade no CI que falha se aparecer "Deskcomm" em texto visível (ainda por fazer).
