import { QUEM_CUIDA_DOS_AGENTES } from "@/lib/cobranca/quem-cuida-dos-agentes";

/**
 * O aviso "Quem cuida dos agentes de IA" (ArvisX, tarefa 3 dos planos): o MESMO
 * componente na landing (abaixo da grade de planos) e no `ComparativoDosPlanos`
 * (acima dos cards), com as frases de `lib/cobranca/quem-cuida-dos-agentes.ts`.
 *
 * Sem hook de propósito: a landing é componente de servidor. Quem tem tradutor
 * (o comparativo) passa `t`; a landing, que é só em português, não passa.
 * `variante` só escolhe a roupa: Tailwind no app, `.lp .quem-cuida` na landing.
 */
export function QuemCuidaDosAgentes({
  variante,
  t = (texto) => texto,
}: {
  variante: "app" | "landing";
  t?: (texto: string) => string;
}) {
  const app = variante === "app";
  return (
    <section
      data-quem-cuida-dos-agentes
      aria-label={t(QUEM_CUIDA_DOS_AGENTES.titulo)}
      className={app ? "space-y-3 rounded-lg border bg-muted/40 p-4 text-sm" : "quem-cuida"}
    >
      <h3 className={app ? "font-semibold" : undefined}>{t(QUEM_CUIDA_DOS_AGENTES.titulo)}</h3>
      <dl className={app ? "grid gap-3 md:grid-cols-3" : undefined}>
        {QUEM_CUIDA_DOS_AGENTES.itens.map((item) => (
          <div key={item.id} data-planos={item.id} className={app ? "min-w-0 space-y-1" : undefined}>
            <dt className={app ? "font-medium" : undefined}>{t(item.planos)}</dt>
            <dd className={app ? "text-muted-foreground" : undefined}>{t(item.texto)}</dd>
          </div>
        ))}
      </dl>
      <p data-consumo className={app ? "text-xs text-muted-foreground" : "qc-consumo"}>
        {t(QUEM_CUIDA_DOS_AGENTES.consumo)}
      </p>
    </section>
  );
}
