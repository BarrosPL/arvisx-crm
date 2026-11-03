# Guia para escrever uma tela do protótipo

O protótipo é só visual: cada tela é um HTML estático em `telas/` que reproduz o CONTEÚDO da tela atual
do app (textos, rótulos, colunas, estados, botões) com a identidade visual da ArvisX. Nenhuma função
nova, nenhum texto reescrito: o que o app diz, a tela diz igual.

## Esqueleto obrigatório

```html
<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nome da tela</title>                     <!-- igual ao rótulo do app -->
<meta name="grupo" content="CRM">               <!-- Entrada | Atendimento | CRM | Agente de IA | Canais | Análise | Organização -->
<meta name="ordem" content="30">                <!-- ordem dentro do grupo no índice -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@100..125,500..800&family=JetBrains+Mono:wght@400;500;600&family=Manrope:wght@400;500;600;700;800&display=swap">
<link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web@2.1.1/src/regular/style.css">
<link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web@2.1.1/src/fill/style.css">
<link rel="stylesheet" href="../tokens.css">
<style>/* só o que é específico desta tela */</style>
</head>
<body data-rota="/app/contacts">                <!-- href do destino no app; marca o item ativo no menu -->
<div class="casca">
  <aside class="lateral"></aside>               <!-- shell.js preenche -->
  <div class="principal">
    <header class="topo"></header>              <!-- shell.js preenche -->
    <main class="conteudo">                     <!-- .conteudo.media (1120px) ou .estreita (880px) para formulários -->
      <div class="cabecalho">
        <div>
          <div class="eyebrow">CRM</div>        <!-- grupo ou trilha (ex.: "Configurações · Sua conta") -->
          <h1>Contatos</h1>
          <p>Subtítulo exato do app.</p>
        </div>
        <div class="acoes"><button class="btn secundario"><i class="ph ph-upload-simple"></i>Importar CSV</button><button class="btn primario"><i class="ph ph-plus"></i>Novo contato</button></div>
      </div>
      <div class="fio"></div>                   <!-- a assinatura: hairline com ponto dourado -->
      …conteúdo…
    </main>
  </div>
</div>
<script src="../shell.js"></script>
</body>
</html>
```

Telas públicas (login, onboarding) não usam a casca: ver `telas/login.html`.

## Peças prontas em `tokens.css` (use-as; não invente outras cores)

- Botões: `.btn.primario` (ouro, ação principal, UMA por tela), `.btn.navy`, `.btn.secundario`, `.btn.fantasma`,
  `.btn.perigo`, `.btn.sinal`; tamanhos `.p` `.g`; `.icone` para só ícone; `.bloco` largura total.
- Cartões: `.cartao` com `.cab` / `.corpo` / `.pe`; `.cartao.link` clicável; `.cartao.navy`; `.cartao.ouro` (aviso da IA).
- Indicadores: `.cartao.indicador` com `.rotulo` + `.valor` + `.delta(.ok|.erro)`.
- Grades: `.grade.c2|c3|c4`, `.grade.lateral-dir` (conteúdo + coluna 320px), `.grade.lateral-esq`.
- Etiquetas: `.tag` (+ `.ouro .navy .sinal .ok .aviso .erro .contorno .mono`); `.ia-tag` (anel dourado = coisa da IA).
- Formulário: `.form(.c2)`, `.campo` com `label` + `input|select|textarea` + `.ajuda`; `.caixa` (checkbox);
  `.chave(.ligada)` (switch) dentro de `.linha-chave`; `.busca-linha`.
- Abas e filtros: `.abas` (`aria-selected`), `.segmento` (`aria-pressed`), `.filtros` + `.filtro`, `.chips` + `.chip`.
- Tabela: `.tabela` (th em mono maiúsculo); `.lista` (li com `.texto` + `.dir`).
- Vazio: `.vazio` com `.elo` + h3 + p + botão. Avisos: `.aviso-faixa.info|ouro|ok|aviso|erro`.
- Kanban: `.kanban` > `.coluna` > `.cartoes` > `.card-negocio`. Inbox: `.inbox` > `.conversas` / `.thread` / `.painel-contato`.
- Timeline: `.timeline` (li `.ouro .sinal .ok`). Passos de onboarding: `.passos`.
- Avatares: `.avatar` (+ `.p .g .gg`, `.claro`, `.ia` = anel dourado para agente, `.sinal`).
- Texto: `.apoio`, `.fraco`, `.pequeno`, `.mono`/`.num` (números e datas sempre em mono), `.rotulo`, `h2.secao`, `.link`, `.volta`.

Ícones: Phosphor web, `<i class="ph ph-nome"></i>` (regular) ou `ph-fill ph-nome`.

## Regras

1. **Conteúdo idêntico ao app.** Títulos, subtítulos, botões, colunas, placeholders, estados vazios e avisos
   saem da nota da tela (`notas/<tela>.md`), copiados literalmente. Não melhore o texto.
2. **Dados fictícios plausíveis** quando a nota diz "sem seed": clínica odontológica "Clínica Vitalis"
   (organização), equipe Ana Souza (admin), Marcos Lima, Renata Borges; agentes de IA "Lia — AgendaPlus" e
   "Bot Padrão E2E"; contatos do seed do CRM (Carlos — Clínica Vida Odonto, Marina Costa, Família Andrade,
   Bruno Tavares, Helena Marques, Grupo Odonto Sul, Caio Ribeiro, Patrícia Nunes, Sônia Vasconcelos, Rogério
   Paiva). Nunca nomes reais de clientes. Telefones `+55 11 9xxxx-xxxx`.
3. **Mostre a tela cheia, com dados**, no estado padrão. Estados vazios/erros só quando a tela é vazia por
   natureza ou numa seção pequena. Diálogos: só se a nota pedir ou se forem o centro da tela.
4. **Uma ação primária (ouro) por tela.** O resto é secundário/fantasma. Azul (`--sinal`) só para o que
   chega (não lido, novo, entrada). Ouro = IA e ação. Verde/âmbar/vermelho = estado.
5. **Números, datas, valores, telefones em `.mono`.** `R$ 12.400` sem centavos quando o app faz assim.
6. **Celular (390px) tem de caber**: nada de larguras fixas fora das classes prontas; tabelas largas
   recebem `class="tabela rolavel"` ou viram lista. A casca já cuida do menu e da barra inferior.
7. **Sem JavaScript de comportamento** além do `shell.js`. Sem CSS que mude a casca.
8. Conferir: `node docs/arvisx/prototipo/verificar.mjs <nome>` gera `_shots/<nome>.desktop.png` e
   `.celular.png`; olhe os dois antes de dar por pronta. Depois `node docs/arvisx/prototipo/montar.mjs`.

Referências prontas: `telas/funil-quadro.html` (kanban), `telas/contatos.html` (tabela),
`telas/contato-ficha.html` (ficha com coluna lateral), `telas/crm-hub.html` (hub de cartões),
`telas/negocio-dossie.html` (gaveta lateral), `telas/login.html` (pública).
