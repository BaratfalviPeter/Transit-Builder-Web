/**
 * Feedback: a GitHub issue on the game's repository, pre-filled with the
 * game's state (date, city, money, lines) and the browser — the beta testers
 * only write what happened. Needs a GitHub account.
 */

export const ISSUES_URL = 'https://github.com/BaratfalviPeter/Transit-Builder-Web/issues/new';

export function feedbackUrl(state: { date: string; population: number; money: number; lines: number; vehicles: number }): string {
  const body = [
    '**Mi történt / mi a javaslatod?**',
    '',
    '',
    '**Hogyan jött elő? (ha hiba)**',
    '',
    '',
    '---',
    `Játék: ${state.date} · ${state.population} lakos · $${Math.round(state.money)} · ${state.lines} járat, ${state.vehicles} jármű`,
    `Böngésző: ${typeof navigator !== 'undefined' ? navigator.userAgent : '?'}`,
  ].join('\n');
  return `${ISSUES_URL}?title=${encodeURIComponent('Visszajelzés: ')}&body=${encodeURIComponent(body)}&labels=${encodeURIComponent('bétateszt')}`;
}
