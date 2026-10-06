import type { Metadata } from "next";
import Link from "next/link";
import { BackLink } from "../../components/BackLink";
import { GESTURES, SECTIONS, SHORTCUTS } from "./content";
import { HelpBrowser } from "./HelpBrowser";
import styles from "./help.module.css";
import { Icon } from "../../components/ui";

export const metadata: Metadata = {
  title: "Help — OpenCall",
  description: "Every part of OpenCall, explained in plain words.",
};

/**
 * Help: every function on the site, what it is for and how to use it.
 *
 * A server component. The words live in content.ts and are rendered here in
 * full, so the page reads without JavaScript; HelpBrowser adds the search.
 */
export default function HelpPage() {
  const topics = SECTIONS.reduce((n, s) => n + s.items.length, 0);
  return (
    <div className={styles.page}>
      <a href="#main" className={styles.skip}>
        Skip to contents
      </a>
      {/* Pinned to the top while you read, so the way back is never a long
          scroll away (asked for 6 Oct). */}
      <header className={styles.header}>
        <BackLink />
        <Link href="/admin" className={styles.homeLink} prefetch={false}>
          Dashboard
        </Link>
        <a href="#main" className={styles.toTop}>
          {Icon.arrowUp} Top
        </a>
      </header>
      <main id="main" tabIndex={-1} className={styles.main}>
        <h1 className={styles.title}>Help</h1>
        <p className={styles.lede}>
          Everything OpenCall can do, in plain words. Each topic says what a thing is for, how to use it — with a mouse,
          the keyboard or a finger — and who is allowed to. There are {topics} topics, plus lists of keyboard shortcuts
          and touch gestures. Search for a word, or pick a part from the contents.
        </p>
        <HelpBrowser sections={SECTIONS} shortcuts={SHORTCUTS} gestures={GESTURES} />
      </main>
    </div>
  );
}
