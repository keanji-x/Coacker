# Skill: AptosBFT Consensus in Gravity

Gravity uses AptosBFT (a variant of DiemBFT/HotStuff) for consensus. 
This consensus mechanism requires strong validator guarantees.

## Vulnerability Patterns to Look For
* **Validator Set Transitions:** During an epoch change, when the active validator set transitions, is the handoff completely secure? Look for off-by-one errors where a validator from epoch N can sign a block for epoch N+1.
* **Double Signing / Equivocation:** Can a malicious leader propose two conflicting blocks at the same height without triggering slashing?
* **Liveness Issues:** If 1/3 of the nodes go offline, the chain halts. Look for mechanisms that could allow a single node to artificially amplify its voting weight or cause others to panic.
