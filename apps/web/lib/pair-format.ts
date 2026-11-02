export function normalizePairCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z2-9]/g, "");
}

export function formatPairCode(code: string): string {
  const clean = normalizePairCode(code);
  if (clean.length !== 6) return clean;
  return `${clean.slice(0, 3)}-${clean.slice(3)}`;
}
