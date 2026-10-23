/**
 * Named moments in a sheet page's start-up (23 Oct): when each live link
 * opened, when the server said hello, when the sheet was in step.
 *
 * Asked for after "it feels a little slow to load buttons": a page's own
 * timings say when the HTML and the files arrived, and nothing about the two
 * sockets that decide when Start can be pressed. These marks do. Read them with
 * `performance.getEntriesByType("mark")` — the speed check does
 * (scripts/perf-check.sh), and so can anyone in a browser's console, on any
 * deployment.
 *
 * Only the first of each is kept: a reconnect half-way through a show is not
 * the page starting up. A test that opens a second page in the same tab clears
 * the marks first.
 */
export const markOnce = (name: string): void => {
  try {
    if (performance.getEntriesByName(name, "mark").length === 0) performance.mark(name);
  } catch {
    /* no performance API: nothing to measure with */
  }
};
