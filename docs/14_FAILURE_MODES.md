# Failure Modes and Recovery

| Failure | Required behavior | Recovery |
|---|---|---|
| AI returns invalid tool arguments | Reject before worker execution; record safe diagnostic | Retry with corrected schema-constrained arguments or ask user for direction |
| Scene version changed after plan | Reject stale operation | Re-inspect scene and re-plan against latest version |
| Body edit accidentally changes jacket | Fail scope validation; restore checkpoint | Re-run narrower operation; add regression test |
| Worker crashes mid-operation | Do not commit partial manifest/scene | Restore last committed checkpoint and mark job failed |
| Blender executable unavailable | Keep draft, preview, and planning features usable; show worker unavailable for final compile and do not display a fallback model | Configure Blender and retry the explicit Save / Compile action |
| Preview export fails | Keep authoritative scene if valid; show stale-preview badge | Retry export; do not show old preview as current without labeling it |
| User rejects phase | Keep current revision/history and mark phase needing changes | Revise targeted component, then request review again |
| User changes the character after approval | Keep the prior checkpoint and mark the phase awaiting review | Review or restore the saved scene |
| Imported model has missing/duplicate IDs | Repair manifest deterministically if safe; otherwise quarantine | Ask user/agent to resolve ambiguous components |
| Reference image unclear | Store uncertainty and use reversible defaults | Ask for another angle or user guidance when consequential |
| Provider outage/rate limit | Backoff with bounded retries; job remains visible | Resume/retry without duplicate operations using idempotency keys |
| Asset storage failure | Do not advance state if required artifact can't be committed | Retry storage or restore transaction |
| User uploads huge/malformed image | Reject safely with user-facing limits | Ask for supported file/size |
| Export quality checks fail | Export report shows fail/warn; gate critical target profile exports | Fix listed issues or explicitly export with warnings where policy allows |

## Recovery principle
The last committed project version is authoritative. A preview, agent transcript, or in-memory Blender scene must not be treated as committed truth until the asset, manifest, and version record agree.
