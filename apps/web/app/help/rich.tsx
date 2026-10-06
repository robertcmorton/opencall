import { Fragment, type ReactNode } from "react";

/**
 * The help text's two marks, kept as plain strings in content.ts so the words
 * stay easy to read and edit:
 *
 *   **Name**   a name as it appears on screen  -> <strong>
 *   `Cmd+K`    a key or keys to press          -> <kbd>
 *
 * Nothing else is interpreted. The text is ours, not anybody's input, but it
 * is still rendered as React text rather than HTML.
 */
export function rich(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      // A narrow column may break a combination after a "+", never inside a key name.
      const keys = part.slice(1, -1).split("+");
      return (
        <kbd key={i}>
          {keys.map((k, j) => (
            <Fragment key={j}>
              {j > 0 && (
                <>
                  +<wbr />
                </>
              )}
              {k}
            </Fragment>
          ))}
        </kbd>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

/** The same text with its marks taken out, for searching. */
export function plain(text: string): string {
  return text.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1");
}
