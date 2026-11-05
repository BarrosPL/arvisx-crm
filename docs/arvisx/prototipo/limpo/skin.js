/* Só pele: ícones em traço leve (Phosphor Light) e logo para barra lateral clara. Não mexe em estrutura. */
(function () {
  const trocar = (raiz) => raiz.querySelectorAll("i.ph:not(.ph-light)").forEach((i) => { i.classList.remove("ph"); i.classList.add("ph-light"); });
  const logo = document.querySelector(".lateral .marca img");
  if (logo) logo.src = logo.src.replace("arvisx-crm-oficial-escuro.png", "arvisx-crm-oficial.png");
  trocar(document);
  new MutationObserver(() => trocar(document)).observe(document.body, { childList: true, subtree: true });
})();
