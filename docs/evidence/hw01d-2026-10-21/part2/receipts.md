# Part 2 command receipts

Node 22; default test settings; Vite runner config loader only for the documented sandbox temp-write failure. All Cargo commands used the prescribed SDK, target directory, locked dependencies and offline mode. Raw logs retain the command and real EXIT.

| Receipt | EXIT | Counts printed by the command |
| --- | --- | --- |
| [build-final.log](build-final.log) | 0 | No test-count output |
| [build.log](build.log) | 0 | No test-count output |
| [cargo-lock.log](cargo-lock.log) | 0 | No test-count output |
| [cargo-metadata.log](cargo-metadata.log) | 0 | No test-count output |
| [cargo-test-1.log](cargo-test-1.log) | 0 | test result: ok. 985 passed; 0 failed; 11 ignored; 0 measured; 0 filtered out; finished in 198.39s; test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s; test result: ok. 13 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.46s; test result: ok. 15 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 5.42s; test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s |
| [cargo-test-final-1.log](cargo-test-final-1.log) | 0 | test result: ok. 987 passed; 0 failed; 11 ignored; 0 measured; 0 filtered out; finished in 213.47s; test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s; test result: ok. 13 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.92s; test result: ok. 15 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 13.30s; test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s |
| [cargo-test-final-2.log](cargo-test-final-2.log) | 0 | test result: ok. 987 passed; 0 failed; 11 ignored; 0 measured; 0 filtered out; finished in 221.74s; test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s; test result: ok. 13 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.55s; test result: ok. 15 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 5.46s; test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s |
| [clippy.log](clippy.log) | 0 | No test-count output |
| [detached-evidence-red.log](detached-evidence-red.log) | 1 | Test Files  1 failed (1); Tests  2 failed | 18 skipped (20) |
| [diff-check.log](diff-check.log) | 0 | No test-count output |
| [diff-final.log](diff-final.log) | 0 | No test-count output |
| [fmt-check.log](fmt-check.log) | 0 | No test-count output |
| [format-final-guards.log](format-final-guards.log) | 0 | No test-count output |
| [format-final-metrics.log](format-final-metrics.log) | 0 | No test-count output |
| [format-final-tests.log](format-final-tests.log) | 0 | No test-count output |
| [format-final.log](format-final.log) | 0 | No test-count output |
| [format.log](format.log) | 0 | No test-count output |
| [homework-final-focused.log](homework-final-focused.log) | 0 | Test Files  4 passed (4); Tests  181 passed (181) |
| [initial-focused-runner.log](initial-focused-runner.log) | 0 | Test Files  4 passed (4); Tests  86 passed (86) |
| [initial-focused.log](initial-focused.log) | 1 | No test-count output |
| [initial-typecheck.log](initial-typecheck.log) | 0 | No test-count output |
| [live-plan-red.log](live-plan-red.log) | 1 | Test Files  1 failed (1); Tests  1 failed | 3 skipped (4) |
| [mutant-invalidated-run.log](mutant-invalidated-run.log) | 1 | Test Files  1 failed (1); Tests  2 failed | 16 skipped (18) |
| [mutant-outside-frozen-scope.log](mutant-outside-frozen-scope.log) | 1 | Test Files  1 failed (1); Tests  2 failed | 16 skipped (18) |
| [mutant-quiz-metrics.log](mutant-quiz-metrics.log) | 1 | Test Files  1 failed (1); Tests  4 failed | 2 passed | 138 skipped (144) |
| [native-detached-fixed.log](native-detached-fixed.log) | 0 | test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 997 filtered out; finished in 0.49s; test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s; test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 13 filtered out; finished in 0.00s; test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 15 filtered out; finished in 0.00s |
| [native-detached.log](native-detached.log) | 101 | test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 997 filtered out; finished in 0.59s; test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s; test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 13 filtered out; finished in 0.00s; test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 15 filtered out; finished in 0.00s |
| [native-final-focused.log](native-final-focused.log) | 101 | test result: FAILED. 21 passed; 1 failed; 0 ignored; 0 measured; 976 filtered out; finished in 45.87s; test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s; test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 13 filtered out; finished in 0.00s; test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 15 filtered out; finished in 0.00s |
| [native-homework-focused.log](native-homework-focused.log) | 0 | test result: ok. 21 passed; 0 failed; 0 ignored; 0 measured; 975 filtered out; finished in 24.95s; test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s; test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 13 filtered out; finished in 0.00s; test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 15 filtered out; finished in 0.00s |
| [npm-test-1.log](npm-test-1.log) | 0 | Test Files  215 passed | 4 skipped (219); Tests  4514 passed | 6 skipped (4520) |
| [npm-test-final-1.log](npm-test-final-1.log) | 0 | Test Files  215 passed | 4 skipped (219); Tests  4540 passed | 6 skipped (4546) |
| [npm-test-final-2.log](npm-test-final-2.log) | 0 | Test Files  215 passed | 4 skipped (219); Tests  4546 passed | 6 skipped (4552) |
| [npm-test-final-3.log](npm-test-final-3.log) | 0 | Test Files  215 passed | 4 skipped (219); Tests  4546 passed | 6 skipped (4552) |
| [schema14-recheck.log](schema14-recheck.log) | 1 | # tests 26; # pass 25; # fail 1 |
| [schema14.log](schema14.log) | 1 | # tests 26; # pass 25; # fail 1 |
| [shared-fixture-final.log](shared-fixture-final.log) | 0 | Test Files  1 passed (1); Tests  144 passed (144) |
| [shared-fixture.log](shared-fixture.log) | 1 | Test Files  1 failed (1); Tests  2 failed | 134 passed (136) |
| [typecheck-final-metrics.log](typecheck-final-metrics.log) | 0 | No test-count output |
| [typecheck-final.log](typecheck-final.log) | 0 | No test-count output |
| [typecheck.log](typecheck.log) | 0 | No test-count output |
| [ui-final-focused.log](ui-final-focused.log) | 0 | Test Files  2 passed (2); Tests  40 passed (40) |
| [wiring-focused-fixed.log](wiring-focused-fixed.log) | 0 | Test Files  5 passed (5); Tests  175 passed (175) |
| [wiring-focused.log](wiring-focused.log) | 1 | Test Files  1 failed | 4 passed (5); Tests  1 failed | 174 passed (175) |
| [wiring-typecheck-fixed.log](wiring-typecheck-fixed.log) | 2 | No test-count output |
| [wiring-typecheck.log](wiring-typecheck.log) | 2 | No test-count output |
