// WhatsApp Business Cloud API channel. Disabled until WHATSAPP_TOKEN and
// WHATSAPP_PHONE_NUMBER_ID are set (see WHATSAPP.md for what Meta requires).
// Business-initiated messages must use templates approved by Meta in advance.
import type { NotificationChannel, OutgoingMessage, SendResult } from '../../shared/notify';

export class WhatsAppCloudChannel implements NotificationChannel {
  readonly name = 'whatsapp_cloud_api';
  constructor(
    private cfg = {
      token: process.env.WHATSAPP_TOKEN ?? '',
      phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? '',
      apiVersion: process.env.WHATSAPP_API_VERSION ?? 'v23.0',
    },
    private fetchImpl: typeof fetch = fetch,
  ) {}

  get configured() {
    return !!(this.cfg.token && this.cfg.phoneNumberId);
  }

  canSend(msg: OutgoingMessage) {
    return this.configured && !!msg.to && !!msg.template;
  }

  async send(msg: OutgoingMessage): Promise<SendResult> {
    if (!this.canSend(msg)) return { ok: false, channel: this.name, error: 'not_configured' };
    const body = {
      messaging_product: 'whatsapp',
      to: String(msg.to).replace(/\D/g, ''),
      type: 'template',
      template: {
        name: msg.template!.name,
        language: { code: msg.template!.language },
        components: [{ type: 'body', parameters: msg.template!.params.map((text) => ({ type: 'text', text: text.slice(0, 1000) })) }],
      },
    };
    try {
      const res = await this.fetchImpl(`https://graph.facebook.com/${this.cfg.apiVersion}/${this.cfg.phoneNumberId}/messages`, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.cfg.token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) return { ok: false, channel: this.name, error: `http_${res.status}` };
      return { ok: true, channel: this.name };
    } catch (e) {
      return { ok: false, channel: this.name, error: (e as Error).message };
    }
  }
}

/** Logs messages instead of sending them. Used while the Cloud API is not set up. */
export class LogChannel implements NotificationChannel {
  readonly name = 'log';
  canSend() {
    return true;
  }
  async send(msg: OutgoingMessage): Promise<SendResult> {
    if (process.env.NOTIFY_LOG === '1') console.log(`[notification ${msg.kind} -> ${msg.to ?? '?'}]\n${msg.text}`);
    return { ok: true, channel: this.name };
  }
}
