import type { MessageAction } from "../lib/actions";

export type AppName = "crm" | "marketing" | "trading" | "system";
export type MessagePriority = "info" | "wichtig" | "dringend";

export interface Message {
  id: string;
  app: AppName;
  kind: string;
  title: string;
  body: string;
  link: string;
  priority: MessagePriority;
  created_at: string;
  read_at: string | null;
  pushed_at: string | null;
  push_error: string;
  tag: string | null;
  actions: MessageAction[];
  action_token: string;
  acted_at: string | null;
  acted_action: string | null;
  action_result: string;
}

export interface Device {
  id: string;
  endpoint: string;
  device: string;
  created_at: string;
  last_ok_at: string | null;
  failures: number;
}

/** Figures of the CRM home page, read from crm.today_overview(). */
export interface CrmOverview {
  new_inquiries: number;
  overdue_invoices: number;
  pending_approvals: number;
  open_tickets: number;
  tasks_due: number;
  receivables: number;
  paid_this_month: number;
  pipeline_value: number;
  unknown_senders: number;
  failed_mails: number;
  mailbox_stale: boolean;
}

export type AssistantStatus = "queued" | "claimed" | "done" | "failed";

/** A request to the assistant, read from crm.assistant_requests. */
export interface AssistantRequest {
  id: string;
  /** What Daniel typed, or the transcript once the server has turned the recording into text. */
  text: string | null;
  audio_path: string | null;
  status: AssistantStatus;
  result_text: string;
  created_at: string;
  finished_at: string | null;
}
