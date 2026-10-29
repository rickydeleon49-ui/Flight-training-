import { describe, expect, it } from "vitest";

import { GUIDE_FORMAT_LIMIT, guideInlineText, parseGuideBody, parseGuideInline, type GuideBlock } from "./guideFormat";

const text = (value: string) => ({ kind: "text", text: value });

/** Each block's words, for checking structure without every inline detail. */
function outline(blocks: GuideBlock[]): unknown[] {
  return blocks.map((block) => {
    switch (block.kind) {
      case "paragraph":
      case "heading":
        return [block.kind, guideInlineText(block.content)];
      case "quote":
        return ["quote", outline(block.blocks)];
      case "list":
        return [block.ordered ? `ol@${block.start}` : "ul", block.items.map(outline)];
      case "table":
        return ["table", block.header.map(guideInlineText), block.rows.map((row) => row.map(guideInlineText))];
    }
  });
}

describe("plain guides read as they always have", () => {
  it("keeps unmarked text as its own paragraphs, line breaks included", () => {
    const body = "Lift opposes weight.\nThrust opposes drag.\n\nIn steady flight they balance.";
    expect(parseGuideBody(body)).toEqual([
      { kind: "paragraph", content: [text("Lift opposes weight.\nThrust opposes drag.")] },
      { kind: "paragraph", content: [text("In steady flight they balance.")] },
    ]);
  });

  it("leaves ordinary punctuation alone", () => {
    for (const line of [
      "Climb at 74 KIAS - then trim.",
      "V_X and V_Y differ; snake_case_names stay whole.",
      "2 * 3 = 6 and 5*4 is 20.",
      "Fuel: 26 gal (usable).",
      "Use 14 CFR 61.109 for the requirements.",
      "Check the A/B switch | then the mags.",
    ]) {
      expect(outline(parseGuideBody(line))).toEqual([["paragraph", line]]);
    }
  });

  it("returns nothing for an empty or blank body", () => {
    expect(parseGuideBody("")).toEqual([]);
    expect(parseGuideBody("  \n\t\n")).toEqual([]);
  });

  it("accepts Windows line endings", () => {
    expect(outline(parseGuideBody("- one\r\n- two\r\n"))).toEqual([["ul", [[["paragraph", "one"]], [["paragraph", "two"]]]]]);
  });
});

describe("lists", () => {
  it("reads dash, star and plus bullets as one list", () => {
    expect(outline(parseGuideBody("Before takeoff:\n- Fuel\n* Oil\n+ Controls"))).toEqual([
      ["paragraph", "Before takeoff:"],
      ["ul", [[["paragraph", "Fuel"]], [["paragraph", "Oil"]], [["paragraph", "Controls"]]]],
    ]);
  });

  it("keeps a numbered list's starting number", () => {
    expect(outline(parseGuideBody("3. Mixture rich\n4) Carb heat on"))).toEqual([
      ["ol@3", [[["paragraph", "Mixture rich"]], [["paragraph", "Carb heat on"]]]],
    ]);
  });

  it("nests an indented list under its item", () => {
    expect(outline(parseGuideBody("- Forces\n  - Lift\n  - Weight\n- Axes"))).toEqual([
      ["ul", [[["paragraph", "Forces"], ["ul", [[["paragraph", "Lift"]], [["paragraph", "Weight"]]]]], [["paragraph", "Axes"]]]],
    ]);
  });

  it("keeps a loose list together across blank lines", () => {
    expect(outline(parseGuideBody("1. Pitch\n\n2. Power\n\nAfter the list."))).toEqual([
      ["ol@1", [[["paragraph", "Pitch"]], [["paragraph", "Power"]]]],
      ["paragraph", "After the list."],
    ]);
  });

  it("ends a list where an unindented paragraph begins", () => {
    expect(outline(parseGuideBody("- Fuel\nThen start the engine."))).toEqual([
      ["ul", [[["paragraph", "Fuel"]]]],
      ["paragraph", "Then start the engine."],
    ]);
  });

  it("starts a numbered list separately from a bulleted one", () => {
    expect(outline(parseGuideBody("- a\n1. b"))).toEqual([
      ["ul", [[["paragraph", "a"]]]],
      ["ol@1", [[["paragraph", "b"]]]],
    ]);
  });
});

describe("quotes, headings and rules", () => {
  it("reads quoted lines as one quote", () => {
    expect(outline(parseGuideBody("> Aviate, navigate,\n> communicate."))).toEqual([["quote", [["paragraph", "Aviate, navigate,\ncommunicate."]]]]);
  });

  it("reads a heading inside a body", () => {
    expect(outline(parseGuideBody("## Stalls\nAngle of attack, not speed."))).toEqual([
      ["heading", "Stalls"],
      ["paragraph", "Angle of attack, not speed."],
    ]);
  });

  it("drops horizontal rules as separators", () => {
    expect(outline(parseGuideBody("Part one\n\n---\n\nPart two"))).toEqual([
      ["paragraph", "Part one"],
      ["paragraph", "Part two"],
    ]);
  });
});

