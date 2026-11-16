/*
  Roda depois de ../shell.js nas telas da proposta "Folha". Não muda conteúdo nem
  posição: só troca o peso dos ícones (Phosphor regular -> light) nos que a
  casca injeta, e o logo do menu pela versão para fundo claro.
*/
(function () {
  const afinar = (raiz) => (raiz.matches?.("i.ph") ? [raiz] : raiz.querySelectorAll?.("i.ph") ?? []).forEach((i) => i.classList.replace("ph", "ph-light"));
  afinar(document);
  // o menu agora é claro: logo e símbolo passam para a arte de fundo claro
  document.querySelectorAll('.lateral img[src$="-oficial-escuro.png"]').forEach((img) => {
    img.src = img.src.replace("-oficial-escuro.png", "-oficial.png");
  });
  new MutationObserver((lista) => {
    for (const m of lista) m.addedNodes.forEach((n) => n.nodeType === 1 && afinar(n));
  }).observe(document.body, { childList: true, subtree: true });
})();
