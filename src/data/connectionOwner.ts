import { DatabaseDisabledError } from "./persistenceErrors";

/**
 * One owner at a time for a single-connection SQLite driver.
 *
 * node:sqlite (tests) and sql.js (plain browser) each hold exactly one
 * connection, and SQLite transactions belong to a connection, not to a
 * caller. A multi-statement save awaits between its statements; without an
 * owner, any other caller's `execute` in that gap runs *inside* the save's
 * transaction, is acknowledged, and is then undone if the save rolls back.
 * (sql.js `export()` is worse: it closes and reopens the connection, silently
 * rolling back whatever transaction is open.)
 *
 * So every public driver method runs through `exclusive`, which starts an
 * operation only after every earlier one on the connection has finished,
 * successfully or not. Inside an operation, drivers use their raw handle,
 * never their own public methods, so an operation cannot wait on itself.
 * Public `execute` refuses transaction-control statements: a transaction
 * spread over several public calls could be joined by any other caller in
 * between, so only a driver's atomic operations may open one.
 *
 * The desktop (Tauri) driver does not use this: its multi-statement saves are
 * single native commands that pin one pooled connection in Rust.
 */
export interface ConnectionOwner {
  /** Run `work` once every earlier operation on this connection has finished. */
  exclusive<T>(work: () => Promise<T> | T): Promise<T>;
}

const TRANSACTION_KEYWORDS = new Set([
  "BEGIN",
  "COMMIT",
  "END",
  "ROLLBACK",
  "SAVEPOINT",
  "RELEASE",
]);

function isIdStart(code: number): boolean {
  return (
    (code >= 0x41 && code <= 0x5a) || // A-Z
    (code >= 0x61 && code <= 0x7a) || // a-z
    code === 0x5f ||                  // _
    code > 0x7f                       // non-ASCII (code >= 128)
  );
}

function isIdPart(code: number): boolean {
  return (
    (code >= 0x41 && code <= 0x5a) || // A-Z
    (code >= 0x61 && code <= 0x7a) || // a-z
    (code >= 0x30 && code <= 0x39) || // 0-9
    code === 0x5f ||                  // _
    code === 0x24 ||                  // $
    code > 0x7f                       // non-ASCII (code >= 128)
  );
}

function isSqliteWhitespace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d || code === 0x0c;
}

function getAsciiKeyword(sql: string, start: number, end: number): string | null {
  const len = end - start;
  if (len < 2 || len > 9) return null;
  let word = "";
  for (let j = start; j < end; j++) {
    const code = sql.charCodeAt(j);
    if (code >= 0x61 && code <= 0x7a) {
      word += String.fromCharCode(code - 32);
    } else if (code >= 0x41 && code <= 0x5a) {
      word += sql[j];
    } else {
      return null;
    }
  }
  return word;
}

/**
 * Index of the LF that ends the `--` line comment starting at `start`, or the
 * input length if none follows. SQLite ends a line comment only at LF (or the
 * input end); a CR inside it is comment text, not a terminator. The normal
 * scan and the CREATE/TRIGGER lookahead both use this so they cannot disagree.
 */
function lineCommentEnd(sql: string, start: number): number {
  const end = sql.indexOf("\n", start + 2);
  return end === -1 ? sql.length : end;
}

/**
 * Scan a SQL string for transaction control statements (BEGIN, COMMIT, END,
 * ROLLBACK, SAVEPOINT, RELEASE).
 *
 * It skips whitespace, line comments (`-- ...` up to LF), block comments (`/* ... *\/`),
 * and statement separators (`;`), and treats quoted literals/identifiers as
 * opaque tokens. It recognizes `CREATE [TEMP|TEMPORARY] TRIGGER` so that valid
 * trigger definition bodies containing `BEGIN ... END` are preserved.
 */
