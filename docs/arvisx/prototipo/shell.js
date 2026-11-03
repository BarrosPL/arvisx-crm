/*
  Casca do protótipo: injeta o menu lateral, a barra de cima e a barra inferior
  do celular em cada tela. A tela declara em <body data-rota="/app/inbox"> qual
  destino está ativo; grupos, rótulos e ordem vêm de lib/navigation/catalogo.ts
  do app (só os destinos com `sidebar: true` mais o link do hub, como o app faz).

  Uso na tela:
    <body data-rota="/app/inbox" data-titulo="Inbox">
      <div class="casca"><aside class="lateral"></aside>
        <div class="principal"><header class="topo"></header>
          <main class="conteudo">…</main>
        </div></div>
      <script src="../shell.js"></script>
*/
(function () {
  const GRUPOS = [
    { id: "atendimento", label: "Atendimento", itens: [
      ["/app/inbox", "Inbox", "ph-tray", { cont: 3 }],
      ["/app/radar", "Radar", "ph-clock-countdown"],
      ["/app/agenda", "Agenda", "ph-calendar-blank"],
      ["/app/templates", "Respostas rápidas", "ph-file-text"],
    ]},
    { id: "crm", label: "CRM", hub: ["/app/crm", "Ver tudo em CRM"], itens: [
      ["/app/kanban", "Funis", "ph-kanban"],
      ["/app/contacts", "Contatos", "ph-users"],
      ["/app/tasks", "Tarefas", "ph-list-checks"],
    ]},
    { id: "ia", label: "Agente de IA", hub: ["/app/ai", "Ver tudo em IA"], itens: [
      ["/app/ai/agents", "Agentes", "ph-robot"],
      ["/app/ai/followups", "Follow-ups", "ph-flow-arrow"],
      ["/app/ai/cases", "Casos", "ph-clipboard-text", { cont: 2, ouro: true }],
    ]},
    { id: "canais", label: "Canais", itens: [
      ["/app/connections", "Conexões", "ph-plugs-connected", { ponto: true }],
      ["/app/webhooks", "Webhooks", "ph-webhooks-logo"],
    ]},
    { id: "analise", label: "Análise", hub: ["/app/analise", "Ver tudo em Análise"], itens: [
      ["/app/metrics", "Desempenho", "ph-chart-bar"],
      ["/app/ads/meta", "Meta Ads", "ph-megaphone"],
      ["/app/activities", "Atividades", "ph-clock-counter-clockwise"],
    ]},
  ];
  const RODAPE = ["/app/settings", "Configurações", "ph-gear"];
  const ABAS_CELULAR = [
    ["/app/inbox", "Inbox", "ph-tray"],
    ["/app/kanban", "Funis", "ph-kanban"],
    ["/app/agenda", "Agenda", "ph-calendar-blank"],
    ["/app/metrics", "Desempenho", "ph-chart-bar"],
  ];
  const ORG = { nome: "Clínica Vitalis", sigla: "CV" };
  const USUARIO = { nome: "Ana Souza", sigla: "AS" };

  const rota = document.body.dataset.rota || "";
  const ativo = (href) => rota === href || rota.startsWith(href + "/");
  const raiz = document.body.dataset.raiz || "..";

  function item([href, label, icone, extra]) {
    extra = extra || {};
    let sufixo = "";
    if (extra.cont) sufixo = `<span class="cont${extra.ouro ? " ouro" : ""}">${extra.cont}</span>`;
    if (extra.ponto) sufixo = `<span class="ponto" title="Conexão no ar"></span>`;
    return `<li><a href="#" ${ativo(href) ? 'aria-current="page"' : ""} title="${label}"><i class="ph ${icone}"></i><span>${label}</span>${sufixo}</a></li>`;
  }

  const lateral = document.querySelector("aside.lateral");
  if (lateral) {
    lateral.innerHTML = `
      <div class="marca"><img src="${raiz}/marca/arvisx-crm-oficial-escuro.png" alt="ARVISX CRM" style="height:26px;width:auto"></div>
      <nav aria-label="Navegação principal">
        ${GRUPOS.map((g) => `
          <div class="grupo" data-grupo="${g.id}">
            <button type="button" aria-expanded="true">${g.label}<i class="ph ph-caret-down"></i></button>
            <ul>
              ${g.itens.map(item).join("")}
              ${g.hub ? `<li><a href="#" class="hub" ${rota === g.hub[0] ? 'aria-current="page"' : ""}><i class="ph ph-arrow-right"></i><span>${g.hub[1]}</span></a></li>` : ""}
            </ul>
          </div>`).join("")}
      </nav>
      <div class="rodape">
        <a href="#" ${ativo(RODAPE[0]) ? 'aria-current="page"' : ""}><i class="ph ${RODAPE[2]}"></i><span>${RODAPE[1]}</span></a>
        <div class="versao"><span>Versão 1.2.3</span><button type="button" title="Recolher sidebar" aria-label="Recolher sidebar"><i class="ph ph-caret-double-left"></i></button></div>
      </div>`;
    lateral.querySelectorAll(".grupo > button").forEach((b) => {
      b.addEventListener("click", () => {
        const g = b.parentElement;
        g.classList.toggle("fechado");
        b.setAttribute("aria-expanded", String(!g.classList.contains("fechado")));
      });
    });
    const recolher = lateral.querySelector(".versao button");
    recolher.addEventListener("click", () => {
      const casca = document.querySelector(".casca");
      casca.classList.toggle("recolhida");
      const r = casca.classList.contains("recolhida");
      recolher.innerHTML = `<i class="ph ${r ? "ph-caret-double-right" : "ph-caret-double-left"}"></i>`;
      recolher.title = recolher.ariaLabel = r ? "Expandir sidebar" : "Recolher sidebar";
    });
  }

  const topo = document.querySelector("header.topo");
  if (topo) {
    topo.innerHTML = `
      <div style="display:flex;align-items:center;gap:4px;min-width:0">
        <button type="button" class="icone menu-cel" aria-label="Abrir navegação"><i class="ph ph-list"></i></button>
        <button type="button" class="org" aria-label="Selecionar org"><span class="sigla">${ORG.sigla}</span><span class="nome">${ORG.nome}</span><i class="ph ph-caret-up-down"></i></button>
      </div>
      <button type="button" class="busca" aria-label="Buscar telas"><i class="ph ph-magnifying-glass"></i><span>Buscar...</span><kbd>⌘K</kbd></button>
      <div class="acoes">
        <button type="button" class="icone" aria-label="Central de avisos — 4 em aberto"><i class="ph ph-bell"></i><span class="cont">4</span></button>
        <button type="button" class="icone idioma" aria-label="Idioma: PT — Português (BR)">PT</button>
        <button type="button" class="icone" aria-label="Tema: claro. Cmd+Shift+L para alternar."><i class="ph ph-sun"></i></button>
        <button type="button" class="usuario" aria-label="Menu do usuário"><span class="avatar claro">${USUARIO.sigla}</span><i class="ph ph-caret-down" style="font-size:12px;color:var(--fraco)"></i></button>
      </div>`;
  }

  if (document.querySelector(".casca") && !document.querySelector(".barra-inferior")) {
    const nav = document.createElement("nav");
    nav.className = "barra-inferior";
    nav.setAttribute("aria-label", "Navegação rápida");
    nav.innerHTML = ABAS_CELULAR.map(([href, label, icone]) =>
      `<a href="#" ${ativo(href) ? 'aria-current="page"' : ""}><i class="ph ${icone}"></i>${label}</a>`).join("") +
      `<a href="#" aria-label="Mais"><i class="ph ph-dots-three-outline"></i>Mais</a>`;
    document.body.appendChild(nav);
  }
})();
