import assert from "node:assert/strict";
import { runMutantVerification } from "./runMutants.mjs";

console.log("=== RUNNING MUTANT SURVIVAL CONTROL ===");
console.log("Testing that disabling assertion failures causes runMutantVerification to fail...\n");

let caughtError = null;
try {
  runMutantVerification({ disableAssertions: true });
} catch (err) {
  caughtError = err;
}

assert.ok(caughtError, "Verifier MUST fail when mutant assertions are disabled!");
assert.match(
  caughtError.message,
  /MUTATION VERIFIER FAILURE: Mutant .* survived!/,
  `Verifier error message must explicitly indicate mutant survival, got: ${caughtError.message}`
);

console.log("SURVIVAL CONTROL PASSED: Verifier correctly failed upon mutant survival.");
console.log(`Verified error message: "${caughtError.message}"\n`);