export function hasTransactionControl(sql: string): boolean {
  let i = 0;
  const len = sql.length;
  let atStatementStart = true;
  let triggerState: "none" | "header" | "body" = "none";
  let onTargetState: "before_on" | "expect_first" | "expect_dot_or_done" | "expect_second" | "done" = "before_on";
  let lastCharWasDot = false;
  let caseDepth = 0;

  while (i < len) {
    const ch = sql[i]!;

    // 1. Whitespace: only ASCII whitespace and token-boundary UTF-8 BOM separate tokens in SQLite
    if (
      ch === " " ||
      ch === "\t" ||
      ch === "\n" ||
      ch === "\r" ||
      ch === "\f" ||
      ch === "\uFEFF"
    ) {
      i++;
      continue;
    }

    // 2. Block comment /* ... */
    if (ch === "/" && sql[i + 1] === "*") {
      i += 2;
      while (i < len && !(sql[i] === "*" && sql[i + 1] === "/")) {
        i++;
      }
      i += 2;
      continue;
    }

    // 3. Line comment -- ...
    if (ch === "-" && sql[i + 1] === "-") {
      i = lineCommentEnd(sql, i);
      continue;
    }

    // In trigger header, if we expected a qualification dot and got anything else
    // (or a decimal number like .5), the ON target clause is complete.
    if (triggerState === "header" && onTargetState === "expect_dot_or_done") {
      if (ch !== "." || (i + 1 < len && sql.charCodeAt(i + 1) >= 0x30 && sql.charCodeAt(i + 1) <= 0x39)) {
        onTargetState = "done";
      }
    }

    // 4. Statement separator ;
    if (ch === ";") {
      i++;
      lastCharWasDot = false;
      if (triggerState !== "header") {
        atStatementStart = true;
      }
      continue;
    }

    // Member access dot or leading decimal point
    if (ch === ".") {
      if (i + 1 < len && sql.charCodeAt(i + 1) >= 0x30 && sql.charCodeAt(i + 1) <= 0x39) {
        lastCharWasDot = false;
        i++;
        while (i < len) {
          const code = sql.charCodeAt(i);
          if (
            (code >= 0x30 && code <= 0x39) ||
            (code >= 0x41 && code <= 0x5a) ||
            (code >= 0x61 && code <= 0x7a) ||
            code === 0x2e || // .
            code === 0x5f
          ) {
            i++;
          } else {
            break;
          }
        }
        atStatementStart = false;
        continue;
      }

      if (triggerState === "header" && onTargetState === "expect_dot_or_done") {
        onTargetState = "expect_second";
      }
      lastCharWasDot = true;
      i++;
      continue;
    }

    // 5. String literal '...'
    if (ch === "'") {
      lastCharWasDot = false;
      i++;
      while (i < len) {
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            i += 2;
          } else {
            i++;
            break;
          }
        } else {
          i++;
        }
      }
      if (triggerState === "header") {
        if (onTargetState === "expect_first") {
          onTargetState = "expect_dot_or_done";
        } else if (onTargetState === "expect_second") {
          onTargetState = "done";
        }
      }
      atStatementStart = false;
      continue;
    }

    // 6. Quoted identifier "..."
    if (ch === '"') {
      lastCharWasDot = false;
      i++;
      while (i < len) {
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') {
            i += 2;
          } else {
            i++;
            break;
          }
        } else {
          i++;
        }
      }
      if (triggerState === "header") {
        if (onTargetState === "expect_first") {
          onTargetState = "expect_dot_or_done";
        } else if (onTargetState === "expect_second") {
          onTargetState = "done";
        }
      }
      atStatementStart = false;
      continue;
    }

    // 7. Backtick identifier `...`
    if (ch === "`") {
      lastCharWasDot = false;
      i++;
      while (i < len) {
        if (sql[i] === "`") {
          if (sql[i + 1] === "`") {
            i += 2;
          } else {
            i++;
            break;
          }
        } else {
          i++;
        }
      }
      if (triggerState === "header") {
        if (onTargetState === "expect_first") {
          onTargetState = "expect_dot_or_done";
        } else if (onTargetState === "expect_second") {
          onTargetState = "done";
        }
      }
      atStatementStart = false;
      continue;
    }

    // 8. Bracket identifier [...]
    if (ch === "[") {
      lastCharWasDot = false;
      i++;
      while (i < len && sql[i] !== "]") {
        i++;
      }
      if (i < len) i++;
      if (triggerState === "header") {
        if (onTargetState === "expect_first") {
          onTargetState = "expect_dot_or_done";
        } else if (onTargetState === "expect_second") {
          onTargetState = "done";
        }
      }
      atStatementStart = false;
      continue;
    }

    // 9. Bound parameters / variable tokens: :name, @name, $name, #name
    if (ch === ":" || ch === "@" || ch === "$" || ch === "#") {
      lastCharWasDot = false;
      i++;
      let idCharCount = 0;
      while (i < len) {
        const code = sql.charCodeAt(i);
        if (isIdPart(code)) {
          idCharCount++;
          i++;
        } else if (code === 0x3a && sql.charCodeAt(i + 1) === 0x3a) {
          // Namespace separator ::
          i += 2;
        } else if (code === 0x28 && idCharCount > 0) {
          // Tcl-style parenthesized variable suffix, e.g. $val(case) or $val::ns(case)
          // In SQLite tokenize.c:
          // do { i++; } while ( (c=z[i])!=0 && !sqlite3Isspace(c) && c!=')' );
          // if ( c==')' ) i++;
          i++; // consume '('
          while (
            i < len &&
            !isSqliteWhitespace(sql.charCodeAt(i)) &&
            sql[i] !== ")"
          ) {
            i++;
          }
          if (i < len && sql[i] === ")") {
            i++; // consume ')'
          }
          break;
        } else {
          break;
        }
      }
      atStatementStart = false;
      continue;
    }

    // Positional parameter: ? or ?123
    if (ch === "?") {
      lastCharWasDot = false;
      i++;
      while (i < len && sql.charCodeAt(i) >= 0x30 && sql.charCodeAt(i) <= 0x39) {
        i++;
      }
      atStatementStart = false;
      continue;
    }

    // 10. Numeric literals: starts with a digit
    if (ch >= "0" && ch <= "9") {
      lastCharWasDot = false;
      i++;
      while (i < len) {
        const code = sql.charCodeAt(i);
        if (
          (code >= 0x30 && code <= 0x39) ||
          (code >= 0x41 && code <= 0x5a) ||
          (code >= 0x61 && code <= 0x7a) ||
          code === 0x2e || // .
          code === 0x5f
        ) {
          i++;
        } else {
          break;
        }
      }
      atStatementStart = false;
      continue;
    }

    // 11. Words / identifiers / keywords
    const firstCode = sql.charCodeAt(i);
    if (isIdStart(firstCode)) {
      const wasPrecededByDot = lastCharWasDot;
      lastCharWasDot = false;

      const start = i;
      i++;
      while (i < len && isIdPart(sql.charCodeAt(i))) {
        i++;
      }
      const word = getAsciiKeyword(sql, start, i);

      if (triggerState === "header") {
        if (onTargetState === "expect_first") {
          onTargetState = "expect_dot_or_done";
          atStatementStart = false;
          continue;
        }
        if (onTargetState === "expect_second") {
          onTargetState = "done";
          atStatementStart = false;
          continue;
        }

        if (word === "CASE") {
          caseDepth++;
        } else if (word === "END" && !wasPrecededByDot) {
          if (caseDepth > 0) caseDepth--;
        } else if (word === "ON" && caseDepth === 0 && onTargetState === "before_on") {
          onTargetState = "expect_first";
        } else if (word === "BEGIN" && caseDepth === 0 && onTargetState === "done" && !wasPrecededByDot) {
          triggerState = "body";
          atStatementStart = true;
        }
        atStatementStart = false;
        continue;
      }

      if (triggerState === "body") {
        if (word === "CASE") {
          caseDepth++;
          atStatementStart = false;
        } else if (word === "END") {
          if (caseDepth > 0) {
            caseDepth--;
            atStatementStart = false;
          } else if (atStatementStart) {
            // Real outer END of the trigger definition
            triggerState = "none";
            atStatementStart = false;
          } else {
            atStatementStart = false;
          }
        } else {
          atStatementStart = false;
        }
        continue;
      }

      // Outside trigger (triggerState === "none")
      if (word === "CASE") {
        caseDepth++;
      } else if (word === "END") {
        if (caseDepth > 0) {
          caseDepth--;
        }
      }

      if (atStatementStart) {
        if (word !== null && TRANSACTION_KEYWORDS.has(word) && caseDepth === 0) {
          return true;
        }
        if (word === "CREATE") {
          // Check if this statement is a CREATE TRIGGER
          let j = i;
          let isTrigger = false;
          while (j < len) {
            while (
              j < len &&
              (sql[j] === " " ||
                sql[j] === "\t" ||
                sql[j] === "\n" ||
                sql[j] === "\r" ||
                sql[j] === "\f" ||
                sql[j] === "\uFEFF")
            ) {
              j++;
            }
            if (sql[j] === "/" && sql[j + 1] === "*") {
              j += 2;
              while (j < len && !(sql[j] === "*" && sql[j + 1] === "/")) j++;
              j += 2;
              continue;
            }
            if (sql[j] === "-" && sql[j + 1] === "-") {
              j = lineCommentEnd(sql, j);
              continue;
            }
            if (j < len && isIdStart(sql.charCodeAt(j))) {
              const nextStart = j;
              j++;
              while (j < len && isIdPart(sql.charCodeAt(j))) j++;
              const nextWord = getAsciiKeyword(sql, nextStart, j);
              if (nextWord === "TRIGGER") {
                isTrigger = true;
                break;
              }
              if (nextWord === "TEMP" || nextWord === "TEMPORARY") {
                continue;
              }
              break;
            } else {
              break;
            }
          }
          if (isTrigger) {
            triggerState = "header";
            onTargetState = "before_on";
          }
        }
        atStatementStart = false;
      }
      continue;
    }

    lastCharWasDot = false;
    i++;
  }

  return false;
}

