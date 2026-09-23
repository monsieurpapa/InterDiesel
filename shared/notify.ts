// One interface for every outgoing message. Today the app uses channels that
// open WhatsApp on the phone (share sheet, wa.me link). Later the server can use
// the WhatsApp Business Cloud API channel for automatic messages, without the
// rest of the code changing. See WHATSAPP.md.

export type MessageKind = 'receipt' | 'daily_summary' | 'low_stock' | 'transfer_request' | 'transfer_sent' | 'debt_reminder';

export interface OutgoingMessage {
  kind: MessageKind;
  to?: string | null; // international phone number; empty = let the user choose the chat
  text: string;
  file?: { name: string; type: string; data: Blob | Uint8Array } | null;
  /** For template-based channels (Cloud API): template name + ordered parameters. */
  template?: { name: string; language: string; params: string[] };
}

export interface SendResult {
  ok: boolean;
  channel: string;
  error?: string;
}

export interface NotificationChannel {
  readonly name: string;
  /** Can this channel deliver this message right now (online, configured, supported)? */
  canSend(msg: OutgoingMessage): boolean | Promise<boolean>;
  send(msg: OutgoingMessage): Promise<SendResult>;
}

/** Tries channels in order and uses the first one that can deliver the message. */
export class NotificationService {
  constructor(private channels: NotificationChannel[]) {}
  async send(msg: OutgoingMessage): Promise<SendResult> {
    for (const c of this.channels) {
      if (await c.canSend(msg)) return c.send(msg);
    }
    return { ok: false, channel: 'none', error: 'no_channel' };
  }
}
