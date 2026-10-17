# §C. FRONT MATTER

**F.1 — Who this book is for, and what it assumes** (~700 words). You write code and you have used
Docker. You have never been on call, you do not know what a time series is, and nobody has ever
handed you a pager. That is the assumed starting point and nothing in this book quietly requires
more. What you will be able to do at the end, stated as five verbs.

**F.2 — How to read this book** (~600 words). The lab grows; do not skip labs. The IOU boxes and how
the debt is repaid. The self-check boxes. The debugging-ladder cross-references. Chapters 27–29 are
optional and the book stands without them. Which chapters a reader in a hurry may skim on the first
pass (11, 26, 27).

**F.3 — What you need** (~500 words). Docker Desktop or Docker Engine with Compose v2, ~6 GB free
RAM for the full stack (3 GB for the base stack through chapter 11), ~10 GB disk, and no internet
after the first `docker compose pull`. Apple Silicon and ARM notes. The `make` targets. Why the TSDB
lives in a named volume and never a bind mount.

**F.4 — The lab in one page** (~500 words). The service diagram, the ports, the chaos API, the git
tag map, and the one command that recovers any broken state:
`make reset && git checkout ch<NN> && make up`.

**F.5 — Versions this book was written against** (~600 words). The pin table with verification dates,
the currency policy from §A.2 (including the explicit refusal to name an LTS number and why), and a
pointer to Appendix F for reading anything older.

**F.6 — Conventions** (~600 words). The typographic devices: `IOU` boxes, `SELF-CHECK` boxes,
`LADDER →` cross-references, `TRAP` boxes, `SIDEBAR` boxes, `IF YOU ARE ON GRAFANA 12.4` boxes (that
support window runs to May 2027, so a corporate reader is a real reader). Why every selector in this
book is scoped with `{job="..."}`, and why examples use `without()` rather than `by()`.

*Front matter total: ~3,500 words.*

---
