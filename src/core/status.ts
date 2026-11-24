// The History status filter's two rules, shared by the store and the renderer so they cannot drift apart
// (history-status-filter, code review 10).

/** The code a call was answered with, or `''` (No response): an error completion, in flight, or interrupted. */
export function statusOf(completion: object | null): string {
  return completion !== null && 'response' in completion
    ? String((completion as { response: { status: number } }).response.status)
    : '';
}

/** Status options and selections in one order: codes ascending, No response (`''`) last. */
export const byStatus = (a: string, b: string): number =>
  a === '' ? 1 : b === '' ? -1 : Number(a) - Number(b);