export function refuseTransactionControl(sql: string): void {
  if (hasTransactionControl(sql)) {
    throw new Error(
      "Transactions on this connection must go through one of the driver's atomic operations.",
    );
  }
}

/** Roll back a transaction an operation left open; no open transaction is fine. */
export function rollbackIfOpen(exec: (sql: string) => void): void {
  try {
    exec("ROLLBACK");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/no transaction is active/i.test(message)) throw error;
  }
}

/**
 * `releaseAfterFailure` runs after an operation fails, before the next one
 * starts, and must leave the connection outside any transaction. If it cannot,
 * the connection's state is unknown, so every later operation is refused with
 * that error rather than risk running inside an abandoned transaction.
 */
export function createConnectionOwner(releaseAfterFailure: () => void): ConnectionOwner {
  let tail: Promise<unknown> = Promise.resolve();
  let broken: Error | null = null;
  const settle = () => undefined;

  return {
    exclusive<T>(work: () => Promise<T> | T): Promise<T> {
      const operation = tail.then(async () => {
        if (broken) throw broken;
        try {
          return await work();
        } catch (error) {
          try {
            releaseAfterFailure();
          } catch (releaseError) {
            broken = new DatabaseDisabledError({ cause: releaseError });
          }
          throw error;
        }
      });
      tail = operation.then(settle, settle);
      return operation;
    },
  };
}
