# A2 integration evidence — 4 October 2026

Codex completed and independently reviewed Gemini's candidate on main 53ae33505621fa0cd209a8e7d071cd8fef5cf200. Source is accepted for integration; the containing PR supplies its exact head, required CI and publication outcome. The owner and Gemini worktrees were preserved. Synthetic data only.

Host: Windows 11 Pro 10.0.26200 x64, Ryzen 7 5800X3D, 34,282,184,704 bytes RAM. Node 24.16.0/npm 11.13.0, Rust/Cargo 1.98.1. Full source checks ran sequentially in the coordinator clone, using committed npm/Cargo locks and the existing Rust target cache. GitHub uses Node 22. The Unix helper-only check used existing Ubuntu WSL Node 22.22.1/npm 9.2.0 and an LF-preserving archive of the unchanged checked-in .claude helpers; no app matrix ran concurrently.

- [Gemini's incomplete frontend run](gemini-incomplete-frontend.txt): 2 failed files, 2,313 pass/one failed assertion/four skips; preflight module failed collection. This is NOT acceptance.
- [Focused corrected source](focused.txt): eight files, 1,473 pass, no skips, exit 0; 37.19 seconds.
- [Independent historical diagnostics](independent-diagnostics.txt): eight files, 649 pass, no skips, exit 0; 4.94 seconds. Includes the prepared 181 cases/all 57 mandatory seam assertions and prior write-loss regressions. Temporary diagnostic copies removed before default discovery.
- [Sequential gate metadata](results.json): actual command/start/duration/exit. Native Windows helper attempt fails at /bin/sh, not an app check; supported-host follow-up below replaces that unavailable step. Final whitespace was run separately after notes.
- [Dependency install](gate-01.txt): npm ci, exit 0, zero reported npm vulnerabilities.
- [Full frontend](gate-02.txt): 77 files pass/three skipped; 2,348 tests pass/four intentional skips, exit 0; 56.37 seconds of Vitest time.
- [Build/typecheck](gate-03.txt): exit 0, Vite 1.82 seconds, main JS 385.63 kB/120.09 kB gzip. No speedup claim.
- [Rust formatting](gate-04.txt), [strict Clippy](gate-05.txt), [native tests](gate-06.txt): exits 0; 302 pass/six ignored. Native tests 30.83 seconds, whole command 137.202 seconds with incremental build. Windows case-sensitive identity case returns early; it is NOT APFS coverage. Directory-link and Unix-only cfg coverage must be checked on Mac.
- [Cargo lock](gate-07.txt) and [unchanged 0.5.3 version policy](gate-08.txt): exits 0.
- [Native Windows Unix-helper attempt](gate-09.txt): unavailable /bin/sh, exit 1, no legitimate helper cases ran.
- [First WSL helper attempt](gate-09-wsl-crlf.txt): 17 pass/12 fail, exit 1; Windows archive checkout converted shell hashbangs to CRLF. Kept as failed environment evidence.
- [Corrected supported-host helper run](gate-09-wsl.txt): all 29 pass, zero skips, exit 0, 22.697 seconds. Narrow .gitattributes rules and LF-preserving archive restore original committed shell bytes. No .claude helper implementation or assertions changed.
- [Exact source manifest](source-manifest.json): Windows working bytes and Git-normalized blob IDs. Use Git blobs across differing checkout line endings. Paths exclude this evidence/documentation to avoid self-reference.

Environment-only Vite startup/file-resolution restrictions were retried with the same source outside the sandbox; zero collected tests from those attempts are not passes. A command-line quoting attempt emitted no helper test output and is also not evidence of a pass. Protected raw logs remain local; published logs replace clone/cache/synthetic temporary paths, retaining actual output/counts/exits.

See [acceptance](../../A2_INTEGRATION_ACCEPTANCE_2026-10-04.md) and [Mac next assignment](../../CLAUDE_MAC_A2_ACCEPTED_SOURCE_VERIFICATION_PROMPT_2026-10-04.md). No installer, installed Mac/APFS/WKWebView, live Gemini or release readiness claim.

Bounded benchmark-setup smoke: a temporary copy of the unchanged benchmark entry point restricted SIZES to small (100 materials/100 actions/30 journal/50 questions), REPEATS to one and WARMUPS to zero. [Raw result](bounded-benchmark-smoke.txt) and [observations](bounded-benchmark-smoke.json): one test pass, exit 0, 11.27 seconds of test time (13.11 total). Temporary source copy removed. This verifies compatible setup/scenario execution, not a comparative speedup or the official multi-tier timing matrix. The benchmark’s internal Git call lacked core.longpaths=true and produced false deep-path deletion warnings on Windows; no such files were deleted. The acceptance manifest and coordinator’s long-path-aware diff are the authoritative source identity.

Published text logs also trim trailing whitespace and surplus terminal blank lines; protected original bytes remain local. Output semantics and failures are retained.
