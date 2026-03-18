# Skill: Grevm (Gravity EVM)

Grevm is a hybrid parallel EVM designed for Gravity. It employs aggressive parallelization (hybrid parallel EVM) and parallel Merklization.

## Vulnerability Patterns to Look For
* **State Dependency Conflicts:** When executing transactions in parallel, Grevm uses software transactional memory or dependency graphs. Look for cases where a transaction mutates a state that another concurrent transaction is reading, but the conflict isn't detected (e.g., specific opcodes like BALANCE or EXTCODEHASH missing from conflict tracking).
* **Parallel Merklization Races:** Modifying the Nested Trie structure concurrently. Look for data races in Trie node updates.
* **Cache Expirations:** Gravity Cache is used for high-performance state access. Look for scenarios where Cache is not properly invalidated after a state revert.
