/**
 * How many live connections one address may hold open at once (24 Oct 2026).
 *
 * There was no limit: anyone holding a view-only link — and those are shared
 * on purpose, photographed off walls and forwarded round group chats — could
 * open thousands of show or sheet connections from one machine, and every
 * screen that joins tells every other screen on the sheet who is there.
 *
 * Generous on purpose: a whole crew on a venue's Wi-Fi reaches the server
 * from ONE address, each person with the show page and maybe a timer and a
 * prompter open. 150 covers fifty people with three screens each.
 */
export const SOCKETS_PER_ADDRESS = 150;

export class SocketCounter {
  private open = new Map<string, number>();
  private readonly max: number;
  constructor(max: number = SOCKETS_PER_ADDRESS) {
    this.max = max;
  }

  /** Count one more for this address, or say no when it already holds the most. */
  tryTake(key: string): boolean {
    const n = this.open.get(key) ?? 0;
    if (n >= this.max) return false;
    this.open.set(key, n + 1);
    return true;
  }

  /** One fewer — the connection closed. */
  give(key: string): void {
    const n = (this.open.get(key) ?? 0) - 1;
    if (n <= 0) this.open.delete(key);
    else this.open.set(key, n);
  }

  held(key: string): number {
    return this.open.get(key) ?? 0;
  }
}
