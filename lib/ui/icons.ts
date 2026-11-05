/**
 * Canonical icon map. Toda feature importa daqui — não direto de @phosphor-icons/react.
 * ADR-05 (Spec 09 §12). Permite swap futuro sem big-bang refactor.
 *
 * Re-exporting from `@phosphor-icons/react/dist/ssr` so Server Components can
 * render icons without forcing the entire CSR React-context module client-side.
 * Client Components still get fully interactive icons (size/weight/color).
 */

import { createElement, forwardRef } from "react";
import * as Ph from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";

/**
 * Traço leve por padrão (identidade ArvisX "pele limpa"): quem não pede um peso
 * — ou pede "regular" — recebe "light". Peso explícito (bold, fill, duotone,
 * thin) é respeitado. Sem hook: serve Server e Client Components.
 */
function leve(Base: Icon, nome: string): Icon {
  const Icone = forwardRef<SVGSVGElement, React.ComponentProps<Icon>>((props, ref) =>
    createElement(Base, {
      ...props,
      ref,
      weight: !props.weight || props.weight === "regular" ? "light" : props.weight,
    }),
  );
  Icone.displayName = nome;
  return Icone as Icon;
}

// navigation (inbox icon = Tray in Phosphor)
export const Inbox = leve(Ph.Tray, "Inbox");
export const ListChecks = leve(Ph.ListChecks, "ListChecks");
export const Plugs = leve(Ph.Plugs, "Plugs");
export const PlugsConnected = leve(Ph.PlugsConnected, "PlugsConnected");
export const QrCode = leve(Ph.QrCode, "QrCode");
export const Kanban = leve(Ph.Kanban, "Kanban");
export const Users = leve(Ph.Users, "Users");
export const UsersThree = leve(Ph.UsersThree, "UsersThree");
export const Storefront = leve(Ph.Storefront, "Storefront");
export const Robot = leve(Ph.Robot, "Robot");
export const Sparkle = leve(Ph.Sparkle, "Sparkle");
export const ShieldCheck = leve(Ph.ShieldCheck, "ShieldCheck");
export const Gear = leve(Ph.Gear, "Gear");
export const House = leve(Ph.House, "House");
// admin platform
export const Buildings = leve(Ph.Buildings, "Buildings");
export const FlowArrow = leve(Ph.FlowArrow, "FlowArrow");
export const ChatsCircle = leve(Ph.ChatsCircle, "ChatsCircle");
export const ClipboardText = leve(Ph.ClipboardText, "ClipboardText");
export const Scales = leve(Ph.Scales, "Scales");
export const Gauge = leve(Ph.Gauge, "Gauge");
export const WifiSlash = leve(Ph.WifiSlash, "WifiSlash");
export const Clock = leve(Ph.Clock, "Clock");
// marca da instalação (o revendedor troca nome e cor do produto)
export const Palette = leve(Ph.Palette, "Palette");
// anúncios (Análise → Meta Ads). Megaphone e não outro ChartX: os dois
// vizinhos do grupo já são gráficos (ChartBar em Desempenho, ChartLineUp em
// Evolução da IA), e um terceiro gráfico deixaria as três linhas do menu
// indistinguíveis de relance. Mesma família Phosphor, mesmo peso.
export const Megaphone = leve(Ph.Megaphone, "Megaphone");
// health dashboard
export const WifiHigh = leve(Ph.WifiHigh, "WifiHigh");
export const Brain = leve(Ph.Brain, "Brain");
export const ArrowsClockwise = leve(Ph.ArrowsClockwise, "ArrowsClockwise");
export const Dot = leve(Ph.Dot, "Dot");
// actions
export const ArrowBendUpLeft = leve(Ph.ArrowBendUpLeft, "ArrowBendUpLeft");
// encaminhar (#2835): a seta espelhada do "Responder" — mesma família,
// mesmo peso, para os dois gestos da bolha lerem como par.
export const ArrowBendUpRight = leve(Ph.ArrowBendUpRight, "ArrowBendUpRight");
// videochamada (#2440): ícone de câmera, não Video (que no Phosphor é a
// janela de player) — junto do Phone do DialButton, a família é a mesma.
export const VideoCamera = leve(Ph.VideoCamera, "VideoCamera");
export const List = leve(Ph.List, "List");
export const Bell = leve(Ph.Bell, "Bell");
export const BellSlash = leve(Ph.BellSlash, "BellSlash");
export const DeviceMobile = leve(Ph.DeviceMobile, "DeviceMobile");
export const EnvelopeSimple = leve(Ph.EnvelopeSimple, "EnvelopeSimple");
export const PaperPlaneTilt = leve(Ph.PaperPlaneTilt, "PaperPlaneTilt");
export const Smiley = leve(Ph.Smiley, "Smiley");
export const Check = leve(Ph.Check, "Check");
export const Checks = leve(Ph.Checks, "Checks");
export const X = leve(Ph.X, "X");
export const Plus = leve(Ph.Plus, "Plus");
export const Trash = leve(Ph.Trash, "Trash");
export const PencilSimple = leve(Ph.PencilSimple, "PencilSimple");
export const MagnifyingGlass = leve(Ph.MagnifyingGlass, "MagnifyingGlass");
export const Pause = leve(Ph.Pause, "Pause");
export const Play = leve(Ph.Play, "Play");
export const SkipForward = leve(Ph.SkipForward, "SkipForward");
export const Copy = leve(Ph.Copy, "Copy");
export const DownloadSimple = leve(Ph.DownloadSimple, "DownloadSimple");
export const Archive = leve(Ph.Archive, "Archive");
// origem de uma captação de formulário (página, IP, link para o lead)
export const Globe = leve(Ph.Globe, "Globe");
export const ArrowSquareOut = leve(Ph.ArrowSquareOut, "ArrowSquareOut");
export const Tray = leve(Ph.Tray, "Tray");
// feedback
export const CheckCircle = leve(Ph.CheckCircle, "CheckCircle");
export const Warning = leve(Ph.Warning, "Warning");
export const WarningOctagon = leve(Ph.WarningOctagon, "WarningOctagon");
export const Info = leve(Ph.Info, "Info");
export const CircleNotch = leve(Ph.CircleNotch, "CircleNotch");
// lgpd
export const ScalesSimple = leve(Ph.Scales, "ScalesSimple");
export const Eye = leve(Ph.Eye, "Eye");
export const EyeSlash = leve(Ph.EyeSlash, "EyeSlash");
export const ChartBar = leve(Ph.ChartBar, "ChartBar");
export const ClockCountdown = leve(Ph.ClockCountdown, "ClockCountdown");
// painéis de evolução / aprendizado
export const ChartLineUp = leve(Ph.ChartLineUp, "ChartLineUp");
export const Lightbulb = leve(Ph.Lightbulb, "Lightbulb");
// theme
export const Sun = leve(Ph.Sun, "Sun");
export const Moon = leve(Ph.Moon, "Moon");
export const MonitorPlay = leve(Ph.MonitorPlay, "MonitorPlay");
// conversation
export const ChatCircle = leve(Ph.ChatCircle, "ChatCircle");
export const WhatsappLogo = leve(Ph.WhatsappLogo, "WhatsappLogo");
export const InstagramLogo = leve(Ph.InstagramLogo, "InstagramLogo");
export const MessengerLogo = leve(Ph.MessengerLogo, "MessengerLogo");
export const Phone = leve(Ph.Phone, "Phone");
export const PhoneIncoming = leve(Ph.PhoneIncoming, "PhoneIncoming");
export const PhoneOutgoing = leve(Ph.PhoneOutgoing, "PhoneOutgoing");
export const PhoneX = leve(Ph.PhoneX, "PhoneX");
export const Paperclip = leve(Ph.Paperclip, "Paperclip");
export const Microphone = leve(Ph.Microphone, "Microphone");
export const MicrophoneSlash = leve(Ph.MicrophoneSlash, "MicrophoneSlash");
export const ImageIcon = leve(Ph.Image, "ImageIcon");
export const ImageSquare = leve(Ph.ImageSquare, "ImageSquare");
export const MusicNote = leve(Ph.MusicNote, "MusicNote");
export const Note = leve(Ph.Note, "Note");
export const FileText = leve(Ph.FileText, "FileText");
export const Lock = leve(Ph.Lock, "Lock");
export const LockOpen = leve(Ph.LockOpen, "LockOpen");
export const Receipt = leve(Ph.Receipt, "Receipt");
export const Tag = leve(Ph.Tag, "Tag");
export const Question = leve(Ph.Question, "Question");
export const Keyboard = leve(Ph.Keyboard, "Keyboard");
// followup flow builder (Task 6.2)
export const GitBranch = leve(Ph.GitBranch, "GitBranch");
export const Flag = leve(Ph.Flag, "Flag");
export const TreeStructure = leve(Ph.TreeStructure, "TreeStructure");
// reordenar por arrastar e soltar (#3244): a alça da lista de respostas rápidas
export const DragHandle = leve(Ph.DotsSixVertical, "DragHandle");
// misc
export const DotsThree = leve(Ph.DotsThree, "DotsThree");
export const CaretDown = leve(Ph.CaretDown, "CaretDown");
export const CaretUp = leve(Ph.CaretUp, "CaretUp");
export const CaretDoubleLeft = leve(Ph.CaretDoubleLeft, "CaretDoubleLeft");
export const CaretDoubleRight = leve(Ph.CaretDoubleRight, "CaretDoubleRight");
export const CaretLeft = leve(Ph.CaretLeft, "CaretLeft");
export const CaretRight = leve(Ph.CaretRight, "CaretRight");
export const ArrowRight = leve(Ph.ArrowRight, "ArrowRight");
export const SignOut = leve(Ph.SignOut, "SignOut");
export const WebhooksLogo = leve(Ph.WebhooksLogo, "WebhooksLogo");
export const PuzzlePiece = leve(Ph.PuzzlePiece, "PuzzlePiece");
export const UploadSimple = leve(Ph.UploadSimple, "UploadSimple");
export const Signpost = leve(Ph.Signpost, "Signpost");
// atualização de versão
export const ArrowCircleUp = leve(Ph.ArrowCircleUp, "ArrowCircleUp");
// navegação agrupada (registro em lib/navigation/registry.ts)
export const Funnel = leve(Ph.Funnel, "Funnel");
export const BookOpen = leve(Ph.BookOpen, "BookOpen");
export const Key = leve(Ph.Key, "Key");
export const UserCircle = leve(Ph.UserCircle, "UserCircle");
export const ClockCounterClockwise = leve(Ph.ClockCounterClockwise, "ClockCounterClockwise");
// inbox no celular: voltar para a lista e abrir a ficha do contato
export const IdentificationCard = leve(Ph.IdentificationCard, "IdentificationCard");
// agenda (o barril não tinha NENHUM ícone de calendário até aqui)
export const CalendarBlank = leve(Ph.CalendarBlank, "CalendarBlank");
export const CalendarDots = leve(Ph.CalendarDots, "CalendarDots");
export const CalendarPlus = leve(Ph.CalendarPlus, "CalendarPlus");
export const CalendarX = leve(Ph.CalendarX, "CalendarX");
export const CalendarCheck = leve(Ph.CalendarCheck, "CalendarCheck");
export const GoogleLogo = leve(Ph.GoogleLogo, "GoogleLogo");
export const MapPin = leve(Ph.MapPin, "MapPin");
export const ArrowsOutSimple = leve(Ph.ArrowsOutSimple, "ArrowsOutSimple");
// /admin/modulos: módulo opcional com tabela própria (ADR-0002)
export const Stack = leve(Ph.Stack, "Stack");
// atalhos do card (#3487): carrinho do app de pedidos e o link genérico.
// `LinkSimple` entra apelidado de `LinkIcon` porque `Link` é o do `next/link`
// em quase toda tela — dois identificadores iguais no mesmo import seriam
// erro de compilação na primeira tela que precisasse dos dois.
export const ShoppingCart = leve(Ph.ShoppingCart, "ShoppingCart");
export const LinkIcon = leve(Ph.LinkSimple, "LinkIcon");
