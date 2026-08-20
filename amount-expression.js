export function parseAmountExpression(value) {
  const expression = String(value ?? '')
    .replaceAll('＋', '+')
    .replace(/\s+/g, '');

  if (!/^\d+(?:\+\d+)*$/.test(expression)) return null;

  const total = expression
    .split('+')
    .reduce((sum, term) => sum + Number(term), 0);
  return Number.isSafeInteger(total) && total > 0 ? total : null;
}
