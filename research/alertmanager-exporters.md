# Research Dossier: Alertmanager and the Exporter Ecosystem

**Compiled:** 2026-07-27
**For:** *Observability with Prometheus and Grafana: A Hands-On Introduction*
**Scope:** Alertmanager (config schema, routing, matchers, templating, amtool, silences, HA, webhook payload)
and the exporter ecosystem (node_exporter, cAdvisor, postgres_exporter, redis_exporter, blackbox_exporter,
windows_exporter, Pushgateway).

Everything below was verified against live primary sources on 2026-07-27 unless explicitly marked
**UNVERIFIED**. Version numbers were read off `prometheus.io/download`, the GitHub Releases API, or the
project CHANGELOG — never from memory.

---

## 1. Version matrix (verified 2026-07-27)

| Component | Current version | Released | Image reference to use in the lab |
|---|---|---|---|
| Prometheus | **3.13.1** | 2026-07-10 | `prom/prometheus:v3.13.1` |
| Prometheus LTS | **3.5.5** | 2026-07-09 | `prom/prometheus:v3.5.5` |
| **Alertmanager** | **0.33.1** | 2026-07-04 | `prom/alertmanager:v0.33.1` (also `quay.io/prometheus/alertmanager:v0.33.1`) |
| node_exporter | **1.12.1** | 2026-07-14 | `quay.io/prometheus/node-exporter:v1.12.1` |
| cAdvisor | **v0.60.5** | 2026-07-11 | `ghcr.io/google/cadvisor:v0.60.5` |
| postgres_exporter | **0.20.1** | 2026-07-08 | `quay.io/prometheuscommunity/postgres-exporter:v0.20.1` |
| redis_exporter | **v1.88.0** | 2026-07-23 | `oliver006/redis_exporter:v1.88.0` |
| blackbox_exporter | **0.28.0** | 2025-12-04 (tagged 2025-12-06) | `quay.io/prometheus/blackbox-exporter:v0.28.0` |
| Pushgateway | **1.11.3** | 2026-05-27 | `prom/pushgateway:v1.11.3` |
| windows_exporter | **v0.31.8** | 2026-07-22 | `ghcr.io/prometheus-community/windows-exporter:v0.31.8` (MSI is the normal install) |
| Grafana (context only) | **13.2.0** self-managed | 2026-07-13 | `grafana/grafana:13.2.0` — *belongs to the Grafana researcher; cross-check before printing* |

Other exporters on the official download page, for completeness: graphite_exporter 0.17.0 (2026-07-08),
memcached_exporter 0.16.0 (2026-04-08), mysqld_exporter 0.19.0 (2026-03-18), consul_exporter 0.13.0
(2024-11-06), statsd_exporter 0.30.0, PromLens 0.4.0 (2026-07-10).

> **Author warning — pin every tag.** `:latest` is a trap in a book. cAdvisor moved registries
> (`gcr.io/cadvisor/cadvisor` → `ghcr.io/google/cadvisor` at v0.53.0), postgres_exporter renamed collectors
> in 0.20.0, and Alertmanager removed a feature flag in 0.33.0. A pinned compose file is the only thing that
> will still work when the reader tries it.

### Release cadence facts worth stating once

- Alertmanager is still **pre-1.0** (`0.x`). Minor bumps (`0.32` → `0.33`) *can* carry breaking changes.
  Say this to the reader explicitly; they will assume semver otherwise.
- Prometheus 3.x is post-1.0 and maintains an **LTS** line (currently 3.5.5). Alertmanager has no LTS line.

---

## 2. Division of labour: Prometheus vs Alertmanager

This is the single most common conceptual mistake for a newcomer. Spell it out early.

- **Prometheus evaluates alerting rules.** It decides *whether a condition is true*. It knows nothing about
  email, Slack, PagerDuty, grouping, silences, or on-call schedules.
- **Prometheus pushes firing alerts to Alertmanager**, repeatedly, roughly every evaluation cycle, over
  `POST /api/v2/alerts`. Alerts are *re-sent continuously while they fire*; they are not fire-and-forget events.
- **Alertmanager decides what a human sees.** Deduplication, grouping, routing, inhibition, silencing,
  throttling, and delivery to receivers.

An alert that is "firing" in Prometheus and an alert that "notified you" are different things separated by
the entire Alertmanager pipeline. Teach the two-box mental model before showing any YAML.

### 2.1 Prometheus side — alerting rules

```yaml
groups:
  - name: example
    rules:
      - alert: HighRequestLatency
        expr: job:request_latency_seconds:mean5m{job="myjob"} > 0.5
        for: 10m
        keep_firing_for: 5m
        labels:
          severity: page
        annotations:
          summary: High request latency
```

Field semantics, verbatim from the docs:

- `for` — *"Prometheus will check that the alert continues to be active during each evaluation for 10 minutes
  before firing the alert. Elements that are active, but not firing yet, are in the **pending** state."*
- `keep_firing_for` — holds the alert in `firing` after the expression stops matching. Purpose, per the docs:
  *"prevent situations such as flapping alerts, false resolutions due to lack of data loss, etc."*
- `labels` — become alert labels; these are what Alertmanager routes on. **Label values are templated.**
- `annotations` — free-form human text (`summary`, `description`, `runbook_url`). Templated. Not used for routing.

Prometheus also exposes a synthetic series while a rule is active:

```
ALERTS{alertname="<name>", alertstate="pending"|"firing", <all alert labels>} == 1
```

It is marked stale when the alert becomes inactive. There is a companion `ALERTS_FOR_STATE` series used to
restore `for`-state across restarts.

> **Pedagogy note:** `for` is *the* anti-flapping knob and belongs in the chapter on "alerts that don't cry
> wolf". `keep_firing_for` is the mirror image and is newer — many blog posts predate it.

### 2.2 Prometheus side — pointing at Alertmanager

Top-level `alerting:` block in `prometheus.yml`:

```yaml
alerting:
  alert_relabel_configs:
    [ - <relabel_config> ... ]
  alertmanagers:
    [ - <alertmanager_config> ... ]
```

`<alertmanager_config>` fields, with the defaults that matter:

```yaml
# The scheme to use when communicating with Alertmanager.
[ scheme: <string> | default = http ]

# The API version to use when communicating with Alertmanager.
[ api_version: <string> | default = v2 ]

# The URL path prefix for Alertmanager.
[ path_prefix: <string> ]

# Optional timeout when communicating with Alertmanager.
[ timeout: <duration> | default = 10s ]

# Service discovery (static_configs, dns_sd_configs, kubernetes_sd_configs, ...)
static_configs:
  [ - <static_config> ... ]

relabel_configs:
  [ - <relabel_config> ... ]

alert_relabel_configs:
  [ - <relabel_config> ... ]

[ <http_config> ]
```

Minimal lab version:

```yaml
alerting:
  alertmanagers:
    - static_configs:
        - targets: ['alertmanager:9093']
```

**Do not print `api_version: v1` anywhere in the book.** v2 is the default and v1 is long gone from practice.

---

## 3. Alertmanager configuration file — full schema

Source of truth: `docs/configuration.md` on `main` of `prometheus/alertmanager` (v0.33.1 era).

### 3.1 Top-level file layout (verbatim)

```yaml
global:
  [ smtp_from: <tmpl_string> ]
  [ smtp_smarthost: <string> ]
  [ smtp_hello: <string> | default = "localhost" ]
  [ smtp_auth_username: <string> ]
  [ smtp_auth_password: <secret> ]
  [ smtp_auth_password_file: <string> ]
  [ smtp_auth_identity: <string> ]
  [ smtp_auth_secret: <secret> ]
  [ smtp_auth_secret_file: <string> ]
  [ smtp_require_tls: <bool> | default = true ]
  [ smtp_tls_config: <tls_config> ]
  [ smtp_force_implicit_tls: <bool>]
  [ jira_api_url: <string> ]
  [ slack_api_url: <secret> ]
  [ slack_api_url_file: <filepath> ]
  [ slack_app_token: <secret> ]
  [ slack_app_token_file: <filepath> ]
  [ slack_app_url: <string> ]
  [ victorops_api_key: <secret> ]
  [ victorops_api_key_file: <filepath> ]
  [ victorops_api_url: <string> | default = "https://alert.victorops.com/integrations/generic/20131114/alert/" ]
  [ pagerduty_url: <string> | default = "https://events.pagerduty.com/v2/enqueue" ]
  [ opsgenie_api_key: <secret> ]
  [ opsgenie_api_key_file: <filepath> ]
  [ opsgenie_api_url: <string> | default = "https://api.opsgenie.com/" ]
  [ rocketchat_api_url: <string> | default = "https://open.rocket.chat/" ]
  [ rocketchat_token: <secret> ]
  [ rocketchat_token_file: <filepath> ]
  [ rocketchat_token_id: <secret> ]
  [ rocketchat_token_id_file: <filepath> ]
  [ wechat_api_url: <string> | default = "https://qyapi.weixin.qq.com/cgi-bin/" ]
  [ wechat_api_secret: <secret> ]
  [ wechat_api_secret_file: <string> ]
  [ wechat_api_corp_id: <string> ]
  [ telegram_api_url: <string> | default = "https://api.telegram.org" ]
  [ telegram_bot_token: <secret> ]
  [ telegram_bot_token_file: <string> ]
  [ webex_api_url: <string> | default = "https://webexapis.com/v1/messages" ]
  [ mattermost_webhook_url: <secret> ]
  [ mattermost_webhook_url_file: <string> ]
  [ http_config: <http_config> ]
  [ resolve_timeout: <duration> | default = 5m ]

templates:
  [ - <filepath> ... ]

route: <route>

receivers:
  - <receiver> ...

inhibit_rules:
  [ - <inhibit_rule> ... ]

# DEPRECATED: use time_intervals below.
# A list of mute time intervals for muting routes.
mute_time_intervals:
  [ - <time_interval> ... ]

# A list of time intervals for muting/activating routes.
time_intervals:
  [ - <time_interval> ... ]

[ event_recorder: <event_recorder_config> ]

[ tracing: <tracing_config> ]
```

Notes for the author:

- `global.resolve_timeout` (default `5m`) is **only** used for alerts that arrive without an `EndsAt`.
  Prometheus always sets `EndsAt`, so in a Prometheus-only setup this knob does nothing. Blogs frequently
  misdescribe it as "how long before an alert auto-resolves". Correct framing: it is a fallback for
  third-party clients posting to the alerts API.
- `templates:` takes **file globs**, e.g. `- '/etc/alertmanager/template/*.tmpl'`.
- `event_recorder` and `tracing` are new-ish and optional; `event_recorder` is gated behind a feature flag
  (see §3.10). Neither belongs in an introductory chapter.

### 3.2 `<route>` block (verbatim)

```yaml
[ receiver: <string> ]
[ group_by: '[' <labelname>, ... ']' ]
[ continue: <boolean> | default = false ]
match:
  [ <labelname>: <labelvalue>, ... ]
match_re:
  [ <labelname>: <regex>, ... ]
matchers:
  [ - <matcher> ... ]
labels:                                    # ⚠ NOT IN v0.33.1 — see warning below
  [ <labelname>: <tmpl_string>, ... ]
[ group_wait: <duration> | default = 30s ]
[ group_interval: <duration> | default = 5m ]
[ repeat_interval: <duration> | default = 4h ]
mute_time_intervals:
  [ - <string> ...]
active_time_intervals:
  [ - <string> ...]
routes:
  [ - <route> ... ]
```

Field docs, verbatim:

- `group_by` — *"The labels by which incoming alerts are grouped together. For example, multiple alerts coming
  in for cluster=A and alertname=LatencyHigh would be batched into a single group."*
- `group_wait` — *"How long to wait before sending the first notification for a new group of alerts."*
- `group_interval` — *"How long to wait before sending subsequent notifications for an existing group of
  alerts after group_wait."*
- `repeat_interval` — *"How long to wait before repeating the last notification. Notifications are not
  repeated if any new alerts have fired..."*
- `continue` — *"Whether an alert should continue matching subsequent sibling nodes."*
- `mute_time_intervals` — *"Times when the route should be muted. These must match the name of a time interval
  defined in the time_intervals section."*
- `active_time_intervals` — *"Times when the route should be active. These must match the name of a time
  interval defined in the time_intervals section."*
- `labels` — *"A set of labels that are attached to the route and made available to notification templates via
  the `routeLabels` template function (and to the `routeLabels` field of the `/api/v2/alerts/groups` API
  response). Route labels are merged from parent to child routes: a child route inherits its parent's route
  labels and may override individual labels by redefining them. Unlike group_by, route labels do not affect
  how alerts are grouped."*

> **CRITICAL SUBTLETY the book must get right.**
> The **top-level** `mute_time_intervals:` *section* is DEPRECATED (define your intervals under
> `time_intervals:` instead).
> The **route-level** `mute_time_intervals:` *field* is **NOT deprecated** — it is the normal, current way to
> reference a named interval for muting. Almost every blog post conflates these. Getting this wrong in a
> textbook would be embarrassing and hard to un-teach.

> **⚠ CORRECTION (second research pass, 2026-07-27): route-level `labels` is NOT in v0.33.1.**
> An earlier pass of this dossier listed `labels:` in the route block as available and recommended it for an
> advanced sidebar. That was read off `docs/configuration.md` on the **`main` branch**, which documents
> unreleased work. Verified by diffing the Go source:
>
> - `config/config.go` at tag **`v0.33.1`** — `type Route struct` has **no `Labels` field**.
> - `config/config.go` on **`main`** — has `Labels model.LabelSet \`yaml:"labels,omitempty" json:"labels,omitempty"\``.
> - `https://prometheus.io/docs/alerting/0.33/configuration/` (version-pinned) — the `<route>` block does
>   **not** contain `labels:`. Only `https://prometheus.io/docs/alerting/latest/` (which tracks `main`) shows it.
>
> The same applies to the **`routeLabels` template function** listed in §4.2, which depends on this field.
> **Do not put either in the book.** A reader on 0.33.1 who copies a route with `labels:` gets a config
> parse error. **UNVERIFIED:** which release they will ship in.
>
> **General rule this incident establishes:** verify every Alertmanager YAML key against the *version-pinned*
> docs URL (`/docs/alerting/0.33/...`) or the `v0.33.1` git tag — never `/latest/` and never `main`. This is
> the single easiest way for this book to ship a config that does not work.

### 3.3 Route tree semantics

Verbatim: *"Every alert enters the routing tree at the configured top-level route, which must match all alerts
(i.e. not have any configured matchers). It then traverses the child nodes. If `continue` is set to false, it
stops after the first matching child. If `continue` is true on a matching node, the alert will continue
matching against subsequent siblings."*

Consequences to teach:

1. **The root route must have no matchers and must have a `receiver`.** It is the catch-all. If nothing else
   matches, the root's receiver gets the alert. A reader who forgets this ends up with silently dropped alerts
   — except they aren't dropped, they go to whatever the root receiver is, which is usually the wrong place.
2. **Depth-first, first-match-wins.** Order of `routes:` matters. Put the most specific first.
3. **Inheritance.** Child routes inherit `receiver`, `group_by`, `group_wait`, `group_interval`,
   `repeat_interval`, `mute_time_intervals`, `active_time_intervals`, and `labels` from the parent and may
   override any of them. This is why the canonical example only sets timings at the root.
4. **Fallback to parent.** From the official example: *"The service has a sub-route for critical alerts, any
   alerts that do not match, i.e. severity != critical, fall-back to the parent node."* A non-matching child
   does not mean "unrouted" — it means "handled by the parent".
5. `continue: true` is how you fan one alert out to two receivers (e.g. page the owner *and* mirror to a
   central channel).

### 3.4 The official example config (verbatim, `doc/examples/simple.yml`)

This is the file the book should adapt. Reproducing it verbatim gives the reader something they can diff
against upstream.

