const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Kurze zufällige ID – funktioniert auch ohne Secure Context (http) */
export function newId(len = 12): string {
  const bytes = new Uint8Array(len);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}
