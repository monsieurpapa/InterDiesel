// Client-side WhatsApp channels behind the shared NotificationService interface.
// - ShareSheetChannel: Android/Windows share sheet, can attach the receipt image.
// - WaMeChannel: opens a WhatsApp chat (wa.me) with the text ready to send.
// Both work offline: WhatsApp keeps the message and sends it when the phone reconnects.
import { NotificationService, type NotificationChannel, type OutgoingMessage, type SendResult } from '../shared/notify';

class ShareSheetChannel implements NotificationChannel {
  readonly name = 'share_sheet';
  canSend(msg: OutgoingMessage) {
    // With a known recipient, opening their chat directly is faster than the share sheet.
    if (msg.to) return false;
    if (!navigator.share) return false;
    if (msg.file) {
      const f = toFile(msg.file);
      return !!navigator.canShare?.({ files: [f] });
    }
    return true;
  }
  async send(msg: OutgoingMessage): Promise<SendResult> {
    try {
      const data: ShareData = { text: msg.text };
      if (msg.file) data.files = [toFile(msg.file)];
      await navigator.share(data);
      return { ok: true, channel: this.name };
    } catch (e) {
      const aborted = (e as Error).name === 'AbortError';
      return { ok: aborted, channel: this.name, error: aborted ? undefined : (e as Error).message };
    }
  }
}

class WaMeChannel implements NotificationChannel {
  readonly name = 'wa_me';
  canSend() {
    return true;
  }
  async send(msg: OutgoingMessage): Promise<SendResult> {
    const digits = (msg.to ?? '').replace(/\D/g, '');
    const url = `https://wa.me/${digits}?text=${encodeURIComponent(msg.text)}`;
    const w = window.open(url, '_blank', 'noopener');
    if (!w) location.href = url;
    return { ok: true, channel: this.name };
  }
}

function toFile(f: NonNullable<OutgoingMessage['file']>): File {
  return f.data instanceof File ? f.data : new File([f.data as BlobPart], f.name, { type: f.type });
}

export const notifier = new NotificationService([new ShareSheetChannel(), new WaMeChannel()]);

export function sendWhatsApp(msg: OutgoingMessage) {
  return notifier.send(msg);
}

/** Draw a receipt as a PNG image (384 px wide, the width of 58 mm printers). */
export async function receiptImage(text: string): Promise<Blob> {
  const W = 384;
  const pad = 14;
  const size = 19;
  const lh = 25;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const font = (bold: boolean) => `${bold ? 'bold ' : ''}${size}px system-ui, Arial, sans-serif`;
  // wrap lines to the width
  const out: { s: string; bold: boolean }[] = [];
  for (const raw of text.split('\n')) {
    const bold = /^\*.*\*/.test(raw.trim());
    const s = raw.replace(/\*/g, '');
    ctx.font = font(bold);
    let line = '';
    for (const word of s.split(' ')) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > W - pad * 2 && line) {
        out.push({ s: line, bold });
        line = word;
      } else line = test;
    }
    out.push({ s: line, bold });
  }
  canvas.width = W;
  canvas.height = pad * 2 + out.length * lh;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, canvas.height);
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'top';
  out.forEach((l, i) => {
    ctx.font = font(l.bold);
    ctx.fillText(l.s, pad, pad + i * lh);
  });
  return new Promise((res) => canvas.toBlob((b) => res(b!), 'image/png'));
}

/** Print on a 58 mm thermal printer (Android: through the RawBT or the printer's print service). */
export function printText(text: string) {
  let el = document.getElementById('print-area');
  if (!el) {
    el = document.createElement('div');
    el.id = 'print-area';
    document.body.appendChild(el);
  }
  el.textContent = text.replace(/\*/g, '');
  window.print();
}
