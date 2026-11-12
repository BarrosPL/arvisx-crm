"use client";

import { useState } from "react";

import { AGENDA_EMBED } from "@/lib/landing/links";

/**
 * O cartão de /agendar: o portão de confirmação e, depois dele, a agenda do
 * Google incorporada. Igual ao protótipo aprovado
 * (docs/arvisx/prototipo/landing/agendar.html): sem a confirmação de que a
 * reunião é sobre os Agentes Arvisx, os horários não aparecem; com ela,
 * o portão encolhe para uma linha e o <iframe> do Google ganha o espaço. O
 * <iframe> só nasce na primeira confirmação e fica montado se a pessoa
 * desmarcar e marcar de novo, como no protótipo.
 */
export function CartaoDaAgenda() {
  const [confirmado, setConfirmado] = useState(false);
  const [montada, setMontada] = useState(false);

  return (
    <div className={confirmado ? "cartao-agenda confirmado" : "cartao-agenda"}>
      <div className="cab">
        <b id="titulo-agenda">Escolha o melhor horário</b>
        <span>
          <i>30 min</i>
          <i>Google Meet</i>
        </span>
      </div>
      <div className="portao">
        <label>
          <input
            type="checkbox"
            id="confirma"
            checked={confirmado}
            onChange={(e) => {
              setConfirmado(e.target.checked);
              if (e.target.checked) setMontada(true);
            }}
          />
          <span className="longo">
            Confirmo que a reunião é sobre os <b>Agentes Arvisx</b> (agentes de IA sob medida) e
            não para suporte ou para conhecer o CRM.
          </span>
          <span className="curto">
            Reunião sobre os <b>Agentes Arvisx</b>, confirmado.
          </span>
        </label>
        <p>Agendamentos fora desse objetivo podem ser cancelados.</p>
      </div>
      <div className={confirmado ? "agenda on" : "agenda"} id="agenda">
        {montada && (
          <iframe src={AGENDA_EMBED} title="Horários disponíveis para a reunião" loading="lazy" />
        )}
      </div>
      <div className="bloqueado">Marque a confirmação acima para ver os horários disponíveis.</div>
    </div>
  );
}
