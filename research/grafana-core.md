# Grafana OSS — Current State (research dossier)

**Compiled:** 2026-07-27 / 2026-07-28 (all live fetches done on these dates)
**For:** *Observability with Prometheus and Grafana: A Hands-On Introduction*
**Reader model:** working developer, comfortable with Docker, **zero** ops/SRE background.
**Lab model:** ONE `docker-compose` stack that grows chapter by chapter. Reader must see a real dashboard by ch. 3.

**Verification standard used here.** Every version number, YAML key, env var, config key, panel ID and formula
below was fetched live from `grafana.com/docs`, the `grafana/grafana` GitHub repo (raw files + GitHub contents
API), Docker Hub's tag API, or official Grafana Labs blog/what's-new pages, on 2026-07-27/28. Anything I could
**not** confirm from a primary source is explicitly tagged **UNVERIFIED** or **PARTIALLY VERIFIED**.
Do not silently upgrade a tagged claim to fact when writing the chapters.

---

## 0. TL;DR for the book's technical spine

| Decision | Answer |
|---|---|
| Grafana image + tag to pin | `grafana/grafana:13.1.1` |
| Latest stable at time of writing | **13.1.1**, released **2026-07-21** |
| Major line | **Grafana 13** (13.0 GA 2026-04-14, announced GrafanaCON April 2026) |
| Dashboard schema (classic) | `schemaVersion: 42` |
| Dashboard API resource versions | `dashboard.grafana.app/v1` (classic-in-k8s-wrapper), `dashboard.grafana.app/v2` (dynamic dashboards) |
| Provisioning config file version | `apiVersion: 1` — this has **not** changed and is unrelated to the dashboard API versions |
| Angular | **Gone.** Removed in Grafana **12.0** (May 2025). `angular_support_enabled` no longer exists. |
| Ad hoc filters | Renamed to **Filter and Group by** (13.x) |
| Explore Metrics | Renamed to **Grafana Metrics Drilldown** (Feb 2025); plugin ID `grafana-metricsdrilldown-app`; preinstalled since Grafana 12 |
| RBAC in OSS | **No.** Fine-grained RBAC is Enterprise/Cloud. OSS gets basic roles + folder/dashboard permissions. |
| CLI binary | `grafana cli` / `grafana server` — the hyphenated `grafana-cli` / `grafana-server` were **removed in 13.0** |

---

## 1. Version landscape

### 1.1 Releases (fetched from <https://github.com/grafana/grafana/releases>, 2026-07-28)

| Version | Release date | Note |
|---|---|---|
| **v13.1.1** | 2026-07-21 | **Latest stable — marked "Latest" on GitHub** |
| v13.0.4 | 2026-07-21 | 13.0 patch line |
| v12.4.6 | 2026-07-21 | last minor of 12, extended support |
| v12.3.9 | 2026-07-21 | |
| v13.1.0 | 2026-07-01 | superseded |
| v13.0.3 | 2026-06-23 | |
| v12.4.5 / v12.3.8 / v12.2.10 / v11.6.16 | 2026-06-23 | |

`endoflife.date/grafana` (fetched 2026-07-28) reports:

| Line | Released | Support status as of Jul 2026 |
|---|---|---|
| 13.1 | 2026-06-22 | Active, through Mar 2027 |
| 13.0 | 2026-04-14 | Security/critical fixes, through Jan 2027 |
| 12.4 | 2026-02-24 | Security/critical fixes, through May 2027 (last minor of 12 → extended) |

> **Date discrepancy to be careful about.** The docs support table gives 13.0.0 = **2026-04-14**; the GitHub
> release for 13.1 is 2026-07-01 while endoflife.date says 13.1 = 2026-06-22 (release-branch cut vs. published
> tag). **In the book, write "April 2026" for Grafana 13 and don't state a day.**

### 1.2 Release cadence and support policy

From <https://grafana.com/docs/grafana/latest/upgrade-guide/when-to-upgrade/> and endoflife.date:

- **Major**: roughly once a year, April/May (11 → May 2024, 12 → May 2025, 13 → April 2026).
- **Minor**: every other (even) month.
- **Patch**: at least monthly; odd months are patch-only.
- **"Each minor release is supported for 9 months after its release date."**
- **"The last minor release of a major version receives extended support for 15 months after its release date."**
- Support tiers are named **Full Support → Patch Support → Not Supported**.

### 1.3 What to pin in the lab

```yaml
image: grafana/grafana:13.1.1
```

Do **not** use `:latest` or a floating `:13.1`. A textbook lab that drifts under the reader is worse than a
slightly stale one. Say this out loud in the book, once, in the chapter that introduces compose — it teaches a
real ops habit and it protects the manuscript.

---

## 2. The `grafana/grafana` Docker image

### 2.1 Image names and tag variants

Repositories:
- `grafana/grafana` — **OSS** (this is the one the book uses)
- `grafana/grafana-enterprise` — Enterprise binary (runs as OSS without a licence; grafana.com docs default to
  this image in their examples, which is a small trap: **the book should say `grafana/grafana`**)
- `grafana/grafana-oss` — historical alias; still published. Prefer `grafana/grafana`.

Tag variants confirmed present for 13.1.1 on Docker Hub (fetched 2026-07-28):

```
13.1.1
13.1.1-slim
13.1.1-ubuntu
13.1.1-ubuntu-slim
13.1.1-distroless
13.1.1-distroless-slim
```

All six exist for **amd64, arm64, armv7** (so Apple Silicon readers are fine).
Rolling tags also exist: `13.1`, `13.1-slim`, `13.0`, `latest`, plus `nightly*`.

- default (no suffix) = Alpine-based, includes the shell entrypoint `/run.sh`
- `-ubuntu` = Ubuntu 24.04 base
- `-slim` = fewer bundled plugins/tools
- `-distroless` = `gcr.io/distroless/static-debian13`, **no shell**, entrypoint is the binary directly.
  **Do not use distroless in the book** — the `__FILE` secret handling and the `GF_INSTALL_PLUGINS` runtime
  behaviour depend on `/run.sh`.

### 2.2 Facts verbatim from the `Dockerfile` on `main` (fetched 2026-07-28)

Base images:

```
alpine:3.24.1                        # alpine-base
ubuntu:24.04                         # ubuntu-base
golang:1.26.5-alpine                 # go-builder-base
node:24-alpine                       # js-builder-base
gcr.io/distroless/static-debian13    # distroless-base
```

User/group and paths:

```dockerfile
ARG GF_UID="472"
ARG GF_GID="0"

ENV GF_PATHS_CONFIG="/etc/grafana/grafana.ini" \
    GF_PATHS_DATA="/var/lib/grafana" \
    GF_PATHS_HOME="/usr/share/grafana" \
    GF_PATHS_LOGS="/var/log/grafana" \
    GF_PATHS_PLUGINS="/var/lib/grafana/plugins" \
    GF_PATHS_PROVISIONING="/etc/grafana/provisioning"

EXPOSE 3000
ENTRYPOINT [ "/run.sh" ]
```

Distroless variant instead uses:

```dockerfile
ENTRYPOINT ["/usr/share/grafana/bin/grafana", "server", "--homepath=/usr/share/grafana", "--config=/etc/grafana/grafana.ini", "--packaging=docker"]
CMD ["cfg:default.log.mode=console"]
```

> **UID 472, GID 0.** This is the #1 source of "why is my Grafana container crash-looping" for beginners who
> bind-mount a host directory onto `/var/lib/grafana`. **The book should use a named volume for
> `/var/lib/grafana` and bind-mount only the read-only provisioning directories.** That side-steps the whole
> permissions lesson at exactly the point where you don't want to teach it.

Also note there is **no `VOLUME` instruction** in the Dockerfile — so if you don't declare a volume, the
reader's dashboards/annotations/alert state die with the container. Say so.

### 2.3 Environment variable override rule (verbatim from `configure-grafana`)

> The override syntax is `GF_<SECTION NAME>_<KEY>` where section names and keys use uppercase with underscores
> replacing periods and dashes.

Documented example:

```bash
export GF_SECURITY_ADMIN_USER=owner
export GF_AUTH_GOOGLE_CLIENT_SECRET=newS3cretKey
```

Mechanically: take the `grafana.ini` section header `[auth.anonymous]` and key `org_role`, uppercase
everything, replace `.` and `-` with `_`, prefix `GF_` → `GF_AUTH_ANONYMOUS_ORG_ROLE`.
Nested sections are flattened by the same rule (`[auth.anonymous]` → `AUTH_ANONYMOUS`).

**Feature toggles** are the one exception to "uppercase everything": toggle *names* stay camelCase.

```ini
[feature_toggles]
dashboardNewLayouts = true
```

```bash
GF_FEATURE_TOGGLES_dashboardNewLayouts=true
```

(Verbatim from the configure-grafana page: `GF_FEATURE_TOGGLES_newNavigation=true`.)

### 2.4 Docker secrets — the `__FILE` suffix

From <https://grafana.com/docs/grafana/latest/setup-grafana/configure-docker/>:

> you can apply this technique to any configuration options in `conf/grafana.ini` by setting
> `GF_<SectionName>_<KeyName>__FILE`

Example: `GF_SECURITY_ADMIN_PASSWORD__FILE=/run/secrets/admin_password`.
The entrypoint reads the file, trims surrounding whitespace, and sets the non-`__FILE` variable.
Docker secrets land in `/run/secrets/`. Requires `/run.sh` — i.e. **not** distroless.

### 2.5 The env vars the lab actually needs

| Env var | ini equivalent | Default | Why the book needs it |
|---|---|---|---|
| `GF_SECURITY_ADMIN_USER` | `[security] admin_user` | `admin` | |
| `GF_SECURITY_ADMIN_PASSWORD` | `[security] admin_password` | `admin` | Set it explicitly so the reader isn't nagged by the change-password screen with an undefined value |
| `GF_SECURITY_ADMIN_EMAIL` | `[security] admin_email` | `admin@localhost` | rarely needed |
| `GF_AUTH_ANONYMOUS_ENABLED` | `[auth.anonymous] enabled` | `false` | **the early-win lever** |
| `GF_AUTH_ANONYMOUS_ORG_NAME` | `[auth.anonymous] org_name` | `Main Org.` | must match the org name in the UI exactly, trailing period included |
| `GF_AUTH_ANONYMOUS_ORG_ROLE` | `[auth.anonymous] org_role` | `Viewer` | `Viewer` / `Editor` / `Admin` |
| `GF_AUTH_ANONYMOUS_HIDE_VERSION` | `[auth.anonymous] hide_version` | `false` | |
| `GF_AUTH_ANONYMOUS_DEVICE_LIMIT` | `[auth.anonymous] device_limit` | *(empty)* | "Limits the number of anonymous devices in your instance" |
| `GF_AUTH_BASIC_ENABLED` | `[auth.basic] enabled` | `true` | Grafana's own tutorial stack sets this to `false` alongside anon |
| `GF_AUTH_DISABLE_LOGIN_FORM` | `[auth] disable_login_form` | `false` | hides the login box entirely |
| `GF_USERS_ALLOW_SIGN_UP` | `[users] allow_sign_up` | `false` | already off by default; no need to set |
| `GF_USERS_DEFAULT_THEME` | `[users] default_theme` | `dark` | `dark`/`light`/`system` |
| `GF_SERVER_HTTP_PORT` | `[server] http_port` | `3000` | |
| `GF_SERVER_ROOT_URL` | `[server] root_url` | | needed only if reverse-proxying |
| `GF_SERVER_SERVE_FROM_SUB_PATH` | `[server] serve_from_sub_path` | `false` | |
| `GF_DASHBOARDS_MIN_REFRESH_INTERVAL` | `[dashboards] min_refresh_interval` | `5s` | raise it if you don't want readers hammering Prometheus |
| `GF_DASHBOARDS_DEFAULT_HOME_DASHBOARD_PATH` | `[dashboards] default_home_dashboard_path` | *(empty → built-in home)* | **great trick: point the reader's home page at their own provisioned dashboard** |
| `GF_LOG_LEVEL` | `[log] level` | `info` | `debug` when provisioning silently doesn't work |
| `GF_PLUGINS_PREINSTALL` | `[plugins] preinstall` | | runtime plugin install |
| `GF_PATHS_PROVISIONING` | `[paths] provisioning` | `/etc/grafana/provisioning` | |

`[paths]` keys, from configure-grafana: `data`, `logs`, `plugins`, `provisioning`
("Directory containing provisioning config files applied at startup"), `temp_data_lifetime` (default `24h`).

### 2.6 Anonymous auth — verbatim ini block

From <https://grafana.com/docs/grafana/latest/setup-grafana/configure-security/configure-authentication/anonymous-auth/>
(also served at `.../setup-grafana/configure-access/configure-authentication/anonymous-auth/` — see §18 on the
docs restructure):

```ini
[auth.anonymous]
enabled = true
org_name = Main Org.
org_role = Viewer
hide_version = true
device_limit =
```

Grafana's own `grafana/tutorial-environment` compose file (fetched 2026-07-28) does exactly this:

```yaml
grafana:
  image: grafana/grafana:12.0.1
  ports:
    - 3000:3000
  environment:
    - "GF_DEFAULT_APP_MODE=development"
    - "GF_LOG_LEVEL=debug"
    - GF_AUTH_ANONYMOUS_ORG_ROLE=Admin
    - GF_AUTH_ANONYMOUS_ENABLED=true
    - GF_AUTH_BASIC_ENABLED=false
  volumes:
    - ./grafana/provisioning/datasources:/etc/grafana/provisioning/datasources
```

**Pedagogical recommendation for this book:** do **not** copy that. Anonymous-Admin-with-no-login-form is great
for a 10-minute tutorial and terrible for a book that later teaches folder permissions, annotations (which need
a user), and alerting. Suggested progression:

- **Ch. 3 (early win):** anonymous **Viewer** on + admin login still available. Reader sees a dashboard with
  zero friction, but still has a real account to log into when they start editing.
- **Ch. 4+:** anonymous off. One `admin` account.
- Mention `GF_AUTH_ANONYMOUS_ORG_ROLE=Admin` once, in a box, labelled *demo only*.

### 2.7 Plugins

- `GF_PLUGINS_PREINSTALL` — **runtime**, comma-separated. Format `<plugin ID>@[<plugin version>]@<url>`.
  Example: `GF_PLUGINS_PREINSTALL=grafana-clock-panel,grafana-simple-json-datasource`
  Pinned: `GF_PLUGINS_PREINSTALL=grafana-clock-panel@1.0.1`
- `GF_INSTALL_PLUGINS` — documented as a **Docker build arg** for building a custom image. It still works at
  runtime in the alpine/ubuntu images via `/run.sh`, but the docs now steer you to `GF_PLUGINS_PREINSTALL`.
  **Older books and blog posts all use `GF_INSTALL_PLUGINS`. Use `GF_PLUGINS_PREINSTALL`.**
- Runtime plugin install needs egress to `grafana.com`. For an offline-friendly lab, don't require plugins at
  all — the book's needs (time series, stat, gauge, bar gauge, table, heatmap, state timeline) are all core.

### 2.8 A compose skeleton assembled from verified pieces

```yaml
services:
  grafana:
    image: grafana/grafana:13.1.1
    container_name: grafana
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      GF_SECURITY_ADMIN_USER: admin
      GF_SECURITY_ADMIN_PASSWORD: admin
      GF_USERS_DEFAULT_THEME: light
      GF_LOG_LEVEL: info
      # early-win only; removed in a later chapter
      GF_AUTH_ANONYMOUS_ENABLED: "true"
      GF_AUTH_ANONYMOUS_ORG_NAME: "Main Org."
      GF_AUTH_ANONYMOUS_ORG_ROLE: Viewer
    volumes:
      - grafana-data:/var/lib/grafana
      - ./grafana/provisioning:/etc/grafana/provisioning:ro
      - ./grafana/dashboards:/var/lib/grafana/dashboards:ro
    depends_on:
      - prometheus

volumes:
  grafana-data: {}
```

Notes the book must make:
1. `grafana-data` is a **named volume**, not a bind mount → avoids the UID 472 permission trap.
2. `/etc/grafana/provisioning` is mounted **`:ro`**. Grafana never writes there.
3. Dashboards JSON is *not* under `/etc/grafana/provisioning/dashboards` — that directory holds the **provider
   YAML**. The JSON files go somewhere else (`/var/lib/grafana/dashboards` by convention) and the provider YAML
   points at them via `options.path`. **This is the single most common provisioning mistake.**
4. Booleans in compose `environment:` maps must be quoted (`"true"`), or the YAML parser hands docker a bool and
   some tooling complains. Using the list form (`- GF_X=true`) side-steps it.

---

## 3. Provisioning — the exact current schema

This is the load-bearing section for the book. Everything below is verbatim from
<https://grafana.com/docs/grafana/latest/administration/provisioning/> fetched 2026-07-28.

### 3.1 Directory layout

`GF_PATHS_PROVISIONING` defaults to `/etc/grafana/provisioning`. Grafana scans these subdirectories **at
startup** (and, for dashboards, on a timer):

```
/etc/grafana/provisioning/
├── datasources/       # *.yaml  → data sources
├── dashboards/        # *.yaml  → dashboard *providers* (not the dashboards themselves)
├── plugins/           # *.yaml  → app plugin configuration
├── alerting/          # *.yaml  → alert rules, contact points, policies, templates, mute timings
└── access-control/    # *.yaml  → RBAC role assignments (ENTERPRISE ONLY)
```

Config file locations (verbatim): Grafana reads defaults from `<WORKING DIRECTORY>/conf/defaults.ini` and custom
config from `<WORKING DIRECTORY>/conf/custom.ini`, overridable with `--config`.
In the Docker image the effective config path is `GF_PATHS_CONFIG=/etc/grafana/grafana.ini`.

### 3.2 Environment variable interpolation inside provisioning files (verbatim)

> The syntax for variable substitution is `$ENV_VAR_NAME` or `${ENV_VAR_NAME}`. During replacement, Grafana
> processes `${ENV_VAR_NAME}` first, then `$ENV_VAR_NAME`. To include literal dollar signs, use `$$` escape
> sequences (e.g., `Pa$$sw0rd`).

```yaml
datasources:
  - name: Graphite
    url: http://localhost:$PORT
    user: $USER
    secureJsonData:
      password: $PASSWORD
```

> **Critical caveat, and it bites everyone:** env-var interpolation works in **provisioning config files
> only**, *not* in dashboard JSON definition files. If the book wants a parameterised dashboard, that's what
> dashboard *variables* are for, not `$ENV`.