```yaml
global:
  # The smarthost and SMTP sender used for mail notifications.
  smtp_smarthost: 'localhost:25'
  smtp_from: 'alertmanager@example.org'
  smtp_auth_username: 'alertmanager'
  smtp_auth_password: 'password'

# The directory from which notification templates are read.
templates:
  - '/etc/alertmanager/template/*.tmpl'

# The root route on which each incoming alert enters.
route:
  # The labels by which incoming alerts are grouped together. For example,
  # multiple alerts coming in for cluster=A and alertname=LatencyHigh would
  # be batched into a single group.
  #
  # To aggregate by all possible labels use '...' as the sole label name.
  # This effectively disables aggregation entirely, passing through all
  # alerts as-is. This is unlikely to be what you want, unless you have
  # a very low alert volume or your upstream notification system performs
  # its own grouping. Example: group_by: [...]
  group_by: ['alertname', 'cluster', 'service']

  # When a new group of alerts is created by an incoming alert, wait at
  # least 'group_wait' to send the initial notification.
  # This way ensures that you get multiple alerts for the same group that start
  # firing shortly after another are batched together on the first
  # notification.
  group_wait: 30s

  # When the first notification was sent, wait 'group_interval' to send a batch
  # of new alerts that started firing for that group.
  group_interval: 5m

  # If an alert has successfully been sent, wait 'repeat_interval' to
  # resend them.
  repeat_interval: 3h

  # A default receiver
  receiver: team-X-mails

  # All the above attributes are inherited by all child routes and can
  # overwritten on each.

  # The child route trees.
  routes:
    # This routes performs a regular expression match on alert labels to
    # catch alerts that are related to a list of services.
    - matchers:
        - service=~"foo1|foo2|baz"
      receiver: team-X-mails
      # The service has a sub-route for critical alerts, any alerts
      # that do not match, i.e. severity != critical, fall-back to the
      # parent node and are sent to 'team-X-mails'
      routes:
        - matchers:
            - severity="critical"
          receiver: team-X-pager
    - matchers:
        - service="files"
      receiver: team-Y-mails

      routes:
        - matchers:
            - severity="critical"
          receiver: team-Y-pager

    # This route handles all alerts coming from a database service. If there's
    # no team to handle it, it defaults to the DB team.
    - matchers:
        - service="database"
      receiver: team-DB-pager
      # Also group alerts by affected database.
      group_by: [alertname, cluster, database]
      routes:
        - matchers:
            - owner="team-X"
          receiver: team-X-pager
          continue: true
        - matchers:
            - owner="team-Y"
          receiver: team-Y-pager


# Inhibition rules allow to mute a set of alerts given that another alert is
# firing.
# We use this to mute any warning-level notifications if the same alert is
# already critical.
inhibit_rules:
  - source_matchers: [severity="critical"]
    target_matchers: [severity="warning"]
    # Apply inhibition if the alertname is the same.
    # CAUTION:
    #   If all label names listed in `equal` are missing
    #   from both the source and target alerts,
    #   the inhibition rule will apply!
    equal: [alertname, cluster, service]


receivers:
  - name: 'team-X-mails'
    email_configs:
      - to: 'team-X+alerts@example.org'

  - name: 'team-X-pager'
    email_configs:
      - to: 'team-X+alerts-critical@example.org'
    pagerduty_configs:
      - service_key: <team-X-key>

  - name: 'team-Y-mails'
    email_configs:
      - to: 'team-Y+alerts@example.org'

  - name: 'team-Y-pager'
    pagerduty_configs:
      - service_key: <team-Y-key>

  - name: 'team-DB-pager'
    pagerduty_configs:
      - service_key: <team-DB-key>

tracing:
  endpoint: localhost:4317
  insecure: true
  sampling_fraction: 1.0
```

Observe: upstream now writes matchers in the **new** syntax (`service=~"foo1|foo2|baz"`), not `match_re:`.
The book should match upstream.

### 3.5 The grouping and timing model (the part everybody gets wrong)

Three timers, three different jobs. Draw this as a timeline in the book.

| Timer | Default | Fires when | Mental model |
|---|---|---|---|
| `group_wait` | `30s` | A **brand-new group** appears | "Wait a moment in case friends arrive." Batches the initial burst. |
| `group_interval` | `5m` | An **existing group** gains new alerts (or alerts resolve) | "Don't spam me more than once per 5 min about this group as it evolves." |
| `repeat_interval` | `4h` | Nothing changed, group still firing | "Nag me again if it's still broken." |

Precise behaviour:

- A **group** is the set of alerts sharing identical values for every label in `group_by`. One group produces one
  notification containing possibly many alerts.
- After `group_wait`, the first notification for the group is sent.
- Thereafter, Alertmanager checks the group every `group_interval`. If the group's contents **changed**
  (new firing alert, or an alert resolved and `send_resolved` is true), it notifies.
- If nothing changed, it stays quiet until `repeat_interval` has elapsed since the last notification.
- `repeat_interval` is effectively rounded up to a multiple of `group_interval`, because the group is only
  evaluated on the `group_interval` tick. Setting `repeat_interval: 7m` with `group_interval: 5m` gives you
  10-minute repeats, not 7. **This surprises people.** Keep `group_interval` well below `repeat_interval`.
- Documented caveat on `repeat_interval`: *"Notifications are not repeated if any new alerts have fired..."* —
  a new alert in the group resets the repeat clock, because a notification just went out.

`group_by` guidance:

- **`group_by: ['...']`** (literal three dots as the sole entry) means *aggregate by all possible labels*, which
  the docs describe as: *"This effectively disables aggregation entirely, passing through all alerts as-is.
  This is unlikely to be what you want, unless you have a very low alert volume or your upstream notification
  system performs its own grouping."* Note the counter-intuitive phrasing: "group by everything" equals
  "group by nothing useful" equals one notification per alert.
- **Omitting `group_by` entirely** at the root means every alert lands in a single group — the opposite
  failure, where a disk-full alert and a latency alert arrive in the same email.
- Sensible default for the book's lab: `group_by: ['alertname', 'job']`, escalating to
  `['alertname', 'cluster', 'service']` when the lab grows.
- **`alertname` should almost always be in `group_by`.** Without it you merge unrelated problems.

> **Lab-friendly timings.** Defaults of `30s / 5m / 4h` are correct for production and terrible for a
> tutorial — the reader will think it is broken. For the hands-on chapter use `group_wait: 10s`,
> `group_interval: 30s`, `repeat_interval: 5m`, then show the production values and explain why they differ.
> Say out loud: "these are teaching values, do not ship them."

### 3.6 Matchers: the new syntax, the deprecated syntax, and UTF-8

**Use `matchers:` everywhere. `match:` and `match_re:` are deprecated.** Same for inhibit rules:
`source_matchers:` / `target_matchers:` replace `source_match:` / `source_match_re:` / `target_match:` /
`target_match_re:`.

Modern (correct for this book):

```yaml
matchers:
  - severity = "critical"
  - service =~ "foo1|foo2|baz"
  - env != "dev"
  - alertname !~ "Watchdog|InfoInhibitor"
```

Deprecated (do **not** print except in a clearly-labelled "migrating old configs" box):

```yaml
match:
  severity: critical
match_re:
  service: foo1|foo2|baz
```

A matcher is three tokens: **label name**, **operator**, **value**. Operators: `=`, `!=`, `=~`, `!~`.
Regexes are **fully anchored** (as everywhere in Prometheus) — `=~"foo"` matches only the exact string `foo`,
not `foobar`.

Matchers can also be written as a single comma-separated braced string, which is what the UI and `amtool`
emit: `{severity="critical", service=~"foo|bar"}`.

#### UTF-8 support and the three parsing modes

Alertmanager v0.27.0 introduced a **new matchers parser** supporting any UTF-8 character in label names and
values. As of 0.33.1 the transition is still in progress and there are three modes:

| Mode | How to enable | Meaning |
|---|---|---|
| **Fallback mode** | *default, nothing to do* | Parse as UTF-8 first; if incompatible, fall back to the classic parser and log a warning. |
| **UTF-8 strict mode** | `--enable-feature="utf8-strict-mode"` | Classic parser disabled; Alertmanager refuses to start on an incompatible matcher (e.g. `end of input: expected label value`). Not the default — see the timeline note below. |
| **Classic mode** | `--enable-feature="classic-mode"` | Behaves like Alertmanager 0.26.0 and earlier. Escape hatch only. |

Docs, verbatim: *"Alertmanager runs in a special mode called fallback mode as its default mode."*

> **⚠ Do not repeat the docs' migration timeline — it is stale.** `docs/configuration.md` still says, verbatim:
> *"Alertmanager will make UTF-8 strict mode the default in the next two versions, so it's important to
> transition as soon as possible."* That sentence was written for **0.27.0 (Feb 2024)**. I read every
> `[CHANGE]` entry in the CHANGELOG for **0.28.0, 0.29.0, 0.30.0, 0.31.0, 0.32.0, 0.32.1, 0.32.2, 0.33.0 and
> 0.33.1** — **there is no entry flipping the default.** Six minor releases later, fallback mode is still the
> default and strict mode is still opt-in.
>
> Correct wording for the book: *"As of Alertmanager 0.33.1 the default is still fallback mode. Strict mode is
> opt-in via `--enable-feature=utf8-strict-mode`. The project has signalled it intends to make strict mode the
> default eventually, but has not committed to a release."* Do **not** write "in the next two versions", and do
> not imply the switch is imminent — a book that says so will read as wrong within a year either way.
>
> **Also still present in 0.33.1:** `match:` / `match_re:` are deprecated but **not removed**. The Go source at
> tag `v0.33.1` annotates both `// Deprecated. Remove before v1.0 release.` — and Alertmanager has been pre-1.0
> for ten years, so that is an indefinite horizon. Don't tell readers these keys are gone.

#### The YAML-quoting vs matcher-quoting trap

