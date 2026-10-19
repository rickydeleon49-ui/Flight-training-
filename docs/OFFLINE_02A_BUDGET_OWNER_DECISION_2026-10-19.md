# OFFLINE-02a owner decision — 19 October 2026

The owner was asked whether to retain the complete SQLite search index and approve **750 ms for the 10,000-page cold opening check** and **3× canonical text bytes for added index storage**, or retain the original limits and pursue a larger representation redesign.

The owner's answer was: **“Approve the proposed budgets (Recommended)”**.

Adopt these two limits for the existing frozen corpora and exact original denominator. Warm-query, 2-second command deadline, response size, memory, consistency, destination validation and release gates are unchanged. The original manifest, 300 ms/1.0× misses and raw receipts remain historical evidence, not rewritten passes.

The proposal's separate 3-second limit for 30k validation was not stated in the approval question and is **not adopted**. Retain the original **≤1 second or background initialization before search is enabled** requirement. Provide an explicit `index_preparing` response during initialization so the caller can distinguish setup from a running search timeout. No partly validated search is allowed.

This decision authorizes the two budget amendments and their verification. It is not independent acceptance of the implementation, a merge approval, or permission to enable the feature in releases. Next: final native verification, independent source review, then normal exact-head PR/CI integration before 02b.
