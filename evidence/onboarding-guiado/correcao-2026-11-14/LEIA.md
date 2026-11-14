# Correção de 14/11/2026: a tela antiga do onboarding aparecia no meio do guia

Percurso pela tela (Playwright com o Chrome instalado, `next dev -p 3100`, `ONBOARDING_GUIADO=on`, Supabase local),
pulando cada passo. `percurso.mjs` registra toda navegação e amostra a tela a cada 30 ms.

Antes (main `1374ccf66`):

    ---- clique: Pular por enquanto em /app/connections
    NAV /onboarding
    TELA /onboarding [CASCA DO WIZARD ANTIGO]
    NAV /app/connections
    ...
    ---- clique: Pular em /app/kanban
    NAV /onboarding
    TELA /onboarding [CASCA DO WIZARD ANTIGO]
    ---- fim em /onboarding

Depois:

    ---- clique: Pular por enquanto em /app/connections
    NAV /app/connections
    ---- clique: Pular em /app/ai/agents
    NAV /app/ai/agents
    ---- clique: Pular por enquanto em /app/kanban
    NAV /app/kanban
    ---- clique: Pular em /app/kanban
    NAV /app/inbox
    ---- clique: Pular por enquanto em /app/team
    NAV /app/team
    ---- botões: Recolher o guia | Começar a usar

Páginas antigas abertas direto pela URL, com o guia em andamento (`paginas-antigas.mjs`): `/onboarding` e as
sete páginas `/onboarding/*` devolvem ao CRM, nenhuma desenha a casca do wizard.

Não medido: build de produção (`next build` + `next start`), WhatsApp conectado de verdade e agente criado com
chave de IA real. Os passos foram pulados, não concluídos.
