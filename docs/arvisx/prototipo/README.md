# Protótipo de redesign do ArvisX CRM (lado do cliente)

Só visual. Cada tela em `telas/*.html` repete o conteúdo da tela atual do app (textos, colunas,
botões, estados) com a identidade da ArvisX: navy `#0F131A`, ouro `#D4AF37`, off-white `#F7F6F2`,
Archivo nos títulos, Manrope no texto, JetBrains Mono nos números. Nenhuma funcionalidade muda.

## Abrir

1. `node docs/arvisx/prototipo/montar.mjs` gera o `index.html` (lista de telas + visor desktop/celular).
2. `node docs/arvisx/prototipo/servir.mjs` e abra http://localhost:8766/ (ou abra `index.html` direto;
   fontes e ícones vêm da internet).

## Conferir

`node docs/arvisx/prototipo/verificar.mjs [nome]` renderiza cada tela em 1440×900 e 390×844 com o
Chrome da máquina e grava em `_shots/` (fora do git).

## Arquivos

- `tokens.css` — tokens e peças (botões, cartões, tabela, kanban, inbox, formulários, celular).
- `shell.js` — menu lateral, barra de cima e barra inferior do celular, injetados em cada tela.
- `GUIA-TELAS.md` — como escrever uma tela nova no mesmo padrão.
- `marca/` — símbolo e logo da ArvisX.