Also: `$` is meaningful. A PromQL query inside a **provisioning YAML** containing `$__rate_interval` is fine
(that's not an env var Grafana knows, so it stays), but a literal `$` you actually want must be `$$`. In
**dashboard JSON** no interpolation happens at all, so `$__rate_interval` is safe there unconditionally.

### 3.3 Data sources — canonical example, verbatim with the doc's own comments

```yaml
# Configuration file version
apiVersion: 1

# List of data sources to delete from the database.
deleteDatasources:
  - name: Graphite
    orgId: 1

# Mark provisioned data sources for deletion if they are no longer in a provisioning file.
# It takes no effect if data sources are already listed in the deleteDatasources section.
prune: true

# List of data sources to insert/update depending on what's
# available in the database.
datasources:
  # <string, required> Sets the name you use to refer to
  # the data source in panels and queries.
  - name: Graphite
    # <string, required> Sets the data source type.
    type: graphite
    # <string, required> Sets the access mode, either
    # proxy or direct (Server or Browser in the UI).
    # Some data sources are incompatible with any setting
    # but proxy (Server).
    access: proxy
    # <int> Sets the organization id. Defaults to orgId 1.
    orgId: 1
    # <string> Sets a custom UID to reference this
    # data source in other parts of the configuration.
    # If not specified, Grafana generates one.
    uid: my_unique_uid
    # <string> Sets the data source's URL, including the
    # port.
    url: http://localhost:8080
    # <string> Sets the database user, if necessary.
    user:
    # <string> Sets the database name, if necessary.
    database:
    # <bool> Enables basic authorization.
    basicAuth:
    # <string> Sets the basic authorization username.
    basicAuthUser:
    # <bool> Enables credential headers.
    withCredentials:
    # <bool> Toggles whether the data source is pre-selected
    # for new panels. You can set only one default
    # data source per organization.
    isDefault:
    # <map> Fields to convert to JSON and store in jsonData.
    jsonData:
      # <string> Defines the Graphite service's version.
      graphiteVersion: '1.1'
      # <bool> Enables TLS authentication using a client
      # certificate configured in secureJsonData.
      tlsAuth: true
      # <bool> Enables TLS authentication using a CA
      # certificate.
      tlsAuthWithCACert: true
    # <map> Fields to encrypt before storing in jsonData.
    secureJsonData:
      # <string> Defines the CA cert, client cert, and
      # client key for encrypted authentication.
      tlsCACert: '...'
      tlsClientCert: '...'
      tlsClientKey: '...'
      # <string> Sets the database password, if necessary.
      password:
      # <string> Sets the basic authorization password.
      basicAuthPassword:
    # <int> Sets the version. Used to compare versions when
    # updating. Ignored when creating a new data source.
    version: 1
    # <bool> Allows users to edit data sources from the
    # Grafana UI.
    editable: false
```

Semantics the book must get right:

- **`apiVersion: 1`** — this is the *provisioning file format* version. It has been `1` for years and is
  unrelated to `dashboard.grafana.app/v1|v2`. Do not "modernise" it.
- **`prune: true`** (root level) — "enables automatic deletion of provisioned data sources when they're removed
  from the provisioning file or the file is deleted entirely." Good hygiene for a lab that grows.
  `deleteDatasources` is the older, explicit mechanism and takes precedence.
- **`editable: false`** vs `true` — `false` makes the data source read-only in the UI. For a *teaching* lab,
  set `editable: true` in the early chapters (so readers can poke at settings) and flip it to `false` when you
  teach "config as code".
- **`access: proxy`** — always. `direct` (browser) is legacy and effectively dead for Prometheus.
  `proxy` means the browser talks to Grafana, Grafana talks to Prometheus. In a compose network this is why the
  URL is `http://prometheus:9090` and **not** `http://localhost:9090`. Beginners get this wrong constantly.

### 3.4 Prometheus data source — verbatim provisioning example

From <https://grafana.com/docs/grafana/latest/datasources/prometheus/configure/>:

```yaml
apiVersion: 1

datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://localhost:9090
    jsonData:
      httpMethod: POST
      manageAlerts: true
      allowAsRecordingRulesTarget: true
      prometheusType: Prometheus
      prometheusVersion: 3.3.0
      cacheLevel: 'High'
      disableRecordingRules: false
      seriesEndpoint: false
      timeInterval: 10s
      incrementalQueryOverlapWindow: 10m
      exemplarTraceIdDestinations:
        - datasourceUid: my_jaeger_uid
          name: traceID
        - name: traceID
          url: 'http://localhost:3000/explore?orgId=1&left=%5B%22now-1h%22,%22now%22,%22Jaeger%22,%7B%22query%22:%22$${__value.raw}%22%7D%7D'
```

Field-by-field, in the order a beginner meets them:

| `jsonData` key | UI label | What it does | Book relevance |
|---|---|---|---|
| `timeInterval` | **Scrape interval** | Lower bound for the auto-calculated interval; feeds `$__rate_interval` | **Set this to your Prometheus `scrape_interval`. It is the highest-leverage single setting in the whole book.** |
| `httpMethod` | HTTP method | `POST` (default) or `GET` | POST avoids URL-length limits on big queries |
| `queryTimeout` | Query timeout | default `60s` | |
| `prometheusType` | Prometheus type | `Prometheus` \| `Mimir` \| `Thanos` \| `Cortex` | affects which features Grafana offers |
| `prometheusVersion` | Version | e.g. `3.3.0` | gates feature detection |
| `manageAlerts` | Manage alert rules via Alerting UI | lets Grafana write rules back to a ruler | leave `false` for a plain Prometheus |
| `allowAsRecordingRulesTarget` | | allows this DS as a recording-rule target | |
| `disableRecordingRules` | Disable recording rules | | |
| `cacheLevel` | | `None`/`Low`/`Medium`/`High` — browser-side query cache | |
| `incrementalQuerying` / `incrementalQueryOverlapWindow` | Incremental querying | re-fetch only the new tail on dashboard refresh | nice perf story, optional |
| `seriesEndpoint` | | use `/api/v1/series` instead of `/api/v1/labels` for metadata | |
| `exemplarTraceIdDestinations[]` | Exemplars | `{ name, datasourceUid }` for internal links or `{ name, url }` for external | see §11 |
| `sigV4Auth` | | AWS SigV4 | out of scope |

**Note the `$$` in the exemplar URL** (`$${__value.raw}`) — that is the provisioning escape for a literal `$`,
exactly as documented in §3.2. Great teachable moment; also a great way to get it wrong in a manuscript.

**Recommended book version** (network-correct for compose, minimal, honest):

```yaml
apiVersion: 1

datasources:
  - name: Prometheus
    type: prometheus
    uid: prometheus          # pin it — dashboards reference this string
    access: proxy
    url: http://prometheus:9090
    isDefault: true
    editable: false
    jsonData:
      httpMethod: POST
      timeInterval: 15s      # MUST match prometheus.yml global.scrape_interval
```

### 3.5 Data source `uid` — the rule that makes provisioned dashboards portable

- If you omit `uid`, Grafana generates a random one at first startup. Any dashboard JSON you write by hand then
  has to reference that random UID → your dashboards break on a fresh `docker compose down -v`.
- **Always set an explicit `uid`** in the book. Use a lowercase slug (`prometheus`, `loki`).
- Then dashboard panels reference it as:

```json
"datasource": { "type": "prometheus", "uid": "prometheus" }
```

- Alternative that also works and is arguably better for a book: reference the **default** data source with

```json
"datasource": { "type": "prometheus", "uid": "${DS_PROMETHEUS}" }
```

only in *exported-for-sharing* dashboards (see §4.9), or simply omit `datasource` on a panel to inherit the
dashboard/default one. **Recommendation: use an explicit `uid: prometheus` everywhere. It is the least magical
and the easiest to debug.**

- UID constraints: string, and for dashboards the docs say **8–40 characters**. Data source UIDs are looser but
  keep them short, lowercase, `[a-zA-Z0-9_-]`.

### 3.6 Dashboards — provider YAML, verbatim with the doc's own comments

```yaml
apiVersion: 1

providers:
  # <string> an unique provider name. Required
  - name: 'a unique provider name'
    # <int> Org id. Default to 1
    orgId: 1
    # <string> name of the dashboard folder.
    folder: ''
    # <string> folder UID. will be automatically generated if not specified
    folderUid: ''
    # <string> provider type. Default to 'file'
    type: file
    # <bool> disable dashboard deletion
    disableDeletion: false
    # <int> how often Grafana will scan for changed dashboards
    updateIntervalSeconds: 10
    # <bool> allow updating provisioned dashboards from the UI
    allowUiUpdates: false
    options:
      # <string, required> path to dashboard files on disk. Required when using the 'file' type
      path: /var/lib/grafana/dashboards
      # <bool> use folder names from filesystem to create folders in Grafana
      foldersFromFilesStructure: true
```

Semantics:

- **`options.path`** — the directory containing the dashboard **JSON** files. Grafana walks it recursively.
- **`options.foldersFromFilesStructure: true`** — subdirectories under `path` become Grafana folders.
  When `true`, the `folder` / `folderUid` fields are ignored for nested files. Ideal for the growing lab:
  ```
  grafana/dashboards/
  ├── 01-service/
  │   └── request-rate.json
  ├── 02-runtime/
  │   └── go-runtime.json
  └── 99-alerts/
      └── alert-overview.json
  ```
- **`folder` / `folderUid`** — used when `foldersFromFilesStructure` is `false` (or absent). If the folder does
  not exist, Grafana creates it. Setting an explicit `folderUid` keeps folder URLs stable across rebuilds.
- **`updateIntervalSeconds: 10`** — Grafana rescans every 10s. **In Docker with a bind mount this is how live
  editing works**: reader edits `request-rate.json` on the host, waits ≤10s, refreshes browser. Excellent
  pedagogy — but see the caveat below.
- **`disableDeletion: true`** — a dashboard removed from disk is *not* removed from Grafana.
- **`allowUiUpdates`** — see next section.

> **The mtime/inode caveat.** Grafana's file watcher compares the file's modification time. Some editors
> (and some Docker Desktop bind-mount filesystems on Windows/macOS) write via rename or don't propagate mtime
> reliably to the container. If the reader's edit doesn't show up, the fix is `docker compose restart grafana`.
> **Put that in a callout box.** PARTIALLY VERIFIED: the reload-on-interval behaviour is documented; the
> Docker-Desktop mtime flakiness is well-known field experience rather than a documented Grafana statement.

### 3.7 `allowUiUpdates` — verbatim semantics

- `allowUiUpdates: true` → the reader can save changes made in the UI; they persist to the database.
  **But:** *"If you save a provisioned dashboard in the UI and then later update the provisioning source,
  Grafana always overwrites the database dashboard with the one from the provisioning file."*
- `allowUiUpdates: false` (default) → the **Save** button errors out with a dialog. The reader can still edit
  in the browser session and can **Export → JSON**, then paste back into the file.

**Recommended book progression:**
- Chapters 3–6: `allowUiUpdates: true`. Let the reader click around and save. Reduce friction.
- The "config as code" chapter: flip to `false`, and teach the loop *edit in UI → export JSON → commit to file*.
  That is the real-world workflow and it lands much better once they've felt the friction.

### 3.8 Two accepted dashboard file formats (verbatim)

Classic JSON (still the everyday format):

```json
{
  "dashboard": {
    "id": null,
    "uid": "example-dashboard",
    "title": "Production Overview",
    "tags": ["production", "monitoring"],
    "timezone": "browser",
    "schemaVersion": 16,
    "version": 0,
    "refresh": "30s"
  },
  "folderUid": "monitoring-folder",
  "overwrite": true
}
```

Kubernetes resource format:

```json
{
  "kind": "Dashboard",
  "apiVersion": "dashboard.grafana.app/v1",
  "metadata": {
    "name": "dashboard-uid"
  },
  "spec": {
    "title": "Dashboard title",
    "panels": [...]
  }
}
```

> *"You **must** use the Kubernetes resource format to provision dashboards v2 / dynamic dashboards."*

**Very important nuance for the book.** In practice, file provisioning also accepts a **bare** dashboard JSON
object (no `"dashboard": { ... }` wrapper, no k8s wrapper) — that is what every dashboard you download from
grafana.com looks like, and it is what the UI's **Export as JSON** produces. That bare form is what the book
should use. The wrapped `{"dashboard": …, "folderUid": …, "overwrite": true}` form shown in the docs is the
HTTP-API request body shape, and it *also* works from a file.
**PARTIALLY VERIFIED:** the bare form is universally used and works; the docs currently only show the wrapped
form and the k8s form. Verify empirically when you build the lab, then state whichever you actually shipped.

Rules that are documented and do matter:
- `"id": null` — required. A non-null `id` collides with the DB's own numeric IDs.
- `"uid": "<stable-string>"` — *"If the dashboard in the JSON file contains an [UID], Grafana updates the
  dashboard with that UID in the database."* This gives **reusable dashboard URLs**: `/d/<uid>/<slug>`
  is stable across rebuilds and across the reader's machine and yours. **Set a uid on every dashboard in the
  book so you can print URLs in the text.**
- `"version"` — provisioning ignores/overwrites it; don't hand-maintain it.

For v2 / dynamic dashboards: a community report (Grafana 13, self-solved, no staff reply) says the working
apiVersion string is **`dashboard.grafana.app/v2`**, not `v1` and not `v2beta1`, and that using `v1` with a v2
spec produces "empty dashboard title" errors. The docs' Swagger link still points at
`dashboard.grafana.app-v2beta1`. **PARTIALLY VERIFIED — confirm against the actual 13.1.1 image before
printing.** See §4.8.

**Book recommendation: provision Classic JSON.** It is what every existing dashboard on grafana.com is, it is
what the UI exports by default, it is stable, and every reader's Google search will match it. Mention v2/k8s
format in one clearly-labelled "what's coming" box.

### 3.9 Alerting provisioning (files) — for the alerting chapter

Directory: `provisioning/alerting/`. Verbatim examples from
<https://grafana.com/docs/grafana/latest/alerting/set-up/provision-alerting-resources/file-provisioning/>:

```yaml
apiVersion: 1
groups:
  - orgId: 1
    name: my_rule_group
    folder: my_first_folder
    interval: 60s
    rules:
      - uid: my_id_1
        title: my_first_rule
        condition: A
        data:
          - refId: A
            datasourceUid: '__expr__'
            model:
              conditions:
                - evaluator:
                    params:
                      - 3
                    type: gt
                  operator:
                    type: and
                  query:
                    params:
                      - A
                  reducer:
                    type: last
                  type: query
              datasource:
                type: __expr__
                uid: '__expr__'
              expression: 1==0
              intervalMs: 1000
              maxDataPoints: 43200
              refId: A
              type: math
        dashboardUid: my_dashboard
        panelId: 123
        noDataState: Alerting
        execErrState: Alerting
        for: 60s
        annotations:
          some_key: some_value
        labels:
          team: sre_team_1
```

```yaml
apiVersion: 1
contactPoints:
  - orgId: 1
    name: cp_1
    receivers:
      - uid: first_uid
        type: prometheus-alertmanager
        disableResolveMessage: false
        settings:
          url: http://test:9000
```

```yaml
apiVersion: 1
policies:
  - orgId: 1
    receiver: grafana-default
    group_by: ['...']
    matchers:
      - alertname = Watchdog
      - service_id_X = serviceX
      - severity =~ "warning|critical"
    object_matchers:
      - ['alertname', '=', 'CPUUsage']
      - ['service_id-X', '=', 'serviceX']
      - ['severity', '=~', 'warning|critical']
    mute_time_intervals:
      - abc
    group_wait: 30s
    group_interval: 5m
    repeat_interval: 4h
```

```yaml
apiVersion: 1
muteTimes:
  - orgId: 1
    name: mti_1
    time_intervals:
      - times:
          - start_time: '06:00'
            end_time: '23:59'
        location: 'UTC'
        weekdays: ['monday:wednesday', 'saturday', 'sunday']
        months: ['1:3', 'may:august', 'december']
        years: ['2020:2022', '2030']
        days_of_month: ['1:5', '-3:-1']
```

```yaml
apiVersion: 1
templates:
  - orgId: 1
    name: my_first_template
    template: |
      {{ define "my_first_template" }}
        Custom notification message
      {{ end }}
```

Deletion keys, all top-level and all `apiVersion: 1`:
`deleteRules`, `deleteContactPoints`, `resetPolicies`, `deleteMuteTimes`, `deleteTemplates`.

> Note the mixed casing: `groups`/`contactPoints`/`policies`/`muteTimes`/`templates` are camelCase, but the
> *fields inside* policies are snake_case (`group_by`, `group_wait`, `repeat_interval`, `mute_time_intervals`)
> because they mirror Alertmanager's own config. Easy thing for a textbook to normalise incorrectly.
> (Detailed alerting semantics are the other researcher's territory — this section exists so the provisioning
> chapter is internally consistent.)

### 3.10 Plugins provisioning

Directory `provisioning/plugins/`. The plugin must already be installed.

```yaml
apiVersion: 1
apps:
  - type: raintank-worldping-app
    org_id: 1
    disabled: false
    jsonData:
      key: value
    secureJsonData:
      key: value
```

(Note `org_id` snake_case here, vs `orgId` in datasources/dashboards. Historical inconsistency; copy exactly.)

### 3.11 Access control provisioning

`provisioning/access-control/` — **Grafana Enterprise / Cloud only.** Not usable in the book's OSS lab.

---

## 4. Dashboards: what changed, and why 2021-era books are wrong

### 4.1 The Scenes → Dynamic Dashboards arc (the narrative)

1. Grafana Labs built **`@grafana/scenes`**, a React framework for building "scene"-based apps. Explore Metrics,
   the Drilldown apps and Grafana's own dashboard runtime were rebuilt on it.
2. **Grafana 11.3–11.5**: the dashboard page itself was progressively migrated to Scenes behind the
   `dashboardScene` toggle, then defaulted on. Users mostly saw "the edit experience feels different".
3. **Grafana 12.0 (May 2025)**: **Dynamic Dashboards** shipped as **preview**, built on the Scenes migration.
   *"navigating, consuming, and editing dashboards"* got a new engine. Also 12.0 = **Angular removed**,
   **Git Sync** (GitHub) introduced, **SQL Expressions** private preview.
4. **Grafana 12.4 (Feb 2026)**: Dynamic Dashboards **public preview** with revamped UX; dashboard templates;
   multi-property variables; gauge revamp; "Dashboard controls" menu; automatic Unified Storage migration for
   small instances.
5. **Grafana 13.0 (Apr 2026)**: **Dynamic Dashboards GA.** Verbatim: *"Every new and existing dashboard uses
   the new layout engine, editing experience, and dashboard structure automatically."* Existing dashboards
   migrate to the new schema **on open**. Also: **Git Sync GA**, **Unified Storage for folders and dashboards**,
   gauge GA, saved queries, panel styles, annotation clustering, Grafana Advisor GA.
6. **Grafana 13.1 (Jul 2026)**: many of the 13.0 previews go GA — multi-property variables, time-series-to-table
   with sparklines, annotation clustering, copy/paste panel styles, **Filter and Group by**, panel styles,
   section-level variables. Git Sync gains GitLab/Bitbucket/plain-Git, verified commits, README rendering,
   root-level sync, UI import into a Git-Sync folder.

**Practical consequence for the book:** the phrase "Scenes" is now an implementation detail the reader never
needs. **Write about "Dynamic Dashboards", "edit mode", "layouts". Mention Scenes once, in a footnote, so
readers who Google it aren't lost.**

### 4.2 Edit mode and the current editing UI

Verbatim from the create-dashboard docs:

- Create: **Dashboards > New > New Dashboard**, then the blue **+** icon.
- Adding content offers three routes: **Configure visualization**, **Use saved query**, **Use library panel**.
  (**"Use saved query"** is new in 13.x — saved queries are a first-class reusable object now.)
- In edit mode there is a **sidebar** and a **toolbar**. The sidebar *"allows changes without leaving the
  dashboard, by displaying options associated with the part of the dashboard that's in focus."*
- You **Edit → change → Save**. Edit mode is explicit; you are not silently editing.
- 12.4 added a consolidated **Dashboard controls** menu (template variables + controls) to de-clutter the
  toolbar. 13.1 further revamped sidebar/toolbar.

**Screenshot warning for the book:** the dashboard chrome changed materially in 12.0, again in 12.4, and again
in 13.0/13.1. **Every screenshot must be retaken against 13.1.1.** Do not reuse anything.

### 4.3 Layouts

Two layout families, verbatim:

- **Custom** — *"You can position and size panels individually. This is the default selection for a new
  dashboard."* This is the classic 24-column grid.
- **Auto grid** — *"Panels resize and fit automatically to create a uniform grid."*

Plus grouping constructs: **Rows** and **Tabs**, which can be nested and can carry their own variables
(section-level variables, GA in 13.1) and their own repeat settings.

### 4.4 Conditional rendering (show/hide rules)

New with Dynamic Dashboards. Three rule types:

| Rule | Behaviour |
|---|---|
| **Query result** | show/hide depending on whether the queries return data |
| **Template variable** | show/hide based on a variable's value; operators equals / not equals / matches |
| **Time range less than** | hide if *"dashboard time range is shorter than the selected time range"* |

Multiple rules combine with **Match all** / **Match any**.
**Documented restriction:** these rules apply to panels in **Auto grid** layout only.

This is a genuinely useful, genuinely new capability — a good "wow" beat for a later chapter (e.g. hide the
"error breakdown" row when there are no errors).

### 4.5 Repeating rows, panels and tabs

Verbatim: *"dynamically add panels, rows, or tabs to a dashboard based on the value of a variable"* via the
**Repeat options** section, with horizontal or vertical arrangement.

Classic-schema JSON fields (still what you write in provisioned Classic dashboards):

```json
{
  "repeat": "instance",
  "repeatDirection": "h",
  "maxPerRow": 3
}
```

- `repeat` — the **variable name** (no `$`).
- `repeatDirection` — `"h"` (horizontal) or `"v"` (vertical). If missing, the classic engine defaults to `h`.
- `maxPerRow` — only meaningful for `h`.
- On a **row** object (`"type": "row"`), `repeat` repeats the whole row and everything collapsed inside it.

In the v2 / dynamic schema the equivalent is a `RepeatOptions` object with
`repeatMode: 'variable'`, `repeatBy: <string>`, optional `repeatDirection?: "h" | "v"`, optional `maxPerRow?: number`.
**PARTIALLY VERIFIED** (from PR/issue discussion in `grafana/grafana`, not from the published docs).

Gotchas worth a callout:
- Repeat only re-evaluates on **variable change or dashboard load** — not on refresh.
- Repeated panels get `repeatPanelId`/generated ids; don't hand-write ids for them.
- Repeating a row + repeating panels inside it is legal and confusing. Teach row-repeat with **one** panel first.

### 4.6 Dashboard JSON model — top-level fields that actually matter

Verbatim table from the docs, with a "does the book care?" column added:

| Field | Docs description | Book cares? |
|---|---|---|
| `id` | *"unique numeric identifier for the dashboard. (generated by the db)"* | **Yes — must be `null` in provisioned files** |
| `uid` | *"unique dashboard identifier that can be generated by anyone. string (8-40)"* | **Yes — always set it** |
| `title` | *"current title of dashboard"* | Yes |
| `tags` | *"tags associated with dashboard, an array of strings"* | Yes — cheap nav win |
| `style` | *"theme of dashboard, i.e. `dark` or `light`"* | No — vestigial |
| `timezone` | *"timezone of dashboard, i.e. `utc` or `browser`"* | Yes — set `browser` |
| `editable` | *"whether a dashboard is editable or not"* | Yes |
| `graphTooltip` | *"0 for no shared crosshair or tooltip (default), 1 for shared crosshair, 2 for shared crosshair AND shared tooltip"* | **Yes — set `1`, it's the single best correlation UX win** |
| `time` | *"time range for dashboard"* | Yes — `{"from":"now-1h","to":"now"}` |
| `timepicker` | timepicker metadata | Sometimes |
| `templating` | template variables | **Yes** |
| `annotations` | annotations metadata | Yes |
| `refresh` | auto-refresh interval | Yes — `"30s"`; respect `min_refresh_interval` |
| `schemaVersion` | *"version of the JSON schema (integer), incremented each time a Grafana update brings changes to said schema"* | **Yes — see §4.7** |
| `version` | *"version of the dashboard (integer), incremented each time the dashboard is updated"* | No — let Grafana own it |
| `panels` | *"panels array"* | Yes |
| `links` | dashboard links | Optional |
| `fiscalYearStartMonth` | month fiscal year begins (0–11) | No |
| `preload` | whether to preload dashboard | Optional |
| `weekStart` | `""` / `monday` / … | No |

**`panels[]`** minimal shape:

```json
"panels": [
  {
    "type": "text",
    "title": "Panel Title",
    "gridPos": { "x": 0, "y": 0, "w": 12, "h": 9 },
    "id": 4,
    "mode": "markdown",
    "content": "# title"
  }
]
```

`gridPos` (verbatim semantics):
- `w`: **1–24** — *"dashboard width divided into 24 columns"*
- `h`: grid height units, **each = 30 pixels**
- `x`, `y`: position; `y` is a sort key, Grafana compacts upward

A realistic Prometheus timeseries panel for the book:

```json
{
  "type": "timeseries",
  "title": "Request rate",
  "id": 1,
  "gridPos": { "h": 8, "w": 12, "x": 0, "y": 0 },
  "datasource": { "type": "prometheus", "uid": "prometheus" },
  "targets": [
    {
      "refId": "A",
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "editorMode": "code",
      "expr": "sum by (status) (rate(http_requests_total{job=\"demo-app\"}[$__rate_interval]))",
      "legendFormat": "{{status}}",
      "range": true
    }
  ],
  "fieldConfig": {
    "defaults": {
      "unit": "reqps",
      "custom": { "drawStyle": "line", "lineWidth": 1, "fillOpacity": 10 }
    },
    "overrides": []
  },
  "options": {
    "legend": { "displayMode": "list", "placement": "bottom", "showLegend": true },
    "tooltip": { "mode": "multi", "sort": "desc" }
  }
}
```

Fields inside a target that a beginner will hit:
- `refId` — `"A"`, `"B"`, … used by transformations, alerting conditions and `Filter data by query refId`.
- `expr` — the PromQL.
- `legendFormat` — `{{label}}` templating. `__auto` is a supported special value.
- `range: true` / `instant: true` — range query vs instant query. **Stat/Gauge panels normally want
  `instant: true`; time series wants `range: true`.** Both can be true; Grafana returns two frames.
- `editorMode` — `"code"` or `"builder"`. Set `"code"` in book JSON so readers land in the text editor.
- `interval` — per-query **Min interval** override (string, e.g. `"30s"`).

**`timepicker`** verbatim example:

```json
"timepicker": {
  "collapse": false,
  "enable": true,
  "notice": false,
  "now": true,
  "hidden": false,
  "nowDelay": "",
  "quick_ranges": [
    { "display": "Last 6 hours", "from": "now-6h", "to": "now" },
    { "display": "Last 7 days",  "from": "now-7d", "to": "now" }
  ],
  "refresh_intervals": ["5s","10s","30s","1m","5m","15m","30m","1h","2h","1d"],
  "status": "Stable",
  "type": "timepicker"
}
```

`quick_ranges` is a relatively recent addition and is a nice touch for a lab dashboard.
`nowDelay` — *"Override time with delay to handle data aggregation lag"* — is the fix for "my last data point
is always missing"; set `"1m"` when scraping every 15s and evaluating recording rules.

**`templating.list[]`** verbatim example (note this doc example is old-style; see §7 for what you should write):

```json
"templating": {
  "enable": true,
  "list": [
    {
      "allFormat": "wildcard",
      "current": { "tags": [], "text": "prod", "value": "prod" },
      "datasource": null,
      "includeAll": true,
      "name": "env",
      "options": [
        { "selected": false, "text": "All",   "value": "*" },
        { "selected": false, "text": "stage", "value": "stage" }
      ],
      "query": "tag_values(cpu.utilization.average,env)",
      "refresh": false,
      "type": "query"
    }
  ]
}
```

### 4.7 `schemaVersion` — the number to get right

Verified directly from `grafana/grafana` `main`, file
`apps/dashboard/pkg/migration/schemaversion/migrations.go`:

```go
const (
	MIN_VERSION    = 0
	LATEST_VERSION = 42
)
```

and the migration registry runs `2 → 42` (`v2.go` … `v42.go` all present in
`apps/dashboard/pkg/migration/schemaversion/`).

So: **the current classic dashboard `schemaVersion` is `42`.**

What this means in practice:
- You can hand-write a dashboard with a **lower** `schemaVersion` and Grafana will migrate it forward on load.
  Grafana removed the `schemaVersion < min_version` rejection, so old dashboards keep working.
- **You should not hand-write `schemaVersion: 42` unless the JSON really is v42-shaped.** Safer authoring
  workflow for the book: build the panel in the UI on 13.1.1, **Export as JSON**, and ship whatever
  `schemaVersion` Grafana emits. Then the number is true by construction.
- Migration moved to the **backend** in the 12.x/13.x era (`DashboardMigrator` → Go). Consequence: the API can
  now return a migrated dashboard, so a dashboard's stored `schemaVersion` and its served `schemaVersion` can
  differ.

### 4.8 The three dashboard models (this is the part everyone gets wrong)

Verbatim classifications from the current docs:

| Model | What it is | apiVersion |
|---|---|---|
| **Classic** | *"Non-Kubernetes resource that was the default before Grafana v12.2.0. Widely used for exporting, importing, and sharing dashboards."* | *(none — bare JSON)* |
| **V1 Resource** | *"Classic dashboard schema formatted as a Kubernetes-style resource. The `spec` property contains the Classic model. Default format for API communication between Grafana v12.2.0 and v13.0.0."* | `dashboard.grafana.app/v1` |
| **V2 Resource** | *"current, supports new features such as advanced layouts and conditional rendering"*; models all dashboard elements as Kubernetes kinds | `dashboard.grafana.app/v2` (docs Swagger link still says `v2beta1`) |

Verified from the repo (GitHub contents API, `main`, 2026-07-28):

```
apps/dashboard/pkg/apis/dashboard/   → v0alpha1, v1, v1beta1, v2, v2alpha1, v2beta1
apps/dashboard/kinds/                → v0alpha1, v1beta1, v2, v2alpha1, v2beta1
```

So `v2` exists as a served, non-beta group version. The published docs page for the JSON model still links to
`https://play.grafana.org/swagger?api=dashboard.grafana.app-v2beta1`, and the *V1 Resource* example in the docs
uses `dashboard.grafana.app/v1`. A Grafana 13 community thread reports that **file provisioning of a v2 spec
only worked with `apiVersion: dashboard.grafana.app/v2`**.

**Verdict for the book: `PARTIALLY VERIFIED`. Teach Classic JSON. Show the V2 resource only as an aside, and
if you print an apiVersion string, verify it against the running 13.1.1 lab first** (hit
`GET /apis/dashboard.grafana.app` on the reader's own instance and read the `versions` list back — that is also
a nice teaching moment about the app-platform API).

V1 Resource example verbatim (useful because it shows a real `schemaVersion` in the wild):

```json
{
  "apiVersion": "dashboard.grafana.app/v1",
  "kind": "Dashboard",
  "metadata": {
    "name": "isnt5ss",
    "namespace": "stacks-521104",
    "uid": "92674c0e-0360-4bb4-99ab-fb150581376d",
    "resourceVersion": "1764705030717045",
    "generation": 1,
    "creationTimestamp": "2025-12-02T19:50:30Z",
    "labels": { "grafana.app/deprecatedInternalID": "1329" },
    "annotations": {
      "grafana.app/createdBy": "user:u000000002",
      "grafana.app/folder": "",
      "grafana.app/saved-from-ui": "Grafana Cloud (instant)"
    }
  },
  "spec": {
    "annotations": { "list": [ { "builtIn": 1, "datasource": { "type": "grafana", "uid": "-- Grafana --" }, "enable": true, "hide": true, "iconColor": "rgba(0, 211, 255, 1)", "name": "Annotations & Alerts", "type": "dashboard" } ] },
    "editable": true,
    "fiscalYearStartMonth": 0,
    "graphTooltip": 0,
    "id": 1329,
    "links": [],
    "panels": [],
    "preload": false,
    "schemaVersion": 42,
    "tags": [],
    "templating": { "list": [] },
    "time": { "from": "now-6h", "to": "now" },
    "timepicker": {},
    "timezone": "Africa/Abidjan",
    "title": "Graphite suggestions",
    "uid": "isnt5ss",
    "version": 1,
    "weekStart": ""
  },
  "status": {}
}
```

Note `metadata.name` == the dashboard **uid**, and `metadata.uid` is a *different*, k8s-internal UUID.
That naming collision will confuse readers; call it out if you show this at all.

### 4.9 Export and share (current UI names)

From the share/export docs:

| Option | OSS? | Notes |
|---|---|---|
| **Share internally** | Yes | direct link, options to lock time range and shorten |
| **Share externally** (public dashboards) | Yes | anyone without a Grafana account |
| **Share snapshot** | Yes | *"removing sensitive data such as queries and panel links, leaving only visible metrics and series names"* |
| **Export as code / JSON** | Yes | *"layout, variables, styles, data sources, queries, and so on"* |
| **Schedule a report** | **Enterprise only** | |
| **Export as PDF** | **Enterprise only** | |

Key detail: **when exporting, you choose between the "Classic" and "V2 Resource" models. V2 Resource can be
emitted as JSON *or YAML*.** That is the current "observability as code" export path and it's new enough that
no existing book covers it.

There is also a **"Share dashboard with another instance"** switch, which *"removes details specific to your
Grafana instance"*. Historically this is the `__inputs` / `__requires` / `${DS_PROMETHEUS}` mechanism:

```json
{
  "__inputs": [
    {
      "name": "DS_PROMETHEUS",
      "label": "Prometheus",
      "description": "",
      "type": "datasource",
      "pluginId": "prometheus",
      "pluginName": "Prometheus"
    }
  ],
  "__requires": [ { "type": "datasource", "id": "prometheus", "name": "Prometheus", "version": "1.0.0" } ],
  "panels": [ { "datasource": "${DS_PROMETHEUS}" } ]
}
```

**UNVERIFIED for 13.1.1:** the current docs page describes the toggle but does **not** document `__inputs` /
`DS_` placeholders explicitly. The mechanism certainly still exists (every grafana.com community dashboard uses
it and importing them works), but **do not assert the exact emitted shape without checking against 13.1.1.**

Why the book cares: a dashboard exported *with* the externally-shareable toggle contains `${DS_PROMETHEUS}` and
**will not work as a provisioned file** unless you either (a) define a `datasource`-type template variable named
`DS_PROMETHEUS`, or (b) find-and-replace it with your real uid. **This is the number-one reason "I copied a
dashboard from grafana.com into my provisioning folder and it shows 'Datasource ${DS_PROMETHEUS} was not
found'".** It deserves a full worked example in the book.

### 4.10 Import

Three documented routes: *"Upload a dashboard JSON file"*, *"Paste a Grafana.com dashboard URL or ID into the
field provided"*, *"Paste dashboard JSON text directly into the text area"*.
On import you pick the target folder and map each `__inputs` entry to a real data source.

13.1 adds: **import dashboard JSON directly into a Git-Sync-provisioned folder from the UI**, with commit
configuration.

### 4.11 Version history, restore, delete

- Dashboard **version history** with diff and restore — OSS, always been there.
- **13.0 adds "Recently deleted"**: restore deleted dashboards from a soft-delete view.
- **13.0 Unified Storage** changes where dashboards physically live (see §16). Version history survives.

---

## 5. Panels / visualizations — current names and type IDs

### 5.1 Documented names, in the docs' own grouping

**Graphs & charts:** Time series · State timeline · Status history · Bar chart · Histogram · Heatmap ·
Pie chart · Candlestick · Gauge · Trend · XY chart
**Stats & numbers:** Stat · Bar gauge
**Misc:** Table · Logs · Node graph · Traces · Flame graph · Canvas · Geomap
**Widgets:** Dashboard list · Alert list · Annotations list · Text · News

> 13.0 also introduced a **Graphviz** visualization (DOT-language interactive diagrams). It is **not** in
> `public/app/plugins/panel/` (see below), so it ships as a plugin rather than a core panel.
> **PARTIALLY VERIFIED** — announced in the 13.0 what's-new; distribution mechanism not confirmed.

### 5.2 Core panel type IDs (verified from `public/app/plugins/panel/` on `main`, 2026-07-28)

These are the exact strings you put in `"type"` in dashboard JSON:

```
alertlist        annolist        barchart        bargauge        candlestick
canvas           dashlist        debug           flamegraph      gauge
geomap           gettingstarted  heatmap         histogram       live
logs             logstable       news            nodeGraph       piechart
stat             state-timeline  status-history  table           text
textng           timeseries      traces          trend           welcome
xychart
```

Mapping the ones that are non-obvious:

| UI name | `"type"` value |
|---|---|
| Time series | `timeseries` |
| Bar chart | `barchart` |
| Bar gauge | `bargauge` |
| State timeline | `state-timeline` |
| Status history | `status-history` |
| XY chart | `xychart` |
| Pie chart | `piechart` |
| Node graph | `nodeGraph` (**camelCase — the only one**) |
| Flame graph | `flamegraph` |
| Dashboard list | `dashlist` |
| Annotations list | `annolist` |
| Alert list | `alertlist` |

`debug`, `gettingstarted`, `welcome`, `live` are internal/utility panels — don't teach them.
`logstable` and `textng` are newer additions; `textng` is a next-gen text panel.
**UNVERIFIED:** whether `textng` is user-selectable in 13.1.1 or still behind a toggle.

### 5.3 Panels that no longer exist

| Gone | Replacement | Since |
|---|---|---|
| `graph` (the AngularJS "Graph" panel) | `timeseries` | force-migrated; Angular removed in **12.0** |
| `table-old` | `table` | same |
| `singlestat` / `grafana-singlestat-panel` | `stat` | long gone; `$__name` global var is its last fossil |
| `heatmap-old` | `heatmap` | |
| `IoT TwinMaker SceneViewer` | — | broke on React 19 in 13.0 |

**If a manuscript draft, a downloaded dashboard, or an LLM-generated JSON blob contains `"type": "graph"`, it is
wrong for this book.** Grafana will migrate it, but the reader will see options that don't match the text.

### 5.4 Time series panel option groups (13.1)

1. **Panel options** — Title, Description, Transparent background, Panel links, Repeat options
2. **Tooltip** — Tooltip mode (Single / All / Hidden), Values sort order, Hide zeros, Hover proximity, Max width, Max height
3. **Legend** — Visibility, Mode (List / Table), Placement (Bottom / Right), Width, **Limit**, Values (calcs), Overflow, **Series visibility** *(13.1: interactive filter by name or label in the legend)*
4. **Axis** — Time zone, Placement, Label, Width, Show grid lines, Color, Show border, Scale (Linear / Logarithmic / Symlog), Centered zero, Soft min, Soft max
5. **Annotations** *(13.x)* — Multi-row annotations, **Annotation clustering**, Hide lines and areas
6. **Graph styles** — Style (Lines / Bars / Points), Line interpolation, Line width, Fill opacity, Gradient mode, Line style, Connect null values, Disconnect values, Show points, Show values, Point size, Stack series, Bar alignment, Bar width factor
7. **Standard options** — Unit, Min, Max, Field min/max, Decimals, Display name, Color scheme, No value
8. **Data links and actions** — Title, URL, Open in new tab, **One click**, plus Actions (API call)
9. **Value mappings** — Condition, Display text, Color, Icon
10. **Thresholds** — Value, Thresholds mode (Absolute / Percentage), Show thresholds
11. **Field overrides**

Plus, new and GA in 13.1: **Panel styles** — predefined styling presets for time series, stat, gauge, bar gauge
and bar chart panels, with **copy/paste panel styles** between panels of the same type.

### 5.5 Field config: defaults vs overrides

The JSON shape (this is stable and the book needs it):

```json
"fieldConfig": {
  "defaults": {
    "unit": "reqps",
    "min": 0,
    "decimals": 2,
    "color": { "mode": "palette-classic" },
    "thresholds": {
      "mode": "absolute",
      "steps": [
        { "color": "green", "value": null },
        { "color": "red",   "value": 80 }
      ]
    },
    "custom": { "drawStyle": "line", "lineWidth": 1, "fillOpacity": 10, "showPoints": "auto" }
  },
  "overrides": [
    {
      "matcher": { "id": "byName", "options": "5xx" },
      "properties": [
        { "id": "color", "value": { "mode": "fixed", "fixedColor": "red" } }
      ]
    }
  ]
}
```

- `defaults` = every field.
- `defaults.custom` = **panel-type-specific** options (`drawStyle` etc. only exist for timeseries).
- `overrides[]` = `{ matcher, properties[] }`.
- Matcher UI names → matcher ids:

| UI name | `matcher.id` |
|---|---|
| Fields with name | `byName` |
| Fields with name matching regex | `byRegexp` |
| Fields with type | `byType` |
| Fields returned by query | `byFrameRefID` |
| Fields with values | `byValue` |

**PARTIALLY VERIFIED:** the five UI names are verbatim from the current docs; the `matcher.id` strings are from
the stable Grafana data-frame API and are consistent across 9.x–13.x, but the current docs page no longer prints
the JSON. Confirm by exporting a panel with an override from the 13.1.1 lab.

The first threshold step **must** have `"value": null` — that's the "base" step. Beginners write `0` and get a
subtly wrong colour at exactly zero.

### 5.6 Query options (this belongs next to the PromQL chapter)

Verbatim from the query-and-transform docs:

| Option | Docs text |
|---|---|
| **Max data points** | *"If the data source supports it, this sets the maximum number of data points for each series returned."* |
| **Min interval** | *"Sets a minimum limit for the automatically calculated interval, which is typically the minimum scrape interval."* |
| **Interval** | read-only; the resulting `$__interval` / `$__interval_ms` |
| **Relative time** | *"Overrides the relative time range for individual panels, which causes them to be different than what is selected in the dashboard time picker."* |
| **Time shift** | *"Overrides the time range for individual panels by shifting its start and end relative to the time picker."* |
| **Cache timeout** | *"Overrides the default cache timeout if your time series store has a query cache."* |

The relationship, stated plainly for a beginner:

```
$__interval ≈ (to - from) / maxDataPoints
              then rounded up to a "nice" duration
              then floored at Min interval
```

`Max data points` defaults to the panel's pixel width. That is why **the same PromQL renders differently in a
narrow panel and a wide one** — a fact that reliably astonishes beginners and is worth a full page.

---

## 6. Transformations — the complete current list

Applied **after** the query returns, **before** the visualization. Order matters:
*"When there are multiple transformations, Grafana applies them in the order they are listed. Each
transformation creates a result set that then passes on to the next transformation."*
UI affordances: **bug icon** = show input/output frames (debug), **eye icon** = disable without deleting,
**filter icon** = apply to specific queries only.

Current names, verbatim:

1. Add field from calculation
2. Concatenate fields
3. Config from query results
4. Convert field type
5. Extract fields
6. Lookup fields from resource
7. Filter data by query refId
8. Filter data by values
9. Filter fields by name
10. Format string
11. Format time
12. Group by
13. Grouping to matrix
14. Group to nested tables
15. Create heatmap
16. Histogram
17. Join by field
18. Join by labels
19. Labels to fields
20. Limit
21. Merge series/tables
22. Organize fields by name
23. Partition by values
24. Prepare time series
25. Reduce
26. Rename by regex
27. Rows to fields
28. Series to rows
29. Sort by
30. Spatial
31. Time series to table transform
32. Transpose
33. Trendline
34. Smoothing

Notes for the book:
- **Trendline was previously called "Regression analysis".** Older material uses the old name.
- **Smoothing** (ASAP adaptive algorithm) is new.
- **Time series to table transform** went **GA in 13.1** and now supports **sparkline** columns — this is the
  single most useful transformation for the book's "service overview table" dashboard.
- The five a Prometheus-focused book actually needs: **Organize fields by name**, **Labels to fields**,
  **Join by field**, **Reduce**, **Time series to table transform**. Teach those; list the rest.
- **Filter data by query refId** is the one that makes "hide the helper query" work — pair it with a hidden
  query for e.g. a threshold line.

---

## 7. Variables / templating

### 7.1 Variable types (current UI list, verbatim)

1. **Query** — data source query returning metric names, server names, sensor IDs
2. **Custom** — manually defined comma-separated list
3. **Text box** — free text input with optional default
4. **Constant** — hidden single-value constant
5. **Data source** — quick data source switching
6. **Interval** — time spans like `1m`, `1h`, `1d`
7. **Switch** — toggle between two configurable values *(new-ish; not in older books)*

**Ad hoc filters were renamed.** The docs note ad hoc filters are now **"Filter and Group by"** (GA in 13.1),
surfaced as a dashboard-level control rather than "just another variable". Older books call this "Ad hoc
filters". **Use "Filter and Group by" and mention the old name once.**

Also new/GA in 13.1: **Multi-property variables** — *"Mapping one variable to multiple values"* — one variable
carries several identifiers (e.g. a service name *and* its cluster *and* its namespace). And **section-level
variables** — variables scoped to a row or tab rather than the whole dashboard.

### 7.2 Syntax forms (verbatim)

| Form | Note |
|---|---|
| `$varname` | *"Simple syntax, cannot be used mid-word"* |
| `${var_name}` | *"Allows interpolation within expressions"* |
| `${var_name:<format>}` | *"Enables advanced formatting control"* |
| `[[varname]]` | **"Deprecated syntax, that will be removed in a future release"** |

**The book must never use `[[varname]]`.** It appears in a huge amount of older material.

### 7.3 Advanced variable format options (verbatim table)

Given a multi-value variable with values `test1`, `test2`:

| Format | Example output |
|---|---|
| `csv` | `test1,test2` |
| `distributed` | `test1,servers=test2` |
| `doublequote` | `"test1","test2"` |
| `glob` | `{test1,test2}` |
| `join` | `test1&test2` (custom delimiter) |
| `json` | `["test1", "test2"]` |
| `lucene` | `("test1" OR "test2")` |
| `percentencode` | `foo%28%29bar%20BAZ%2Ctest2` |
| `pipe` | `test1\|test2` |
| `queryparam` | `var-servers=test1&var-servers=test2` |
| `raw` | `test1,test2` (no data source formatting) |
| `regex` | `(test1\|test2)` |
| `singlequote` | `'test1','test2'` |
| `sqlstring` | `'test''1','test2'` |
| `text` | `test1 + test2` |

**For Prometheus the one that matters is `regex`** (and the implicit default, which for the Prometheus data
source already produces a regex-alternation for multi-value). Canonical pattern:

```promql
sum by (instance) (rate(http_requests_total{job=~"$job", instance=~"$instance"}[$__rate_interval]))
```

Note `=~` not `=`. With `Include All` enabled and the custom all-value `.*`, this Just Works.
Beginners write `job="$job"` and it breaks the moment they select two values. **Teach `=~` from the start.**

`queryparam` is how you build a data link that carries the current variable selection to another dashboard:
`/d/other/uid?${var-job:queryparam}&${var-instance:queryparam}` — and `${__all_variables}` carries all of them.

### 7.4 Global built-in variables (verbatim from the Global variables page)

| Variable | Meaning |
|---|---|
| `$__dashboard` | current dashboard name |
| `$__from` / `$__to` | *"always interpolated as epoch milliseconds by default, but you can control date formatting"* — supports ISO 8601, Unix seconds, and custom formats via modifiers such as `:date:seconds` or `:date:YYYY-MM` |
| `$__interval` | *"Automatically calculates time grouping based on the dashboard's time range and pixel width using the formula `(to - from) / resolution`"* |
| `$__interval_ms` | the interval in milliseconds, as a number |
| `$__range` | *"dashboard range as `to - from`"*; available for **Prometheus and Loki**; variants `$__range_s`, `$__range_ms` |
| `$__rate_interval` | designed for Prometheus rate functions (see §7.5) |
| `$__rate_interval_ms` | millisecond form |
| `$__org` | organization ID; `${__org.name}` for the name |
| `$__user` | `${__user.id}`, `${__user.login}`, `${__user.email}` |
| `$__timezone` | current timezone selection (`utc` or IANA) |
| `$timeFilter` / `$__timeFilter` | generates SQL-ish time expressions like `time > now() - 7d` |
| `$__url_time_range` | expands to `from=…&to=…`; **for links only, not query editors** |
| `$__name` | **legacy** — *"Available only in deprecated Singlestat panels for series names"* |

Date-format examples for `$__from` / `$__to`:

```
${__from}                        → 1594671549254   (epoch ms)
${__from:date:seconds}           → 1594671549
${__from:date:iso}               → 2020-07-13T20:19:09.254Z
${__from:date:YYYY-MM-DD}        → 2020-07-13
```

**UNVERIFIED:** the exact sample values above are reconstructed illustrations of the documented modifiers, not
copied literals. The *modifier syntax* (`:date:seconds`, `:date:YYYY-MM`, ISO 8601, Unix seconds) **is**
verbatim from the docs. Regenerate the sample values from the lab before printing them.

### 7.5 `$__rate_interval` — the formula and the reason it exists

**Formula (verbatim from the Prometheus data source docs):**

```
$__rate_interval = max($__interval + Scrape interval, 4 * Scrape interval)
```

where **"Scrape interval"** is:
- the query's **Min step** setting if one is set on that specific query, otherwise
- the data source's **Scrape interval** setting (= `jsonData.timeInterval`, default `15s`).

Docs guidance, verbatim: *"Always use `$__rate_interval` instead of a fixed interval or `$__interval`"* with
rate functions, and: *"For `$__rate_interval` to produce reliable results, the scrape interval must match your
actual Prometheus scrape configuration."*

```promql
rate(http_requests_total[$__rate_interval])
```

**Why it exists — the explanation the book owes the reader.**
`rate()` needs at least two samples inside its range window to return anything. When a reader zooms into a
15-minute window on a wide monitor, `$__interval` can drop to `10s`; with a 15s scrape interval a `[10s]` window
often contains **one** sample or **zero**, and the graph goes full of holes — or, worse, silently sparse.
`$__rate_interval` guarantees the window holds **at least four scrape intervals**, so `rate()` always has
material to work with, at every zoom level, without the author hard-coding `[5m]`.

The `4 *` factor comes from Prometheus's own rule of thumb (range ≥ 4× scrape interval) and it is **not
configurable** — there is a long-standing open feature request for `2 *`. Don't imply it's tunable.

**Consequences the book should state explicitly:**
- `$__rate_interval` is **wrong** for non-rate aggregation over time. For `avg_over_time`, `max_over_time`,
  `sum_over_time` use `$__interval` (you want the window to equal the step, not overlap it).
- `$__rate_interval` **depends on the data source's Scrape interval field being correct**. If the reader leaves
  it at the 15s default while Prometheus scrapes every 60s, every rate graph in the book is subtly wrong. This
  is why §3.4 makes `timeInterval` the headline setting.
- Hard-coded `[5m]` is not *wrong*, it's just fixed. It over-smooths short windows and under-smooths long ones.
  Show all three (`[5m]`, `[$__interval]`, `[$__rate_interval]`) side by side once, on the same metric. It is
  the single most convincing demo in the whole PromQL chapter.

### 7.6 Interval variables and `$__auto`

An **Interval** variable produces values like `1m,5m,10m,30m,1h` plus an optional **auto** option.
Since **Grafana 10.2** the auto option's value is the literal string **`$__auto`** (it used to be
`$__auto_interval_<varname>`). JSON shape:

