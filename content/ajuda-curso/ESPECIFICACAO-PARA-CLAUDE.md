# Especificação: página de treinamento do Arvisx CRM (para o Claude montar)

Só a **montagem** fica com você (a tarefa completa está em `TAREFA-CLAUDE.md`, na raiz deste pacote). Conteúdo, fotos e textos já estão prontos neste pacote (checados por validação de esquema, varredura automática de imagens e amostras visuais; não houve revisão humana imagem a imagem). Não reescreva texto, não refotografe, não mude o escopo.

## 1. O que é
Uma página de ajuda/treinamento **dentro do CRM, para o cliente** tirar dúvidas de uso (PT-BR apenas), com 58 módulos de lições passo a passo e 26 histórias por nicho. O escopo é tudo que o cliente usa no CRM; o que é de quem administra a instalação ficou de fora (seção 5). Reaproveita as **informações** do curso de referência. **Não copie o layout dele**: use o visual do Arvisx (preto-grafite, degradê quente, branco, dourado `#D6B32C`).

## 2. Conteúdo do pacote
| Pasta/arquivo | O que tem |
|---|---|
| `licoes/textos/<modulo>.json` | 58 módulos → lições → passos (`id`, `titulo`, `rota`, `texto`, `dica`, `destaques`, `antes`). Já validados pelo esquema Zod `Modulo` do repo (`curso/licao.ts`). |
| `licoes/capturas/*.webp` + `licoes/capturas.json` | 1.080 fotos 2160×1350 (16:10, WebP q80). Chave: `<modulo>--<licao>--<passo>`. O JSON traz `largura`/`altura` base (1440×900) e, por foto, `destaques` com `x,y,w,h,rotulo,tipo`. |
| `historias/textos/<nicho>.json` | 10 nichos, 26 jornadas × 4 cenas (`chegada`, `qualificacao`, `acao`, `continuidade`), já validados pelo esquema `Nicho` (`curso/jornada.ts`). |
| `historias/capturas/*.webp` + `capturas.json` | 104 de 104 cenas com foto. |
| `AVISOS-MODULOS-TECNICOS.json` | Passos sem foto, por módulo, com o `aviso_cliente` pronto para exibir no lugar da imagem. |
| `RELATORIO.md`, `licoes/AJUSTES-DE-TEXTO.md` | Contagens e o que foi adaptado em relação à referência. |

## 3. As fotos NÃO têm setas nem caixas desenhadas
Os destaques estão só como medidas em `capturas.json` (coordenadas na base 1440×900). A página desenha caixas/numeração por cima da foto, escalando as medidas pela largura renderizada. O motor do repo já faz isso (`curso/montar.ts`, `curso/geometria.ts`); reaproveite.

## 4. Passos sem foto (10)
- 10 passos em 3 módulos: `conexoes` (5), `meta-ads-conexao` (4) e `conversoes` (1). Mostre o `aviso_cliente` do `AVISOS-MODULOS-TECNICOS.json` no lugar da imagem, junto com o texto do passo. Não gere imagem de substituição.
- Não afirme que esses passos foram "testados" ou "validados".

## 5. Escopo: o que NÃO entra
- Módulo **Marcas** e qualquer coisa de *white-label* (a função será desativada).
- Admin de plataforma e atualização de servidor.
- Módulos de quem administra a instalação, já removidos do pacote: Extensões, Servidor MCP externo e Dados externos. **Plano e cobrança** está em espera até as condições comerciais serem definidas. As 4 jornadas que dependiam deles também saíram (contabilidade-situacao-guia, e-commerce-consultar-pedido, seguros-renovacao, servicos-retirada).
- Se o Perfil ou outra tela citar um desses itens (ex.: cartão "Servidor MCP externo" em Dados e acesso), é só a descrição do que a tela mostra; não crie link para uma lição que não existe.
- Nuvemshop e Trunk SIP: só citar como serviços de terceiros que **não fazem parte** do que o Arvisx vende.
- Não prometer RGPD pronto, hospedagem na Europa, IA externa ilimitada ou homologação. IA depende da conta/chave e dos custos do cliente.

## 6. Onde vive no produto (proposta, não implantado)
- Rota protegida de ajuda (o repo já tem `app/app/ajuda/` e `lib/ajuda/hub.ts`); link no hub de Ajuda e atalho no ⌘K.
- Menu lateral do curso derivado de `lib/navigation/catalogo.ts`, como já faz o `montar.ts`.
- Fotos servidas como estáticos; busca por título de lição/passo; módulos agrupados como o menu do app.
- Visibilidade por usuário: o módulo só aparece para quem vê a tela correspondente no menu lateral (mesmas regras de papel, áreas, módulos e capacidades que o `Sidebar` já resolve via `AuthProvider`). **Não use o campo `papel` da lição como filtro**: ele só indica com qual perfil a foto foi tirada. O cliente administrador vê tudo.

## 7. Regras de qualidade
- Imagens com `loading="lazy"`, largura/altura declaradas (sem salto de layout), `alt` = título do passo.
- Textos em PT-BR, sem inglês solto na interface da página. Termos técnicos (Webhooks, API Tokens, Follow-ups) seguem como aparecem no CRM.
- Fotos mostram dados fictícios (clínica Bem Viver e demos por nicho). Nunca troque por captura de cliente real.
- Rodar `typecheck` e os testes do repo antes de abrir PR. Não publicar nem fazer deploy sem aprovação do Lucas.

## 8. Limitações conhecidas das fotos (informe, não "corrija")
- A faixa "WhatsApp … está desconectado" foi escondida nas fotos de uso (organização fictícia, sem WhatsApp real). Aparece em 14: as 12 de Conexões, onde é esperado, e `equipe--conhecendo-a-equipe--p6` e `radar--assumir-pelo-radar--p3`, que dependem de uma ação que grava e não foi refeita. Essa ocultação é só visual, para a foto: não prova WhatsApp conectado.
- Modais altos: 17 fotos foram refeitas com janela maior (1800×1125, mesma proporção 16:10) para o formulário aparecer inteiro. Em 7 não deu para refazer e podem mostrar o formulário cortado: `api-tokens--criar-um-token--p4`, `conhecimento--conhecimento-ensinar-algo-novo--p5`, `contatos--editar-e-excluir--p2`, `prospeccao--escolher-as-empresas--p2`, `respostas-rapidas--visao-do-atendente--p2`, `skills--skills-editar-uma-skill--p5` e `p6`. Em algumas fotos refeitas (ex.: `follow-ups--instalar-um-modelo--p2`) a lista interna do modal ainda rola e o último cartão aparece parcial: é rolagem interna, não erro.
- As medidas de destaque das fotos refeitas já estão convertidas para a base 1440×900; use-as como as demais.
- Telas com "Sem permissão" (403) são intencionais (papel sem acesso).
- Não houve revisão humana imagem a imagem.
