# Prova pela tela — tarefa 4 dos planos (10/11/2026)

Ambiente: worktree `arvisx-crm-main`, `next dev -p 3100`, Supabase local de
desenvolvimento `arvisx-treinamento` com os cenários das tarefas 2 e 3 mais
`cenario-local.sql` desta pasta (só o "Para quem é" e o "Como funciona" do Equipe
Completa, como em `docs/arvisx/PLANOS.md`). Roteiro Playwright, sem login. Medidas
por ferramenta em `medidas.json`. Sem dados pessoais.

| Captura | O que mostra |
|---|---|
| `01-landing-planos-desktop.png` | Seção Planos (1440 px): Essencial, Standard e Premium com "Começar o teste grátis"; o card do Equipe Completa com "Agendar reunião"; o aviso "Quem cuida dos agentes de IA" dizendo que o Equipe Completa começa por uma reunião. |
| `02-landing-planos-celular-390.png` | A mesma seção em 390 px, rolagem horizontal 0. |
| `03-landing-equipe-completa-desktop.png` | Seção `#agentes`: os três passos novos (reunião, orientação da assinatura, desenvolvimento) e o botão "Agendar reunião com o time Arvisx". |
| `04-landing-equipe-completa-celular-390.png` | A mesma seção em 390 px. |
| `05-agendar-desktop.png` | `/agendar` (1440 px), antes de confirmar: etiqueta e título do Equipe Completa, "Esta reunião é para" / "Não é para" (com a linha de Essencial, Standard e Premium) e o portão com a confirmação nova. |
| `06-agendar-celular-390.png` | `/agendar` em 390 px, rolagem horizontal 0. |

Nas capturas da landing o cabeçalho fixo, o aviso de cookies e o indicador do
`next dev` foram escondidos por CSS só no roteiro, para não cobrirem a seção.

Medidas que importam (`medidas.json`):
- botões dos cards: Essencial, Standard e Premium → `/signup`; Equipe Completa → `/agendar`;
- botão da seção `#agentes` → `/agendar`; links para `/agendar` na landing: 2;
- hero: "IA a partir do Standard, com as credenciais da sua empresa";
- frases "contratado à parte", "orçados em reunião", "combinadas na reunião", "Agentes Arvisx" e "Em todos os planos · IA": 0;
- `/agendar`: frases antigas 0; nenhum `<iframe>` antes da confirmação;
- rolagem horizontal em todas as capturas: 0.

Não provado pela tela: a agenda do Google depois de marcar a confirmação (serviço
externo; coberto com o `<iframe>` em `app/agendar/page.test.tsx`), o comparativo
logado com a frase nova do aviso e a mensagem "Recebemos sua assinatura…" do
painel depois do pagamento (testes unitários).
