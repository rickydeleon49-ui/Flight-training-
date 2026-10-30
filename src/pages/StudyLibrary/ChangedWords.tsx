import { Fragment } from "react";

import { wordDiff } from "@/logic/textDiff";

/**
 * One version of a text, with the words that differ from the other version
 * highlighted (JSDIFF-01). `show="added"` renders `text` as the new version
 * (its new words in <ins>); `show="removed"` renders `text` as the earlier
 * version (its dropped words in <del>). Either way the visible text is `text`
 * exactly. Text children only; long texts show plainly.
 */
export function ChangedWords({ text, other, show }: { text: string; other: string | undefined; show: "added" | "removed" }) {
  if (other === undefined) return <>{text}</>;
  // Diffing from the other version makes the "same" parts this version's own text.
  const parts = wordDiff(other, text);
  if (!parts) return <>{text}</>;
  return (
    <>
      {parts.map((part, index) =>
        part.kind === "same" ? (
          <Fragment key={index}>{part.text}</Fragment>
        ) : part.kind === "removed" ? null : show === "added" ? (
          <ins className="changed-words" key={index}><span className="visually-hidden">added: </span>{part.text}</ins>
        ) : (
          <del className="changed-words" key={index}><span className="visually-hidden">removed: </span>{part.text}</del>
        ),
      )}
    </>
  );
}
