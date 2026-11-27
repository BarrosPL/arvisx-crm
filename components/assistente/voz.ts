/**
 * A VOZ DO VIX no navegador: a pessoa fala (reconhecimento de fala) e o Vix pode
 * responder em voz alta (síntese de fala). Tudo roda no aparelho da pessoa, sem
 * serviço de terceiros e sem custo por minuto.
 *
 * A qualidade depende do navegador e do sistema: Chrome e Edge trazem vozes
 * neurais em português (as "naturais"); outros navegadores caem na voz do
 * sistema, mais robótica. Por isso `escolherVoz` procura a mais natural que
 * existir, e a pessoa sempre pode ficar só com texto.
 *
 * Nada aqui decide segurança: o texto falado é o mesmo que o servidor já
 * mascarou, e o texto reconhecido entra como uma mensagem comum.
 */

export type OrigemDaEntrada = "texto" | "voz_transcrita";

/** O que o navegador expõe do reconhecimento de fala (não está nos tipos do TS). */
interface ReconhecimentoDeFala {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
type ConstrutorDeReconhecimento = new () => ReconhecimentoDeFala;

function construtorDeReconhecimento(): ConstrutorDeReconhecimento | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: ConstrutorDeReconhecimento;
    webkitSpeechRecognition?: ConstrutorDeReconhecimento;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const podeOuvir = (): boolean => construtorDeReconhecimento() !== null;
export const podeFalar = (): boolean => typeof window !== "undefined" && "speechSynthesis" in window;

/** O idioma da fala: o da interface, que é o que a pessoa fala com o Vix. */
export function idiomaDaFala(idiomaDaInterface: string | null | undefined): string {
  const i = (idiomaDaInterface ?? "").toLowerCase();
  if (i.startsWith("en")) return "en-US";
  if (i.startsWith("es")) return "es-ES";
  return "pt-BR";
}

// ───────────────────────────── ouvir ─────────────────────────────

export interface Escuta {
  parar: () => void;
}

/**
 * Começa a ouvir. `aoParcial` recebe o que já foi entendido (para mostrar na
 * caixa de texto enquanto a pessoa fala); `aoFinal` recebe a frase completa,
 * uma vez; `aoFalhar` recebe uma pista curta (permissão negada, sem microfone).
 */
export function ouvir(
  lang: string,
  cb: { aoParcial: (texto: string) => void; aoFinal: (texto: string) => void; aoFalhar: (motivo: string) => void; aoFim: () => void },
): Escuta | null {
  const Construtor = construtorDeReconhecimento();
  if (!Construtor) return null;
  const r = new Construtor();
  r.lang = lang;
  r.continuous = false;
  r.interimResults = true;
  let final = "";
  let entregue = false;
  r.onresult = (e) => {
    let parcial = "";
    for (let i = 0; i < e.results.length; i++) {
      const alt = e.results[i]?.[0]?.transcript ?? "";
      if (e.results[i]?.isFinal) final += alt;
      else parcial += alt;
    }
    cb.aoParcial((final + parcial).trim());
  };
  r.onerror = (e) => {
    entregue = true;
    cb.aoFalhar(e.error ?? "erro");
  };
  r.onend = () => {
    if (!entregue && final.trim() !== "") cb.aoFinal(final.trim());
    entregue = true;
    cb.aoFim();
  };
  try {
    r.start();
  } catch {
    return null;
  }
  return {
    parar: () => {
      try {
        r.stop();
      } catch {
        /* já tinha parado */
      }
    },
  };
}

// ───────────────────────────── falar ─────────────────────────────

/** Vozes que costumam ser neurais (as mais naturais) nos navegadores e sistemas comuns. */
const PISTAS_DE_VOZ_NATURAL = ["natural", "neural", "online", "google", "premium", "enhanced", "siri"];
/** Vozes antigas, de som sintético, que ficam por último. */
const PISTAS_DE_VOZ_ROBOTICA = ["espeak", "compact", "microsoft maria desktop", "microsoft daniel", "microsoft helena desktop"];

function pontuar(v: SpeechSynthesisVoice, lang: string): number {
  const nome = v.name.toLowerCase();
  let pontos = 0;
  if (v.lang.replace("_", "-").toLowerCase() === lang.toLowerCase()) pontos += 40;
  else if (v.lang.toLowerCase().startsWith(lang.slice(0, 2).toLowerCase())) pontos += 20;
  else return -1;
  if (PISTAS_DE_VOZ_NATURAL.some((p) => nome.includes(p))) pontos += 30;
  if (PISTAS_DE_VOZ_ROBOTICA.some((p) => nome.includes(p))) pontos -= 25;
  if (!v.localService) pontos += 5; // as de rede costumam ser neurais
  return pontos;
}

/** A voz mais natural do idioma; `null` quando o aparelho não tem nenhuma. */
export function escolherVoz(vozes: readonly SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice | null {
  let melhor: SpeechSynthesisVoice | null = null;
  let pontos = 0;
  for (const v of vozes) {
    const p = pontuar(v, lang);
    if (p > pontos) {
      melhor = v;
      pontos = p;
    }
  }
  return melhor;
}

/**
 * O texto como se FALA: sem markdown, sem emoji, sem endereço, sem símbolos
 * que a voz leria em voz alta ("asterisco asterisco").
 */
export function textoParaFalar(texto: string): string {
  return texto
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/^\s*(\d+)[.)]\s+/gm, "$1. ")
    .replace(/[*_~>|]/g, "")
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, "")
    .replace(/\s*\n+\s*/g, ". ")
    .replace(/\.\s*\./g, ".")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Frases curtas: o Chrome corta falas longas no meio, e frase a frase soa mais natural. */
export function dividirEmFrases(texto: string, maximo = 220): string[] {
  const frases = texto.match(/[^.!?…]+[.!?…]*/g)?.map((f) => f.trim()).filter(Boolean) ?? [];
  const saida: string[] = [];
  for (const f of frases) {
    if (f.length <= maximo) {
      saida.push(f);
      continue;
    }
    for (let i = 0; i < f.length; i += maximo) saida.push(f.slice(i, i + maximo));
  }
  return saida;
}

let numeroDaFala = 0;

export function pararDeFalar(): void {
  numeroDaFala++;
  if (podeFalar()) window.speechSynthesis.cancel();
}

/** Lê o texto em voz alta, frase a frase. `aoTerminar` roda ao fim ou ao ser interrompida. */
export function falar(texto: string, lang: string, aoTerminar: () => void): void {
  if (!podeFalar()) {
    aoTerminar();
    return;
  }
  const frases = dividirEmFrases(textoParaFalar(texto));
  if (frases.length === 0) {
    aoTerminar();
    return;
  }
  pararDeFalar();
  const minha = numeroDaFala;
  const voz = escolherVoz(window.speechSynthesis.getVoices(), lang);
  const dizer = (i: number) => {
    if (minha !== numeroDaFala) return; // outra fala (ou o botão de parar) tomou a vez
    if (i >= frases.length) {
      aoTerminar();
      return;
    }
    const u = new SpeechSynthesisUtterance(frases[i]);
    u.lang = voz?.lang ?? lang;
    if (voz) u.voice = voz;
    u.rate = 1.03;
    u.pitch = 1;
    u.onend = () => dizer(i + 1);
    u.onerror = () => {
      if (minha === numeroDaFala) aoTerminar();
    };
    window.speechSynthesis.speak(u);
  };
  dizer(0);
}