0.33.0 shipped a docs fix specifically for this (*"[ENHANCEMENT] docs: Clarify YAML quoting vs matcher token
quoting in UTF-8 matchers section. #5264"*), which tells you how often readers get it wrong. **Two independent
quoting layers are in play:** YAML's, and the matcher grammar's. The most robust habit to teach is
**single-quote the whole matcher in YAML, double-quote the value inside it**:

```yaml
matchers:
  - 'severity =~ "warning|critical"'
```

YAML passes the single-quoted string through untouched, and the matcher parser then sees a properly quoted
value. The bare form (`- severity =~ "warning|critical"`) works today but is fragile once a regex contains
`:` or `#`, which YAML will try to interpret.

One concrete incompatibility between the parsers worth showing: the classic parser accepted `foo=` to mean
"empty value"; the UTF-8 parser requires `foo=""`. This is the most common warning readers will see in
fallback mode.

UTF-8 matcher tokens, verbatim: *"An unquoted literal or a double-quoted string for the label name. One of
`=`, `!=`, `=~`, or `!~`. An unquoted literal or a double-quoted string for the regular expression or label
value."*

Reserved characters that force quoting in an unquoted literal: whitespace, and all of
`{ } ! = ~ , \ " '` plus the backtick.

**Practical rule to teach:** *always double-quote the value*, and double-quote the label name too if it
contains anything other than `[a-zA-Z0-9_:]`. That form is valid in both parsers, so it survives the
transition:

```yaml
matchers:
  - severity="critical"
  - "team.name"="payments"      # UTF-8 label name, only valid in the new parser
```

Verification without a running server:

```bash
amtool check-config alertmanager.yml
amtool check-config alertmanager.yml --enable-feature="utf8-strict-mode"
```

`check-config` reports warnings for matchers that only parse under the classic parser. The book should show
this command in the "before you commit your config" section.

> **Stale advice alert.** Anything written before ~2024 shows `match:`/`match_re:` as normal. Anything written
> before 0.22 may claim `matchers:` does not exist. Both are wrong now.

### 3.7 `<inhibit_rule>` block (verbatim)

```yaml
[ name: <string> ]
target_match:
  [ <labelname>: <labelvalue>, ... ]
target_match_re:
  [ <labelname>: <regex>, ... ]
target_matchers:
  [ - <matcher> ... ]
source_match:
  [ <labelname>: <labelvalue>, ... ]
source_match_re:
  [ <labelname>: <regex>, ... ]
source_matchers:
  [ - <matcher> ... ]
[ equal: '[' <labelname>, ... ']' ]
```

Semantics: *"Inhibition is a concept of suppressing notifications for certain alerts if certain other alerts
are already firing."*

- **source** = the alert doing the suppressing (the bigger problem).
- **target** = the alert being suppressed (the symptom).
- `equal` = the list of label names that must have **equal values** on both source and target for the
  inhibition to apply. This is what scopes the rule to the same host/cluster/service.
- `name` (added in v0.30.0) is a human-readable identifier for the rule, useful in the UI/API.

**The `equal` footgun, verbatim from upstream:**

```
# CAUTION:
#   If all label names listed in `equal` are missing
#   from both the source and target alerts,
#   the inhibition rule will apply!
```

That is: missing equals missing counts as equal. A rule with `equal: [cluster]` will inhibit *everything*
if neither alert carries a `cluster` label. Put this in a warning box.

Canonical rule every reader should copy:

```yaml
inhibit_rules:
  - source_matchers: [severity="critical"]
    target_matchers: [severity="warning"]
    equal: [alertname, cluster, service]
```

Second canonical example (host down suppresses everything on that host):

```yaml
  - source_matchers: [alertname="InstanceDown"]
    target_matchers: [severity=~"warning|critical"]
    equal: [instance]
```

> Inhibition suppresses **notification**, not the alert. The alert is still firing and still visible in the
> Alertmanager UI and API, flagged as suppressed. Since v0.28.0 muted/suppressed alerts are explicitly
> indicated in the API and UI. Teach this — "it disappeared" is not the same as "it is fixed".

### 3.8 Time intervals (`time_intervals`, `active_time_intervals`, `mute_time_intervals`)

Two-step model:

1. **Define** a named interval once, under the top-level `time_intervals:` list.
2. **Reference** it by name from a route's `mute_time_intervals:` or `active_time_intervals:`.

`<time_interval>` (verbatim):

```yaml
name: <string>
time_intervals:
  [ - <time_interval_spec> ... ]
```

`<time_interval_spec>` (verbatim):

```yaml
- times:
  [ - <time_range> ...]
  weekdays:
  [ - <weekday_range> ...]
  days_of_month:
  [ - <days_of_month_range> ...]
  months:
  [ - <month_range> ...]
  years:
  [ - <year_range> ...]
  location: <string>
```

Range sub-types:

- **`<time_range>`** — `start_time: HH:MM`, `end_time: HH:MM`. **Inclusive of start, exclusive of end.**
  24-hour clock.
- **`<weekday_range>`** — a day name (`sunday`) or an inclusive range (`monday:wednesday`). Case-insensitive.
- **`<days_of_month_range>`** — numeric `1`-`31`, or **negative** for from-the-end (`-1` = last day of the
  month). Ranges are inclusive (`1:5`, `-3:-1`). Values are **clamped** to the month's actual length.
- **`<month_range>`** — case-insensitive names or numbers (January = 1); ranges like `may:august`.
- **`<year_range>`** — e.g. `2026`, or `2020:2022`.
- **`location`** — an IANA timezone name (`Europe/Berlin`, `America/New_York`), or `Local`, or `UTC`.
  **Defaults to UTC if unset.** This is the number-one cause of "my maintenance window fired at the wrong time".

**Within one `time_interval_spec`, all specified fields must match (AND). Across multiple specs in the list,
any one matching is enough (OR).**

Worked example for the book:

```yaml
time_intervals:
  - name: business-hours
    time_intervals:
      - weekdays: ['monday:friday']
        times:
          - start_time: '09:00'
            end_time: '17:00'
        location: 'Europe/Berlin'

  - name: out-of-hours
    time_intervals:
      - weekdays: ['saturday', 'sunday']
        location: 'Europe/Berlin'
      - weekdays: ['monday:friday']
        times:
          - start_time: '00:00'
            end_time: '09:00'
          - start_time: '17:00'
            end_time: '24:00'
        location: 'Europe/Berlin'

  - name: monthly-maintenance
    time_intervals:
      - days_of_month: ['1']
        times:
          - start_time: '02:00'
            end_time: '04:00'
        location: 'UTC'

route:
  receiver: default
  routes:
    # Page only outside business hours; in-hours the ticket queue is fine.
    - matchers: [severity="critical"]
      receiver: pagerduty
      active_time_intervals: [out-of-hours]
    - matchers: [severity="critical"]
      receiver: slack-team
      active_time_intervals: [business-hours]
    # Never page during the maintenance window.
    - matchers: [service="batch"]
      receiver: pagerduty
      mute_time_intervals: [monthly-maintenance]
```

Notes:

- `end_time: '24:00'` is the idiom for "to midnight". `00:00`-`24:00` is a whole day.
- If both `mute_time_intervals` and `active_time_intervals` are set on a route, an alert must be **inside** an
  active interval **and** **outside** every mute interval to notify.
- Time intervals mute the **route**, not the alert. A muted route still consumes the alert (unless
  `continue: true`) — it does not fall through to a sibling. Readers expect fall-through; correct them.

### 3.9 Receivers — the full integration list in 0.33.x

```yaml
name: <string>
labels:
  [ <labelname>: <labelvalue>, ... ]
discord_configs:
  [ - <discord_config>, ... ]
email_configs:
  [ - <email_config>, ... ]
mattermost_configs:
  [ - <mattermost_config>, ... ]
msteams_configs:
  [ - <msteams_config>, ... ]
msteamsv2_configs:
  [ - <msteamsv2_config>, ... ]
jira_configs:
  [ - <jira_config>, ... ]
opsgenie_configs:
  [ - <opsgenie_config>, ... ]
pagerduty_configs:
  [ - <pagerduty_config>, ... ]
incidentio_configs:
  [ - <incidentio_config>, ... ]
pushover_configs:
  [ - <pushover_config>, ... ]
rocketchat_configs:
  [ - <rocketchat_config>, ... ]
slack_configs:
  [ - <slack_config>, ... ]
sns_configs:
  [ - <sns_config>, ... ]
telegram_configs:
  [ - <telegram_config>, ... ]
victorops_configs:
  [ - <victorops_config>, ... ]
webex_configs:
  [ - <webex_config>, ... ]
webhook_configs:
  [ - <webhook_config>, ... ]
wechat_configs:
  [ - <wechat_config>, ... ]
```

Facts:

- A receiver with **no** `*_configs` at all is legal and is the idiomatic **null/blackhole receiver**:
  ```yaml
  receivers:
    - name: 'null'
  ```
- A receiver may hold **multiple** integrations and multiple instances of one integration; all are notified.
- `receiver.labels` (v0.31.0+) exists for **querying and filtering** receivers via the API
  (`receiver_matchers` on `/api/v2/receivers`, `/api/v2/alerts`, `/api/v2/alerts/groups`). It is not a routing
  mechanism.
- Newer integrations worth knowing so the book does not look dated: **Rocket.Chat**, **Jira**, and
  **MS Teams v2 (`msteamsv2_configs`, Power Automate Flows-based)** landed in **v0.28.0**;
  **Mattermost** and **distributed tracing** in **v0.30.0**; **incident.io** in **v0.29.0**.
- **`msteams_configs` targets the legacy Office 365 connector, which Microsoft has retired.** Use
  `msteamsv2_configs`. Any pre-2025 tutorial showing `msteams_configs` is dead advice.

### 3.10 Feature flags (`--enable-feature=`), verified against `featurecontrol/featurecontrol.go`

| Flag string | Description |
|---|---|
| `alert-names-in-metrics` | "Alert names in metrics enabled" |
| `receiver-name-in-metrics` | "Experimental receiver name in metrics enabled" |
| `group-key-in-metrics` | "Experimental group key in metrics enabled" (new in v0.33.0) |
| `classic-mode` | "Classic mode enabled" |
| `utf8-strict-mode` | "UTF-8 strict mode enabled" |
| `auto-gomemlimit` | "Automatically set GOMEMLIMIT to match the Linux container or system memory limit." |
| `event-recorder` | "Experimental event recorder enabled" (new in v0.33.0; file / webhook / Kafka outputs) |

Multiple flags are comma-separated: `--enable-feature=utf8-strict-mode,receiver-name-in-metrics`.

**`auto-gomaxprocs` was REMOVED in v0.33.0** (deprecated in v0.32.0). If the book or any copied compose file
passes it, Alertmanager will refuse to start. This is exactly the kind of thing a 2024-era blog post will
lead a reader into.

---

## 4. Notification templating

Alertmanager uses **Go `text/template` / `html/template`**. Every field annotated `<tmpl_string>` in the
config schema is a template. Templates are rendered **once per notification** (i.e. per group per receiver),
not once per alert.

### 4.1 The data available to a template (top-level `.`)

| Field | Type | Meaning |
|---|---|---|
| `.Receiver` | string | Name of the receiver being notified. |
| `.Status` | string | `firing` if at least one alert is firing, otherwise `resolved`. |
| `.Alerts` | Alert list | All alerts in this notification. Has `.Firing` and `.Resolved` methods. |
| `.GroupLabels` | KV | The labels used for grouping (i.e. the `group_by` labels and their values). |
| `.CommonLabels` | KV | Labels common to **all** alerts in the group. |
| `.CommonAnnotations` | KV | Annotations common to all alerts in the group. |
| `.RouteLabels` | KV | Route labels from the matched route (see the route `labels:` field). |
| `.ExternalURL` | string | Backlink to this Alertmanager (set with `--web.external-url`). |

Each element of `.Alerts` (type `Alert`):

| Field | Type | Meaning |
|---|---|---|
| `.Status` | string | `firing` or `resolved`. |
| `.Labels` | KV | The alert's labels. |
| `.Annotations` | KV | The alert's annotations. |
| `.StartsAt` | time.Time | When the alert started firing. |
| `.EndsAt` | time.Time | When it ended, if known. |
| `.GeneratorURL` | string | Link back to the Prometheus expression that produced it. |
| `.Fingerprint` | string | Unique identifier for the alert. |

`.Alerts.Firing` and `.Alerts.Resolved` return the filtered sub-lists. This is how you write a message that
says "3 firing, 1 resolved".

`KV` is a `map[string]string` with helper methods commonly used as `.Labels.SortedPairs`, `.Labels.Names`,
`.Labels.Values`, and `.Labels.Remove [list]`.

### 4.2 Template functions available

Verified list from `docs/notifications.md`:

```
append, date, dict, humanizeDuration, join, list, match, map, now, reReplaceAll, routeLabels,
safeHtml, safeUrl, since, stringSlice, title, toJson, toLower, toUpper, trimSpace, tz, urlUnescape
```

> **⚠ Two caveats on that list (second pass, 2026-07-27).**
> 1. **`routeLabels` is NOT usable in v0.33.1.** It reads route-level `labels`, which does not exist in the
>    released `Route` struct — see the correction box in §3.2. Strike it from any chapter.
> 2. That list was read from `docs/notifications.md` on **`main`**, so it may contain other functions not yet
>    released. Everything except `now` (0.33.0), `dict`/`map`/`append` (0.32.0), `toJson` (0.30.0) and
>    `routeLabels` has been present for many releases and is safe to teach.
>
> **Spelling conflict on the JSON function — resolve before printing.** The 0.30.0 CHANGELOG says
> *"[FEATURE] template: Add tojson function. #4773"* (lowercase `tojson`); the docs function table says
> `toJson` (camelCase). **UNVERIFIED** which name the code actually registers, or whether both are aliases.
> Test it in the lab before printing either spelling — Go templates fail at render time, not config-load time,
> so a wrong spelling here produces a broken notification rather than a startup error.

Provenance worth noting in an "it's newer than you think" sidebar:

- `since`, `humanizeDuration`, `date`, `tz`, `toJson` — added in **v0.28.0 / v0.30.0**.
- `dict`, `map`, `append` — added in **v0.32.0**.
- `now` — added in **v0.33.0**.

That means a 2023-era book could not have used most of these. Useful for the book's "what changed recently"
framing.

Note the difference from Prometheus's own rule templating, which has `humanize`, `humanize1024`,
`humanizePercentage`, `humanizeTimestamp` and can run `query`. **Alertmanager templates cannot query
Prometheus.** Readers routinely try. Anything computed must be baked into a label or annotation by the
alerting rule.

### 4.3 Defining and using template files

```yaml
templates:
  - '/etc/alertmanager/template/*.tmpl'
```

A template file (`/etc/alertmanager/template/myorg.tmpl`), verbatim shape from the official examples:

```
{{ define "slack.myorg.text" }}https://internal.myorg.net/wiki/alerts/{{ .GroupLabels.app }}/{{ .GroupLabels.alertname }}{{ end}}
```

Referenced from the config:

```yaml
receivers:
  - name: 'slack-notifications'
    slack_configs:
      - channel: '#alerts'
        text: '{{ template "slack.myorg.text" . }}'
```

Inline examples from the official notification-examples page:

```yaml
# 1. Build a runbook URL from group labels
text: 'https://internal.myorg.net/wiki/alerts/{{ .GroupLabels.app }}/{{ .GroupLabels.alertname }}'

# 2. Use common annotations
title: '{{ .CommonAnnotations.summary }}'
text: '{{ .CommonAnnotations.description }}'

# 3. Range over every alert in the group
title: '{{ range .Alerts }}{{ .Annotations.summary }}\n{{ end }}'
text: '{{ range .Alerts }}{{ .Annotations.description }}\n{{ end }}'
```

A realistic Slack template for the book:

```
{{ define "slack.title" }}[{{ .Status | toUpper }}{{ if eq .Status "firing" }}:{{ .Alerts.Firing | len }}{{ end }}] {{ .CommonLabels.alertname }}{{ end }}

{{ define "slack.text" }}
{{ range .Alerts -}}
*Severity:* {{ .Labels.severity }}
*Instance:* {{ .Labels.instance }}
*Summary:* {{ .Annotations.summary }}
*Description:* {{ .Annotations.description }}
{{ if .Annotations.runbook_url }}*Runbook:* {{ .Annotations.runbook_url }}{{ end }}
*Started:* {{ .StartsAt | since | humanizeDuration }} ago
{{ end }}
{{ end }}
```

### 4.4 Testing templates without sending anything

```bash
amtool template render --template.glob='/etc/alertmanager/template/*.tmpl' \
  --template.text='{{ template "slack.title" . }}'
```

This is the single most valuable debugging command for a beginner, because the alternative is spamming a real
Slack channel. Feature it prominently.

> **Template gotchas to warn about.**
> - A template error usually means the notification is **not sent at all**, and the failure shows up only in
>   Alertmanager's log and in `alertmanager_notifications_failed_total`.
> - Config reload does **not** always pick up changes to `.tmpl` files reliably in older versions — restart
>   if in doubt, and verify with `amtool template render`.
> - `.CommonLabels` silently drops any label that differs between alerts in the group. A template that reads
>   `.CommonLabels.instance` renders empty as soon as two instances are grouped together. Use
>   `.GroupLabels` for things you are sure about, and `range .Alerts` for per-alert detail.
> - `html/template` is used for the email `html` field, so it auto-escapes. Use `safeHtml` deliberately.

---

## 5. The webhook receiver

The webhook receiver is the right teaching vehicle: it needs no third-party account, and the reader can run a
5-line HTTP server and *see the JSON*.

### 5.1 `<webhook_config>` (verbatim)

```yaml
[ send_resolved: <boolean> | default = true ]
url: <secret>
url_file: <filepath>
[ http_config: <http_config> | default = global.http_config ]
[ max_alerts: <int> | default = 0 ]
[ timeout: <duration> | default = 0s ]
[ payload: { <string>: <tmpl_string>, ... } ]
```

- `max_alerts: 0` means unlimited. If set, extra alerts are dropped and counted in `truncatedAlerts`.
- `timeout: 0s` means no timeout (rely on the HTTP client default).
- `url` is templated as of v0.31.0 (webhook URL templating).
- **`payload`** (new in **v0.32.0**) lets you replace the whole JSON body with your own templated structure —
  the "full payload templating for webhooks" feature. Before 0.32 you had to run a translator service.
  This is a genuinely new capability worth a sidebar.

### 5.2 The default webhook JSON payload (verbatim from the docs)

```json
{
  "version": "4",
  "groupKey": "<string>",
  "truncatedAlerts": "<int>",
  "status": "<resolved|firing>",
  "receiver": "<string>",
  "groupLabels": "<object>",
  "commonLabels": "<object>",
  "commonAnnotations": "<object>",
  "externalURL": "<string>",
  "notification_reason": "<string>",
  "alerts": [
    {
      "status": "<resolved|firing>",
      "labels": "<object>",
      "annotations": "<object>",
      "startsAt": "<rfc3339>",
      "endsAt": "<rfc3339>",
      "generatorURL": "<string>",
      "fingerprint": "<string>"
    }
  ]
}
```

Field descriptions, verbatim:

- `groupKey` — *"key identifying the group of alerts (e.g. to deduplicate)"*
- `truncatedAlerts` — *"how many alerts have been truncated due to max_alerts"*
- `externalURL` — *"backlink to the Alertmanager"*
- `notification_reason` — *"string represent the reason this notification was generated"*
- `generatorURL` — *"identifies the entity that caused the alert"*
- `fingerprint` — *"fingerprint to identify the alert"*

**`notification_reason` is new and the docs for it were only fixed in v0.33.1.** It tells the receiver whether
this notification was the initial one, an update, or a repeat. Do not present it as long-standing.

`"version": "4"` has been stable for years; it is the payload schema version, not the Alertmanager version.

### 5.3 Lab receiver

A trivial webhook sink for the lab (`prom/alertmanager` has none built in). Either:

- `docker run -p 8080:8080 --name webhook-logger <a tiny echo image>` — the book should ship its own
  ~15-line Python/Go sink in the lab repo so nothing external is required; or
- point at `https://webhook.site/...` (network-dependent, not recommended for a book), or
- use the `webhook` receiver against a `nc -l` one-liner for a single-shot demo.

Recommendation: **ship a tiny `alert-sink` service in the compose file** that pretty-prints the JSON to
stdout. It makes `docker compose logs -f alert-sink` the moment the reader "gets it".

---

## 6. Silences

A silence is a **time-bounded set of matchers**. Any incoming alert matching **all** matchers of an active
silence is not notified. Verbatim: *"Silences are a straightforward way to simply mute alerts for a given
time."*

Key properties:

- Silences live in Alertmanager, not Prometheus. They are runtime state, not config. They are gossiped
  between cluster peers (last-write-wins by timestamp).
- Silences are persisted to disk in `--data.retention`-governed snapshots under `--storage.path`
  (default `data/`). **A container without a volume loses its silences on restart** — worth a compose-file
  note.
- A silenced alert still fires and is still visible in the UI, flagged as silenced.
- Silences can be created from the web UI, the API, or `amtool`.
- **v0.32.0 added multiple matcher-set silences** and **silence annotations**; **v0.33.0 surfaced silence
  annotations in the UI**. v0.33.1 fixed the snapshot format so that silences remain readable by older
  versions and so silences with no matchers serialise as empty arrays rather than null.

### 6.1 API v2 shapes (from `api/v2/openapi.yaml`)

`silence`:

| Field | Type | Required |
|---|---|---|
| `matchers` | matchers | yes |
| `startsAt` | date-time | yes |
| `endsAt` | date-time | yes |
| `createdBy` | string | yes |
| `comment` | string | yes |
| `annotations` | labelSet | no |

`gettableSilence` adds `id` (string, required), `status` (silenceStatus, required), `updatedAt` (date-time,
required).

`matcher`:

| Field | Type | Notes |
|---|---|---|
| `name` | string | required |
| `value` | string | required |
| `isRegex` | boolean | required |
| `isEqual` | boolean | default `true` |

Note the four-way encoding: `isRegex` x `isEqual` gives `=`, `!=`, `=~`, `!~`. Readers who script against the
API get this wrong; `isEqual: false` is how you express negation.

`postableAlert`: `labels` (labelSet, **required**), `startsAt`, `endsAt`, `annotations`, `generatorURL`.

`alertGroup`: `labels` (required), `routeLabels` (required), `receiver` (required), `alerts` (required).

Endpoints:

```
GET    /api/v2/status
GET    /api/v2/silences
POST   /api/v2/silences
GET    /api/v2/silence/{silenceID}
DELETE /api/v2/silence/{silenceID}
GET    /api/v2/alerts
POST   /api/v2/alerts
GET    /api/v2/alerts/groups
GET    /api/v2/receivers
```

Two subtleties:

- The list endpoint is **plural** (`/silences`), the single-item endpoint is **singular** (`/silence/{id}`).
  This asymmetry trips everyone.
- `POST /api/v2/silences` both **creates and updates**. To update, include the existing `id`.
- `DELETE /api/v2/silence/{id}` **expires** the silence (sets `endsAt` to now); it does not erase history.

Manual alert injection for a lab demo (no Prometheus rule needed):

```bash
curl -s -XPOST http://localhost:9093/api/v2/alerts -H 'Content-Type: application/json' -d '[
  {
    "labels": {"alertname":"TestAlert","severity":"critical","instance":"demo:9100"},
    "annotations": {"summary":"This is a hand-crafted alert"},
    "generatorURL": "http://localhost:9090"
  }
]'
```

This is a great early-chapter trick: the reader sees Alertmanager working before they have written a single
alerting rule.

---

## 7. `amtool`

Ships in the same release tarball as `alertmanager`, and is present in the official container image.
Also installable with `go install github.com/prometheus/alertmanager/cmd/amtool@latest`.

### 7.1 Command surface

| Command | Purpose |
|---|---|
| `amtool alert query [<matchers>...]` | Search/list current alerts. |
| `amtool alert add [<labels>...]` | Create and send a new alert to Alertmanager. |
| `amtool silence query [<matchers>...]` | List silences. |
| `amtool silence add [<matchers>...]` | Create a silence. |
| `amtool silence update [<ids>...]` | Modify existing silences. |
| `amtool silence expire [<ids>...]` | Expire silences. |
| `amtool silence import [<file>]` | Bulk-load silences from JSON. |
| `amtool config show` | Show the running config. |
| `amtool config routes show` | Print the routing tree. |
| `amtool config routes test [<labels>...]` | **Show which receiver a given label set would route to.** |
| `amtool check-config <files>...` | *"Validate alertmanager config files"* — works offline. |
| `amtool cluster show` | Show cluster peer status. |
| `amtool template render` | Render templates locally. |

Global flags:

```
--alertmanager.url=http://localhost:9093/
-o, --output=simple        # simple | extended | json
--timeout=30s
-v, --verbose
```

Silence flags:

```
-d, --duration="1h"
-a, --author=AUTHOR
-c, --comment=COMMENT
--start=START              # RFC3339
--end=END                  # RFC3339
```

Config file: `$HOME/.config/amtool/config.yml` or `/etc/amtool/config.yml`. Keys include `alertmanager.url`,
`author`, `comment_required`, `output`, `receiver`.

Example `~/.config/amtool/config.yml`:

```yaml
alertmanager.url: "http://localhost:9093"
author: me@example.com
comment_required: true
output: extended
```

Bash completion: `amtool --completion-script-bash`.

### 7.2 The two commands the book must teach

**Route testing — the killer feature.** This answers "why did my alert go to the wrong channel?" without
firing anything:

```bash
amtool config routes test --config.file=alertmanager.yml \
  severity=critical service=database owner=team-X
```

Also from the README: `amtool config routes test --config.file=doc/examples/simple.yml`.

**Config validation before reload:**

```bash
amtool check-config alertmanager.yml
```

Both work **offline against a file**, which means they belong in the reader's edit-save-check loop and in CI.
Show a GitHub Actions snippet running `amtool check-config`.

Everyday silence workflow:

```bash
# Silence a noisy alert for 2 hours
amtool silence add alertname="DiskWillFillIn4Hours" instance="db1:9100" \
  --duration=2h --author="$USER" --comment="Cleaning up logs, ticket OPS-123"

# See what's silenced
amtool silence query

# Kill it early
amtool silence expire <silence-id>
```

Running amtool from inside the compose stack (no local install needed) — good for the book:

```bash
docker compose exec alertmanager amtool --alertmanager.url=http://localhost:9093 silence query
```

---

## 8. High availability and the gossip mesh

Design goals, verbatim from the HA doc: *"Single pane view and management"*, *"Survive cluster split-brain
with fail open"*, *"At-least-once delivery"*.

Mechanics:

- Alertmanager instances form a mesh using **HashiCorp Memberlist** (a gossip protocol). There is **no
  quorum, no leader election, no consensus**. N instances tolerate N-1 failures.
- Clustering is **enabled by default** on `--cluster.listen-address=0.0.0.0:9094`. Disable with
  `--cluster.listen-address=` (empty).
- **Both UDP and TCP on the cluster port are required** (verbatim: *"Both UDP and TCP are needed in
  alertmanager 0.15 and higher for the cluster to work."*). Firewall rules that only open TCP silently
  produce a half-working mesh.
- Two things are replicated over gossip:
  1. **Silences** — create/update/delete, resolved last-write-wins by timestamp.
  2. **The notification log (`nflog`)** — a record of which notifications have already been sent. This is what
     enables deduplication.

### 8.1 How deduplication actually works

Each peer has a **position** in the cluster (a deterministic ordering). Before sending, a peer waits:

```
wait_time = peer_position x peer_timeout
```

With the default peer timeout of 15s and three peers: peer 0 sends immediately, peer 1 waits 15s, peer 2
waits 30s. During its wait, a peer watches the gossiped notification log; if it sees that an earlier peer
already sent this notification, it suppresses its own. That is the whole deduplication mechanism.

Consequences the book should state plainly:

- **Deduplication is best-effort and timing-based, not transactional.** If the mesh is partitioned, each
  partition notifies independently and you get duplicates. This is deliberate: *fail open*, at-least-once.
- Adding Alertmanager replicas adds up to `(n-1) x 15s` of latency to notifications from the last peer. This
  is fine, but it explains why HA Alertmanager "feels slower".

### 8.2 The rule that matters most

Verbatim: *"Do not load balance traffic between Prometheus and its Alertmanagers, but instead point Prometheus
to a list of all Alertmanagers."*

```yaml
alerting:
  alertmanagers:
    - static_configs:
        - targets:
            - alertmanager-0:9093
            - alertmanager-1:9093
            - alertmanager-2:9093
```

Prometheus sends **every alert to every Alertmanager**. The Alertmanagers deduplicate. Putting a load balancer
in front breaks the model: each Alertmanager sees only a subset of alerts, so grouping and inhibition go
wrong. This is the number-one HA misconfiguration in the wild and deserves a boxed warning.

### 8.3 Cluster flags

```
--cluster.listen-address="0.0.0.0:9094"
--cluster.advertise-address=
--cluster.peer=            # repeatable, one per peer
--cluster.peer-timeout=15s
--cluster.gossip-interval=200ms
--cluster.pushpull-interval=1m0s
--cluster.settle-timeout=
--cluster.tcp-timeout=
--cluster.probe-timeout=
--cluster.probe-interval=
--cluster.reconnect-interval=
--cluster.reconnect-timeout=
--cluster.label=
--cluster.tls-config=      # mutual TLS for gossip traffic
```

`--cluster.advertise-address` is needed when the container's internal IP is not routable by peers (Docker
bridge networks, NAT). `--cluster.label` prevents two unrelated clusters on the same network from merging.

Three-node docker-compose sketch (optional advanced chapter only):

```yaml
  alertmanager-0:
    image: prom/alertmanager:v0.33.1
    command:
      - --config.file=/etc/alertmanager/alertmanager.yml
      - --storage.path=/alertmanager
      - --cluster.listen-address=0.0.0.0:9094
      - --cluster.peer=alertmanager-1:9094
      - --cluster.peer=alertmanager-2:9094
```

> **Keep HA out of the main track.** A single Alertmanager is correct for the book's lab. Put HA in a short
> "when you go to production" section, because the concepts (gossip, fail-open, no load balancer) are worth
> knowing even if the reader never runs three replicas.

### 8.4 TLS and auth

- HTTP: `--web.config.file` pointing at a YAML with `tls_server_config` and `basic_auth_users` (bcrypt
  hashes). Verbatim: *"the file is read upon every http request, such as any change in the configuration and
  the certificates is picked up immediately."*
- Gossip: `--cluster.tls-config` for mutual TLS between peers.
- Both are marked **experimental** in the docs. Say so.

---

## 9. Monitoring Alertmanager itself

Metric names verified against `notify/metrics.go`:

| Metric | Help | Labels |
|---|---|---|
| `alertmanager_notifications_total` | "The total number of attempted notifications." | `integration`, (`receiver_name` if flag enabled) |
| `alertmanager_notifications_failed_total` | "The total number of failed notifications." | `integration`, `reason`, (`receiver_name`) |
| `alertmanager_notification_requests_total` | "The total number of attempted notification requests." | `integration`, (`receiver_name`) |
| `alertmanager_notification_requests_failed_total` | "The total number of failed notification requests." | `integration`, (`receiver_name`) |
| `alertmanager_notifications_suppressed_total` | "The total number of notifications suppressed for being silenced, inhibited, outside of active time intervals or within muted time intervals." | `reason` |
| `alertmanager_notification_latency_seconds` | "The latency of notifications in seconds." | `integration`, (`receiver_name`) |

Note `alertmanager_notifications_total` (a whole notification) vs `alertmanager_notification_requests_total`
(individual HTTP attempts including retries). Confusing them produces wrong success-rate dashboards.

Other useful series (present but not read from source in this pass — treat exact names as **needing a
one-line verification against a running instance**): `alertmanager_alerts`, `alertmanager_alerts_invalid_total`,
`alertmanager_silences`, `alertmanager_cluster_members`, `alertmanager_cluster_failed_peers`,
`alertmanager_cluster_health_score`, `alertmanager_config_last_reload_successful`,
`alertmanager_config_last_reload_success_timestamp_seconds`, `alertmanager_dispatcher_aggregation_groups`.

Confirmed from the docs page: `--alerts.per-alertname-limit` caps active alerts per alertname; drops are
counted by **`alertmanager_alerts_limited_total`**.

Two meta-alerts every book should ship:

```yaml
- alert: AlertmanagerNotificationsFailing
  expr: rate(alertmanager_notifications_failed_total[5m]) > 0
  for: 10m
  labels:
    severity: critical
  annotations:
    summary: "Alertmanager is failing to deliver notifications ({{ $labels.integration }})"

- alert: AlertmanagerConfigNotReloaded
  expr: alertmanager_config_last_reload_successful == 0
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "Alertmanager config reload failed"
```

Plus the classic **Watchdog / DeadMansSwitch** pattern — an always-firing alert routed to an external
heartbeat service, so that silence from the monitoring system is itself detectable:

```yaml
- alert: Watchdog
  expr: vector(1)
  labels:
    severity: none
  annotations:
    summary: "This alert always fires to prove the alerting pipeline works end to end."
```

Route it to a dead-man's-switch receiver with a short `repeat_interval`. This is the answer to
"who monitors the monitor?" and is a genuinely important lesson for a reader with no ops background.

### 9.1 Management API

| Endpoint | Methods | Behaviour |
|---|---|---|
| `/-/healthy` | GET, HEAD | *"always returns 200 and should be used to check Alertmanager health"* |
| `/-/ready` | GET, HEAD | *"returns 200 when Alertmanager is ready to serve traffic (i.e. respond to queries)"* |
| `/-/reload` | POST | Reload the config file. `SIGHUP` does the same. |
| `/metrics` | GET | Prometheus metrics (undocumented on that page but present). |

Note `/-/healthy` is unconditionally 200 — it is a liveness probe, not a config-validity check. Use
`alertmanager_config_last_reload_successful` for that.

---

## 10. The exporter ecosystem — the model first

Before any specific exporter, the reader needs three distinctions:

1. **Direct instrumentation** — your own code imports a Prometheus client library and serves `/metrics`.
   Preferred whenever you control the code.
2. **Single-target exporter** — a sidecar process that translates one thing's stats into Prometheus format
   and serves them at its own `/metrics`. Examples: node_exporter, cAdvisor, redis_exporter (in its
   default mode). Prometheus scrapes the exporter directly; the exporter's address is the `instance`.
3. **Multi-target exporter** — one exporter process probes *many* targets, chosen per-scrape via URL
   parameters. Examples: blackbox_exporter, snmp_exporter, and (optionally) postgres_exporter and
   redis_exporter. Prometheus scrapes `/probe?target=X`, and relabeling makes the *probed thing* the
   `instance`.

The multi-target pattern, verbatim from the Prometheus guide:

> *"the exporter will get the target's metrics via a network protocol"*
> *"the exporter does not have to run on the machine the metrics are taken from"*
> *"the exporter gets the targets and a query config string as parameters of Prometheus' GET request"*

Category 3 is the one that confuses beginners, because the exporter's address disappears from the metrics.
Teach it once, thoroughly, with blackbox_exporter, and then everything else (SNMP, postgres multi-target,
redis multi-target) is a variation.

### 10.1 Well-known ports (worth a table in the book)

| Component | Port |
|---|---|
| Prometheus | 9090 |
| Pushgateway | 9091 |
| Alertmanager | 9093 (HTTP) / 9094 (cluster gossip) |
| node_exporter | 9100 |
| blackbox_exporter | 9115 |
| redis_exporter | 9121 |
| postgres_exporter | 9187 |
| windows_exporter | 9182 |
| cAdvisor | 8080 |
| Grafana | 3000 |

(These come from the community "default port allocations" wiki convention; the ones above were each seen in
the respective project's own docs during this research.)

---

## 11. node_exporter

**Version 1.12.1 (2026-07-14).** Image: `quay.io/prometheus/node-exporter:v1.12.1`. Port **9100**.

Linux (and BSD/Solaris) host metrics: CPU, memory, disk, filesystem, network, load, and much more.
**It does not monitor containers or applications** — that is cAdvisor's and your app's job. Beginners
routinely install node_exporter and wonder why they cannot see their app's request rate.

### 11.1 Running it in Docker (and why that is awkward)

Verbatim from the README: *"The `node_exporter` is designed to monitor the host system. Deploying in
containers requires extra care in order to avoid monitoring the container itself."*

Official command:

```bash
docker run -d \
  --net="host" \
  --pid="host" \
  -v "/:/host:ro,rslave" \
  quay.io/prometheus/node-exporter:latest \
  --path.rootfs=/host
```

The `--path.rootfs` flag must match the bind-mount path. Non-root mount points you care about must be
bind-mounted into the container, and volumes should use `rslave` propagation.

Compose form for the book's lab:

```yaml
  node-exporter:
    image: quay.io/prometheus/node-exporter:v1.12.1
    command:
      - '--path.rootfs=/host'
      - '--path.procfs=/host/proc'
      - '--path.sysfs=/host/sys'
      - '--collector.filesystem.mount-points-exclude=^/(sys|proc|dev|host|etc)($$|/)'
    pid: host
    volumes:
      - '/:/host:ro,rslave'
    ports:
      - '9100:9100'
```

> **Docker Desktop caveat (macOS/Windows) — the book MUST say this.** On Docker Desktop there is no real
> Linux host; node_exporter reports the metrics of the lightweight Linux VM, not the reader's Mac or Windows
> machine. Numbers will look strange (tiny disks, odd filesystems, unfamiliar network interfaces). This is
> expected, not a bug. Tell the reader up front, or half of them will think their lab is broken.
> `--net=host` also does not work as expected on Docker Desktop. For the lab, prefer publishing port 9100
> normally and accept VM-level metrics.

### 11.2 Collectors

Enabled by default (verified from the README table):

```
arp, bcache, bonding, btrfs, boottime, conntrack, cpu, cpufreq, diskstats, dmi, dmmultipath, edac,
entropy, exec, fibrechannel, filefd, filesystem, hwmon, infiniband, ipvs, kernel_hung, loadavg, mdadm,
meminfo, netclass, netdev, netisr, netstat, nfs, nfsd, nvme, os, powersupplyclass, pressure, rapl,
schedstat, selinux, sockstat, softnet, stat, tapestats, textfile, thermal, thermal_zone, time, timex,
udp_queues, uname, vmstat, watchdog, xfs, zfs
```

Disabled by default:

```
buddyinfo, cgroups, cpu_vulnerabilities, devstat, drm, drbd, ethtool, interrupts, ksmd, lnstat, logind,
meminfo_numa, mountstats, network_route, nvmesubsystem, pcidevice, perf, processes, qdisc, slabinfo,
softirqs, sysctl, swap, systemd, tcpstat, wifi, xfrm, zoneinfo
```

Toggling:

```
--collector.<name>            # enable
--no-collector.<name>         # disable
--collector.disable-defaults  # turn everything off, then enable only what you list
```

Two disabled-by-default collectors readers will want:

- **`systemd`** — *"Exposes service and system status from systemd."* Gives `node_systemd_unit_state`.
  Expensive on hosts with many units; scope it with `--collector.systemd.unit-include`.
- **`processes`** — *"Exposes aggregate process statistics from `/proc`."*

### 11.3 The metrics that actually matter

Verified naming: metrics are `node_` + subsystem + field, e.g. the meminfo collector builds
`node_memory_<Field>` from `/proc/meminfo` keys, giving the exact CamelCase names below.
`node_cpu_seconds_total` has labels `cpu` and `mode` (confirmed in `collector/cpu_linux.go`).

| Metric | Type | Key labels | Why it matters |
|---|---|---|---|
| `node_cpu_seconds_total` | counter | `cpu`, `mode` | The one metric everyone uses. `mode` is `idle`, `user`, `system`, `iowait`, `steal`, `nice`, `irq`, `softirq`. |
| `node_memory_MemTotal_bytes` | gauge | — | Total RAM. |
| `node_memory_MemAvailable_bytes` | gauge | — | **Use this, not `MemFree`.** Free memory is meaningless on Linux because of page cache. |
| `node_memory_MemFree_bytes` | gauge | — | The trap. |
| `node_filesystem_size_bytes` | gauge | `device`, `mountpoint`, `fstype` | Denominator for disk-full. |
| `node_filesystem_avail_bytes` | gauge | `device`, `mountpoint`, `fstype` | **Use `avail`, not `free`** — `free` includes root-reserved blocks. |
| `node_filesystem_readonly` | gauge | `mountpoint` | Great alert, rarely used. |
| `node_filesystem_files` / `node_filesystem_files_free` | gauge | `mountpoint` | Inode exhaustion — the disk-full that `df -h` does not show. |
| `node_disk_read_bytes_total` / `node_disk_written_bytes_total` | counter | `device` | Disk throughput. |
| `node_disk_io_time_seconds_total` | counter | `device` | Disk utilisation (fraction of wall time busy). |
| `node_disk_io_time_weighted_seconds_total` | counter | `device` | Queue-depth-weighted; use for saturation. |
| `node_network_receive_bytes_total` / `node_network_transmit_bytes_total` | counter | `device` | Network throughput. |
| `node_network_receive_errs_total` / `node_network_receive_drop_total` | counter | `device` | Errors. |
| `node_load1`, `node_load5`, `node_load15` | gauge | — | Load average. Only meaningful divided by core count. |
| `node_boot_time_seconds` | gauge | — | Uptime = `time() - node_boot_time_seconds`. Detects reboots. |
| `node_time_seconds` | gauge | — | Clock skew vs Prometheus. |
| `node_uname_info` | gauge (=1) | `nodename`, `release`, `sysname`, ... | Info metric; join on it to get hostnames onto other series. |
| `node_pressure_cpu_waiting_seconds_total` | counter | — | PSI. Modern, better than load average. Also `_io_` and `_memory_` variants. |
| `node_systemd_unit_state` | gauge | `name`, `state` | Requires the `systemd` collector. |
| `node_textfile_scrape_error` | gauge | — | 1 if a `.prom` file failed to parse. Alert on it. |
| `node_scrape_collector_success` | gauge | `collector` | Per-collector health. Alert on it. |
| `node_scrape_collector_duration_seconds` | gauge | `collector` | Find the slow collector. |

Canonical PromQL the book should teach against these:

```promql
# CPU utilisation per instance (0-1)
1 - avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[5m]))

# CPU broken down by mode
sum by (instance, mode) (rate(node_cpu_seconds_total[5m]))
  / on (instance) group_left count by (instance) (node_cpu_seconds_total{mode="idle"})

# Memory used fraction
1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)

# Filesystem used fraction, excluding pseudo filesystems
1 - (
  node_filesystem_avail_bytes{fstype!~"tmpfs|overlay|squashfs|ramfs"}
  /
  node_filesystem_size_bytes{fstype!~"tmpfs|overlay|squashfs|ramfs"}
)

# Predictive disk-full: will it fill within 4 hours?
predict_linear(node_filesystem_avail_bytes{fstype!~"tmpfs|overlay"}[6h], 4*3600) < 0

# Disk busy fraction
rate(node_disk_io_time_seconds_total[5m])

# Network receive rate in bits/sec
rate(node_network_receive_bytes_total{device!~"lo|veth.*|docker.*"}[5m]) * 8

# Load per core
node_load1 / on (instance) group_left count by (instance) (node_cpu_seconds_total{mode="idle"})

# Host rebooted in the last 10 minutes
time() - node_boot_time_seconds < 600

# A collector is broken
node_scrape_collector_success == 0
```

> **`predict_linear` on disk is the best "real alert" example in the whole book.** It shows why threshold
> alerts ("disk > 90%") are worse than trend alerts: a 91%-full disk that has been stable for a year is not
> an incident; a 60%-full disk filling at 10 GB/hour is.

### 11.4 The textfile collector

Enabled by default; needs a directory:

```
--collector.textfile.directory=/var/lib/node_exporter/textfile_collector
```

*"The collector will parse all files in that directory matching the glob `*.prom`"*, and
*"The `textfile` collector is similar to the Pushgateway, in that it allows exporting of statistics from
batch jobs. It can also be used to export static metrics, such as what role a machine has."*

Correct usage pattern — **write to a temp file and rename**, because the collector may read a half-written
file:

```bash
#!/bin/sh
TEXTFILE_DIR=/var/lib/node_exporter/textfile_collector
TMP=$(mktemp -t backup.prom.XXXXXX)
cat > "$TMP" <<EOF
# HELP backup_last_success_timestamp_seconds Unix time of last successful backup.
# TYPE backup_last_success_timestamp_seconds gauge
backup_last_success_timestamp_seconds $(date +%s)
EOF
mv "$TMP" "$TEXTFILE_DIR/backup.prom"
```

Then alert on staleness:

```promql
time() - backup_last_success_timestamp_seconds > 86400 * 2
```

**This is the correct answer for machine-local cron jobs — not the Pushgateway.** See §17.

---

## 12. cAdvisor

**Version v0.60.5 (2026-07-11).** Image: `ghcr.io/google/cadvisor:v0.60.5`. Port **8080**, metrics at
`/metrics`.

Container-level resource usage: CPU, memory, network, filesystem, per container. This is what makes the
book's docker-compose lab self-observing — the reader can watch their own stack's containers.

> **Registry change.** Verbatim: *"for versions prior to v0.53.0, use gcr.io/cadvisor/cadvisor instead"*.
> Any tutorial saying `gcr.io/cadvisor/cadvisor` is out of date. Use `ghcr.io/google/cadvisor`.

### 12.1 Running it

Official command (docs use an older VERSION; substitute v0.60.5):

```bash
VERSION=v0.60.5
sudo docker run \
  --volume=/:/rootfs:ro \
  --volume=/var/run:/var/run:rw \
  --volume=/sys:/sys:ro \
  --volume=/var/lib/docker/:/var/lib/docker:ro \
  --publish=8080:8080 \
  --detach=true \
  --name=cadvisor \
  ghcr.io/google/cadvisor:$VERSION
```

Documented extras:

- *"If docker daemon is running with user namespace enabled, you need to add `--userns=host` option"*
- *"If cadvisor scrapes process metrics...you need to add `--pid=host` and `--privileged`"*
- Specific distros (CentOS, Fedora, RHEL, Debian, LXC) may need additional mounts.

Compose form:

```yaml
  cadvisor:
    image: ghcr.io/google/cadvisor:v0.60.5
    command:
      - '--docker_only=true'
      - '--housekeeping_interval=10s'
      - '--store_container_labels=false'
    volumes:
      - /:/rootfs:ro
      - /var/run:/var/run:rw
      - /sys:/sys:ro
      - /var/lib/docker/:/var/lib/docker:ro
    devices:
      - /dev/kmsg
    privileged: true
    ports:
      - '8080:8080'
```

> **cAdvisor is a cardinality bomb by default.** It emits a very large number of series per container, and by
> default copies **all container labels** into metric labels. `--store_container_labels=false` (plus
> `--whitelisted_container_labels=` to opt specific ones back in) and `--docker_only=true` are close to
> mandatory. Also consider `--disable_metrics=` to drop metric families you do not need. A lab that grinds to
> a halt teaches the wrong lesson — but *demonstrating* the cardinality problem with cAdvisor and then fixing
> it is an excellent teaching moment.

> **cAdvisor on Docker Desktop / cgroup v2:** works, but some metrics (notably certain disk and memory
> figures) are missing or zero. Warn the reader.

### 12.2 The metrics that actually matter

| Metric | Type | Meaning |
|---|---|---|
| `container_cpu_usage_seconds_total` | counter | *"Cumulative cpu time consumed"* (seconds). The main CPU metric. |
| `container_cpu_cfs_throttled_seconds_total` | counter | Time throttled by the CFS quota. **The metric that explains "my container is slow but CPU looks fine".** |
| `container_memory_working_set_bytes` | gauge | *"Current working set"*. **This is what the OOM killer looks at. Use this for memory alerts.** |
| `container_memory_usage_bytes` | gauge | *"Current memory usage, including all memory regardless of when it was accessed"* — includes reclaimable page cache, so it over-reports. |
| `container_memory_rss` | gauge | Resident set size. |
| `container_spec_memory_limit_bytes` | gauge | The configured limit (0 if unlimited). Denominator for "% of limit". |
| `container_spec_cpu_quota` / `container_spec_cpu_period` | gauge | CPU limit; quota/period = cores. |
| `container_network_receive_bytes_total` | counter | Bytes received. |
| `container_network_transmit_bytes_total` | counter | Bytes transmitted. |
| `container_network_receive_errors_total` / `container_network_transmit_errors_total` | counter | Errors. |
| `container_fs_usage_bytes` | gauge | Filesystem bytes used by the container. |
| `container_fs_reads_bytes_total` / `container_fs_writes_bytes_total` | counter | Container disk I/O. |
| `container_fs_io_time_seconds_total` | counter | Filesystem I/O time. |
| `container_last_seen` | gauge | Timestamp the container was last seen. Useful to filter out ghosts. |
| `container_start_time_seconds` | gauge | Container start time; detects restarts. |
| `machine_cpu_cores` | gauge | Host core count — the denominator for CPU percentages. |
| `machine_memory_bytes` | gauge | Host RAM. |

Standard labels: `name` (container name), `image`, `id`, plus (under Kubernetes) `pod`, `namespace`,
`container`. In plain Docker, `name` is the friendly container name — that is the one to group by.

Canonical PromQL:

```promql
# CPU cores used per container
sum by (name) (rate(container_cpu_usage_seconds_total{name!=""}[5m]))

# CPU as a fraction of the container's own limit
sum by (name) (rate(container_cpu_usage_seconds_total{name!=""}[5m]))
  / sum by (name) (container_spec_cpu_quota{name!=""} / container_spec_cpu_period{name!=""})

# Throttling: fraction of time the container was held back
rate(container_cpu_cfs_throttled_seconds_total{name!=""}[5m])

# Memory used vs limit (the pre-OOM signal)
container_memory_working_set_bytes{name!=""}
  / container_spec_memory_limit_bytes{name!=""} > 0.9

# Network in, per container
sum by (name) (rate(container_network_receive_bytes_total{name!=""}[5m]))

# Container restarted in the last 5 minutes
time() - container_start_time_seconds{name!=""} < 300
```

> **`{name!=""}` is essential.** cAdvisor emits a series for every cgroup, including the root cgroup and
> intermediate slices, all with an empty `name`. Omitting the filter double- and triple-counts. Every real
> dashboard has this filter; explain *why* rather than just printing it.

---

## 13. postgres_exporter

**Version 0.20.1 (2026-07-08).** Image: `quay.io/prometheuscommunity/postgres-exporter:v0.20.1`
(as of v0.20.0 images are also published to GHCR). Port **9187**.

### 13.1 Connection configuration

```
DATA_SOURCE_NAME="postgresql://user:pass@host:5432/postgres?sslmode=disable"
```

or split, which avoids credentials in one blob:

```
DATA_SOURCE_URI="my_pg_hostname:5432/postgres?sslmode=disable"
DATA_SOURCE_USER="postgres_exporter"
DATA_SOURCE_PASS="..."
```

File variants exist for secrets management: `DATA_SOURCE_URI_FILE`, `DATA_SOURCE_USER_FILE`,
`DATA_SOURCE_PASS_FILE`.

**Privileges:** for PostgreSQL 10+, grant the built-in `pg_monitor` role:

```sql
CREATE USER postgres_exporter WITH PASSWORD 'secret';
GRANT pg_monitor TO postgres_exporter;
```

Older versions need `SECURITY DEFINER` wrapper functions/views. Do not run the exporter as superuser; the
book should model good practice here.

### 13.2 Collectors

Toggle with `--[no-]collector.<name>`. Available collectors (v0.20.x):

```
database, database_wraparound, locks, long_running_transactions, postmaster, process_idle, replication,
replication_slots, settings, stat_activity, stat_activity_autovacuum, stat_archiver, stat_bgwriter,
stat_checkpointer, stat_database, stat_progress_vacuum, stat_replication, stat_statements,
stat_user_tables, stat_wal_receiver, statio_user_indexes, statio_user_tables, wal, xlog_location
```

> **v0.20.0 breaking changes — a textbook must not print the old names.**
> - `--collector.replication_slot` was renamed to **`--collector.replication_slots`**.
> - Replication slot metrics gained the `pg_replication_slots_` prefix, e.g.
>   `pg_replication_slot_slot_current_wal_lsn` became `pg_replication_slots_slot_current_wal_lsn`.
> - `settings`, `stat_activity`, `stat_archiver`, `stat_replication`, and `replication_slots` *"now come from
>   standalone collectors instead of the legacy default metric map"* and **no longer respect
>   `--metric-prefix` or `--disable-default-metrics`.**
>
> Every pre-2026 tutorial has the old names.

### 13.3 Multi-target mode

`/probe?target=<DSN>` with optional `&auth_module=<name>`, configured via `postgres_exporter.yml`:

```yaml
auth_modules:
  first:
    type: userpass
    userpass:
      username: postgres_exporter
      password: secret
    options:
      sslmode: disable
```

Same relabel pattern as blackbox (see §15.3). This lets one exporter watch many databases.

### 13.4 Metrics that matter

| Metric | Why |
|---|---|
| `pg_up` | 1 if the exporter could reach Postgres. First alert. |
| `pg_stat_database_numbackends{datname=...}` | Connection count — compare against `max_connections`. |
| `pg_settings_max_connections` | The denominator. |
| `pg_stat_database_xact_commit` / `pg_stat_database_xact_rollback` | Transaction rate; rollback ratio is a health signal. |
| `pg_stat_database_blks_hit` / `pg_stat_database_blks_read` | Cache hit ratio. |
| `pg_stat_database_deadlocks` | Deadlocks. Should be ~0. |
| `pg_stat_database_conflicts` | Replication conflicts. |
| `pg_stat_database_tup_returned` / `_tup_fetched` | Scan efficiency; a huge ratio means missing indexes. |
| `pg_locks_count{mode=...}` | Lock pressure. |
| `pg_stat_replication_*` (e.g. lag bytes/seconds) | Replica lag. |
| `pg_replication_slots_*` | Slot state; a stale slot silently fills the disk with WAL. |
| `pg_stat_bgwriter_*` / `pg_stat_checkpointer_*` | Checkpoint behaviour. Split in PG17+. |
| `pg_database_size_bytes` | Growth. |
| `pg_stat_activity_max_tx_duration` | Long-running transactions — the cause of bloat and vacuum failure. |
| `pg_exporter_last_scrape_error` / `pg_exporter_last_scrape_duration_seconds` | Exporter self-health. |

Example PromQL:

```promql
# Connection saturation
sum by (instance) (pg_stat_database_numbackends) / on (instance) pg_settings_max_connections > 0.8

# Cache hit ratio (want > 0.99)
rate(pg_stat_database_blks_hit[5m])
  / (rate(pg_stat_database_blks_hit[5m]) + rate(pg_stat_database_blks_read[5m]))

# Deadlocks appearing
rate(pg_stat_database_deadlocks[5m]) > 0

# Postgres unreachable
pg_up == 0
```

> **PostgreSQL 17 split `pg_stat_bgwriter` into `pg_stat_bgwriter` + `pg_stat_checkpointer`.** The exporter
> gained a `stat_checkpointer` collector to match. Which metrics you get depends on the *server* version, not
> just the exporter version. Say so, and pin a Postgres version in the lab compose file.

---

## 14. redis_exporter

**Version v1.88.0 (2026-07-23).** Image: `oliver006/redis_exporter:v1.88.0` (also on ghcr.io and quay.io).
Port **9121**. The project now describes itself as a **Valkey and Redis** exporter — worth a sentence, since
the Redis licence change split the ecosystem and readers will encounter both names.

### 14.1 Configuration

| Flag | Env var | Notes |
|---|---|---|
| `--redis.addr` | `REDIS_ADDR` | *"Address of the Redis instance, defaults to `redis://localhost:6379`"* |
| `--redis.password` | `REDIS_PASSWORD` | Empty by default. |
| `--check-keys` | `REDIS_EXPORTER_CHECK_KEYS` | *"Comma separated list of key patterns to export value and length/size"* |
| `--check-single-keys` | `REDIS_EXPORTER_CHECK_SINGLE_KEYS` | *"Keys to export value and length/size without glob pattern matching"* |
| `--script` | `REDIS_EXPORTER_SCRIPT` | *"Comma separated list of path(s) to Redis Lua script(s)"* for custom metrics. |

> **`--check-keys` with a glob runs `SCAN`/`KEYS`-style work on every scrape.** On a large keyspace this is a
> production hazard. Prefer `--check-single-keys` for named keys. Mention this; it is a classic self-inflicted
> outage.

### 14.2 Multi-target mode

Endpoint `/scrape?target=<redis-host:port>`. Official relabel example:

```yaml
metrics_path: /scrape
relabel_configs:
  - source_labels: [__address__]
    target_label: __param_target
  - source_labels: [__param_target]
    target_label: instance
  - target_label: __address__
    replacement: <<REDIS-EXPORTER-HOSTNAME>>:9121
```

Query form: `http://exporterhost:9121/scrape?target=first-redis-host:6379`.

### 14.3 Metrics that matter

| Metric | Why |
|---|---|
| `redis_up` | Reachability. First alert. |
| `redis_connected_clients` | Client count; compare to `redis_config_maxclients`. |
| `redis_blocked_clients` | Clients blocked on BLPOP etc. |
| `redis_memory_used_bytes` | Memory in use. |
| `redis_memory_max_bytes` | The `maxmemory` setting; 0 means unlimited. |
| `redis_evicted_keys_total` | **Evictions — the single best "Redis is too small" signal.** |
| `redis_expired_keys_total` | Normal TTL expiry (not a problem). |
| `redis_keyspace_hits_total` / `redis_keyspace_misses_total` | Cache hit ratio. |
| `redis_commands_total{cmd=...}` | Per-command call counts. |
| `redis_commands_duration_seconds_total{cmd=...}` | Per-command time; divide by calls for mean latency. |
| `redis_db_keys{db="db0"}` | Key count per database. |
| `redis_connected_slaves` | Replica count. |
| `redis_master_last_io_seconds_ago` | Replication health on a replica. |
| `redis_rdb_last_save_timestamp_seconds` | Persistence freshness. |
| `redis_rejected_connections_total` | Hit `maxclients`. |
| `redis_instance_info` | Info metric with `redis_version`, `role`, etc. |

Example PromQL:

```promql
# Cache hit ratio
rate(redis_keyspace_hits_total[5m])
  / (rate(redis_keyspace_hits_total[5m]) + rate(redis_keyspace_misses_total[5m]))

# Evicting keys - memory pressure
rate(redis_evicted_keys_total[5m]) > 0

# Memory used vs maxmemory
redis_memory_used_bytes / redis_memory_max_bytes > 0.9

# Mean command latency
rate(redis_commands_duration_seconds_total[5m]) / rate(redis_commands_total[5m])
```

---

## 15. blackbox_exporter — the multi-target exporter, in depth

**Version 0.28.0 (2025-12-04).** Image: `quay.io/prometheus/blackbox-exporter:v0.28.0`. Port **9115**.

Probes endpoints from the outside: HTTP(S), TCP, ICMP, DNS, gRPC, Unix sockets, WebSocket. This is
**black-box monitoring** — "does it work from where a user stands?" — as opposed to the white-box metrics
everything else in the book produces. That contrast is worth a whole section.

Probers available in 0.28.0: `http`, `tcp`, `dns`, `icmp`, `grpc`, `unix`, `websocket`.
(`unix`, `websocket`, and HTTP/3 support are new in 0.28.0 — do not describe them as long-standing.)

### 15.1 Module configuration (`blackbox.yml`)

Top-level:

```yaml
modules:
  [ <string>: <module> ... ]
```

A module is `prober` + optional `timeout` + exactly one prober-specific block.

`<http_probe>` schema, verbatim:

```yaml
# Accepted status codes for this probe. List between square brackets. Defaults to 2xx.
[ valid_status_codes: [<int>, ...] | default = 2xx ]

# Accepted HTTP versions for this probe.
[ valid_http_versions: <string>, ... ]

# The HTTP method the probe will use.
[ method: <string> | default = "GET" ]

# The HTTP headers set for the probe.
headers:
  [ <string>: <string> ... ]

# Additional HTTP headers that can be injected into the request.
http_headers:
  [ <string>:
    [ values: <string>, ... ],
    [ secrets: <string>, ... ],
    [ files: <string>, ... ]
  ], ...

[ body_size_limit: <size> | default = 0 ]
[ compression: <string> | default = "" ]
[ follow_redirects: <boolean> | default = true ]
[ fail_if_ssl: <boolean> | default = false ]
[ fail_if_not_ssl: <boolean> | default = false ]
fail_if_body_json_matches_cel: <string>
fail_if_body_json_not_matches_cel: <string>

fail_if_body_matches_regexp:
  [ - <regex>, ... ]

fail_if_body_not_matches_regexp:
  [ - <regex>, ... ]

fail_if_header_matches:
  [ - <http_header_match_spec>, ... ]

fail_if_header_not_matches:
  [ - <http_header_match_spec>, ... ]

tls_config:
  [ <tls_config> ]

basic_auth:
  [ username: <string> ]
  [ password: <secret> ]
  [ username_file: <filename> ]
  [ password_file: <filename> ]

authorization:
  [ type: <string> | default: Bearer ]
  [ credentials: <secret> ]
  [ credentials_file: <filename> ]

[ proxy_url: <string> ]
[ no_proxy: <string> ]
[ proxy_from_environment: <bool> | default: false ]
[ proxy_connect_header:
  [ <string>: [<secret>, ...] ] ]

[ skip_resolve_phase_with_proxy: <boolean> | default = false ]

oauth2:
  [ <oauth2> ]

[ enable_http2: <bool> | default: true ]
[ enable_http3: <bool> | default: false ]
[ preferred_ip_protocol: <string> | default = "ip6" ]
[ ip_protocol_fallback: <boolean> | default = true ]
[ body: <string> ]
[ body_file: <filename> ]
```

Other probers:

- `<tcp_probe>`: `preferred_ip_protocol` (default `ip6`), `ip_protocol_fallback` (default `true`),
  `query_response` (send/expect regex pairs, plus byte matching new in 0.28.0), `tls` (default `false`),
  `tls_config`.
- `<icmp_probe>`: `preferred_ip_protocol`, `ip_protocol_fallback`, `payload_size`, `ttl` (0–255).
- `<dns_probe>`: `preferred_ip_protocol`, `query_name`, `query_type` (default `ANY`), `transport_protocol`
  (default `udp`), `valid_rcodes`.
- `<grpc_probe>`: `service`, `preferred_ip_protocol`, `tls` (default `false`). gRPC metadata config new in
  0.28.0.
- `<unix_probe>`: `query_response` with `expect`, `labels`, `send`, `starttls`; plus `tls`, `tls_config`.
- `<websocket_probe>`: `http_config`, `headers`, `query_response`, IP protocol settings.

**CEL matching (new-ish, 0.28.0-era):**

- `fail_if_body_json_matches_cel` — *"Probe fails if response body JSON matches the CEL expression or if
  response is not JSON."*
- `fail_if_body_json_not_matches_cel` — *"Probe fails if response body JSON does not match CEL expression or
  if response is not JSON."*

This is a real upgrade over regex-matching a JSON body and is exactly the kind of thing that dates a book if
omitted. Example:

```yaml
  api_healthy:
    prober: http
    http:
      fail_if_body_json_not_matches_cel: 'body.status == "ok"'
```

> **The `preferred_ip_protocol: "ip6"` default bites every Docker user.** The official multi-target guide
> works around it explicitly: *"The IPv4 preference modification addresses Docker's default IPv6
> restrictions."* Put `preferred_ip_protocol: "ip4"` in every module in the book's lab, or probes will fail
> with confusing DNS errors.

A `blackbox.yml` for the lab:

```yaml
modules:
  http_2xx:
    prober: http
    timeout: 5s
    http:
      valid_http_versions: ["HTTP/1.1", "HTTP/2.0"]
      valid_status_codes: []          # defaults to 2xx
      method: GET
      follow_redirects: true
      preferred_ip_protocol: "ip4"

  http_post_2xx:
    prober: http
    http:
      method: POST
      preferred_ip_protocol: "ip4"

  http_api_ok:
    prober: http
    http:
      method: GET
      headers:
        Accept: application/json
      fail_if_body_json_not_matches_cel: 'body.status == "ok"'
      preferred_ip_protocol: "ip4"

  tcp_connect:
    prober: tcp
    timeout: 5s
    tcp:
      preferred_ip_protocol: "ip4"

  icmp:
    prober: icmp
    timeout: 5s
    icmp:
      preferred_ip_protocol: "ip4"

  dns_udp_a:
    prober: dns
    dns:
      query_name: "example.com"
      query_type: "A"
      transport_protocol: "udp"
      preferred_ip_protocol: "ip4"
```

> **ICMP needs privileges.** In Docker, add `cap_add: [NET_RAW]` (or `net.ipv4.ping_group_range` sysctl).
> Without it, ICMP probes fail with a permissions error and the reader has no idea why.

### 15.2 The `/probe` endpoint

Query parameters: `target` (what to probe), `module` (which module config to use), `debug=true` (verbose
human-readable diagnostics including the probe's log).

```bash
curl 'localhost:9115/probe?target=prometheus.io&module=http_2xx'
curl 'localhost:9115/probe?target=prometheus.io&module=http_2xx&debug=true'
```

`debug=true` is the best troubleshooting tool in the whole exporter and the book should feature it.
The exporter also serves its **own** operational metrics at `/metrics` (a different endpoint from `/probe`) —
`blackbox_exporter_config_last_reload_successful`, `blackbox_module_unknown_total`, and Go runtime metrics.
Scrape both.

Auto-reload of `blackbox.yml` is available behind a feature flag as of 0.28.0; otherwise `SIGHUP` or
`POST /-/reload`.

### 15.3 The relabel trick — explain every line

Official example, verbatim from the README:

```yaml
scrape_configs:
  - job_name: 'blackbox'
    metrics_path: /probe
    params:
      module: [http_2xx]
    static_configs:
      - targets:
        - http://prometheus.io
        - https://prometheus.io
        - http://example.com:8080
    relabel_configs:
      - source_labels: [__address__]
        target_label: __param_target
      - source_labels: [__param_target]
        target_label: instance
      - target_label: __address__
        replacement: 127.0.0.1:9115
```

Line-by-line, in the order Prometheus applies them:

1. `metrics_path: /probe` — scrape the probe endpoint, not `/metrics`.
2. `params: module: [http_2xx]` — becomes `&module=http_2xx` on the query string. (Equivalently, set
   `__param_module` via relabeling if it must vary per target.)
3. `targets:` — these are **the things to probe**, written where Prometheus normally expects the thing to
   scrape. That inversion is the conceptual leap.
4. **Relabel 1:** copy `__address__` (the target, e.g. `https://prometheus.io`) into `__param_target`.
   Any label named `__param_<name>` becomes URL query parameter `<name>`. So this produces `?target=...`.
5. **Relabel 2:** copy `__param_target` into `instance`, so the resulting time series are labelled with the
   *probed URL*, not the exporter. Without this, every probe would carry `instance="127.0.0.1:9115"` and all
   targets would collide into one series.
6. **Relabel 3:** overwrite `__address__` with the exporter's address. `__address__` is what Prometheus
   actually connects to, so after this step Prometheus connects to blackbox_exporter and asks it to probe the
   original target.

Final URL: `http://127.0.0.1:9115/probe?module=http_2xx&target=https://prometheus.io`, with the resulting
series labelled `instance="https://prometheus.io"`, `job="blackbox"`.

In a compose lab use the service name:

```yaml
      - target_label: __address__
        replacement: blackbox-exporter:9115
```

Useful variant — carry the module in the target list so one job can probe several ways:

```yaml
    relabel_configs:
      - source_labels: [__address__]
        target_label: __param_target
      - source_labels: [__param_target]
        target_label: instance
      - source_labels: [__param_module]
        target_label: module        # keep the module visible as a label
      - target_label: __address__
        replacement: blackbox-exporter:9115
```

> **This is the single hardest idea in the exporter chapter.** Budget a full diagram: three boxes (Prometheus,
> blackbox_exporter, target) and the label transformations written along the arrows. Once the reader gets it,
> snmp_exporter and the multi-target postgres/redis modes are free.

### 15.4 The `probe_*` metrics (verified against the exporter source)

**Always present (from `prober/utils.go` and the probe handler):**

| Metric | Help | Labels |
|---|---|---|
| `probe_success` | 1 if the probe succeeded, 0 otherwise. | — |
| `probe_duration_seconds` | How long the whole probe took. | — |
| `probe_ip_protocol` | *"Specifies whether probe ip protocol is IP4 or IP6"* (value 4 or 6) | — |
| `probe_ip_addr_hash` | *"Specifies the hash of IP address. It's useful to detect if the IP address changes."* | — |
| `probe_dns_lookup_time_seconds` | *"Returns the time taken for probe dns lookup in seconds"* | — |

**HTTP prober (verified against `prober/http.go`):**

| Metric | Help | Labels |
|---|---|---|
| `probe_http_status_code` | "Response HTTP status code" | — |
| `probe_http_duration_seconds` | "Duration of http request by phase, summed over all redirects" | `phase` (`resolve`, `connect`, `tls`, `processing`, `transfer`) |
| `probe_http_content_length` | "Length of http content response" | — |
| `probe_http_uncompressed_body_length` | "Length of uncompressed response body" | — |
| `probe_http_redirects` | "The number of redirects" | — |
| `probe_http_ssl` | "Indicates if SSL was used for the final redirect" | — |
| `probe_http_version` | "Returns the version of HTTP of the probe response" | — |
| `probe_http_last_modified_timestamp_seconds` | "Returns the Last-Modified HTTP response header in unixtime" | — |
| `probe_failed_due_to_regex` | "Indicates if probe failed due to regex" | — |
| `probe_failed_due_to_cel` | "Indicates if probe failed due to CEL expression not matching" | — |
| `probe_ssl_earliest_cert_expiry` | "Returns last SSL chain expiry in unixtime" | — |
| `probe_ssl_last_chain_expiry_timestamp_seconds` | "Returns last SSL chain expiry in timestamp" | — |
| `probe_ssl_last_chain_info` | "Contains SSL leaf certificate information" | `fingerprint_sha256`, `subject`, `issuer`, `subjectalternative`, `serialnumber` |
| `probe_tls_version_info` | "Returns the TLS version used or NaN when unknown" | `version` |
| `probe_tls_cipher_info` | "Returns the TLS cipher negotiated during handshake" | `cipher` |

`probe_failed_due_to_cel` is **new** and does not appear in any older documentation. Good "we are current"
signal for the book.

Canonical PromQL:

```promql
# Is it up, from the outside?
probe_success == 0

# Availability over the last day
avg_over_time(probe_success[1d])

# Latency by phase - the "where did the time go?" panel
probe_http_duration_seconds

# Slow endpoints
probe_duration_seconds > 1

# TLS certificate expiring within 21 days
(probe_ssl_earliest_cert_expiry - time()) / 86400 < 21

# Unexpected status code
probe_http_status_code != 200

# The IP behind a hostname changed (possible DNS hijack / failover)
changes(probe_ip_addr_hash[1h]) > 0

# Redirect chain grew
probe_http_redirects > 0
```

> **The cert-expiry alert is the highest-value, lowest-effort alert in the entire book.** Every reader has
> been burned by an expired certificate. Lead the alerting chapter with it.

> **Do not alert on a single failed probe.** Use `for: 5m` or
> `avg_over_time(probe_success[5m]) < 0.5`. A single probe from a single vantage point is noisy — the classic
> "crying wolf" failure this book is trying to prevent.

---

## 16. windows_exporter (brief)

**Version v0.31.8 (2026-07-22).** Port **9182**. Images at Docker Hub / ghcr.io / quay.io as
`prometheuscommunity/windows-exporter`, **but the MSI installer is the normal deployment** — it registers a
Windows service and may create a Windows Firewall exception.

- The project is `prometheus-community/windows_exporter`. **It was renamed from `wmi_exporter`** years ago,
  and metrics were renamed `wmi_*` → `windows_*`. Any tutorial mentioning `wmi_exporter` is obsolete.
- Default-enabled collectors: `cpu`, `logical_disk`, `memory`, `net`, `os`, `physical_disk`, `service`.
- Many more exist (`iis`, `mssql`, `process`, `container`, `scheduled_task`, `dns`, `ad`, `exchange`,
  `terminal_services`, `textfile`, ...), enabled with `--collectors.enabled`.
- MSI install:
  ```
  msiexec /i windows_exporter-0.31.8-amd64.msi ENABLED_COLLECTORS=cpu,memory,logical_disk,net,os,service LISTEN_PORT=9182
  ```
- YAML config file supported: `--config.file`, with top-level keys `collectors`, `collector`, `log`.
- v0.31.8 is a dependency-only release: *"only dependency updates and maintenance changes"*, no collector
  changes. Go 1.25.12.
- Metric family names follow `windows_<collector>_<name>`, e.g. `windows_cpu_time_total`,
  `windows_os_physical_memory_free_bytes`, `windows_logical_disk_free_bytes`,
  `windows_net_bytes_received_total`, `windows_service_state`, `windows_exporter_collector_success`.
  **Mark the exact metric names as UNVERIFIED** — this pass confirmed the collector set, the port, the
  install methods and the version, but did not enumerate metric names from source. Verify against a running
  instance before printing individual names.

Scope guidance: one short section. The book's lab is Docker/Linux. A page saying "yes, Windows hosts are
covered, here is the exporter, here is the port, note the `wmi_exporter` rename" is enough.

---

## 17. Pushgateway — when it is legitimate and why it is usually wrong

**Version 1.11.3 (2026-05-27).** Image: `prom/pushgateway:v1.11.3`. Port **9091**.

### 17.1 The official position, verbatim

> *"We only recommend using the Pushgateway in certain limited cases."*

> *"the only valid use case for the Pushgateway is for capturing the outcome of a **service-level batch job**."*

A *service-level* batch job is one **not tied to a specific machine or instance** — its metrics should not
carry an `instance` label, because the job's identity is the service, not the host that happened to run it.

Documented pitfalls, verbatim/near-verbatim:

1. **Single point of failure.** Monitoring many instances through one Pushgateway creates both a bottleneck
   and a shared failure domain.
2. **You lose `up`.** Prometheus no longer generates a per-instance `up` metric and per-scrape health signal
   for the pushing job, *"you lose the automatic `up` metric"* — so you cannot tell "the job is down" from
   "the job hasn't pushed yet".
3. **Metrics live forever.** *"The Pushgateway never forgets series pushed to it and will expose them to
   Prometheus forever unless those series are manually deleted."* Decommissioned or renamed jobs leave
   zombie series behind, unlike pull-based monitoring where they simply vanish.

Documented alternatives:

- **node_exporter's textfile collector** — for batch jobs bound to a specific machine (cron on a host). §11.4.
- **PushProx** — for targets behind NAT or a firewall that Prometheus cannot reach.
- **Direct instrumentation + a long-lived scrape target** — for anything that is actually a service.

### 17.2 How it works, mechanically

Push endpoint and grouping key:

```
/metrics/job/<JOB_NAME>{/<LABEL_NAME>/<LABEL_VALUE>}
```

The full path forms the **grouping key**. A push replaces **all** metrics under that exact grouping key
(with `PUT`) or merges by metric name (with `POST`). Different grouping keys are independent.

```bash
# Push a single metric
echo "some_metric 3.14" | curl --data-binary @- \
  http://pushgateway:9091/metrics/job/some_job

# Push with an extra grouping label
cat <<EOF | curl --data-binary @- http://pushgateway:9091/metrics/job/backup/db/customers
# HELP backup_duration_seconds Duration of the last backup.
# TYPE backup_duration_seconds gauge
backup_duration_seconds 42.3
# HELP backup_last_success_timestamp_seconds Unix time of last success.
# TYPE backup_last_success_timestamp_seconds gauge
backup_last_success_timestamp_seconds 1785500000
EOF

# Delete one group
curl -X DELETE http://pushgateway:9091/metrics/job/some_job/instance/some_instance

# Wipe everything (needs --web.enable-admin-api)
curl -X PUT http://pushgateway:9091/api/v1/admin/wipe
```

Automatic metrics added by the Pushgateway per group: **`push_time_seconds`** and
**`push_failure_time_seconds`** (Unix timestamps of the last successful and last failed push). These are the
things you actually alert on:

```promql
# The nightly backup has not reported in over 25 hours
time() - push_time_seconds{job="backup"} > 25 * 3600
```

Persistence: `--persistence.file=<path>` makes pushed metrics survive a restart. **Without it, a container
restart silently empties the gateway** — mount a volume in the lab.

### 17.3 `honor_labels: true` — non-negotiable

Verbatim: *"You should always set `honor_labels: true` in the scrape config"*.

```yaml
scrape_configs:
  - job_name: 'pushgateway'
    honor_labels: true
    static_configs:
      - targets: ['pushgateway:9091']
```

Why: Prometheus normally overwrites a target's `job` and `instance` labels with the scrape job's own values,
moving the originals to `exported_job` / `exported_instance`. For the Pushgateway that is exactly backwards —
the pushed `job` is the real one. `honor_labels: true` keeps the pushed labels. Omitting it is the most
common Pushgateway misconfiguration and produces series that look right but are labelled with
`job="pushgateway"`.

Also note: because a pushed group with no `instance` in its grouping key gets `instance=""`, service-level
batch jobs come out cleanly instance-less. That is by design.

### 17.4 How to teach it

Recommended framing for the book: put Pushgateway in a clearly-labelled **"you probably don't want this"**
sidebar in the chapter on the pull model. Show:

1. The reader's instinct ("my script should push metrics").
2. Why pull wins (target health for free, no zombie series, no bottleneck).
3. The three legitimate escapes: textfile collector, PushProx, service-level batch jobs.
4. One worked Pushgateway example with `honor_labels: true`, `push_time_seconds` alerting, and an explicit
   `DELETE` at job teardown.

Then never use it again in the lab. The book's own batch-job example should use the **textfile collector**,
because that is the correct answer for a machine-bound job and it reinforces the pull model.

> **Not a Pushgateway problem, but adjacent:** readers coming from StatsD/Datadog will ask "how do I push?".
> The honest answer in 2026 also includes **OpenTelemetry + the OTLP receiver in Prometheus** and
> **remote-write**, which are genuinely push-shaped and legitimate. That is another researcher's topic, but
> the Pushgateway section should point at it so the book does not look like it is pretending push does not
> exist.

---

## 18. Cross-cutting pitfalls a textbook would otherwise get subtly wrong

1. **Route-level `mute_time_intervals` is NOT deprecated; the top-level `mute_time_intervals:` section is.**
   (§3.2)
2. **`group_by: ['...']` disables grouping** rather than grouping more. Counter-intuitive.
3. **`repeat_interval` is quantised to `group_interval`.** 7m with a 5m group_interval means 10m.
4. **`global.resolve_timeout` does nothing when Prometheus is the only alert source**, because Prometheus
   always sets `EndsAt`.
5. **The root route must match everything and needs a receiver.** Unmatched alerts go there, not nowhere.
6. **A non-matching child route falls back to the parent's receiver**, it does not drop the alert.
7. **`equal:` in inhibit rules treats "both missing" as equal** — can inhibit far more than intended.
8. **Inhibition and silences suppress *notification*, not the alert.** The alert is still firing.
9. **Alertmanager templates cannot query Prometheus.** No `query` function. Bake values into annotations.
10. **`.CommonLabels.x` renders empty as soon as the group contains differing values for `x`.**
11. **Do not put a load balancer between Prometheus and Alertmanager.** Send to all of them.
12. **Alertmanager HA deduplication is timing-based and fail-open.** Duplicates during a partition are the
    designed behaviour, not a bug.
13. **Alertmanager cluster needs UDP *and* TCP on 9094.**
14. **Silences are runtime state on disk** — mount a volume or lose them on container restart.
15. **`--enable-feature=auto-gomaxprocs` was removed in 0.33.0** and will now prevent startup.
16. **`msteams_configs` is the retired Office 365 connector; use `msteamsv2_configs`.**
17. **`api_version: v2` is the default for Prometheus → Alertmanager.** Never print v1.
18. **cAdvisor: always filter `{name!=""}`** or you double-count via parent cgroups.
19. **cAdvisor default label copying is a cardinality bomb.** `--store_container_labels=false`.
20. **cAdvisor's `container_memory_usage_bytes` includes page cache;
    `container_memory_working_set_bytes` is the OOM-relevant one.**
21. **node_exporter in Docker Desktop measures the Linux VM, not the reader's laptop.**
22. **`node_memory_MemAvailable_bytes`, not `MemFree`. `node_filesystem_avail_bytes`, not `free`.**
23. **blackbox `preferred_ip_protocol` defaults to `ip6`** and breaks in Docker; set `ip4`.
24. **blackbox ICMP needs `NET_RAW`.**
25. **The blackbox relabel chain overwrites `__address__` last** — order matters and is not obvious.
26. **postgres_exporter 0.20.0 renamed `--collector.replication_slot` to `--collector.replication_slots`**
    and re-prefixed the slot metrics.
27. **Which Postgres metrics exist depends on the Postgres server version** (bgwriter/checkpointer split in
    PG17).
28. **redis_exporter `--check-keys` with globs scans the keyspace on every scrape.**
29. **Pushgateway without `honor_labels: true` mislabels everything as `job="pushgateway"`.**
30. **Pushgateway without `--persistence.file` loses all data on restart, and never forgets otherwise.**
31. **cAdvisor images moved from `gcr.io/cadvisor/cadvisor` to `ghcr.io/google/cadvisor` at v0.53.0.**
32. **`wmi_exporter` is now `windows_exporter`, and metrics are `windows_*` not `wmi_*`.**
33. **Alertmanager is 0.x and minor releases can break things.** Pin the tag.
34. **`/-/healthy` on Alertmanager is unconditionally 200** — it does not tell you the config is valid.
      Use `alertmanager_config_last_reload_successful`.
35. **`alertmanager_notifications_total` ≠ `alertmanager_notification_requests_total`** (notifications vs
      HTTP attempts including retries).

---

## 19. Suggested lab progression for these topics

A sketch the outline author can take or leave, consistent with "one stack that grows":

| Stage | Added to compose | Concept introduced |
|---|---|---|
| Early | `node-exporter`, `cadvisor` | Exporters exist; the lab observes itself; `up`; the `{name!=""}` lesson. |
| Mid | `blackbox-exporter` | Black-box vs white-box; the multi-target pattern and the relabel trick. |
| Mid | `postgres`, `postgres-exporter`, `redis`, `redis-exporter` | Real dependency monitoring; USE/RED on a database. |
| Alerting ch. 1 | `alertmanager` + `alert-sink` (webhook logger) | Rule → alert → notification. `for`. The webhook payload. |
| Alerting ch. 2 | (config only) | Routing tree, `group_by`, the three timers, matchers, `amtool config routes test`. |
| Alerting ch. 3 | (config only) | Inhibition, silences, time intervals, templating, the Watchdog. |
| Optional | `pushgateway` | Only to demonstrate why you usually should not. Then remove it. |
| Optional | three Alertmanagers | HA, gossip, "no load balancer". |

The **cert-expiry alert** (blackbox) and the **predict_linear disk-full alert** (node_exporter) are the two
best "alerts that don't cry wolf" examples available; both should appear.

---

## 20. Sources

All fetched 2026-07-27.

### Alertmanager
- Releases: https://github.com/prometheus/alertmanager/releases
- CHANGELOG: https://raw.githubusercontent.com/prometheus/alertmanager/main/CHANGELOG.md
- Configuration reference: https://prometheus.io/docs/alerting/latest/configuration/
- Configuration source: https://raw.githubusercontent.com/prometheus/alertmanager/main/docs/configuration.md
- Overview (grouping/inhibition/silences/HA): https://prometheus.io/docs/alerting/latest/alertmanager/
- High availability: https://prometheus.io/docs/alerting/latest/high_availability/
- Notification template reference: https://raw.githubusercontent.com/prometheus/alertmanager/main/docs/notifications.md
- Notification examples: https://prometheus.io/docs/alerting/latest/notification_examples/
- Example config: https://raw.githubusercontent.com/prometheus/alertmanager/main/doc/examples/simple.yml
- README (amtool, HA flags, Docker): https://raw.githubusercontent.com/prometheus/alertmanager/main/README.md
- Management API: https://raw.githubusercontent.com/prometheus/alertmanager/main/docs/management_api.md
- HTTPS / web config: https://raw.githubusercontent.com/prometheus/alertmanager/main/docs/https.md
- Feature flags source: https://raw.githubusercontent.com/prometheus/alertmanager/main/featurecontrol/featurecontrol.go
- Notification metrics source: https://raw.githubusercontent.com/prometheus/alertmanager/main/notify/metrics.go
- API v2 OpenAPI spec: https://raw.githubusercontent.com/prometheus/alertmanager/main/api/v2/openapi.yaml
- amtool man page: https://manpages.debian.org/testing/prometheus-alertmanager/amtool.1.en.html

### Prometheus (alerting side)
- Download / versions: https://prometheus.io/download/
- Alerting rules: https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/
- Configuration (alerting block, alertmanager_config): https://prometheus.io/docs/prometheus/latest/configuration/configuration/
- Multi-target exporter guide: https://prometheus.io/docs/guides/multi-target-exporter/
- When to use the Pushgateway: https://prometheus.io/docs/practices/pushing/
- Node exporter guide: https://prometheus.io/docs/guides/node-exporter/

### Exporters
- node_exporter releases: https://github.com/prometheus/node_exporter/releases
- node_exporter README (collector tables, textfile, Docker): https://github.com/prometheus/node_exporter/blob/master/README.md
- node_exporter cpu collector source: https://raw.githubusercontent.com/prometheus/node_exporter/master/collector/cpu_linux.go
- node_exporter meminfo collector source: https://raw.githubusercontent.com/prometheus/node_exporter/master/collector/meminfo.go
- cAdvisor releases (API): https://api.github.com/repos/google/cadvisor/releases
- cAdvisor Prometheus metrics doc: https://raw.githubusercontent.com/google/cadvisor/master/docs/storage/prometheus.md
- cAdvisor running doc: https://raw.githubusercontent.com/google/cadvisor/master/docs/running.md
- postgres_exporter releases: https://github.com/prometheus-community/postgres_exporter/releases and https://api.github.com/repos/prometheus-community/postgres_exporter/releases
- postgres_exporter README: https://raw.githubusercontent.com/prometheus-community/postgres_exporter/master/README.md
- redis_exporter releases (API): https://api.github.com/repos/oliver006/redis_exporter/releases
- redis_exporter README: https://raw.githubusercontent.com/oliver006/redis_exporter/master/README.md
- blackbox_exporter releases (API): https://api.github.com/repos/prometheus/blackbox_exporter/releases
- blackbox_exporter README: https://raw.githubusercontent.com/prometheus/blackbox_exporter/master/README.md
- blackbox_exporter CONFIGURATION.md: https://github.com/prometheus/blackbox_exporter/blob/master/CONFIGURATION.md
- blackbox_exporter http prober source: https://raw.githubusercontent.com/prometheus/blackbox_exporter/master/prober/http.go
- blackbox_exporter shared prober source: https://raw.githubusercontent.com/prometheus/blackbox_exporter/master/prober/utils.go
- windows_exporter releases (API): https://api.github.com/repos/prometheus-community/windows_exporter/releases
- windows_exporter README: https://raw.githubusercontent.com/prometheus-community/windows_exporter/master/README.md
- Pushgateway releases (API): https://api.github.com/repos/prometheus/pushgateway/releases
- Pushgateway README: https://raw.githubusercontent.com/prometheus/pushgateway/master/README.md

### Context (verify with the Grafana researcher before printing)
- Grafana Alertmanager configuration: https://grafana.com/docs/grafana/latest/alerting/set-up/configure-alertmanager/
- Grafana Alertmanager data source: https://grafana.com/docs/grafana/latest/datasources/alertmanager/
- Grafana 13 release: https://grafana.com/blog/grafana-13-release-all-the-latest-features/

---

## 21. Explicitly UNVERIFIED / needs a second pass

These were not confirmed from a primary source in this research pass. Do not print them as fact without
checking:

1. **Exact windows_exporter metric names** (`windows_cpu_time_total`, `windows_logical_disk_free_bytes`,
   etc.). Collector set, port, version and install methods **are** verified; individual metric names are not.
2. **Alertmanager self-monitoring metric names beyond `notify/metrics.go`** — i.e. `alertmanager_alerts`,
   `alertmanager_silences`, `alertmanager_cluster_members`, `alertmanager_cluster_failed_peers`,
   `alertmanager_config_last_reload_successful`, `alertmanager_dispatcher_aggregation_groups`. These are
   widely used and almost certainly correct, but were taken from secondary sources in this pass.
   `alertmanager_alerts_limited_total` **is** confirmed from the docs.
3. ~~**The default `--cluster.peer-timeout=15s`**~~ — **RESOLVED (second pass, 2026-07-27).** Confirmed from
   the flag listing in the Alertmanager README: `--cluster.peer-timeout` default `"15s"`. The same listing
   confirms `--cluster.listen-address` `"0.0.0.0:9094"`, `--cluster.gossip-interval` `"200ms"`,
   `--cluster.pushpull-interval` `"1m0s"`, `--cluster.tcp-timeout` `"10s"`, `--cluster.probe-timeout`
   `"500ms"`, `--cluster.probe-interval` `"1s"`, `--cluster.reconnect-interval` `"10s"`,
   `--cluster.reconnect-timeout` `"6h0m0s"`, `--cluster.peers-resolve-timeout` `"15s"`. Printable as fact.
4. **Exact postgres_exporter metric names** — the collector list and the 0.20.0 renames are verified; the
   individual `pg_*` metric names in §13.4 are drawn from the README's summary and general knowledge and
   should be diffed against a running exporter.
5. **Exact redis_exporter metric names in §14.3** beyond `redis_up`, `redis_connected_clients`,
   `redis_memory_used_bytes`, `redis_commands_total`, `redis_keyspace_hits_total`, `redis_db_keys` (these six
   are confirmed from the README).
6. ~~**cAdvisor `container_cpu_cfs_throttled_seconds_total`**~~ — **RESOLVED (second pass, 2026-07-27).**
   Confirmed verbatim from `docs/storage/prometheus.md`: `container_cpu_cfs_throttled_seconds_total`, Counter,
   *"Total time duration the container has been throttled"*. Printable as fact. The same fetch re-confirmed
   verbatim HELP strings for `container_cpu_usage_seconds_total` (*"Cumulative cpu time consumed"*),
   `container_memory_usage_bytes` (*"Current memory usage, including all memory regardless of when it was
   accessed"*), `container_memory_working_set_bytes` (*"Current working set"*),
   `container_network_receive_bytes_total`, `container_fs_usage_bytes`, `container_last_seen` and
   `container_spec_memory_limit_bytes`.
7. **Default port table in §10.1** — each port was seen in its own project's docs during this pass, but the
   table was assembled by hand. Worth a single re-check.
8. **Grafana 13.2.0 / 13.1.1 version details** — from search snippets only, and outside this dossier's remit.
9. **`node_exporter` metric names in §11.3** — **PARTIALLY RESOLVED (second pass, 2026-07-27).**

   Now confirmed **from source**, `collector/filesystem_common.go` at `master` (subsystem `filesystem`,
   labels `device`/`mountpoint`/`fstype`), with verbatim HELP strings:
   - `node_filesystem_size_bytes` — *"Filesystem size in bytes."*
   - `node_filesystem_free_bytes` — *"Filesystem free space in bytes."*
   - `node_filesystem_avail_bytes` — *"Filesystem space available to non-root users in bytes."*
   - `node_filesystem_files` — *"Filesystem total file nodes."*
   - `node_filesystem_files_free` — *"Filesystem total free file nodes."*
   - `node_filesystem_readonly` — *"Filesystem read-only status."*
   - `node_filesystem_device_error` — *"Whether an error occurred while getting statistics for the given device."*
   - `node_filesystem_mount_info` — *"Filesystem mount information."*
   - `node_filesystem_purgeable_bytes` — macOS-only.

   Also confirmed from the repo's e2e exposition fixture, with verbatim HELP:
   `node_cpu_seconds_total` (*"Seconds the CPUs spent in each mode."*), `node_disk_read_bytes_total`
   (*"The total number of bytes read successfully."*), `node_disk_io_time_seconds_total` (*"Total seconds
   spent doing I/Os."*), `node_boot_time_seconds` (*"Node boot time, in unixtime."*).

   **Still unconfirmed from source:** `node_memory_MemAvailable_bytes`, `node_memory_MemTotal_bytes`,
   `node_load1`/`5`/`15`, `node_disk_written_bytes_total`, `node_network_receive_bytes_total`,
   `node_network_transmit_bytes_total`, `node_time_seconds`, `node_uname_info`, `node_filefd_allocated`,
   `node_textfile_scrape_error`. These are long-stable (unchanged since 0.16, 2018) and almost certainly
   right, but the e2e fixture is too large for the fetch tool to return whole — it truncates alphabetically
   partway through the `node_disk_*` family, so absence from the excerpt proves nothing. Close these against
   a live `/metrics`.

   **Useful confirmed detail for the book** (`collector/meminfo.go`): names are built with
   `prometheus.BuildFQName(namespace, memInfoSubsystem, k)` where `memInfoSubsystem = "memory"` and `k` is the
   field name taken straight from `/proc/meminfo`. That is *why* node_exporter has CamelCase names like
   `node_memory_MemAvailable_bytes`, in apparent violation of Prometheus naming convention — they are
   inherited verbatim from the kernel. Fields ending `_total` are typed as counters, everything else as
   gauges. Readers notice the inconsistency; this explains it.

The fastest way to close 1, 2, 4, 5, 6, 9: bring the lab stack up and `curl <exporter>/metrics | grep -E '^# HELP'`
for each, then diff against this dossier. That should be a step in the "technically verify the manuscript" task.

---

## 22. Second research pass — 2026-07-27 (independent re-verification)

A second agent re-researched this topic from scratch against live primary sources without reading the sections
above first. This section records what that pass **confirmed**, what it **corrected**, and what it **added**.

### 22.1 Version matrix: fully corroborated

Every version in §1 was independently re-derived, most via the GitHub Releases **API** (`releases/latest`,
which returns exact `tag_name` and `published_at` and is not subject to page-rendering ambiguity):

| Component | Independently confirmed | Source |
|---|---|---|
| Alertmanager | `v0.33.1`, 2026-07-04 | prometheus.io/download + CHANGELOG |
| Prometheus | 3.13.1, 2026-07-10 | prometheus.io/download |
| node_exporter | `v1.12.1`, `2026-07-14T12:34:45Z` | GitHub API |
| blackbox_exporter | `v0.28.0`, `2025-12-06T13:32:18Z` | GitHub API |
| Pushgateway | `v1.11.3`, `2026-05-27T15:18:34Z` | GitHub API |
| cAdvisor | `v0.60.5`, `2026-07-11T05:08:18Z` | GitHub API |
| postgres_exporter | `v0.20.1`, `2026-07-08T02:06:53Z` | GitHub API |
| windows_exporter | `v0.31.8`, `2026-07-22T19:58:31Z` | GitHub API |
| redis_exporter | `v1.88.0`, 2026-07-23 | GitHub releases page |

Two agents converging on all nine numbers from different fetch paths is about as good as this gets. **Treat
the §1 matrix as settled.** Note the blackbox_exporter date discrepancy is real and harmless: the download
page says 2025-12-04, the git tag was published 2025-12-06. Write "December 2025" if you want to avoid it.

This also **feeds conflict C3** in `_CONFLICTS.md` (registry prefixes): both `quay.io/prometheus/*` and
`prom/*` genuinely publish these images. The lab spec still needs to pick one and use it everywhere.

### 22.2 Corrections made to earlier sections

Three substantive fixes were applied inline above. Summarised here so the manuscript author sees them in one place:

1. **§3.2 — route-level `labels` does not exist in v0.33.1.** Earlier pass read it off `main`. Verified absent
   from `type Route struct` at tag `v0.33.1` and absent from the version-pinned 0.33 docs. Correction box added.
2. **§4.2 — `routeLabels` template function is therefore also unusable** in 0.33.1. Flagged.
3. **§3.6 — the docs' "UTF-8 strict mode becomes the default in the next two versions" sentence is stale**
   (written for 0.27, still not true six releases later). Earlier pass softened it to "will become the default
   in future versions", which still overstates it. Now corrected with the changelog evidence.

All three come from the same root cause, which is worth stating as a working rule for everyone on this book:

> **`prometheus.io/docs/alerting/latest/` and `raw.githubusercontent.com/.../main/docs/` document unreleased
> work.** Always cross-check Alertmanager config keys against `prometheus.io/docs/alerting/0.33/configuration/`
> or the `v0.33.1` git tag. This bit us twice in one dossier.

### 22.3 Additions not covered above

**`--store_container_labels` now defaults to `false`** (verified from cAdvisor `docs/runtime_options.md`).
It historically defaulted to `true` and was a notorious cardinality bomb. Older books and blog posts instruct
readers to set it to `false` explicitly — now redundant, though harmless. **Do not tell readers it defaults
to `true`.** Other verified cAdvisor defaults: `--housekeeping_interval` `"1s"`, `--docker_only` `"false"`,
`--allow_dynamic_housekeeping` `"true"`, and `--disable_metrics` defaulting to
`"advtcp,cpu_topology,cpuset,hugetlb,memory_numa,process,referenced_memory,resctrl,sched,tcp,udp"`.

**blackbox_exporter has seven prober types as of 0.28.0**, not four: `http`, `tcp`, `dns`, `icmp`, `grpc`,
**`unix`** and **`websocket`**. The last two are recent; nearly every tutorial online lists four or five.
0.28.0 also added HTTP/3 (QUIC) support, `expect_bytes` byte-matching in TCP `query_response`, gRPC
`metadata`, and CEL-based JSON body matching — the last of which introduces a new metric,
**`probe_failed_due_to_cel`** (*"Indicates if probe failed due to CEL expression not matching"*, verified from
`prober/http.go`). 0.28.0 also carried a **breaking change**: `--log.prober` became an independent logger and
log levels were restructured (errors → ERROR, probe detail → DEBUG).

**Alertmanager `<http_probe>` default `preferred_ip_protocol` is `ip6`** — already in §15, but worth
re-flagging as the single most common blackbox support question. Same for the DNS prober's inversion, where
`target` is the DNS *server* and `query_name` is the record looked up.

**A forward-compatibility warning from the unreleased CHANGELOG** (`## main / (unreleased)`), verbatim:

> "[CHANGE] The `reason` label on `alertmanager_notifications_failed_total` now distinguishes `authError`
> (HTTP 401/403) and `rateLimited` (HTTP 429) from the generic `clientError`. Dashboards/alerts matching
> `reason="clientError"` for these codes must be updated."

If the book prints an alert rule or dashboard filtering on `reason="clientError"`, add a footnote — it will
change in the release after 0.33.1. Also unreleased: optional webhook batching in the event recorder, and a
webhook bugfix preserving custom `payload` string values that resemble YAML syntax (#5302).

**`notification_reason` enum values are VERIFIED BY MEASUREMENT (2026-09-20).** §5.2 correctly documents
the field and correctly notes its docs were only fixed in 0.33.1. The earlier passes could not confirm the
*exact set of string values*; a live ch17 stack now has. There are exactly **five** — `first notification`,
`new alerts added`, `some alerts resolved`, `repeat interval elapsed`, `all alerts resolved` — confirmed both
by `grep -a -o` over `/bin/alertmanager` in `quay.io/prometheus/alertmanager:v0.33.1` and by catching each
one on the wire at the lab's webhook sink. See `lab/MEASURED.md` §11. The quarantine is lifted: the book may
print the list. The one that is easy to miss is `some alerts resolved` — a PARTIAL resolution does **not**
report `new alerts added`. Having the reader also read the values off their own sink remains good pedagogy,
and it is exactly the `group_wait` / `group_interval` / `repeat_interval` distinction from §3.5 made visible.

**Casing oddity to preserve:** the webhook payload is camelCase throughout (`groupKey`, `truncatedAlerts`,
`commonLabels`, `externalURL`) *except* `notification_reason`, which is snake_case. That is genuinely what
ships. A copy-editor will "fix" it — protect it with a comment in the manuscript source.

### 22.4 Confirmed-verbatim reference data added this pass

**Alertmanager feature flags (0.33.1):** `receiver-name-in-metrics`, `classic-mode`, `utf8-strict-mode`,
`group-key-in-metrics` (new in 0.33.0), `event-recorder` (new in 0.33.0). `auto-gomaxprocs` was **removed** in
0.33.0 — verbatim: *"This flag had no effect since v0.29 and was deprecated in v0.32. It can be safely removed
from any startup scripts."*

**blackbox_exporter universal metrics**, verified from `prober/handler.go`:

| Metric | HELP (verbatim) |
|---|---|
| `probe_success` | "Displays whether or not the probe was a success" |
| `probe_duration_seconds` | "Returns how long the probe took to complete in seconds" |
| `probe_timeout_seconds` | "Returns how long the probe timeout is in seconds" |

Also confirmed: the default module is `http_2xx` when a scrape omits `module`, and a missing `target`
parameter returns HTTP 400 *"Target parameter is missing"*.

**TLS metrics**, verified from `prober/prober.go` (these live in `prober.go`, not `tls.go` — noted because
it took several fetches to locate them):

| Metric | HELP (verbatim) |
|---|---|
| `probe_ssl_earliest_cert_expiry` | "Returns last SSL chain expiry in unixtime" |
| `probe_ssl_last_chain_expiry_timestamp_seconds` | "Returns last SSL chain expiry in timestamp" |
| `probe_tls_version_info` | "Returns the TLS version used or NaN when unknown" |
| `probe_tls_cipher_info` | "Returns the TLS cipher negotiated during handshake" |

**DNS prober metrics**, verified from `prober/dns.go`: `probe_dns_duration_seconds` (*"Duration of DNS request
by phase"*), `probe_dns_answer_rrs`, `probe_dns_authority_rrs`, `probe_dns_additional_rrs`,
`probe_dns_query_succeeded`, `probe_dns_serial`. From `prober/utils.go`: `probe_dns_lookup_time_seconds`,
`probe_ip_protocol`, `probe_ip_addr_hash`.

**Alertmanager template function table**, verified verbatim from `docs/notifications.md` — the full
name/arguments/description table is reproduced in §4.2's source. Two entries carry the caveats in §4.2's
correction box (`routeLabels` unusable; `toJson` vs `tojson` spelling unresolved).

### 22.5 Net assessment

The dossier above was accurate on essentially everything checkable, and its UNVERIFIED list was honest and
well-scoped — three of its nine items are now closed and one is substantially narrowed. The one real defect
was the route-`labels` / `routeLabels` / strict-mode-timeline cluster, all three traceable to reading
`main`-branch documentation. Nothing else needed changing.

**Highest-leverage remaining action:** stand up the lab and diff every metric name in §11.3, §12.2, §13.4,
§14.3 and §16 against live `/metrics` output. That single step closes items 1, 2, 4, 5 and the remainder of 9,
and it is cheap once the compose stack exists.
