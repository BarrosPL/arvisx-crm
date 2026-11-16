/*
  Casca do painel do administrador da instalação (/admin/**): tarja "MODO
  PLATAFORMA", menu lateral e barra de cima com a busca. A lista de destinos é a
  de lib/admin/navegacao.ts (o menu do app renderiza a lista corrida, sem título
  de grupo); os textos são os de components/admin/AdminSidebar.tsx, AdminShell.tsx
  e PlatformModeBanner.tsx.

  Uso na tela (igual ao shell.js, trocando o script):
    <body data-rota="/admin/tenants">
      <div class="casca"><aside class="lateral"></aside>
        <div class="principal"><header class="topo"></header>
          <main class="conteudo">…</main>
        </div></div>
      <script src="../shell-admin.js"></script>
*/
(function () {
  const ITENS = [
    ["/admin/dashboard", "Dashboard", "ph-gauge"],
    ["/admin/inbox", "Inbox", "ph-chats-circle"],
    ["/admin/incidents", "Incidents", "ph-warning"],
    ["/admin/audit", "Audit", "ph-clipboard-text"],
    ["/admin/lgpd", "LGPD", "ph-scales"],
    ["/admin/tenants", "Tenants", "ph-buildings"],
    ["/admin/users", "Users", "ph-users"],
    ["/admin/platform-admins", "Platform Admins", "ph-shield-check"],
    ["/admin/usage", "Usage", "ph-chart-bar"],
    ["/admin/google", "Google Agenda", "ph-calendar-blank"],
    ["/admin/meta", "API Oficial (Meta)", "ph-webhooks-logo"],
    ["/admin/email", "E-mail", "ph-envelope-simple"],
    ["/admin/destinos-internos", "Destinos internos", "ph-plugs"],
    ["/admin/marca", "Marca", "ph-palette"],
    ["/admin/cadastro", "Cadastro", "ph-key"],
    ["/admin/configuracao", "Credenciais", "ph-lock"],
    ["/admin/sistema", "Recursos opcionais", "ph-gear"],
    ["/admin/extensoes", "Extensões", "ph-puzzle-piece"],
    ["/admin/modulos", "Módulos", "ph-stack"],
    ["/admin/cobranca", "Cobrança", "ph-receipt"],
  ];
  const EMAIL = "ana.souza@clinicavitalis.com.br";
  const rota = document.body.dataset.rota || "";
  const ativo = (href) => rota === href || rota.startsWith(href + "/");
  const raiz = document.body.dataset.raiz || "..";

  const casca = document.querySelector(".casca");
  if (casca && !document.querySelector(".modo-plataforma")) {
    const tarja = document.createElement("div");
    tarja.className = "modo-plataforma";
    tarja.setAttribute("role", "region");
    tarja.setAttribute("aria-label", "Modo Plataforma");
    tarja.style.cssText = "position:sticky;top:0;z-index:40;display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 16px;background:var(--navy);color:#fff;font-size:12px";
    tarja.innerHTML = `<i class="ph ph-shield-check" style="font-size:16px"></i><span style="font-weight:600">MODO PLATAFORMA</span><span class="so-largo" style="opacity:.8">— operação cross-tenant</span><a href="#" style="margin-left:auto;color:#fff;text-decoration:underline;text-underline-offset:3px">Sair pra app pessoal</a>`;
    casca.parentElement.insertBefore(tarja, casca);
  }

  const lateral = document.querySelector("aside.lateral");
  if (lateral) {
    lateral.innerHTML = `
      <div class="marca" style="gap:10px"><img src="${raiz}/marca/arvisx-simbolo-oficial-escuro.png" alt="" style="height:30px;width:auto"><div style="display:flex;flex-direction:column;line-height:1.25;min-width:0"><span class="marca-nome" style="font-size:11px;opacity:.7">ArvisX CRM</span><span class="marca-painel" style="font-weight:600;font-size:13px">Admin Plataforma</span></div></div>
      <nav aria-label="Navegação plataforma">
        <div class="grupo"><ul>
          ${ITENS.map(([href, label, icone]) => `<li><a href="#" ${ativo(href) ? 'aria-current="page"' : ""} title="${label}"><i class="ph ${icone}"></i><span>${label}</span></a></li>`).join("")}
        </ul></div>
      </nav>
      <div class="rodape">
        <a href="#"><i class="ph ph-arrow-right"></i><span>Voltar pra app</span></a>
        <div class="versao"><span title="${EMAIL}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${EMAIL}</span></div>
      </div>`;
  }

  const topo = document.querySelector("header.topo");
  if (topo) {
    topo.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;min-width:0">
        <button type="button" class="icone menu-cel" aria-label="Abrir menu de navegação"><i class="ph ph-list"></i></button>
        <span class="so-celular" style="font-weight:600">Admin Plataforma</span>
      </div>
      <button type="button" class="busca" aria-label="Buscar telas da instalação" style="margin-left:auto"><i class="ph ph-magnifying-glass"></i><span>Buscar...</span><kbd>⌘K</kbd></button>`;
  }

  const estilo = document.createElement("style");
  estilo.textContent = ".so-celular{display:none}@media (max-width:860px){.so-celular{display:inline}.modo-plataforma .so-largo{display:none}}";
  document.head.appendChild(estilo);
})();
