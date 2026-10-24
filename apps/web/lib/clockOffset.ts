/**
 * How far the server's clock is ahead of this device's, from one exchange:
 * sent and received by this device, arrived at and left the server.
 *
 * The usual four-stamp estimate. It takes the two legs to be equally long and
 * leaves out the time the server spent between them — for a hello that is the
 * sign-in and the sheet's lookups, which would otherwise be counted as travel
 * and push the estimate out by half of it. A ping is the same sum with the
 * server's two stamps equal.
 */
export const clockOffset = (sentMs: number, serverInMs: number, serverOutMs: number, receivedMs: number): number =>
  (serverInMs - sentMs + (serverOutMs - receivedMs)) / 2;
