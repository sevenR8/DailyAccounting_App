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

export function canRebaseEmptyCurrentPeriod({ period, entries = [], otherIncomeEntries = [] }) {
  if (!period) return false;
  if (Number(period.salary_amount ?? 0) !== 0) return false;
  if (period.previous_card_bill_amount !== null && period.previous_card_bill_amount !== undefined) {
    return false;
  }
  if (period.previous_card_bill_zero_confirmed === true) return false;
  if (otherIncomeEntries.length > 0) return false;

  const periodStart = new Date(`${period.starts_on}T00:00:00+08:00`);
  const periodEnd = new Date(`${period.ends_on}T00:00:00+08:00`);
  periodEnd.setUTCDate(periodEnd.getUTCDate() + 1);
  return !entries.some((entry) => {
    const occurredAt = new Date(entry.occurred_at);
    return occurredAt >= periodStart && occurredAt < periodEnd;
  });
}

export function scheduledDateInAccountingPeriod(
  startsOn,
  endsOn,
  scheduledDay,
  scheduledMonth = null,
) {
  const [year, month] = dateParts(startsOn);
  const day = Number(scheduledDay);
  if (!Number.isInteger(day) || day < 1 || day > 28) {
    throw new RangeError('固定開銷日期必須介於 1 到 28 日。');
  }

  if (scheduledMonth !== null && scheduledMonth !== undefined) {
    const annualMonth = Number(scheduledMonth);
    if (!Number.isInteger(annualMonth) || annualMonth < 1 || annualMonth > 12) {
      throw new RangeError('年度固定開銷月份必須介於 1 到 12 月。');
    }

    const [endYear] = dateParts(endsOn);
    for (const candidateYear of new Set([year, endYear])) {
      const scheduledOn = new Date(Date.UTC(candidateYear, annualMonth - 1, day))
        .toISOString()
        .slice(0, 10);
      if (scheduledOn >= startsOn && scheduledOn <= endsOn) return scheduledOn;
    }
    return null;
  }

  let scheduledDate = new Date(Date.UTC(year, month - 1, day));
  let scheduledOn = scheduledDate.toISOString().slice(0, 10);
  if (scheduledOn < startsOn) {
    scheduledDate = new Date(Date.UTC(year, month, day));
    scheduledOn = scheduledDate.toISOString().slice(0, 10);
  }

  if (scheduledOn > endsOn) {
    throw new RangeError('固定開銷日期不在這個帳務週期內。');
  }
  return scheduledOn;
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
