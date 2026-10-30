// Status badges with consistent colours across all pages.
import type { ContractStatus, DealStage, InquiryStatus, InvoiceStatus, OrderStatus, QuoteStatus, TicketStatus } from "../api/types";
import { CONTRACT_STATUS, DEAL_STAGE, INQUIRY_STATUS, INVOICE_STATUS, ORDER_STATUS, QUOTE_STATUS, TICKET_STATUS, today } from "../lib/format";
import { Badge, type Tone } from "./ui";

const QUOTE_TONE: Record<QuoteStatus, Tone> = { draft: "", sent: "gold", accepted: "good", declined: "bad", expired: "bad" };
const ORDER_TONE: Record<OrderStatus, Tone> = { open: "gold", in_progress: "gold", done: "good", invoiced: "ink" };
const INQUIRY_TONE: Record<InquiryStatus, Tone> = { new: "gold", in_progress: "", done: "good", rejected: "bad" };
const DEAL_TONE: Record<DealStage, Tone> = { new: "gold", meeting: "", quote: "", won: "good", lost: "bad" };
const TICKET_TONE: Record<TicketStatus, Tone> = { open: "gold", waiting: "", solved: "good" };

export function QuoteBadge({ status }: { status: QuoteStatus }) {
  return <Badge tone={QUOTE_TONE[status]}>{QUOTE_STATUS[status]}</Badge>;
}

export function OrderBadge({ status }: { status: OrderStatus }) {
  return <Badge tone={ORDER_TONE[status]}>{ORDER_STATUS[status]}</Badge>;
}

export function InquiryBadge({ status }: { status: InquiryStatus }) {
  return <Badge tone={INQUIRY_TONE[status]}>{INQUIRY_STATUS[status]}</Badge>;
}

export function DealBadge({ stage }: { stage: DealStage }) {
  return <Badge tone={DEAL_TONE[stage]}>{DEAL_STAGE[stage]}</Badge>;
}

export function TicketBadge({ status }: { status: TicketStatus }) {
  return <Badge tone={TICKET_TONE[status]}>{TICKET_STATUS[status]}</Badge>;
}

export function InvoiceBadge({ status, dueDate, isCredit }: { status: InvoiceStatus; dueDate: string | null; isCredit?: boolean }) {
  if (isCredit === true) return <Badge tone="ink">Storno</Badge>;
  if (status === "open" && dueDate !== null && dueDate < today()) return <Badge tone="bad">Überfällig</Badge>;
  const tone: Tone = status === "paid" ? "good" : status === "open" ? "gold" : status === "cancelled" ? "bad" : "";
  return <Badge tone={tone}>{INVOICE_STATUS[status]}</Badge>;
}

const CONTRACT_TONE: Record<ContractStatus, Tone> = { draft: "gold", queued: "gold", sent: "", signed: "good", ended: "ink", rejected: "bad" };

export function ContractBadge({ status }: { status: ContractStatus }) {
  return <Badge tone={CONTRACT_TONE[status]}>{CONTRACT_STATUS[status]}</Badge>;
}
