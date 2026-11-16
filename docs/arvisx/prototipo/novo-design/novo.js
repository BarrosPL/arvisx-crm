/*
  Roda depois de ../shell.js nas telas da proposta nova. Não muda conteúdo nem
  posição: só troca o peso dos ícones (Phosphor regular -> duotone) nos que a
  casca injeta, e o logo do menu pela versão para fundo claro.
*/
(function () {
  document.querySelectorAll("i.ph").forEach((i) => i.classList.replace("ph", "ph-duotone"));
  document.querySelectorAll('img[src$="arvisx-crm-oficial-escuro.png"]').forEach((img) => {
    if (img.closest(".lateral")) img.src = img.src.replace("arvisx-crm-oficial-escuro.png", "arvisx-crm-oficial.png");
  });
  new MutationObserver((lista) => {
    for (const m of lista) m.addedNodes.forEach((n) => {
      if (n.nodeType !== 1) return;
      (n.matches?.("i.ph") ? [n] : n.querySelectorAll?.("i.ph") ?? []).forEach((i) => i.classList.replace("ph", "ph-duotone"));
    });
  }).observe(document.body, { childList: true, subtree: true });
})();
