# Referências do "sem grupo é a lista de hoje" (#3245)

Estes dois arquivos foram GERADOS, não escritos à mão: são o `outerHTML` do
componente ANTES desta mudança (`git show HEAD:` dos arquivos), renderizado com
a mesma fixture de respostas rápidas que o teste usa (`tests/unit/grupos-sem-grupo-e-a-lista-de-hoje.test.tsx`).
O `_r_X_` no lugar dos contadores `_r_<n>_` é a única normalização: eles são
gerados por render (React) e mudam a cada montagem, não a cada mudança de
markup — comparar sem normalizar mediria o contador, não a tela.

- `respostas-rapidas-lista-plana-antes-dos-grupos.html` — o `<ul>` da lista de
  respostas da tela `/app/templates` (arrastar e soltar incluídos).
- `respostas-rapidas-barra-plana-antes-dos-grupos.html` — a barra de recursos
  do Inbox.

A prova: com `grupos` vazio, o componente de hoje tem de produzir EXATAMENTE
este HTML. Quando a lista plana mudar de propósito, a referência é regerada —
o que o teste impede é a mudança SILENCIOSA.

## Regerada no design "Folha"

A lista plana mudou de propósito: o `Badge` base (`components/ui/badge.tsx`)
trocou `py-0.5 ... font-semibold` por `py-px ... font-medium`. A referência
`respostas-rapidas-lista-plana-antes-dos-grupos.html` foi atualizada só nessas
duas classes das sete etiquetas; estrutura, ordem, textos e atributos seguem os
de antes dos grupos.

## Regerada no design "Folha suave" (16/11/2026)

Os cantos mudaram de propósito: o `Badge` base passou de `rounded-md ... px-2`
para `rounded-full ... px-2.5`, e o `Button` base de `rounded-md` para
`rounded-full`. A referência foi atualizada só nessas classes das etiquetas e
dos botões; estrutura, ordem, textos e atributos seguem os de antes dos grupos.
