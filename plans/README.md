# Animation improvement plans

| Plan | Title | Severity | Status |
| --- | --- | --- | --- |
| 002 | Unify toggle response timing | MEDIUM | TODO |
| 003 | Reduce first-hover tooltip latency | LOW | TODO |
| 004 | Add stable list loading transitions | MEDIUM | DONE |
| 005 | Animate usage chart updates safely | MEDIUM | DONE |
| 006 | Make all management layouts viewport-adaptive | HIGH | DONE |

## Recommended execution order

1. **006** — establish width/height constraints first so loading and charts have stable containers at every viewport size.
2. **004** — add list loading transitions after the responsive shell is stable.
3. **005** — tune chart enter/update animation after the chart container no longer jumps during resize.
4. **002** — unify toggle response timing; independent of the layout work.
5. **003** — tune tooltip latency last; it is low risk and independent.

Plans 004–005 depend on 006 for stable geometry. Plans 002 and 003 are independent. The button press plan was intentionally removed per product direction.