```json
{
  "type": "interval",
  "name": "step",
  "query": "1m,5m,10m,30m,1h,6h,12h,1d",
  "auto": true,
  "auto_count": 200,
  "auto_min": "60s",
  "current": { "text": "auto", "value": "$__auto" }
}
```

- `auto_count` — how many data points to aim for
- `auto_min` — floor

**PARTIALLY VERIFIED**: `$__auto` and the 10.2 introduction are confirmed from Grafana issue discussion; the
exact JSON keys above come from bug reports rather than the reference docs. Export one from 13.1.1 to confirm.

**Book advice: don't teach interval variables.** `$__rate_interval` plus Min interval covers everything a
beginner needs, and interval variables add a whole second mental model. Mention them in one sentence.

---

## 8. Annotations

- Every dashboard has a built-in query named **"Annotations & Alerts (Built-in query)"** on the `-- Grafana --`
  data source. It *"fetches all annotation events that originate from the current dashboard, which are stored
  in Grafana."*
- **Add manually:** click a data point → **Add annotation**, enter a description and optional tags.
  Or **Ctrl/Cmd + click** to open the annotation tooltip.
- **Region annotations:** *"press Ctrl/Cmd and click and drag on the panel"* to mark a span with start and end.
- **Annotation queries** live in **Dashboard settings → Annotations**, and can come from **any** data source.
- Panels that render annotations: **Time series, State timeline, Candlestick**.
- Built-in `-- Grafana --` annotation query options: `tags`, `matchAny` (*"returns annotations matching any tag
  rather than all"*), `limit`, `type`.

JSON shape of the built-in query (from the V1 example above, verbatim):

```json
"annotations": {
  "list": [
    {
      "builtIn": 1,
      "datasource": { "type": "grafana", "uid": "-- Grafana --" },
      "enable": true,
      "hide": true,
      "iconColor": "rgba(0, 211, 255, 1)",
      "name": "Annotations & Alerts",
      "type": "dashboard"
    }
  ]
}
```

New in 13.x and GA in 13.1: **annotation clustering** — dense annotations collapse into clusters instead of
turning the x-axis into a wall of markers. There is a per-panel **Annotations** option group (Multi-row
annotations, Annotation clustering, Hide lines and areas).

**Why the book should care:** annotations are the cheapest possible "deploy marker" story. A reader who adds
`curl -XPOST /api/annotations` to their deploy script and then sees the marker on the latency graph has just
learned, viscerally, what observability is for. Put this in a chapter, not an appendix.
Anonymous users cannot create annotations — another reason not to run the lab anonymous-only.

---

## 9. Data links and actions

### 9.1 Data links

Configured under a panel's **Data links and actions** section. Behaviour differs by visualization: time series
requires clicking a point or line; stat / gauge / bar gauge open a context menu on any click.

Available variables (verbatim descriptions where quoted):

**Time range**
- `__url_time_range` — *"Current dashboard's time range (for example, `?from=now-6h&to=now`)"*
- `__from`, `__to`

**Series**
- `__series.name` — *"Series name to the URL"*

**Field**
- `__field.name` — *"The name of the field"*
- `__field.displayName` — *"The display name of the field. Use this for renamed field names"*
- `__field.labels.<LABEL>` — label values; use bracket notation for labels containing dots

**Value**
- `__value.raw` — *"Raw value"*
- `__value.numeric` — *"Numeric representation of a value"*
- `__value.text` — *"Text representation of a value"*
- `__value.time` — *"Value's timestamp (Unix ms epoch) to the URL"*
- `__value.calc` — *"Calculation name if the value is result of calculation"*

**Data**
- `__data.fields[i]` — *"Value of field `i` (on the same row)"*
- `__data.fields["NameOfField"]` — *"Value of field using name instead of index"*
- `__data.fields[1].labels.cluster`

**Template**
- `${var-myvar:queryparam}`
- `${__all_variables}`

Rule the docs state explicitly and beginners miss: for time-range and value variables *"you must form the query
parameter syntax yourself; that is, you must format the URL by appending query parameters using the question
mark (`?`) and ampersand (`&`) syntax."* Multiple template variables need manual `&`:
`/d/xxxx/dashboard-b?${var-server:queryparam}&${var-host:queryparam}`

**One click**: a switch that makes a data link fire on a single click. *"Only one data link can have One click
enabled at a time"*, and support varies by visualization.

Canonical book example — drill from an overview panel into a per-instance dashboard:

```
Title: Instance detail
URL:   /d/instance-detail/instance?var-instance=${__field.labels.instance}&${__url_time_range}
```

### 9.2 Actions (newer than data links)

Actions fire an **HTTP request** from a panel. Configured in the **Add action** dialog.

| Field | Docs text |
|---|---|
| Title | *"A human-readable label for the action that's displayed in the UI"* |
| Confirmation message | *"A descriptive prompt to confirm or cancel the action"* |
| Connection | *"Specify how the action's HTTP request is sent. Choose from: **Direct from browser** or routed through a configured data source"* |
| Method | *"Select from **POST**, **PUT**, or **GET**"* |
| URL | supports variables via `$` input or Ctrl/Cmd+Space |
| Variables | *"**Key** and **Name** pairs with a type selection"*, prefixed with `$` |
| Query parameters | *"**Key** and **Value** pairs"* |
| Headers | *"Comprised of **Key** and **Value** pairs and a **Content-Type**"* |
| Content-Type | `application/json`, `text/plain`, `application/XML`, `application/x-www-form-urlencoded` |
| Body | request body |

The docs describe these as **unauthenticated** API calls when sent direct from the browser.
**Do not teach Actions as a way to trigger anything destructive.** Mention them, show a read-only example
(or none), and move on. A book that teaches beginners to wire a "restart service" button into a dashboard has
done harm.

---

## 10. Exemplars

Verbatim: *"An exemplar is a specific trace representative of measurement taken in a given time interval."*
*"Support for exemplars is available for the Prometheus data source only. After you enable the functionality,
exemplar data is available by default."*

- Rendered as **highlighted stars** on the graph, in both **Explore** and dashboards.
- Hovering shows the exemplar's labels including a **trace ID**; a button jumps to the trace data source.
- Configured on the Prometheus data source under **Exemplars**:
  - **Internal link** toggle → pick a trace data source → `datasourceUid`
  - or an **external URL**
  - **Label name** = which exemplar label holds the trace ID (conventionally `traceID` / `trace_id`)

Provisioned form (verbatim from §3.4):

```yaml
jsonData:
  exemplarTraceIdDestinations:
    - datasourceUid: my_jaeger_uid
      name: traceID
    - name: traceID
      url: 'http://localhost:3000/explore?...$${__value.raw}...'
```

**Prerequisites the reader will trip over and the docs don't foreground:**
1. Prometheus must be started with the **exemplar storage** feature enabled
   (`--enable-feature=exemplar-storage`) — otherwise `/api/v1/query_exemplars` returns nothing.
2. The application must actually **emit** exemplars (OpenMetrics exposition, `# {trace_id="..."} 0.12 1234567`),
   which in practice means an OTel-instrumented app or a client library with exemplar support.
3. Only histogram/counter samples carry them.

**Recommendation:** exemplars are a beautiful "metrics → traces" moment but they require a tracing backend
(Tempo/Jaeger) in the lab stack. For a book that is deliberately not about tracing, put exemplars in the final
"where to go next" chapter with a short, honest explanation and a working-but-optional compose overlay.
Do **not** make them load-bearing.

---

## 11. Library panels

Verbatim: *"A library panel is a reusable panel that you can use in any dashboard."* When modified, *"that
change propagates to all instances of where the panel is used."*

- **Create:** panel menu → **New library panel** → name it → choose a folder → save.
  *"The panel on the source dashboard is converted to a library panel as well"* — you then have to save the
  source dashboard too.
- **Add:** from the panel library drawer when adding a panel to a dashboard.
- **Unlink:** panel menu → **Unlink library panel** → confirm → save. The panel becomes an ordinary panel again.
- **Manage/delete:** **Dashboards → Library panels** in the main menu. Search by name, filter by folder or type,
  and see which dashboards use each one.

- **OSS?** Yes.
- **Deprecated?** No — **UNVERIFIED / no deprecation statement found** in the current docs. But note that 13.x
  introduced **saved queries** and **panel styles + copy/paste styles**, which cover a lot of the same ground
  more granularly. Library panels are not the flagship reuse story any more.
- **Provisioning?** The docs page says nothing about provisioning library panels from files. The
  `library_element_connection` table is listed among tables deprecated by Unified Storage in 13.0.
  **UNVERIFIED whether file provisioning of library panels works in 13.1.1.**

**Book recommendation:** cover library panels in one short section as "how to stop copy-pasting the same panel
into five dashboards", and do **not** build the lab on them. A provisioned-dashboard lab plus a library panel is
an awkward combination (the library panel lives in the DB, the dashboard lives on disk, and the reader now has
two sources of truth — exactly the confusion the provisioning chapter is trying to eliminate).

---

## 12. Folders, permissions, RBAC — what OSS actually gets

From <https://grafana.com/docs/grafana/latest/administration/roles-and-permissions/>:

### Available in Grafana OSS

- **Server administrator** (the instance-wide `admin`)
- **Organization roles:** **Admin**, **Editor**, **Viewer**
- **Teams**, with Member and Admin team permissions
- **Folder permissions** and **dashboard permissions** at **Admin / Edit / View** levels
- **Folders are the primary permission boundary.** Nested folders exist. Permissions inherit downward.

### Enterprise / Cloud only

- **Data source permissions** — *"restrict data source query permissions to specific Users, Service Accounts,
  and Teams"*
- **Role-based access control (RBAC)** — the fine-grained system: *"granting, changing, and revoking user read
  and write access to Grafana resources"*, custom roles, `access-control` provisioning
- **"No Basic Role"** (a user with no org role at all) — part of RBAC
- Reporting, PDF export, query caching, usage insights, SAML, etc.

**The book must not teach RBAC as if it's available.** A huge amount of blog content conflates
"Grafana permissions" with "Grafana RBAC". For an OSS reader the honest model is:

> Server admin → org role (Admin/Editor/Viewer) → team membership → folder/dashboard permission.
> That's it. If you need per-data-source permissions or custom roles, that's Enterprise.

Grafana 13.0 also **tightened RBAC enforcement** (Enterprise): custom roles referencing data source UIDs or
legacy annotation scopes now need review; `fixed:annotations.dashboard:writer/reader` and `annotations:*`
wildcards on global roles must be removed. Not OSS-relevant, but relevant if a reader migrates.

---

## 13. Explore, and the Drilldown apps

### 13.1 Explore

Verbatim: *"Explore is your starting point for querying, analyzing, and aggregating data in Grafana."*
Documented subpages: Get started with Explore · Query management · Query inspector in Explore · Logs in Explore ·
Traces in Explore · Correlations editor in Explore.

Features to teach:
- Ad hoc querying with no dashboard, no panel config
- **Split view** (compare two queries / two data sources side by side)
- **Query history**
- **Add to dashboard** — the bridge from "poking around" to "I want to keep this"
- **Query inspector** — shows the actual HTTP request/response, the data frames, and the stats.
  **This is the single best debugging tool in Grafana and almost no book teaches it.** For a Prometheus book
  it is where you show the reader the raw `query_range` call with its `start`, `end` and `step`.
- **Correlations** — define links between data sources so a result in one becomes a query in another.

**UNVERIFIED:** the current docs index page did not list split view / query history / keyboard shortcuts /
Add-to-dashboard explicitly. They exist and are documented on the subpages; confirm exact UI wording against
13.1.1 before writing UI steps.

**Pedagogical note:** Explore is the right place to teach PromQL. A panel forces the reader to think about
visualization at the same time as query semantics. Explore doesn't. Teach PromQL in Explore, *then* move to
panels. That also gives a natural home for the "instant vs range query" distinction, which Explore exposes
directly with its query-type toggle.

### 13.2 Drilldown apps — the rename that dates every older text

Verbatim: *"The Grafana Explore apps have changed to Grafana Drilldown apps. For example, Explore Logs is now
Logs Drilldown."* (renamed February 2025)

| Current name | Old name |
|---|---|
| **Grafana Metrics Drilldown** | Explore Metrics |
| **Grafana Logs Drilldown** | Explore Logs |
| **Grafana Traces Drilldown** | Explore Traces |
| **Grafana Profiles Drilldown** | Explore Profiles |

**Metrics Drilldown** — the one this book cares about.
Verbatim: *"A queryless experience for browsing Prometheus-compatible metrics. Quickly find related metrics in
a few clicks, without needing to write a PromQL query."*

- Plugin ID: **`grafana-metricsdrilldown-app`**
- URL path: `/a/grafana-metricsdrilldown-app/drilldown`
- Nav: **Drilldown → Metrics**
- **In Grafana 11 it was built in (no plugin). In Grafana 12 it became a plugin — but a plugin that is
  preinstalled by default in all Grafana 12+ instances, Cloud and self-managed.** The plugin requires Grafana
  ≥ 11.6.0. Source repo: `github.com/grafana/metrics-drilldown`.
- Capabilities: label-based metric segmentation to spot anomalies, automatic choice of visualization based on
  metric type, **Related metrics**, pivot to related logs, filters, multiple view types.

**Book angle — and this is a genuine pedagogical opportunity.** Metrics Drilldown is the fastest possible way
to get a reader from "Prometheus is scraping something" to "I can see my metrics", with zero PromQL. Use it in
**chapter 2 or 3** as the early win, *before* teaching PromQL. Then in the PromQL chapter, show them the query
Drilldown generated — "here's what you were doing without knowing it". That's a much kinder on-ramp than
starting with `rate()`.

Caveat to check in the lab: because it's a preinstalled plugin rather than core code, verify it is present in
the pinned `grafana/grafana:13.1.1` image and works **offline** (no grafana.com egress). **UNVERIFIED.**

---

## 14. Angular: fully removed

Timeline:
- **Grafana 9**: Angular deprecation announced.
- **Grafana 11.0 (May 2024)**: Angular support **disabled by default**; `angular_support_enabled = false`.
  Self-hosted users could flip it back on.
- **Grafana 12.0 (May 2025)**: *"Angular plugin support, deprecated in v11, is now removed entirely. Existing
  Angular-dependent dashboards automatically migrate to React-based alternatives."* The
  **`angular_support_enabled` config option no longer exists.**

Consequences for the book:
- There is no `graph` panel, no `table-old`, no `singlestat`. Don't mention them except in a "if you see this
  in an old dashboard" sidebar.
- **Third-party Angular plugins simply will not load.** If a reader tries to install an old panel plugin from a
  2019 blog post, it fails. Worth one sentence.
- The docs page `/docs/grafana/latest/developers/angular_deprecation/` is **stale** — it still says removal is
  "planned for version 12" in the future tense. Do not quote it. Cite the 12.0 what's-new and the
  "Removal of Angular" what's-new post (2025-05-05) instead.

Additionally, **13.0 migrated the frontend to React 19**, which broke some remaining third-party panels
(explicitly: IoT TwinMaker SceneViewer). Plugin compatibility is a real upgrade consideration now.

---

## 15. Breaking changes the book must not trip over

### 15.1 Grafana 13.0

| Change | Detail |
|---|---|
| **`grafana-cli` / `grafana-server` removed** | Use `grafana cli` and `grafana server` (space, not hyphen). Deprecated since 10.0, removed in 13.0. Affects Dockerfiles, systemd units, CI, and **every blog post that says `grafana-cli plugins install`**. |
| **Unified Storage for folders and dashboards** | Automatic migration from legacy SQL on startup. Tables `dashboard`, `dashboard_acl`, `dashboard_provisioning`, `dashboard_version`, `dashboard_tag`, `library_element_connection`, `folder` are deprecated and will be removed. |
| **SQLite migration may fail** | Lock errors. Fix: increase `migration_cache_size_kb` or enable `migration_parquet_buffer` in `[unified_storage]`. |
| **Downgrade is not safe** | Earlier versions won't see unified-storage changes. Restore a pre-upgrade backup to roll back. |
| **Git Sync data-loss bug in 13.0.0** | *"A migration bug in Grafana v13.0.0 might cause dashboards and folders to be lost or reverted when upgrading from Grafana v12.x.x with Git Sync enabled."* Go to **13.0.1+**, not 13.0.0. |
| **Image Renderer plugin removed** | Must run as a separate service. Default renderer auth switched from opaque tokens to **JWT**; set `[rendering] renderer_token`. |
| **Legacy `/api` deprecated** | Migrating to `/apis`. Legacy endpoints still work but will go. |
| **Numeric data source ID APIs disabled by default** | Use `uid`. Temporary escape hatch: `datasourceLegacyIdApi` feature flag. |
| **Alertmanager endpoints** | Some removed / admin-only; migrate to `notifications.alerting.grafana.app/v1beta1`. `GET /api/alertmanager/grafana/api/v2/status` now needs `alert.notifications.system-status:read`. |
| **`enable_gzip` on by default** | HTTP compression default flipped. |
| **React 19** | Update plugins before upgrading. |
| **`@grafana/ui` removals** | `Graph`, `GraphWithLegend`, `GraphContextMenu`, etc. gone. |
| **`@grafana/runtime` deprecations** | `config.apps`, `config.panels` scheduled for removal in **13.2.0**. |
| **DB metrics renamed** | 18 Prometheus metrics deprecated in favour of standardized `go_sql_*`. Relevant if the book scrapes Grafana's own `/metrics`. |
| **Query caching metrics** | `grafana_caching_items` and `grafana_caching_size` removed (duplicates). |

### 15.2 Known open bug worth a warning box

**`grafana/grafana` issue #126013** — "Unified storage migration silently deletes all migrated dashboards
post-migration". Reported against **13.0.2**, deterministically reproducible on SQLite: the post-migration
search runs unscoped (`query=`), the `dashboard-service` treats the entire result as deletion candidates, and
all dashboards are DELETEd ~3–4 minutes after a "successful" migration. **No error is surfaced.**
Status when checked (2026-07-28): **appears open**. Not confirmed fixed in 13.1.1.

**Implication for the book:** this only bites on **upgrade from 12.x with an existing SQLite DB**. A fresh
`docker compose up` on 13.1.1 with an empty volume is unaffected. But the book should:
1. Never tell a reader to upgrade an existing Grafana in place without a backup.
2. Prefer **provisioned dashboards from files** over UI-created ones — which is what the book teaches anyway,
   and which makes this class of bug a non-event. That's a genuinely good argument for as-code, not just a
   stylistic preference.

### 15.3 Grafana 12.4

- Playlists migrate to unified storage automatically.
- Small instances auto-migrate folders and dashboards to Unified Storage.
- Plugin processes no longer receive all host environment variables by default (security hardening) — relevant
  if a reader's plugin depended on an inherited env var.

### 15.4 Grafana 12.0

- **Angular removed.**
- `editors_can_admin` config removed.
- Deprecated UI extension APIs removed.
- Tempo "Aggregate by" removed.

---

## 16. Unified Storage and the app-platform API — the one-paragraph version

Grafana is being rebuilt so that every resource (dashboard, folder, playlist, alert rule, …) is a
Kubernetes-style object served under `/apis/<group>/<version>/namespaces/<namespace>/<resource>[/<name>]`
(verbatim URL pattern from the API-structure docs). Version tiers follow k8s convention: `v1alpha1` (alpha),
`v1beta1` (beta), `v1` (GA). **Unified Storage** is the backing store for that model, and in 13.0 folders and
dashboards moved onto it.

For a beginner-facing book this is **background, not curriculum**. One page, once, explaining:
- why dashboards suddenly have `apiVersion`/`kind`/`metadata`/`spec` in some contexts,
- why the docs talk about `/apis` and `/api`,
- and why "observability as code" (Git Sync, Terraform, the v2 export) is now the direction of travel.

Then go back to teaching dashboards.

**Git Sync** (GA in 13.0, extended in 13.1 to GitLab / Bitbucket / plain Git, with GitHub App auth, verified
commits, root-level sync, README rendering, and UI import into a Git-Sync folder) is the productised version of
"dashboards as code". Behind the `provisioning` feature toggle:
*"Enables Git Sync and as-code provisioning for Grafana resources"*.
**Recommendation: mention Git Sync, teach file provisioning.** Git Sync needs a Git remote, credentials and a
webhook story — too much apparatus for a book whose lab must run offline on a laptop. But readers should know
it exists, because it's where the ecosystem is going and it's the answer to "so how do teams really do this?"

---

## 17. Feature toggles relevant to dashboards / provisioning

From <https://grafana.com/docs/grafana/latest/setup-grafana/configure-grafana/feature-toggles/> (2026-07-28):

**Generally available**
- `provisioning` — *"Enables Git Sync and as-code provisioning for Grafana resources"*
- `provisioningFolderMetadata` — *"Allow setting folder metadata for provisioned folders"*
- `dashboardNewLayouts` — *"Enables new dashboard layouts"*
- `dashboardDefaultLayoutSelector` — *"Enables default layout selector in dashboard settings"*
- `dashboardSectionVariables` — *"Enables support for section level variables (rows and tabs)"*

**Public preview**
- `dashboardFiltersOverview` — *"Enables the dashboard filters overview pane"*
- `dashboardTemplates` — *"Enables a flow to get started with a new dashboard from a template"*

Notably **absent** from the current list: `dashboardScene`, `exploreMetrics`, `kubernetesDashboards`.
Those toggles are gone — the features they gated are now unconditional. **Any book, blog post or Helm chart
that still sets them is stale.**

Syntax:

```ini
[feature_toggles]
dashboardTemplates = true
```

```bash
GF_FEATURE_TOGGLES_dashboardTemplates=true
```

**Recommendation: the book's lab should set zero feature toggles.** Everything it teaches is GA in 13.1.1.
If a draft chapter needs a toggle, that chapter is teaching something that isn't ready.

---

## 18. The documentation URL restructure (affects every link you print)

**This happened recently and it will silently break the book's link list.** Dashboard, panel and visualization
docs now live under a `/visualizations/` prefix:

| Old (still redirects) | Current |
|---|---|
| `/docs/grafana/latest/dashboards/` | `/docs/grafana/latest/visualizations/dashboards/` |
| `/docs/grafana/latest/panels-visualizations/` | `/docs/grafana/latest/visualizations/panels-visualizations/` |
| `/docs/grafana/latest/explore/simplified-exploration/` | `/docs/grafana/latest/visualizations/simplified-exploration/` |
| `/docs/grafana/latest/http_api/` | `/docs/grafana/latest/developer-resources/api-reference/http-api/` |
| `.../configure-security/configure-authentication/` | also served at `.../configure-access/configure-authentication/` |

Two more useful facts:
1. **Every docs page has a `.md` twin.** Append `.md` to the URL
   (e.g. `.../variables/global-variables.md`) to get the raw Markdown. Enormously useful for verbatim
   quoting during manuscript verification — use it in the fact-check pass.
2. Grafana Play (`https://play.grafana.org`) is a live public Grafana instance with real dashboards. Good for
   "go look at a real one" exercises, and its `/swagger` endpoint documents the app-platform APIs.

**Recommendation for the EPUB:** prefer versioned doc URLs
(`/docs/grafana/v13.1/...`) over `/latest/` wherever the doc set supports it, so links stay meaningful after
Grafana 14. **UNVERIFIED** whether `/docs/grafana/v13.1/` resolves — check before committing to the pattern; if
not, use `/latest/` and add a note that structure may drift.

---

## 19. Things a textbook author will otherwise get subtly wrong

1. **`grafana/grafana` vs `grafana/grafana-enterprise`.** Grafana's own docs default to the *enterprise* image
   in Docker examples. Use `grafana/grafana` in an OSS book, and explain the difference in one sentence.
2. **Provisioning dashboards ≠ putting JSON in `provisioning/dashboards/`.** That directory holds the provider
   YAML. The JSON goes wherever `options.path` points. This is the most common single mistake.
3. **`apiVersion: 1` in provisioning files is not `dashboard.grafana.app/v1`.** Different things entirely.
4. **`access: proxy` + service-name URLs.** `http://prometheus:9090`, not `http://localhost:9090`. Explain why
   (Grafana's backend makes the request, not the browser).
5. **`timeInterval` must equal Prometheus's `scrape_interval`,** or `$__rate_interval` lies.
6. **`$__rate_interval` for `rate()`/`increase()`; `$__interval` for `*_over_time`.** Not interchangeable.
7. **`=~` not `=` with multi-value variables.**
8. **Never `[[var]]`.** Deprecated syntax.
9. **`"id": null` in provisioned dashboard JSON.** A stale numeric id collides with the DB.
10. **Set a `uid` on every dashboard** so `/d/<uid>/` URLs are printable and stable.
11. **`${DS_PROMETHEUS}` in a downloaded dashboard will not resolve when provisioned.** Show the fix.
12. **Named volume for `/var/lib/grafana`.** UID 472 + bind mount = permission errors on Linux.
13. **`"type": "graph"` is dead.** So is `singlestat`, `table-old`, `heatmap-old`.
14. **RBAC is not in OSS.** Folder/dashboard permissions and basic roles are.
15. **Data source permissions are not in OSS.**
16. **Ad hoc filters are now "Filter and Group by".**
17. **Explore Metrics is now Metrics Drilldown**, plugin `grafana-metricsdrilldown-app`.
18. **"Regression analysis" transformation is now "Trendline".**
19. **`grafana-cli` is gone.** It's `grafana cli`.
20. **`$__interval` depends on panel *width*.** Same query, different graph in a narrow vs wide panel.
21. **Thresholds' first step must be `"value": null`.**
22. **Stat/Gauge usually want `instant: true`**; time series wants `range: true`.
23. **Anonymous users can't create annotations** — don't build an annotation exercise on an anonymous lab.
24. **`min_refresh_interval` (default `5s`) silently overrides a dashboard's `refresh`** if you set it lower.
25. **Exemplars need `--enable-feature=exemplar-storage` on Prometheus** and an app that emits them.
26. **`updateIntervalSeconds` reload may not fire on Docker Desktop bind mounts.** Offer `docker compose
    restart grafana` as the fallback.
27. **Every screenshot must be from 13.1.1.** The dashboard chrome changed in 12.0, 12.4, 13.0 and 13.1.
28. **Don't teach `dashboardScene` / `exploreMetrics` feature toggles.** They no longer exist.
29. **The `/docs/grafana/latest/developers/angular_deprecation/` page is stale** and speaks of removal in the
    future tense. Angular is already gone.
30. **Docs moved under `/visualizations/`.** Old links redirect today; don't assume forever.

---

## 20. Suggested mapping to the book's chapters

| Chapter | Grafana content from this dossier |
|---|---|
| 1 — Why observability | nothing Grafana-specific |
| 2 — The lab stack | §2 image/tags/env vars, §2.8 compose skeleton; named volume; pin `13.1.1` |
| **3 — First dashboard (early win)** | §13.2 **Metrics Drilldown** first (queryless), then a provisioned dashboard from §3.6/§3.8; anonymous Viewer from §2.6 |
| 4 — Time series & PromQL foundations | §13.1 **Explore** + Query inspector; instant vs range |
| 5 — PromQL in anger | §7.5 `$__rate_interval` vs `$__interval` vs `[5m]`; §5.6 Max data points / Min interval |
| 6 — Panels | §5 panel names & type IDs, §5.4 time series options, §5.5 fieldConfig/overrides/thresholds |
| 7 — Dashboards as code | §3 in full — provisioning YAML, `allowUiUpdates` progression, `uid` stability, `${DS_}` trap; §4.9 export |
| 8 — Variables | §7 all; `=~`; `queryparam`; repeat rows/panels from §4.5 |
| 9 — Making dashboards useful | §6 transformations (the 5 that matter); §8 annotations + deploy markers; §9 data links |
| 10 — Alerting | §3.9 alerting provisioning (coordinate with the alerting researcher) |
| 11 — Organising | §12 folders/permissions honestly scoped to OSS; §11 library panels briefly |
| 12 — What's next | §16 Git Sync / observability as code; §10 exemplars; §13.2 other Drilldown apps; optional K8s chapter |

---

## Sources

All fetched 2026-07-27 / 2026-07-28.

**Releases and support**
- <https://github.com/grafana/grafana/releases>
- <https://endoflife.date/grafana>
- <https://grafana.com/docs/grafana/latest/upgrade-guide/when-to-upgrade/>
- <https://grafana.com/docs/grafana/latest/upgrade-guide/upgrade-v13.0/>

**What's new / blog**
- <https://grafana.com/docs/grafana/latest/whatsnew/whats-new-in-v13-1/>
- <https://grafana.com/docs/grafana/latest/whatsnew/whats-new-in-v13-0/>
- <https://grafana.com/docs/grafana/latest/whatsnew/whats-new-in-v12-4/>
- <https://grafana.com/docs/grafana/latest/whatsnew/whats-new-in-v12-0/>
- <https://grafana.com/blog/grafana-13-1-release-all-the-latest-features/>
- <https://grafana.com/blog/grafana-12-release-all-the-new-features/>
- <https://grafana.com/whats-new/2025-05-05-removal-of-angular/>
- <https://grafana.com/whats-new/2026-04-14-unified-storage-for-folders-and-dashboards/>
- <https://grafana.com/whats-new/2026-02-23-automatic-storage-migration-for-small-instances/>
- <https://grafana.com/blog/angularjs-support-will-be-removed-in-grafana-12-what-you-need-to-know/>

**Docker / configuration**
- <https://grafana.com/docs/grafana/latest/setup-grafana/installation/docker/>
- <https://grafana.com/docs/grafana/latest/setup-grafana/configure-docker/>
- <https://grafana.com/docs/grafana/latest/setup-grafana/configure-grafana/>
- <https://grafana.com/docs/grafana/latest/setup-grafana/configure-grafana/feature-toggles/>
- <https://grafana.com/docs/grafana/latest/setup-grafana/configure-security/configure-authentication/anonymous-auth/>
- <https://raw.githubusercontent.com/grafana/grafana/main/Dockerfile>
- <https://hub.docker.com/v2/repositories/grafana/grafana/tags> (tag API)
- <https://raw.githubusercontent.com/grafana/tutorial-environment/master/docker-compose.yml>

**Provisioning**
- <https://grafana.com/docs/grafana/latest/administration/provisioning/>
- <https://grafana.com/docs/grafana/latest/administration/provisioning.md>
- <https://grafana.com/docs/grafana/latest/alerting/set-up/provision-alerting-resources/file-provisioning/>
- <https://grafana.com/docs/grafana/latest/datasources/prometheus/configure/>
- <https://community.grafana.com/t/provisioning-in-grafana-13-with-v2-dashboards/163029>

**Dashboards / panels / transformations**
- <https://grafana.com/docs/grafana/latest/visualizations/dashboards/build-dashboards/view-dashboard-json-model.md>
- <https://grafana.com/docs/grafana/latest/visualizations/dashboards/build-dashboards/create-dashboard/>
- <https://grafana.com/docs/grafana/latest/visualizations/dashboards/build-dashboards/annotate-visualizations/>
- <https://grafana.com/docs/grafana/latest/visualizations/dashboards/build-dashboards/manage-library-panels/>
- <https://grafana.com/docs/grafana/latest/visualizations/dashboards/share-dashboards-panels/>
- <https://grafana.com/docs/grafana/latest/visualizations/dashboards/build-dashboards/import-dashboards/>
- <https://grafana.com/docs/grafana/latest/visualizations/panels-visualizations/visualizations/>
- <https://grafana.com/docs/grafana/latest/visualizations/panels-visualizations/visualizations/time-series/>
- <https://grafana.com/docs/grafana/latest/visualizations/panels-visualizations/configure-overrides/>
- <https://grafana.com/docs/grafana/latest/visualizations/panels-visualizations/configure-data-links/>
- <https://grafana.com/docs/grafana/latest/visualizations/panels-visualizations/query-transform-data/>
- <https://grafana.com/docs/grafana/latest/visualizations/panels-visualizations/query-transform-data/transform-data/>

**Variables**
- <https://grafana.com/docs/grafana/latest/visualizations/dashboards/variables/>
- <https://grafana.com/docs/grafana/latest/visualizations/dashboards/variables/add-template-variables/>
- <https://grafana.com/docs/grafana/latest/visualizations/dashboards/variables/global-variables.md>
- <https://grafana.com/docs/grafana/latest/dashboards/variables/variable-syntax/>
- <https://grafana.com/docs/grafana/latest/datasources/prometheus/template-variables/>

**Explore / Drilldown / exemplars / permissions**
- <https://grafana.com/docs/grafana/latest/explore/>
- <https://grafana.com/docs/grafana/latest/visualizations/simplified-exploration/>
- <https://grafana.com/docs/grafana/latest/visualizations/simplified-exploration/metrics/>
- <https://grafana.com/grafana/plugins/grafana-metricsdrilldown-app/>
- <https://github.com/grafana/metrics-drilldown>
- <https://grafana.com/docs/grafana/latest/fundamentals/exemplars/>
- <https://grafana.com/docs/grafana/latest/administration/roles-and-permissions/>

**Source code (GitHub, branch `main`)**
- `apps/dashboard/pkg/migration/schemaversion/migrations.go` — `LATEST_VERSION = 42`
- `apps/dashboard/pkg/migration/schemaversion/` — `v2.go` … `v42.go`
- `apps/dashboard/pkg/apis/dashboard/` — `v0alpha1, v1, v1beta1, v2, v2alpha1, v2beta1`
- `apps/dashboard/kinds/` — `v0alpha1, v1beta1, v2, v2alpha1, v2beta1`
- `public/app/plugins/panel/` — core panel type IDs
- <https://github.com/grafana/grafana/issues/126013> — unified storage migration data-loss report
- <https://grafana.com/docs/grafana/latest/developer-resources/api-reference/http-api/apis/>
