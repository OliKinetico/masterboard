/** Outlook/email integration contracts (spec §5.7, §8). */

export interface EmailAddress {
  name: string;
  address: string;
}

export interface EmailAttachment {
  name: string;
  deepLink: string;
}

export interface EmailMessage {
  /** Graph message id — the idempotency key (interactions.source_ref). */
  graphId: string;
  from: EmailAddress;
  to: EmailAddress[];
  cc: EmailAddress[];
  subject: string;
  bodyPreview: string;
  body: string;
  receivedAt: string; // ISO timestamp
  attachments: EmailAttachment[];
}

export interface EmailProvider {
  readonly name: string;
  /** Delta query: all messages received after `since` (null = everything). */
  listDelta(since: Date | null): Promise<EmailMessage[]>;
}
