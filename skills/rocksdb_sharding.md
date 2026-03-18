# Skill: RocksDB Sharding in Gravity Reth

Gravity Reth implements a 3-database RocksDB sharding mechanism to optimize storage accesses.
The three databases are:
1. State DB (stores accounts and storage slots)
2. History DB (stores historical blocks and transactions)
3. Meta DB (stores configurations and node metadata)

## Vulnerability Patterns to Look For
* **Cross-DB Consistency:** If an operation updates State DB but fails before updating History DB, is it atomic? Look for missing RocksDB WriteBatches spanning multiple DB connections (which is natively unsupported in RocksDB without 2PC).
* **Read-after-Write Races:** Because RPC reads might hit History DB while a new block is only partially written across the three DBs, dirty reads can occur. Look for missing read locks.
* **Compaction Pauses:** While compaction runs on the State DB, it might temporarily stall sync. Are there timeouts in the consensus layer waiting for storage?