describe("tables", () => {
  it("reads a pipe table with its header", () => {
    const body = "| Speed | Meaning |\n| --- | :---: |\n| Vx | Best angle |\n| Vy | Best rate |";
    expect(outline(parseGuideBody(body))).toEqual([
      ["table", ["Speed", "Meaning"], [["Vx", "Best angle"], ["Vy", "Best rate"]]],
    ]);
  });

  it("gives every row the header's columns", () => {
    const body = "A | B\n---|---\nonly one |\n1 | 2 | 3";
    expect(outline(parseGuideBody(body))).toEqual([["table", ["A", "B"], [["only one", ""], ["1", "2"]]]]);
  });

  it("keeps an escaped pipe inside a cell", () => {
    expect(outline(parseGuideBody("| Rule |\n|---|\n| a \\| b |"))).toEqual([["table", ["Rule"], [["a | b"]]]]);
  });

  it("needs a separator row; a lone pipe line is a paragraph", () => {
    expect(outline(parseGuideBody("| not | a table |"))).toEqual([["paragraph", "| not | a table |"]]);
  });
});

describe("inline marks", () => {
  it("reads bold, italic and code", () => {
    expect(parseGuideInline("Set **mixture** to *rich* and `CARB HEAT` on")).toEqual([
      text("Set "),
      { kind: "strong", children: [text("mixture")] },
      text(" to "),
      { kind: "em", children: [text("rich")] },
      text(" and "),
      { kind: "code", text: "CARB HEAT" },
      text(" on"),
    ]);
  });

  it("reads underscores as emphasis only around whole words", () => {
    expect(parseGuideInline("__Always__ check _both_ tanks")).toEqual([
      { kind: "strong", children: [text("Always")] },
      text(" check "),
      { kind: "em", children: [text("both")] },
      text(" tanks"),
    ]);
  });

  it("nests italic inside bold", () => {
    expect(parseGuideInline("**never *ever* skip**")).toEqual([
      { kind: "strong", children: [text("never "), { kind: "em", children: [text("ever")] }, text(" skip")] },
    ]);
  });

  it("leaves unmatched or spaced marks as typed", () => {
    expect(parseGuideInline("**open bold")).toEqual([text("**open bold")]);
    expect(parseGuideInline("a * b * c")).toEqual([text("a * b * c")]);
    expect(parseGuideInline("** spaced **")).toEqual([text("** spaced **")]);
  });

  it("honors backslash escapes", () => {
    expect(parseGuideInline("\\*not italic\\*")).toEqual([text("*not italic*")]);
  });
});

describe("nothing is loaded or run", () => {
  it("shows a link as plain words with its address", () => {
    expect(parseGuideInline("See [the PHAK](https://www.faa.gov/phak) chapter 4")).toEqual([
      text("See the PHAK (https://www.faa.gov/phak) chapter 4"),
    ]);
    expect(parseGuideInline("[https://faa.gov](https://faa.gov)")).toEqual([text("https://faa.gov")]);
  });

  it("shows an image only by its description", () => {
    expect(parseGuideInline("![Lift diagram](https://example.com/x.png)")).toEqual([text("Lift diagram")]);
  });

  it("keeps HTML as the text that was written", () => {
    const body = '<img src=x onerror="alert(1)"> <script>alert(1)</script>';
    expect(parseGuideBody(body)).toEqual([{ kind: "paragraph", content: [text(body)] }]);
  });
});

describe("bounded work", () => {
  it("shows very long text as plain paragraphs without parsing it", () => {
    const body = `${"**".repeat(GUIDE_FORMAT_LIMIT / 2)}\n\n- not a list`;
    const blocks = parseGuideBody(body);
    expect(blocks).toHaveLength(2);
    expect(blocks.every((block) => block.kind === "paragraph" && block.content[0]?.kind === "text")).toBe(true);
  });

  it("stops nesting deep quotes and lists", () => {
    const deep = parseGuideBody(">>>>>>>> deep");
    let depth = 0;
    let current: GuideBlock | undefined = deep[0];
    while (current?.kind === "quote") {
      depth += 1;
      current = current.blocks[0];
    }
    expect(depth).toBeLessThanOrEqual(4);
    expect(current?.kind).toBe("paragraph");
  });

  it("handles a long run of marks quickly", () => {
    const started = performance.now();
    parseGuideBody(`${"*a ".repeat(3000)}\n${"_".repeat(5000)}\n${"[".repeat(5000)}`);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});


describe("double-escaped Gemini guide bodies", () => {
  it("displays old saved headings and bullets without changing the body", () => {
    const saved = "## Page Breakdown\\n\\n- Page 1: Lift\\n- Page 2: Weight";
    expect(outline(parseGuideBody(saved))).toEqual([
      ["heading", "Page Breakdown"],
      ["ul", [[["paragraph", "Page 1: Lift"]], [["paragraph", "Page 2: Weight"]]]],
    ]);
    expect(saved).toBe("## Page Breakdown\\n\\n- Page 1: Lift\\n- Page 2: Weight");
  });

  it("repairs literal \\r\\n pairs too, leaving no stray \\r", () => {
    const saved = "## Page Breakdown\\r\\n\\r\\n- Page 1: Lift\\r\\n- Page 2: Weight";
    expect(outline(parseGuideBody(saved))).toEqual([
      ["heading", "Page Breakdown"],
      ["ul", [[["paragraph", "Page 1: Lift"]], [["paragraph", "Page 2: Weight"]]]],
    ]);
    expect(JSON.stringify(parseGuideBody(saved))).not.toContain("\\\\r");
  });

  it("leaves literal escapes alone in bodies with real newlines", () => {
    const body = "## Notes\nLiteral \\n stays here.";
    expect(outline(parseGuideBody(body))).toEqual([["heading", "Notes"], ["paragraph", "Literal \\n stays here."]]);
  });
});
