import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * O símbolo oficial da ArvisX como data URI, para os ícones gerados no
 * servidor (favicon em app/icon.tsx e ícone do app em icone-do-app.tsx), onde
 * o `ImageResponse` não carrega arquivo por URL relativa. Lido uma vez por
 * processo; o arquivo vai na imagem junto com `public/`.
 */
function ler(nome: string): string {
  try {
    const bytes = readFileSync(join(process.cwd(), "public", "marca", nome));
    return `data:image/png;base64,${bytes.toString("base64")}`;
  } catch {
    return "";
  }
}

export const SIMBOLO_OFICIAL = ler("arvisx-simbolo.png");
