export type MessageChannel = "sms";

export type SendStatus =
  | "accepted"
  | "failed"
  | "send_unknown"
  | "would_send"
  | "blocked_by_allowlist";

export interface SendMessageRequest {
  channel: MessageChannel;
  to: string;
  body: string;
  senderId: string;
  idempotencyKey: string;
  metadata?: Readonly<Record<string, string>>;
}

export interface SendMessageResult {
  status: SendStatus;
  providerMessageId?: string;
  provider?: string;
  dryRun?: boolean;
  errorCode?: string;
  errorMessage?: string;
  segments?: number;
}

export interface MessageSender {
  send(request: SendMessageRequest): Promise<SendMessageResult>;
}
