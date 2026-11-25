import { ChamadosDoAssistente } from "./_client";
import { UsoDoAssistente } from "./_uso";

export const metadata = { title: "Assistente — Admin Plataforma" };

export default function AdminChamadosPage() {
  return (
    <div className="space-y-10">
      <ChamadosDoAssistente />
      <UsoDoAssistente />
    </div>
  );
}
