TAREFA — Arvisx CRM: página de AJUDA/TREINAMENTO do cliente, dentro do CRM

Repo: BarrosPL/arvisx-crm (fork do DeskcommCRM de Rafael Melgaço). Só a MONTAGEM da página é sua. O conteúdo (textos, fotos, avisos) está pronto no pacote que acompanha esta tarefa. Leia primeiro `ESPECIFICACAO-PARA-CLAUDE.md` (na raiz do pacote): ela detalha o conteúdo, o escopo e as limitações das fotos. Este arquivo diz o que entregar e as regras.

OBJETIVO
O cliente, logado no CRM, abre uma página de ajuda e tira dúvidas de uso: lições passo a passo com foto e destaques, histórias por nicho e busca. Só PT-BR. Cobre tudo que o cliente usa; o que é administração da instalação ficou de fora do pacote.

REGRAS DO LUCAS
- Não toque em produção, Easypanel nem banco. Sem deploy.
- Só existe a branch `main`. Faça commits LOCAIS, em pt-BR, e NÃO dê push: o push na main dispara a build das imagens e o plano do Actions está sem minutos. Avise o Lucas quando estiver pronto para ele decidir.
- Mantenha LICENÇA MIT e os créditos de Rafael Melgaço.
- Não altere o conteúdo: não reescreva textos, não refotografe, não mude o escopo. Se achar erro no conteúdo, liste no relatório final, não corrija por conta.
- Não copie o layout do curso de referência (deskcomm.com.br/curso). Visual do Arvisx: componentes e tokens do próprio CRM; identidade preto-grafite, degradê quente, branco, dourado #D6B32C.
- Fotos mostram dados fictícios. Nunca coloque captura de cliente real.
- Não prometa RGPD pronto, hospedagem na Europa, IA externa ilimitada nem homologação. Nuvemshop e Trunk SIP só podem ser citados como serviços de terceiros que não fazem parte do que o Arvisx vende. Marcas/white-label não entra.

O QUE ENTREGAR
1. Rota autenticada dentro do Ajuda existente (`app/app/ajuda/`, `lib/ajuda/hub.ts`), com `requireAuth` como a página atual. Link no hub de Ajuda e atalho no ⌘K (o catálogo de navegação em `lib/navigation/catalogo.ts` já alimenta o ⌘K).
2. Navegação por módulos, agrupados e ordenados como o menu lateral do app (derive de `lib/navigation/catalogo.ts`, como faz `curso/montar.ts`). Cada módulo → lições → passos.
3. Cada passo mostra: título, texto, dica (se houver), a foto e os destaques desenhados por cima. Os destaques vêm só como medidas em `capturas.json` (base 1440×900, campos `x,y,w,h,rotulo,tipo`); a página desenha caixa/seta/numeração escalando pela largura renderizada. Reaproveite `curso/geometria.ts`. As fotos não têm nada desenhado.
4. Passos sem foto (10: `conexoes`, `meta-ads-conexao`, `conversoes`): mostre o texto do passo e, no lugar da imagem, o `aviso_cliente` de `AVISOS-MODULOS-TECNICOS.json`. Não gere imagem de substituição.
5. Histórias por nicho (26 jornadas × 4 cenas, com foto): seção própria, com cabeçalho da jornada (`titulo`, `empresa`, `contexto`, `resultado`, `nota`) e as 4 cenas (`titulo`, `cliente`, `operacao`, `valor` + foto) e, no fim, os links para as lições relacionadas (`montagem`: `modulo`, `licao`, `porque`). Valide os links.
6. Busca por título e texto de lição e de passo, e por história, com resultado que leva ao passo.
7. Visibilidade: o módulo só aparece para quem vê a tela correspondente no menu lateral (mesma lógica de papel, áreas, módulos e capacidades que o `Sidebar` resolve via `AuthProvider`). NÃO filtre pelo campo `papel` da lição. O cliente administrador vê tudo.
8. Se uma tela citar algo que não está no pacote (ex.: cartão "Servidor MCP externo" em Perfil), não crie link para lição inexistente.
9. Desktop primeiro; deve funcionar em tela estreita (menu recolhível, foto com `max-width:100%`). Imagens com `loading="lazy"`, largura/altura declaradas, `alt` = título do passo.

ONDE POR O CONTEÚDO
- NÃO sobrescreva `curso/licoes/` nem `curso/demonstracoes/` (85 módulos do upstream que os testes e gates do repo usam) e não rode `curso:capturar`, `curso:jornadas` nem `montar.ts` no modo site público. Coloque o pacote em área nova (ex.: `content/ajuda-curso/` para textos e manifestos) e leia dali.
- Valide os textos na carga com os esquemas existentes (`Modulo` em `curso/licao.ts`, `Nicho` em `curso/jornada.ts`). O pacote já passou (68 arquivos, 0 erros).
- As fotos somam ~108 MB (1.184 WebP 2160×1350). Isso aumenta repo e imagem Docker. Antes de decidir, meça e me diga as opções (em `public/`, Git LFS ou fora do Git); não faça push de imagem sem o Lucas aprovar. Por padrão, deixe tudo local e funcionando.

LIMITAÇÕES CONHECIDAS (não corrija, só informe no relatório; detalhes na seção 8 da especificação)
- 14 fotos mantêm a faixa "WhatsApp desconectado" (12 de Conexões, onde é esperado; `equipe--conhecendo-a-equipe--p6`; `radar--assumir-pelo-radar--p3`).
- 7 fotos podem ter modal cortado (lista na especificação).
- Não houve revisão humana imagem a imagem. O Lucas ou a equipe revisa a página montada antes de liberar a clientes.

TESTES E PROVA
- `pnpm typecheck`, `pnpm lint` e testes unitários novos: (a) todo arquivo de foto referenciado existe; (b) todo passo tem foto ou aviso; (c) todos os links história→lição resolvem; (d) busca encontra um título conhecido; (e) nenhum módulo excluído (`marca`, `extensoes`, `servidor-mcp-externo`, `dados-externos`, `plano-e-cobranca`) aparece. Rode também os testes que já existem em `curso/` para provar que não quebrou nada.
- Mudança de UI exige prova visual conforme o `CLAUDE.md` do repo: abra a página no navegador (desktop e estreita), confira busca, navegação, posição dos destaques sobre a foto, passo sem foto e história. Salve em `evidence/<nome-da-entrega>/` sem credenciais nem dados reais. `curl` e arquivo existente não provam UX.

ENTREGA
1. Commits locais (não dê push).
2. Relatório curto: o que foi feito, como rodar, resultado de cada teste, tamanho das fotos e a opção de hospedagem recomendada, e tudo que precisei assumir.
3. Me diga o que o Lucas precisa decidir antes do push.
