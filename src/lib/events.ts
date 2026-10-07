/**
 * Helpers over runtime events, which papi decodes as nested `{ type, value }` enums: pallet, then event, then fields.
 */

export interface RuntimeEvent {
  type: string;
  value: { type: string; value?: unknown };
}

/** `Pallet.Event` names, in order. */
export const eventNames = (events: readonly RuntimeEvent[]): string[] => events.map((e) => `${e.type}.${e.value.type}`);

/** Fields of every `pallet.event` in `events`. */
export function findEvents<T = Record<string, unknown>>(
  events: readonly RuntimeEvent[],
  pallet: string,
  event: string,
): T[] {
  return events.filter((e) => e.type === pallet && e.value.type === event).map((e) => e.value.value as T);
}

/** Event names without the per-block bookkeeping noise (System, ParachainSystem, fees). */
export const notableEvents = (events: readonly RuntimeEvent[]): string[] =>
  eventNames(events).filter((n) => !/^(System|ParachainSystem|Balances|TransactionPayment)\./.test(n));
