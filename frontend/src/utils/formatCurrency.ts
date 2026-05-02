/** Format cents (e.g. -4250) as a currency string ("−$42.50") */
export function formatCurrency(cents: number): string {
  const abs = Math.abs(cents) / 100;
  const formatted = abs.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  });
  return cents < 0 ? `−${formatted}` : `+${formatted}`;
}

/** Format ISO date string (YYYY-MM-DD) as a readable date */
export function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
