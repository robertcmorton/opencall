"use client";

import { useEffect, useId, useMemo, useState } from "react";
import type { Gesture, HelpItem, HelpSection, Shortcut } from "./content";
import { plain, rich } from "./rich";
import styles from "./help.module.css";

/**
 * The searchable body of the Help page.
 *
 * A client component only because of the search box. Everything it shows is
 * rendered on the server first (the data arrives as props), so the page reads
 * in full with no JavaScript at all; the search just hides what does not match.
 */

const SHORTCUTS_ID = "shortcuts";
const GESTURES_ID = "gestures";

function itemText(section: HelpSection, item: HelpItem): string {
  return plain(
    [
      section.title,
      item.name,
      item.forWhat,
      ...(item.steps ?? []),
      item.how ?? "",
      item.mouse ?? "",
      item.keys ?? "",
      item.finger ?? "",
      item.who ?? "",
      item.good ?? "",
    ].join(" "),
  ).toLowerCase();
}

/** Every word typed must appear somewhere, in any order. */
function matcher(query: string): (text: string) => boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return (text) => words.every((w) => text.includes(w));
}

export function HelpBrowser({
  sections,
  shortcuts,
  gestures,
}: {
  sections: HelpSection[];
  shortcuts: Shortcut[];
  gestures: Gesture[];
}) {
  const [query, setQuery] = useState("");
  const [announced, setAnnounced] = useState("");
  const searchId = useId();
  const hintId = useId();

  const q = query.trim();
  const matches = useMemo(() => matcher(q), [q]);

  const texts = useMemo(
    () => sections.map((s) => s.items.map((it) => itemText(s, it))),
    [sections],
  );
  const shortcutTexts = useMemo(
    () => shortcuts.map((s) => plain(`keyboard shortcut ${s.keys} ${s.does} ${s.where}`).toLowerCase()),
    [shortcuts],
  );
  const gestureTexts = useMemo(
    () => gestures.map((g) => plain(`touch finger gesture ${g.gesture} ${g.does} ${g.where}`).toLowerCase()),
    [gestures],
  );

  const visible = texts.map((list) => list.map((t) => !q || matches(t)));
  const sectionCounts = visible.map((list) => list.filter(Boolean).length);
  const shortcutVisible = shortcutTexts.map((t) => !q || matches(t));
  const gestureVisible = gestureTexts.map((t) => !q || matches(t));
  const shortcutCount = shortcutVisible.filter(Boolean).length;
  const gestureCount = gestureVisible.filter(Boolean).length;
  const functionCount = sectionCounts.reduce((a, b) => a + b, 0);
  const total = functionCount + shortcutCount + gestureCount;

  // Announce after typing pauses, so a screen reader is not talked over on
  // every key.
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (!q) setAnnounced("");
      else if (total === 0) setAnnounced(`Nothing matches “${q}”. Try a shorter word, or clear the search.`);
      else
        setAnnounced(
          `${functionCount} ${functionCount === 1 ? "topic matches" : "topics match"} “${q}”` +
            (shortcutCount + gestureCount > 0
              ? `, plus ${shortcutCount + gestureCount} ${shortcutCount + gestureCount === 1 ? "shortcut" : "shortcuts"}.`
              : "."),
        );
    }, 400);
    return () => window.clearTimeout(t);
  }, [q, total, functionCount, shortcutCount, gestureCount]);

  // The two tables sit just before the closing section ("Getting more help"),
  // so the page ends with where to go next rather than with a list of keys.
  const tail = sections.length > 0 ? sections.length - 1 : 0;
  const sectionToc = sections.map((s, i) => ({ id: s.id, title: s.title, count: sectionCounts[i] ?? 0 }));
  const toc = [
    ...sectionToc.slice(0, tail),
    { id: SHORTCUTS_ID, title: "Keyboard shortcuts", count: shortcutCount },
    { id: GESTURES_ID, title: "Touch gestures", count: gestureCount },
    ...sectionToc.slice(tail),
  ];

  const renderSection = (section: HelpSection, si: number) => (
          <section
            key={section.id}
            id={section.id}
            aria-labelledby={`${section.id}-h`}
            className={styles.section}
            hidden={!!q && sectionCounts[si] === 0}
          >
            <h2 id={`${section.id}-h`} className={styles.sectionHeading}>
              {section.title}
            </h2>
            {!q && section.intro?.map((p, i) => <p key={i} className={styles.intro}>{rich(p)}</p>)}
            {section.items.map((item, ii) => (
              <article
                key={item.id}
                className={styles.item}
                aria-labelledby={item.id}
                hidden={!visible[si]?.[ii]}
              >
                <h3 id={item.id} className={styles.itemHeading}>
                  {item.name}
                </h3>
                <dl className={styles.facts}>
                  <dt>What it’s for</dt>
                  <dd>{rich(item.forWhat)}</dd>
                  {(item.steps || item.how || item.mouse || item.keys || item.finger) && (
                    <>
                      <dt>How</dt>
                      <dd>
                        {item.how && <p>{rich(item.how)}</p>}
                        {item.steps && (
                          <ol className={styles.steps}>
                            {item.steps.map((s, k) => (
                              <li key={k}>{rich(s)}</li>
                            ))}
                          </ol>
                        )}
                        {(item.mouse || item.keys || item.finger) && (
                          <ul className={styles.ways}>
                            {item.mouse && (
                              <li>
                                <span className={styles.way}>With a mouse:</span> {rich(item.mouse)}
                              </li>
                            )}
                            {item.keys && (
                              <li>
                                <span className={styles.way}>With the keyboard:</span> {rich(item.keys)}
                              </li>
                            )}
                            {item.finger && (
                              <li>
                                <span className={styles.way}>With a finger:</span> {rich(item.finger)}
                              </li>
                            )}
                          </ul>
                        )}
                      </dd>
                    </>
                  )}
                  {item.who && (
                    <>
                      <dt>Who can use it</dt>
                      <dd>{rich(item.who)}</dd>
                    </>
                  )}
                  {item.good && (
                    <>
                      <dt>Good to know</dt>
                      <dd>{rich(item.good)}</dd>
                    </>
                  )}
                </dl>
              </article>
            ))}
          </section>
  );

  return (
    <div className={styles.layout}>
      <div className={styles.aside}>
        <form className={styles.search} role="search" onSubmit={(e) => e.preventDefault()}>
          <label htmlFor={searchId} className={styles.searchLabel}>
            Search the help
          </label>
          <div className={styles.searchRow}>
            <input
              id={searchId}
              type="search"
              className={styles.searchInput}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setQuery("");
              }}
              placeholder="For example: paste, timer, golden point"
              aria-describedby={hintId}
              autoComplete="off"
              spellCheck={false}
            />
            {q && (
              <button type="button" className={styles.clear} onClick={() => setQuery("")}>
                Clear
              </button>
            )}
          </div>
          <p id={hintId} className={styles.searchHint}>
            Shows only the topics that use every word you type.
          </p>
          <p className={styles.status} aria-live="polite" role="status">
            {announced}
          </p>
        </form>

        <nav aria-label="Help contents" className={styles.toc}>
          <h2 className={styles.tocHeading}>Contents</h2>
          <ol className={styles.tocList}>
            {toc.map((t) =>
              q && t.count === 0 ? null : (
                <li key={t.id}>
                  <a href={`#${t.id}`}>{t.title}</a>
                  {q && <span className={styles.tocCount}> ({t.count})</span>}
                </li>
              ),
            )}
          </ol>
          {q && total === 0 && <p className={styles.tocEmpty}>No topics match.</p>}
        </nav>
      </div>

      <div className={styles.content}>
        {q && total === 0 && (
          <div className={styles.empty}>
            <p>
              <strong>Nothing matches “{q}”.</strong>
            </p>
            <p>Try a shorter word, check the spelling, or clear the search to see everything.</p>
            <button type="button" className={styles.clear} onClick={() => setQuery("")}>
              Clear the search
            </button>
          </div>
        )}

        {sections.slice(0, tail).map((section, i) => renderSection(section, i))}

        <section
          id={SHORTCUTS_ID}
          aria-labelledby={`${SHORTCUTS_ID}-h`}
          className={styles.section}
          hidden={!!q && shortcutCount === 0}
        >
          <h2 id={`${SHORTCUTS_ID}-h`} className={styles.sectionHeading}>
            Keyboard shortcuts
          </h2>
          {!q && (
            <p className={styles.intro}>
              On a Mac press <kbd>Cmd</kbd>. On Windows press <kbd>Ctrl</kbd> wherever this list says <kbd>Cmd</kbd>.
            </p>
          )}
          <table className={styles.table}>
            <caption>Keys you can press, what they do, and where they work</caption>
            <thead>
              <tr>
                <th scope="col">Keys</th>
                <th scope="col">What it does</th>
                <th scope="col">Where</th>
              </tr>
            </thead>
            <tbody>
              {shortcuts.map((s, i) =>
                shortcutVisible[i] ? (
                  <tr key={i}>
                    <th scope="row">{rich(s.keys)}</th>
                    <td>{s.does}</td>
                    <td>{s.where}</td>
                  </tr>
                ) : null,
              )}
            </tbody>
          </table>
        </section>

        <section
          id={GESTURES_ID}
          aria-labelledby={`${GESTURES_ID}-h`}
          className={styles.section}
          hidden={!!q && gestureCount === 0}
        >
          <h2 id={`${GESTURES_ID}-h`} className={styles.sectionHeading}>
            Touch gestures
          </h2>
          <table className={styles.table}>
            <caption>Things you can do with a finger on a phone or tablet</caption>
            <thead>
              <tr>
                <th scope="col">Do this</th>
                <th scope="col">What happens</th>
                <th scope="col">Where</th>
              </tr>
            </thead>
            <tbody>
              {gestures.map((g, i) =>
                gestureVisible[i] ? (
                  <tr key={i}>
                    <th scope="row">{g.gesture}</th>
                    <td>{g.does}</td>
                    <td>{g.where}</td>
                  </tr>
                ) : null,
              )}
            </tbody>
          </table>
        </section>

        {sections.slice(tail).map((section, i) => renderSection(section, tail + i))}
      </div>
    </div>
  );
}
