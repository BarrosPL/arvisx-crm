/*
  Casca da proposta v2: ilha navy no topo (marca + dock de grupos + busca + pulso da IA + sino + perfil),
  sub-navegação do grupo ativo e barra inferior no celular. Grupos e itens são os do menu do app
  (lib/navigation/catalogo.ts); só muda onde ficam.
  Na tela:  <body data-grupo="atendimento" data-item="Inbox"> <div id="ilha"></div> …
*/
(function () {
  const GRUPOS = [
    { id: "atendimento", nome: "Atendimento", icone: "ph-chat-circle-dots", cont: 3, itens: [
      ["Inbox", "inbox.html"], ["Radar"], ["Agenda"], ["Respostas rápidas"] ] },
    { id: "crm", nome: "CRM", icone: "ph-kanban", itens: [
      ["Funis", "funil.html"], ["Contatos"], ["Tarefas"] ], tudo: "Ver tudo em CRM" },
    { id: "ia", nome: "Agente de IA", icone: "ph-robot", cont: 2, ouro: true, itens: [
      ["Agentes", "agentes.html"], ["Follow-ups"], ["Casos"] ], tudo: "Ver tudo em IA" },
    { id: "canais", nome: "Canais", icone: "ph-plugs-connected", itens: [["Conexões"], ["Webhooks"]] },
    { id: "analise", nome: "Análise", icone: "ph-chart-line-up", itens: [
      ["Desempenho"], ["Meta Ads"], ["Atividades"] ], tudo: "Ver tudo em Análise" },
  ];
  const b = document.body;
  const ativo = b.dataset.grupo, item = b.dataset.item;
  const alvo = (g) => (g.itens[0][1] || "#");

  const dock = GRUPOS.map((g) =>
    `<a href="${alvo(g)}" ${g.id === ativo ? 'aria-current="page"' : ""}><i class="ph ${g.icone}"></i><span class="t">${g.nome}</span>${g.cont ? `<span class="n${g.ouro ? " ouro" : ""}">${g.cont}</span>` : ""}</a>`).join("");

  const g = GRUPOS.find((x) => x.id === ativo);
  const sub = g ? g.itens.map(([n, h]) => `<a href="${h || "#"}" ${n === item ? 'aria-current="page"' : ""}>${n}</a>`).join("") +
    (g.tudo ? `<a class="tudo" href="#">${g.tudo}<i class="ph ph-arrow-right"></i></a>` : "") : "";

  const baixo = GRUPOS.map((x) =>
    `<a href="${alvo(x)}" ${x.id === ativo ? 'aria-current="page"' : ""}><i class="ph ${x.icone}"></i>${x.nome.replace("Agente de IA", "IA")}</a>`).join("");

  document.getElementById("ilha").outerHTML = `
  <header class="ilha">
    <a class="marca" href="index.html"><img src="../marca/arvisx-crm-oficial-escuro.png" alt="ARVISX CRM"></a>
    <nav class="dock" aria-label="Menu principal">${dock}</nav>
    <div class="lado">
      <div class="pulso" title="Atendimento automático"><span class="anel"></span>Automático · 4</div>
      <div class="busca-k"><i class="ph ph-magnifying-glass"></i>Buscar…<kbd>⌘K</kbd></div>
      <button class="icone-i" aria-label="Alertas"><i class="ph ph-bell"></i><span class="ponto">4</span></button>
      <button class="icone-i" aria-label="Configurações"><i class="ph ph-gear-six"></i></button>
      <div class="eu"><span class="avatar">AS</span><span class="nome">Ana Souza</span><span class="org">· Clínica Vitalis</span></div>
    </div>
  </header>
  <nav class="subnav" aria-label="${g ? g.nome : ""}">${sub}</nav>
  <nav class="barra-baixo" aria-label="Menu">${baixo}</nav>`;

  // abas da gaveta do inbox
  document.querySelectorAll("[data-abas]").forEach((cx) => {
    const botoes = cx.querySelectorAll("[role=tab]"), paineis = cx.querySelectorAll(".painel");
    botoes.forEach((bt, i) => bt.addEventListener("click", () => {
      botoes.forEach((o, j) => { o.setAttribute("aria-selected", j === i); paineis[j].classList.toggle("ativo", j === i); });
    }));
  });
  // pílulas e segmentos de alternância
  document.querySelectorAll(".seg").forEach((s) => s.addEventListener("click", (e) => {
    const bt = e.target.closest("button"); if (!bt) return;
    s.querySelectorAll("button").forEach((o) => o.setAttribute("aria-pressed", o === bt));
  }));
})();
