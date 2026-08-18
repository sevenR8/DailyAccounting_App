function dateParts(value) {
  return String(value).split('-').map(Number);
}

export function shiftAccountingPeriodStart(startsOn, monthDelta) {
  const [year, month, day] = dateParts(startsOn);
  const shifted = new Date(Date.UTC(year, month - 1 + monthDelta, day));
  return shifted.toISOString().slice(0, 10);
}

export function accountingPeriodFromStart(startsOn) {
  const nextStartsOn = shiftAccountingPeriodStart(startsOn, 1);
  const nextStart = new Date(`${nextStartsOn}T00:00:00Z`);
  nextStart.setUTCDate(nextStart.getUTCDate() - 1);
  return {
    startsOn,
    endsOn: nextStart.toISOString().slice(0, 10),
  };
}

export function compareExpenseTotals(currentTotal, previousTotal) {
  if (previousTotal === 0) {
    if (currentTotal === 0) return { direction: 'same', percent: 0, hasBaseline: true };
    return { direction: 'up', percent: null, hasBaseline: false };
  }

  const percent = Math.abs(((currentTotal - previousTotal) / previousTotal) * 100);
  if (currentTotal === previousTotal) return { direction: 'same', percent: 0, hasBaseline: true };
  return {
    direction: currentTotal > previousTotal ? 'up' : 'down',
    percent,
    hasBaseline: true,
  };
}

