// Cutting text to a length without splitting a character (an emoji is two
// UTF-16 units; half of one is invalid JSON and the server refuses it).
export const cut = (s, n) => {
  const str = String(s ?? '');
  return str.length <= n ? str : Array.from(str).slice(0, n).join('');
};
