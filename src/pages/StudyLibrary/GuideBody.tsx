/**
 * One study-guide body, shown with its formatting (P54-03).
 *
 * The text is read by `parseGuideBody` and drawn with ordinary elements only:
 * no links, no images and no HTML, so a guide can never load or run anything.
 * Plain text shows as the same paragraphs it always did.
 */
import { Fragment, type ReactNode } from "react";

import { parseGuideBody, type GuideBlock, type GuideInline } from "@/logic/guideFormat";

function inline(content: GuideInline[]): ReactNode {
  return content.map((part, index) => {
    switch (part.kind) {
      case "text":
        return <Fragment key={index}>{part.text}</Fragment>;
      case "code":
        return <code key={index}>{part.text}</code>;
      case "strong":
        return <strong key={index}>{inline(part.children)}</strong>;
      case "em":
        return <em key={index}>{inline(part.children)}</em>;
    }
  });
}

function blocks(content: GuideBlock[]): ReactNode {
  return content.map((block, index) => {
    switch (block.kind) {
      case "paragraph":
        return <p key={index}>{inline(block.content)}</p>;
      case "heading":
        return (
          <p key={index} className="guide-body__heading strong">
            {inline(block.content)}
          </p>
        );
      case "quote":
        return <blockquote key={index}>{blocks(block.blocks)}</blockquote>;
      case "list": {
        const items = block.items.map((item, itemIndex) => {
          // A one-paragraph item is shown inline, as a tight list item.
          const only = item.length === 1 ? item[0] : undefined;
          return <li key={itemIndex}>{only?.kind === "paragraph" ? inline(only.content) : blocks(item)}</li>;
        });
        return block.ordered ? (
          <ol key={index} start={block.start === 1 ? undefined : block.start}>
            {items}
          </ol>
        ) : (
          <ul key={index}>{items}</ul>
        );
      }
      case "table":
        return (
          <div key={index} className="guide-body__table" role="region" aria-label="Table" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  {block.header.map((cell, cellIndex) => (
                    <th key={cellIndex} scope="col">
                      {inline(cell)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex}>{inline(cell)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
    }
  });
}

interface GuideBodyProps {
  text: string;
  className?: string;
}

export function GuideBody({ text, className }: GuideBodyProps) {
  return <div className={["guide-body", className].filter(Boolean).join(" ")}>{blocks(parseGuideBody(text))}</div>;
}
