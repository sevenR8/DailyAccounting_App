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

export function parseSignedAmountExpression(value, { allowZero = false } = {}) {
  const expression = String(value ?? '')
    .replaceAll('＋', '+')
    .replaceAll('－', '-')
    .replaceAll('−', '-')
    .replace(/\s+/g, '');

  if (!/^\d+(?:[+-]\d+)*$/.test(expression)) return null;

  const total = expression
    .match(/[+-]?\d+/g)
    .reduce((sum, term) => sum + Number(term), 0);
  const minimum = allowZero ? 0 : 1;
  return Number.isSafeInteger(total) && total >= minimum ? total : null;
}
