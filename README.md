# Cluster Monitor

Read-only VSCode panel for Slurm clusters (developed on NCSA Delta). Shows:

- cluster load per partition (CPU / GPU usage, unavailable nodes, pending jobs)
- your jobs: state, elapsed/limit, node or pending reason, priority, estimated queue position
- priority breakdown (age / fairshare / jobsize / partition / qos) of your pending jobs
- fair-share per account and recently finished jobs

It only calls `scontrol`, `squeue`, `sprio`, `sshare` and `sacct`; it never submits or cancels jobs.

## Install (Remote-SSH on the cluster)

```bash
git clone <this repo> ~/cluster-monitor
bash ~/cluster-monitor/install.sh   # symlinks into ~/.vscode-server/extensions
```

Then run **Developer: Reload Window**. Click the `R.. PD..` item in the status bar, or run
**Cluster Monitor: Open Panel**.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `clusterMonitor.refreshSeconds` | 30 | Polling interval (min 10) |
| `clusterMonitor.partitions` | `[]` | Partitions to show; empty = all (overlapping partitions double-count GPUs, so set e.g. `["ghx4"]`) |
| `clusterMonitor.recentHours` | 24 | Look-back for finished jobs |

## Notes

- Queue position is an estimate: pending jobs in the same partition with higher priority, plus one. Backfill is not modelled.
- `node collector.js` prints the raw JSON snapshot, useful for debugging or other front ends.
# NCSA_Delta_Monitor
