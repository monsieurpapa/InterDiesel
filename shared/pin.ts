// PIN hashing, done on the device so sellers can switch users while offline.
// A 4-6 digit PIN cannot resist an attacker who has the phone's storage; it
// protects against casual use of someone else's account at the counter. The real
// security boundary is the device token (see ARCHITECTURE.md).

const ITER = 60_000;

export async function hashPin(pin: string, userId: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(`interdiesel:${userId}`), iterations: ITER },
    key,
    256,
  );
  const hex = Array.from(new Uint8Array(bits), (b) => b.toString(16).padStart(2, '0')).join('');
  return `pbkdf2$${ITER}$${hex}`;
}

export async function checkPin(pin: string, userId: string, stored: string): Promise<boolean> {
  return (await hashPin(pin, userId)) === stored;
}

export const validPin = (pin: string) => /^\d{4,6}$/.test(pin);
