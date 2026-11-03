// Servidor estático mínimo para abrir o protótipo no navegador.
// Uso: node docs/arvisx/prototipo/servir.mjs [porta]  →  http://localhost:8766/
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = dirname(fileURLToPath(import.meta.url));
const porta = Number(process.argv[2] || 8766);
const tipos = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json" };

createServer(async (req, res) => {
  try {
    let caminho = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (caminho.endsWith("/")) caminho += "index.html";
    const arquivo = normalize(join(raiz, caminho));
    if (!arquivo.startsWith(raiz)) throw new Error("fora da raiz");
    await stat(arquivo);
    const corpo = await readFile(arquivo);
    res.writeHead(200, { "Content-Type": tipos[extname(arquivo)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(corpo);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("não achei " + req.url);
  }
}).listen(porta, "127.0.0.1", () => console.log(`protótipo em http://localhost:${porta}/`));
