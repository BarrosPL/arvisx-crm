# Guia de uso (treinamento do cliente) — prova pela tela

Ambiente: `next dev` em `localhost:3100` sobre um Supabase local novo com o
`supabase/baseline.sql` e as migrações de `deploy/arvisx/crm/migracoes-pos-baseline.txt`,
dono criado por `scripts/bootstrap-owner.ts` e uma atendente (papel `agent`) na
mesma organização fictícia. Capturas com Playwright em 1440×900 e 390×844.
Nenhum dado real: as fotos dentro da página são do pacote (dados fictícios).

| Arquivo | O que prova |
|---|---|
| `hub-ajuda-admin-1440.png`, `hub-ajuda-admin-390.png` | cartão do Guia de uso no hub de Ajuda; link "Guia de uso" no rodapé do menu |
| `inicio-admin-1440.png`, `inicio-admin-390.png` | início: menu de módulos agrupado como o menu do app, busca, cartões |
| `busca-nota-interna-1440.png`, `busca-nota-interna-390.png` | busca por "nota interna": lição e passos, com o caminho até o passo |
| `inbox-passo-com-destaques-1440.png`, `inbox-passo-com-destaques-390.png` | passo com foto: caixas e números desenhados por cima, legenda abaixo |
| `conexoes-passo-sem-foto-1440.png`, `conexoes-passo-sem-foto-390.png` | passo sem foto: texto do passo e o `aviso_cliente` no lugar da imagem |
| `historia-advocacia-1440.png`, `historia-advocacia-390.png` | história: cabeçalho da jornada, cenas com foto e links para as lições |
| `menu-aberto-390.png` | tela estreita: o menu de módulos recolhe atrás de um botão |
| `inicio-atendente-1440.png` | atendente vê menos módulos (sem Prospecção, Agentes, Conexões…) |
| `conexoes-atendente-sem-acesso-1440.png` | módulo fora do menu da atendente, aberto por URL: aviso, sem conteúdo |
