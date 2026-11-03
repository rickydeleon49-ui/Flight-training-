# Agent notes

`CLAUDE.md` holds the stack, gates, data-safety rules and conventions. They
apply to every agent; read it first.

## When implementing a change

- Work only in the checkout or worktree you were given. Do not commit, push,
  open pull requests, reset, stash, clean, or install new packages unless the
  task says so; `npm ci` from the committed lockfile is fine.
- Use Node 22 for every npm and test command.
- Run all gates from `CLAUDE.md` that the change touches before handing back,
  and report the exact commands and results.
- Every new guard needs a test that fails without it.
- No real API keys, real profiles, private documents or network access beyond
  loopback test servers. Use synthetic fixtures.
- Migrations only add. No new dependencies without the maintainer's approval.
- Never write absolute local paths, account names or personal email addresses
  into the repository; `npm run hygiene` checks this.

## Gotchas

- macOS has no `timeout` command.
- Some sandboxes cannot write `.git`, run `pgrep` or open sockets; tests that
  need those must be rerun outside the sandbox before they count. If a sandbox
  blocks Vite's temporary config write, run Vitest with `--configLoader runner`.
- A cancelled extraction worker returning `Ok(Err(CANCELLED))` means the
  cancellation was honoured; it is not a lost cancel.
