# Research dossier — "Kubernetes: what changes"

**Topic owner:** k8s specialist agent
**Researched:** 2026-07-27 / 2026-07-28 (all live fetches on these dates)
**Target:** ONE clearly-optional chapter near the end of the book. Kubernetes is *not* the main track.

> **Reading rule for the manuscript author.** Everything below marked **[VERIFIED]** was pulled from a
> primary source on the date above and the URL is in §16. Everything marked **[UNVERIFIED]** could not
> be confirmed live (usually because the source file was too large for the fetch tool to reach the
> relevant section) — it must not be printed as a bare fact. Where a value can be re-checked with a
> one-line command, that command is given.

---

## 0. What this chapter is for (framing advice)

The reader of this book has, by this point, a docker-compose lab: a service they instrumented, a
Prometheus scraping it via `static_configs` / `file_sd`, a Grafana with dashboards they built, and
Alertmanager routing alerts they wrote. **The chapter's job is not to teach Kubernetes.** It is to
answer one question: *"I already understand Prometheus. What is actually different when the same
thing runs on Kubernetes?"*

The honest answer is that only **four** things change, and the chapter should be organised around
exactly these four:

1. **Targets stop being a list you write and become a query against the cluster API.**
   `static_configs` → `kubernetes_sd_config` (or a `ServiceMonitor`, which compiles down to
   `kubernetes_sd_config`). Everything you learned about relabeling is now load-bearing rather than
   optional, because service discovery hands you 20+ `__meta_*` labels and you must decide which
   become real labels.
2. **Configuration stops being a file you edit and becomes objects you `kubectl apply`.**
   The Prometheus Operator watches CRDs and *generates* `prometheus.yaml` for you. The file still
   exists — it is a gzipped Kubernetes Secret — and being able to read it is the #1 debugging skill.
3. **You get an enormous amount of infrastructure telemetry for free**, from three components the
   reader has never heard of (kubelet/cAdvisor, kube-state-metrics, node-exporter), plus ~35
   pre-built dashboards and ~41 pre-built alert rule groups.
4. **Everything gets harder at the edges**: cardinality explodes because pods are ephemeral,
   targets churn constantly, and Prometheus itself now runs inside a resource-limited pod that will
   be OOMKilled if you get sizing wrong.

PromQL does not change. The data model does not change. Instrumentation does not change. Say that
out loud early — it is reassuring and it is true.

A good chapter shape:

- 30% — run `kube-prometheus-stack` on a local `kind` cluster, see it work, look at the free dashboards.
- 30% — instrument the *same lab service from the book* with a `ServiceMonitor` and a `PrometheusRule`.
- 20% — "what's under the hood": read the generated config Secret, and show the equivalent raw
  `kubernetes_sd_config` + relabeling for readers who will never be allowed to install an operator.
- 20% — what's harder, and how to tell when it is going wrong.

---

## 1. Version table — as of 2026-07-28

| Component | Version | Notes | Status |
|---|---|---|---|
| `kube-prometheus-stack` Helm chart | **87.21.0** | `appVersion: v0.92.1` | [VERIFIED] Chart.yaml + Artifact Hub API |
| Prometheus Operator (upstream) | **0.93.0** (2026-07-28) | 0.92.1 = 2026-06-30, 0.92.0 = 2026-06-18, 0.91.0 = 2026-05-05 | [VERIFIED] GitHub releases |
| Chart `kubeVersion` constraint | `>=1.25.0-0` | in Chart.yaml | [VERIFIED] |
| Sub-chart: `kube-state-metrics` | chart **8.0.0** → app **2.19.1** | (repo README shows KSM v2.19.0 as "latest"; chart pins 2.19.1) | [VERIFIED] Artifact Hub API |
| Sub-chart: `prometheus-node-exporter` | chart **4.56.1** → app **1.12.1** | | [VERIFIED] Artifact Hub API |
| Sub-chart: `grafana` | chart **12.10.0** → app **13.1.1** | **repo is now `https://grafana-community.github.io/helm-charts`** | [VERIFIED] Chart.yaml + Artifact Hub API |
| Sub-chart: `prometheus-windows-exporter` | `0.12.*` | conditional on `windowsMonitoring.enabled` | [VERIFIED] Chart.yaml |
| Sub-chart: `crds` | `0.0.0` (local) | conditional on `crds.enabled` | [VERIFIED] Chart.yaml |
| Prometheus (upstream latest) | **3.13.1** (2026-07-10) | | [VERIFIED] prometheus.io/download |
| Prometheus (upstream LTS) | **3.5.5** (2026-07-09) | *this settles conflict C2 in `_CONFLICTS.md` — the download page marks 3.5.5 LTS, not 3.13* | [VERIFIED] prometheus.io/download |
| Alertmanager | **0.33.1** (2026-07-04) | operator's `DefaultAlertmanagerVersion = "v0.33.1"` | [VERIFIED] download page + `pkg/operator/defaults.go` |
| node_exporter | **1.12.1** (2026-07-14) | | [VERIFIED] prometheus.io/download |
| blackbox_exporter | **0.28.0** (2025-12-04) | | [VERIFIED] prometheus.io/download |
| Thanos (operator default) | **v0.42.2** | `DefaultThanosVersion` | [VERIFIED] `pkg/operator/defaults.go` |
| metrics-server | app **v0.8.1**, chart **3.13.1** | image `registry.k8s.io/metrics-server/metrics-server:v0.8.1` | [VERIFIED] search of releases/Artifact Hub |
| Kubernetes latest minor | **1.36** (released 2026-04-22) | 1.36.2 = 2026-06-09 | [VERIFIED] kubernetes.io |
| `kube-prometheus` (jsonnet) | `release-0.18` supports k8s 1.33–1.36; `main` supports 1.34–1.36 | | [VERIFIED] repo README matrix |

### Version facts worth stating explicitly in the book

- **The chart lags upstream by design.** Chart 87.21.0 ships operator **v0.92.1** even though
  upstream cut **0.93.0**. Do not tell readers the chart's operator version equals the newest
  operator release. Tell them to read `Chart.yaml`'s `appVersion`.
- **The Grafana sub-chart moved repositories on 2026-01-30**, from
  `https://grafana.github.io/helm-charts` to `https://grafana-community.github.io/helm-charts`
  (GitHub org `grafana-community/helm-charts`). Any book, blog, or `helm repo add` line from before
  2026 that says `grafana.github.io/helm-charts` for the Grafana chart is stale. Chart releases
  published before the migration were signed by a different key, so `helm verify`/provenance checks
  against the new key fail on old versions. [VERIFIED via grafana-community.github.io + migration issues]
- The operator README still says the minimum supported Kubernetes is **1.16.0**; the *chart* is
  stricter at **1.25.0**. Quote the chart's number, not the operator's. [VERIFIED]

---

## 2. Installing `kube-prometheus-stack`

### 2.1 Two install paths, both current [VERIFIED, from the chart README]

OCI (what the README lists first):

```console
helm install [RELEASE_NAME] oci://ghcr.io/prometheus-community/charts/kube-prometheus-stack
```

Classic HTTP repo:

```console
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update
helm install [RELEASE_NAME] prometheus-community/kube-prometheus-stack
```

For the book's lab, pin the version and create the namespace:

```console
helm install kps prometheus-community/kube-prometheus-stack \
  --version 87.21.0 \
  --namespace monitoring --create-namespace
```

**Choose the release name deliberately and keep it stable** — see §5.1, the release name becomes part
of the label selector that decides whether your `ServiceMonitor` is picked up at all. `kps` is short
and readable; `prometheus` is a bad choice because it collides visually with resource names.

### 2.2 CRDs: the part that bites everyone

- Helm v3 **installs** CRDs from `crds/` on first install but **never upgrades them** on
  `helm upgrade`. This is a Helm limitation, not a chart bug. [VERIFIED, chart README]
- The chart bundles the CRDs as a local sub-chart (`charts/crds`, gated by `crds.enabled`, default
  `true`). Files, verbatim: [VERIFIED, directory listing]

  ```
  crd-alertmanagerconfigs.yaml   crd-alertmanagers.yaml     crd-podmonitors.yaml
  crd-probes.yaml                crd-prometheusagents.yaml  crd-prometheuses.yaml
  crd-prometheusrules.yaml       crd-scrapeconfigs.yaml     crd-servicemonitors.yaml
  crd-thanosrulers.yaml
  ```

- **`kubectl apply -f` on these CRDs fails.** Client-side apply writes the whole object into the
  `kubectl.kubernetes.io/last-applied-configuration` annotation, and the Prometheus CRD is larger
  than the 256 KiB annotation limit. The exact error string the reader will see:

  ```
  The CustomResourceDefinition "prometheuses.monitoring.coreos.com" is invalid:
  metadata.annotations: Too long: must have at most 262144 bytes
  ```

  The fix is **server-side apply** (needs Kubernetes ≥ 1.22):

  ```console
  kubectl apply --server-side --force-conflicts -f <crd-manifests>
  ```

  [VERIFIED — this is documented in the operator troubleshooting docs and is the subject of several
  long-running issues: prometheus-operator#4355, #5104, #6751, helm-charts#1500.]

- The chart now ships an opt-in **CRD upgrade job** to work around the Helm limitation. Verbatim
  from `values.yaml`: [VERIFIED]

  ```yaml
  ## Install Prometheus Operator CRDs
  ##
  crds:
    enabled: true
    ## The CRD upgrade job mitigates the limitation of helm not being able to upgrade CRDs.
    ## The job will apply the CRDs to the cluster before the operator is deployed, using helm hooks.
    ## It deploys a corresponding clusterrole, clusterrolebinding and serviceaccount to apply the CRDs.
    ## This feature is in preview, off by default and may change in the future.
    upgradeJob:
      enabled: false
      forceConflicts: false
  ```

  Note the wording: **"This feature is in preview, off by default and may change in the future."**
  The book should mention it exists but should teach the manual `--server-side` route as the one
  that always works.

- **CRDs survive `helm uninstall`.** The README gives the explicit cleanup list: [VERIFIED]

  ```console
  kubectl delete crd alertmanagerconfigs.monitoring.coreos.com
  kubectl delete crd alertmanagers.monitoring.coreos.com
  kubectl delete crd podmonitors.monitoring.coreos.com
  kubectl delete crd probes.monitoring.coreos.com
  kubectl delete crd prometheusagents.monitoring.coreos.com
  kubectl delete crd prometheuses.monitoring.coreos.com
  kubectl delete crd prometheusrules.monitoring.coreos.com
  kubectl delete crd scrapeconfigs.monitoring.coreos.com
  kubectl delete crd servicemonitors.monitoring.coreos.com
  kubectl delete crd thanosrulers.monitoring.coreos.com
  ```

  Deleting the CRDs deletes every `ServiceMonitor`/`PrometheusRule`/etc. in the cluster. Warn hard.

- A CRDs-only chart exists (`prometheus-community/prometheus-operator-crds`) for teams that manage
  CRDs separately from the release. [VERIFIED that the chart exists; its exact current version was
  **not** pinned down — search results showed both 17.0.0 and 30.0.1 on Artifact Hub. **UNVERIFIED:**
  do not print a version number for this chart.]

### 2.3 Recent chart breaking changes worth a sidebar [VERIFIED, UPGRADE.md]

| Chart major | What broke |
|---|---|
| 87 (86→87) | Operator bumped to v0.92.0 → CRDs must be re-applied (`--server-side`), or use `crds.upgradeJob.enabled` |
| 85 (84→85) | **Distroless image variants became the default** for `prometheus` and `prometheus-node-exporter`. If you mirror images into a private registry, you must also mirror the `-distroless`-suffixed tags. |
| 84 (83→84) | Grafana bumped to **v13.0.0** — read Grafana's own breaking-change notes |
| 80 (79→80) | Operator v0.87.0; new `serviceName` field on Prometheus/Alertmanager/ThanosRuler lets you bypass the operator's automatic Service creation |
| 75 (74→75) | `additionalPrometheusRules` / `additionalPrometheusRulesMap` objects now named with the `fullname` template instead of the `name` template (affects multi-release clusters) |
| 70 (69→70) | Operator v0.81.0; `serviceName` introduced |

---

## 3. What the Prometheus Operator actually *is*

Say this in one paragraph and the reader will get it:

> The Prometheus Operator is a controller. It watches a set of custom resources. From them it
> generates a normal `prometheus.yaml` (and `alertmanager.yaml`, and the rule files), stores the
> Prometheus config as a **gzipped Kubernetes Secret**, and runs Prometheus as a **StatefulSet** with
> a `config-reloader` sidecar that notices the Secret changed and hits Prometheus's reload endpoint.
> Nothing magic happens. It is a YAML-to-YAML compiler with a reconcile loop.

Concrete artefacts the reader can inspect:

- Prometheus runs as a **StatefulSet**, one per `shard`, `replicas` pods each.
- The generated config lives in Secret `prometheus-<prometheus-cr-name>`, key `prometheus.yaml.gz`.
- A **headless Service `prometheus-operated`** is created automatically (likewise
  `alertmanager-operated`). This is what you port-forward. [VERIFIED — the operator troubleshooting
  doc uses `kubectl -n monitoring port-forward svc/prometheus-operated 9090:9090`]
- The operator emits **Kubernetes Events** when it rejects an invalid resource. [VERIFIED]

**The single most useful command in the whole chapter** [VERIFIED verbatim from the operator
troubleshooting docs]:

```console
kubectl -n monitoring get secret prometheus-k8s -ojson \
  | jq -r '.data["prometheus.yaml.gz"]' \
  | base64 -d | gunzip \
  | grep "my-service-monitor"
```

(For the kube-prometheus-stack chart the Secret is named after the Prometheus CR the chart creates,
typically `prometheus-<release>-kube-prom-prometheus`; tell the reader to run
`kubectl -n monitoring get secret | grep prometheus` first rather than hard-coding a name.)

### 3.1 Operator CLI flags the chapter may need [VERIFIED, operator CLI reference]

| Flag | Meaning / default |
|---|---|
| `--namespaces` | allow-list of namespaces to watch; mutually exclusive with `--deny-namespaces` |
| `--deny-namespaces` | deny-list |
| `--prometheus-instance-namespaces` | where `Prometheus`/`PrometheusAgent` CRs are read from; takes precedence |
| `--alertmanager-instance-namespaces` | ditto for Alertmanager |
| `--thanos-ruler-instance-namespaces` | ditto for ThanosRuler |
| `--kubelet-service` | `namespace/name` of the Service/Endpoints object the operator writes kubelet addresses into; conventionally `kube-system/kubelet` |
| `--kubelet-endpoints` | create `Endpoints` for kubelet targets. **default `true`** |
| `--kubelet-endpointslice` | create `EndpointSlice` for kubelet targets |
| `--kubelet-node-address-priority` | `internal` (default) or `external` |
| `--kubelet-sync-period` | default `3m0s` |
| `--kubelet-http-metrics` | also include the plain-HTTP metrics port 10255 in the kubelet Service |
| `--feature-gates` | see below |
| `crds` / `full-crds` (sub-commands) | print the CRDs as YAML from the operator binary itself (added in v0.89.0) |

**Why the kubelet Service exists at all** is a great "aha" for the reader: the kubelet is not a pod,
so there is nothing for `role: endpoints` to discover. The operator therefore *synthesises* a Service
+ Endpoints (and optionally EndpointSlice) named `kubelet` in `kube-system`, listing every node, so
that a perfectly ordinary `ServiceMonitor` can target it.

### 3.2 Feature gates (as named by `--feature-gates`) [VERIFIED names; stages partly verified]

- `PrometheusAgentDaemonSet`
- `PrometheusShardRetentionPolicy` — **promoted to Beta and enabled by default in v0.92.0**
- `PrometheusTopologySharding` — **promoted to Beta and enabled by default in v0.92.0**
- `RemoteWriteCustomResourceDefinition` — off; would add a namespaced `RemoteWrite` CRD plus
  `remoteWriteSelector` / `remoteWriteNamespaceSelector` on Prometheus & PrometheusAgent. **Not
  shipped as a CRD yet** (the CRD directory contains 10 files, no `remotewrites`).
- `StatusForConfigurationResources` — status subresource on ServiceMonitor/PodMonitor/ScrapeConfig/
  Probe (added experimentally in v0.86.0) and on PrometheusRule (v0.87.0).

**[UNVERIFIED]** the full gate table with per-gate default/since columns — the docs page at
`prometheus-operator.dev/docs/platform/feature-gates/` 404s and the raw markdown path I tried 404s
too. Re-find it before printing a table. The list of *names* above is verified from the CLI reference.

---

## 4. The CRDs, as they exist right now

Ten CRDs. Three API versions in play. [VERIFIED against the Go packages and the API reference]

| Kind | API version(s) | Scope | What it is |
|---|---|---|---|
| `Prometheus` | `monitoring.coreos.com/v1` | Namespaced | a Prometheus deployment (StatefulSet) |
| `PrometheusAgent` | `monitoring.coreos.com/v1alpha1` | Namespaced | Prometheus in **agent mode** — scrape + `remote_write`, no local TSDB, no queries, no rules. Supports `spec.mode: DaemonSet` behind a feature gate. |
| `Alertmanager` | `monitoring.coreos.com/v1` | Namespaced | an Alertmanager cluster |
| `ThanosRuler` | `monitoring.coreos.com/v1` | Namespaced | Thanos Ruler for rule evaluation across stores |
| `ServiceMonitor` | `monitoring.coreos.com/v1` | Namespaced | "scrape the pods behind these Services" |
| `PodMonitor` | `monitoring.coreos.com/v1` | Namespaced | "scrape these pods directly" (no Service needed) |
| `Probe` | `monitoring.coreos.com/v1` | Namespaced | blackbox-style probes of static targets or Ingresses |
| `PrometheusRule` | `monitoring.coreos.com/v1` | Namespaced | recording + alerting rules |
| `ScrapeConfig` | `monitoring.coreos.com/v1alpha1` | Namespaced | a near-raw `scrape_config`, for targets that are not Kubernetes Services/Pods |
| `AlertmanagerConfig` | `monitoring.coreos.com/v1alpha1` **and** `/v1beta1` | Namespaced | a *fragment* of Alertmanager routing/receivers, owned by an app team |

Notes that a textbook gets wrong if it isn't careful:

- **`ScrapeConfig` is still `v1alpha1`.** There is an accepted proposal to graduate it to `v1beta1`;
  the strategy is to make all breaking changes *in* `v1alpha1` first so that `v1alpha1` and `v1beta1`
  end up identical and no conversion webhook is needed. It has **not** graduated as of 2026-07-28.
  [VERIFIED — the ScrapeConfig developer doc still shows `apiVersion: monitoring.coreos.com/v1alpha1`.]
- **`AlertmanagerConfig` is served at both `v1alpha1` and `v1beta1`.** The main difference is matcher
  format and validation. The project ships **conversion webhooks** so both can be used at once; the
  admission/conversion webhook must be deployed for that to work. The `kube-prometheus-stack`
  examples and the operator's own docs still use `v1alpha1` in their examples. **[UNVERIFIED:** which
  version is currently the *stored* version in etcd. Contemporary sources say "initially v1alpha1,
  will switch to v1beta1 in a couple of releases" — do not state a current storage version.]
- **`PrometheusAgent` is `v1alpha1`.** If the book shows an agent example, it must not write
  `monitoring.coreos.com/v1`.
- There is **no** `RemoteWrite` CRD today (§3.2).
- v0.86.0+ adds a **status subresource** to ServiceMonitor/PodMonitor/ScrapeConfig/Probe
  (experimental, behind `StatusForConfigurationResources`) and v0.87.0 to PrometheusRule. When it is
  on, `kubectl describe servicemonitor …` will eventually tell you *why* a monitor was rejected —
  that is a big usability change from the historical "read the operator logs" answer. Mention it as
  emerging, not as the default workflow.

### 4.1 Recent CRD-level changes the book must not contradict [VERIFIED, CHANGELOG]

- **v0.93.0 (2026-07-28)** — CHANGE: switched `uint` → `int` in the Go CRD definitions and added API
  validation rejecting negative values. CHANGE: a default of `1` is now defined for `.spec.shards`
  on `Prometheus` and `PrometheusAgent`. CHANGE: local Prometheus compaction is now **kept enabled**
  when the Thanos sidecar uploads to object storage, for Prometheus ≥ v3.9.0 and Thanos ≥ v0.41.0
  (this reverses years of "the sidecar disables compaction" advice). FEATURE: `updateMessage` on the
  Slack receiver in `AlertmanagerConfig`; `chunkEncoding` in `TSDBSpec` for runtime float encoding.
- **v0.92.0 (2026-06-18)** — retention options migrated from CLI flags to the config file for the
  `Prometheus` CRD; Pod Topology Spread Constraints + topology sharding; URL validation on OAuth2
  `tokenUrl` across all CRDs.
- **v0.91.0 (2026-05-05)** — `basicAuth`, `authorization` and `oauth2` are now **mutually exclusive**
  in `ScrapeConfig` (previously silently ambiguous); minimum-length validation on string fields;
  `externalId` on SigV4.
- **v0.88.0 (2026-01-09)** — `scrapeNativeHistograms` field added to multiple monitoring CRDs;
  EC2/Lightsail SD rejected for Prometheus ≥ 3.8.0 in `ScrapeConfig`; `podManagementPolicy` and
  `updateStrategy` added.
- **v0.86.0 (2025-10-07)** — automatic UTF-8 support in label/metric names for Prometheus ≥ 3.0.0,
  including in `PrometheusRule`; `app.kubernetes.io/managed-by: prometheus-operator` label added to
  all managed resources.

---

## 5. Minimal correct examples

### 5.1 ServiceMonitor — the canonical trio

This is the example the chapter should build. Three objects that must agree with each other.

**Deployment** (abbreviated — the reader's own lab service, exposing `/metrics` on 8080):

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: example-app
  namespace: demo
spec:
  replicas: 2
  selector:
    matchLabels:
      app: example-app
  template:
    metadata:
      labels:
        app: example-app
    spec:
      containers:
      - name: example-app
        image: ghcr.io/example/example-app:1.0.0
        ports:
        - name: web          # <-- named port. Not required by the ServiceMonitor, but good practice.
          containerPort: 8080
```

**Service** [VERIFIED verbatim from the operator getting-started doc]:

```yaml
kind: Service
apiVersion: v1
metadata:
  name: example-app
  labels:
    app: example-app
spec:
  selector:
    app: example-app
  ports:
  - name: web
    port: 8080
```

**ServiceMonitor** [VERIFIED verbatim from the operator getting-started doc]:

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: example-app
  labels:
    team: frontend
spec:
  selector:
    matchLabels:
      app: example-app
  endpoints:
  - port: web
```

**Prometheus CR that picks it up** [VERIFIED verbatim]:

```yaml
apiVersion: monitoring.coreos.com/v1
kind: Prometheus
metadata:
  name: prometheus
spec:
  serviceAccountName: prometheus
  serviceMonitorSelector:
    matchLabels:
      team: frontend
```

#### The two-level selector, drawn out

This is *the* concept. Draw it as a chain:

```
Prometheus.spec.serviceMonitorNamespaceSelector  ── picks namespaces ──┐
Prometheus.spec.serviceMonitorSelector           ── picks ServiceMonitors (by their metadata.labels)
                                                      │
ServiceMonitor.spec.namespaceSelector            ── picks namespaces ─┤
ServiceMonitor.spec.selector                     ── picks Services (by the Service's metadata.labels)
                                                      │
Service.spec.selector                            ── picks Pods
                                                      │
ServiceMonitor.spec.endpoints[].port             ── names a PORT ON THE SERVICE (by name, a string)
```

Four selectors, and a missing label anywhere in the chain produces the same symptom: **zero targets,
no error**. This is the single biggest source of frustration for newcomers and deserves a full page.

#### The `release:` label trap — specific to kube-prometheus-stack

The chart's `Prometheus` template does this [VERIFIED verbatim from
`templates/prometheus/prometheus.yaml`]:

```gotemplate
{{- if .Values.prometheus.prometheusSpec.serviceMonitorSelector }}
  serviceMonitorSelector:
{{ tpl (toYaml .Values.prometheus.prometheusSpec.serviceMonitorSelector | indent 4) . }}
{{ else if .Values.prometheus.prometheusSpec.serviceMonitorSelectorNilUsesHelmValues  }}
  serviceMonitorSelector:
    matchLabels:
      release: {{ $.Release.Name | quote }}
{{ else }}
  serviceMonitorSelector: {}
```

The same pattern exists for `ruleSelector` and `scrapeConfigSelector` (and the README documents
`podMonitorSelectorNilUsesHelmValues` too). **All the `*SelectorNilUsesHelmValues` values default to
`true`.** [VERIFIED — the README's own guidance is to set them to `false` to discover everything.]

Consequences to state plainly:

1. By default, a `ServiceMonitor` is invisible to a `kube-prometheus-stack` Prometheus **unless it
   carries the label `release: <your-helm-release-name>`.** With `helm install kps …` that means:

   ```yaml
   metadata:
     name: example-app
     labels:
       release: kps
   ```

2. The same applies to `PrometheusRule` (`ruleSelector`) and `ScrapeConfig` (`scrapeConfigSelector`).
   A `PrometheusRule` without the `release` label silently never loads.
3. The alternative is to open the selectors:

   ```yaml
   prometheus:
     prometheusSpec:
       serviceMonitorSelectorNilUsesHelmValues: false
       podMonitorSelectorNilUsesHelmValues: false
       probeSelectorNilUsesHelmValues: false
       scrapeConfigSelectorNilUsesHelmValues: false
       ruleSelectorNilUsesHelmValues: false
   ```

   Say which trade-off this is: with `false` the selectors become `{}` = *match everything in every
   watched namespace*, which is convenient in a lab and a cardinality footgun in production.

#### Fuller ServiceMonitor with the fields readers actually reach for

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: example-app
  namespace: demo
  labels:
    release: kps
spec:
  jobLabel: app                 # use the Service's `app` label as the `job` label
  selector:
    matchLabels:
      app: example-app
  namespaceSelector:
    matchNames:
    - demo
  targetLabels: [app]           # copy these Service labels onto every scraped series
  podTargetLabels: [version]    # copy these Pod labels onto every scraped series
  endpoints:
  - port: web                   # the Service port NAME, a string
    path: /metrics
    interval: 30s
    scrapeTimeout: 10s
    scheme: http
    honorLabels: false
    relabelings: []             # camelCase — NOT relabel_configs
    metricRelabelings: []       # camelCase — NOT metric_relabel_configs
```

**Field-name pitfalls, all worth a callout box:**

- The CRD uses **camelCase**: `relabelings`, `metricRelabelings`, `sourceLabels`, `targetLabel`,
  `scrapeTimeout`, `honorLabels`. The raw Prometheus config uses snake_case
  (`relabel_configs`, `source_labels`, `target_label`). Copy-pasting a `relabel_configs` block out of
  a Prometheus config into a ServiceMonitor will not work.
- `relabelings` and `metricRelabelings` live **inside an endpoint**, not at `spec` level. Several
  blog posts (including recent 2026 ones) show them at `spec:` level. That is wrong and the API
  server will reject or ignore it.
- `port` is the **Service port's `name`**, a string. Passing a number produces
  `spec.endpoints.port in body must be of type string: integer`. [VERIFIED verbatim from the operator
  troubleshooting doc.]
- `PodMonitor` uses **`spec.podMetricsEndpoints`**, not `spec.endpoints`. [VERIFIED]
  For a PodMonitor, `port` is the **container port's name**.
- `spec.serviceDiscoveryRole` accepts `Endpoints` or `EndpointSlice`; if unset it falls back to the
  value on the Prometheus/PrometheusAgent CR. See §7.4. [VERIFIED]
- `spec.scrapeClass` (singular, on the monitor) references a class defined in
  `Prometheus.spec.scrapeClasses`. See §5.6. [VERIFIED — the field on monitors is `scrapeClass`, not
  `scrapeClassName`.]
- `spec.selectorMechanism` lets the operator use Kubernetes **role selectors** instead of
  relabel-based filtering for discovery (needs Prometheus ≥ v2.17.0). This matters at large scale:
  relabel-based filtering makes Prometheus watch *everything* and throw most of it away.

### 5.2 PrometheusRule — minimal correct

Upstream's own minimal example [VERIFIED verbatim from the operator alerting doc]:

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  creationTimestamp: null
  labels:
    prometheus: example
    role: alert-rules
  name: prometheus-example-rules
spec:
  groups:
  - name: ./example.rules
    rules:
    - alert: ExampleAlert
      expr: vector(1)
```

…with the matching selector on the Prometheus CR [VERIFIED verbatim]:

```yaml
apiVersion: monitoring.coreos.com/v1
kind: Prometheus
metadata:
  name: example
spec:
  serviceAccountName: prometheus
  replicas: 2
  alerting:
    alertmanagers:
    - namespace: default
      name: alertmanager-example
      port: web
  serviceMonitorSelector:
    matchLabels:
      team: frontend
  ruleSelector:
    matchLabels:
      role: alert-rules
      prometheus: example
  ruleNamespaceSelector:
    matchLabels:
      team: frontend
```

**The version the book should actually print** (kube-prometheus-stack flavour, realistic alert,
carries the `release` label, mirrors the alerting chapter's style):

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: example-app-rules
  namespace: demo
  labels:
    release: kps          # required by the chart's default ruleSelector
spec:
  groups:
  - name: example-app.rules
    interval: 30s
    rules:
    # recording rule
    - record: job:http_requests:rate5m
      expr: sum by (job) (rate(http_requests_total[5m]))

    # alerting rule
    - alert: ExampleAppHighErrorRate
      expr: |
        sum by (job, namespace) (rate(http_requests_total{status=~"5..", job="example-app"}[5m]))
          /
        sum by (job, namespace) (rate(http_requests_total{job="example-app"}[5m]))
          > 0.05
      for: 10m
      labels:
        severity: warning
      annotations:
        summary: "example-app is serving >5% 5xx in {{ $labels.namespace }}"
        description: "Error ratio is {{ $value | humanizePercentage }} over the last 5 minutes."
        runbook_url: "https://runbooks.example.com/example-app/high-error-rate"
```

Things the chapter should say about `PrometheusRule` specifically:

- The **structure inside `spec.groups` is exactly the Prometheus rule-file format** the reader
  already learned — `groups[].name`, `groups[].interval`, `rules[].record` / `rules[].alert`,
  `expr`, `for`, `labels`, `annotations`. Nothing new to learn. The CRD is a wrapper.
- `{{ $labels.x }}` / `{{ $value }}` Go templating in annotations survives unchanged. But note the
  collision if the reader is also writing Helm templates: inside a Helm chart you must escape them
  (`{{` `}}` conflicts), typically as `{{`{{ $labels.x }}`}}` or by using `additionalPrometheusRules`
  in values.
- The operator **validates** rules and will reject the object; check Events:
  ```console
  kubectl get events --field-selector=involvedObject.name="<resource-name>" -n "<namespace>"
  ```
  [VERIFIED verbatim command]
- Rules are written into ConfigMaps and mounted; the config-reloader picks them up. There is a
  practical size limit per rule file (ConfigMaps cap at ~1 MiB) — split large rule sets.
- Since v0.86.0 UTF-8 label/metric names are supported in `PrometheusRule` for Prometheus ≥ 3.0.0.

### 5.3 PodMonitor — when there's no Service

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PodMonitor
metadata:
  name: example-batch
  namespace: demo
  labels:
    release: kps
spec:
  selector:
    matchLabels:
      app: example-batch
  podMetricsEndpoints:       # NOT `endpoints`
  - port: metrics            # the CONTAINER port name
    path: /metrics
    interval: 30s
```

`jobLabel` on a PodMonitor picks a **Pod** label to use as `job`; `podTargetLabels` copies Pod labels
onto the series. [VERIFIED field semantics from the API reference.]

### 5.4 Probe — blackbox checks

[VERIFIED verbatim from the operator's blackbox-exporter page]

```yaml
kind: Probe
apiVersion: monitoring.coreos.com/v1
metadata:
  name: example-com-website
  namespace: monitoring
spec:
  interval: 60s
  module: http_2xx
  prober:
    url: blackbox-exporter.monitoring.svc.cluster.local:19115
  targets:
    staticConfig:
      static:
      - http://example.com
      - https://example.com
```

`spec.targets.ingress` is the other form — it discovers targets from Ingress objects instead of a
static list. **[UNVERIFIED]** I could not fetch a canonical `targets.ingress` example; the operator
docs page I reached only showed `staticConfig`. Do not invent one; either omit it or verify first.
There is an open feature request (#8285) to also support `HTTPRoute`/`IngressRoute` — so Gateway API
targets are **not** supported today.

### 5.5 ScrapeConfig — for things that aren't Kubernetes workloads

All [VERIFIED verbatim from the ScrapeConfig developer doc]:

```yaml
apiVersion: monitoring.coreos.com/v1alpha1
kind: ScrapeConfig
metadata:
  name: static-config
  namespace: my-namespace
  labels:
    prometheus: system-monitoring-prometheus
spec:
  staticConfigs:
    - labels:
        job: prometheus
      targets:
        - prometheus.demo.do.prometheus.io:9090
```

```yaml
apiVersion: monitoring.coreos.com/v1alpha1
kind: ScrapeConfig
metadata:
  name: kubernetes-sd
  namespace: my-namespace
  labels:
    prometheus: system-monitoring-prometheus
spec:
  kubernetesSDConfigs:
    - role: Node
```

```yaml
apiVersion: monitoring.coreos.com/v1alpha1
kind: ScrapeConfig
metadata:
  name: http-sd
  namespace: my-namespace
  labels:
    prometheus: system-monitoring-prometheus
spec:
  httpSDConfigs:
    - url: http://my-external-api/discovery
      refreshInterval: 15s
```

File SD needs a ConfigMap mounted into the Prometheus pod:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: scrape-file-sd-targets
  namespace: monitoring
  labels:
    prometheus: system-monitoring-prometheus
data:
  targets.yaml: |
    - labels:
        job: node-demo
      targets:
      - node.demo.do.prometheus.io:9100
```

```yaml
apiVersion: monitoring.coreos.com/v1alpha1
kind: ScrapeConfig
metadata:
  name: file-sd
  namespace: my-namespace
spec:
  fileSDConfigs:
    - files:
        - /etc/prometheus/configmaps/scrape-file-sd-targets/targets.yaml
```

Selected via:

```yaml
spec:
  scrapeConfigSelector:
    matchLabels:
      prometheus: system-monitoring-prometheus
```

**Important detail for the book:** `role` values inside `kubernetesSDConfigs` are **capitalised** in
the CRD (`Node`, `Pod`, `Service`, `Endpoints`, `EndpointSlice`, `Ingress`), whereas in raw
`prometheus.yml` they are lowercase (`node`, `pod`, …). Getting this wrong is a validation error.
[VERIFIED — the doc's example is `role: Node`.]

SD support is tiered: **Tier 1 (fully supported)** = Kubernetes, File, Static, DNS, HTTP.
**Tier 2 (community-maintained)** = the cloud SDs (Azure, EC2, GCE, DigitalOcean, …). [VERIFIED]

### 5.6 ScrapeClass — the "stop repeating yourself" feature

`Prometheus.spec.scrapeClasses` defines named, reusable bundles of scrape settings; a monitor opts in
with `spec.scrapeClass: <name>`. Fields on a ScrapeClass: `name`, `default`, `tlsConfig`,
`authorization`, `relabelings`, `metricRelabelings`, `attachMetadata`. Still marked **experimental**
in the API reference. [VERIFIED]

Good use case to show: a platform team defines a `tls-internal` scrape class carrying the CA bundle
and client cert, and app teams never touch TLS config again.

### 5.7 AlertmanagerConfig — namespaced routing

[VERIFIED verbatim from the operator alerting doc]

```yaml
apiVersion: monitoring.coreos.com/v1alpha1
kind: AlertmanagerConfig
metadata:
  name: config-example
  labels:
    alertmanagerConfig: example
spec:
  route:
    groupBy: ['job']
    groupWait: 30s
    groupInterval: 5m
    repeatInterval: 12h
    receiver: 'webhook'
  receivers:
  - name: 'webhook'
    webhookConfigs:
    - url: 'http://example.com/'
```

Note the **camelCase again**: `groupBy` / `groupWait` / `groupInterval` / `repeatInterval` /
`webhookConfigs`, versus the raw Alertmanager config's `group_by`, `group_wait`, etc. Same trap as
ServiceMonitor.

The mental model to teach: the top-level `Alertmanager` CR owns the *global* config and the root
route; each `AlertmanagerConfig` is grafted in as a **sub-route** scoped to its own namespace, with
a namespace matcher injected automatically so team A cannot capture team B's alerts.
[Conceptually standard; **[UNVERIFIED]** the exact injected matcher label name — verify before
stating it as `namespace="…"`.]

---

## 6. The non-operator path: `kubernetes_sd_config` by hand

Every reader should see this once, for three reasons: (a) some of them will work somewhere that
forbids CRDs; (b) it demystifies the operator; (c) it is the only way to understand the `__meta_*`
labels that relabeling in a ServiceMonitor operates on.

### 6.1 Roles [VERIFIED]

Six roles: **`node`, `service`, `pod`, `endpoints`, `endpointslice`, `ingress`.**

| Role | One target per… | Typical use |
|---|---|---|
| `node` | cluster node (address = kubelet address, port 10250 by default) | kubelet, cAdvisor |
| `pod` | **container port** of every pod | annotation-driven scraping; sidecar-free apps with no Service |
| `service` | service port | *not* for scraping app metrics — it hits the Service VIP and load-balances, so you get one random backend per scrape. Use it only for blackbox probing. |
| `endpoints` | address:port behind a Service | the classic app-scraping role; what `ServiceMonitor` compiles to by default |
| `endpointslice` | address:port from an EndpointSlice | same as `endpoints` but scales far better |
| `ingress` | **each path of each Ingress** | blackbox probing of public URLs |

**Say this loudly:** the Kubernetes **`Endpoints` API is deprecated as of Kubernetes v1.33**; the API
server emits warnings when it is read or written, and `EndpointSlice` (`discovery.k8s.io/v1`, stable
since v1.21) is the replacement. Prometheus's `endpointslice` role is therefore the forward-looking
choice, and the Prometheus docs already say newer clusters should prefer it. [VERIFIED — Kubernetes
blog "Kubernetes v1.33: Continuing the transition from Endpoints to EndpointSlices", 2025-04-24.]

### 6.2 The `__meta_kubernetes_*` labels

The following lists were verified against the Grafana Alloy `discovery.kubernetes` reference, which
documents the same discovery implementation Prometheus uses. [VERIFIED for label *names*; a
belt-and-braces re-check against `prometheus.io/docs/prometheus/latest/configuration/configuration/#kubernetes_sd_config`
is advisable because that page is too large for my fetch tool to reach the section.]

**role: node**
```
__meta_kubernetes_node_name
__meta_kubernetes_node_provider_id
__meta_kubernetes_node_address_<address_type>
__meta_kubernetes_node_label_<labelname>
__meta_kubernetes_node_labelpresent_<labelname>
__meta_kubernetes_node_annotation_<annotationname>
__meta_kubernetes_node_annotationpresent_<annotationname>
```

**role: pod**
```
__meta_kubernetes_namespace
__meta_kubernetes_pod_name
__meta_kubernetes_pod_ip
__meta_kubernetes_pod_uid
__meta_kubernetes_pod_node_name
__meta_kubernetes_pod_host_ip
__meta_kubernetes_pod_phase
__meta_kubernetes_pod_ready
__meta_kubernetes_pod_controller_kind
__meta_kubernetes_pod_controller_name
__meta_kubernetes_pod_container_id
__meta_kubernetes_pod_container_image
__meta_kubernetes_pod_container_init
__meta_kubernetes_pod_container_name
__meta_kubernetes_pod_container_port_name
__meta_kubernetes_pod_container_port_number
__meta_kubernetes_pod_container_port_protocol
__meta_kubernetes_pod_label_<labelname>
__meta_kubernetes_pod_labelpresent_<labelname>
__meta_kubernetes_pod_annotation_<annotationname>
__meta_kubernetes_pod_annotationpresent_<annotationname>
```

**role: service**
```
__meta_kubernetes_namespace
__meta_kubernetes_service_name
__meta_kubernetes_service_cluster_ip
__meta_kubernetes_service_external_name
__meta_kubernetes_service_type
__meta_kubernetes_service_port_name
__meta_kubernetes_service_port_number
__meta_kubernetes_service_port_protocol
__meta_kubernetes_service_label_<labelname>
__meta_kubernetes_service_labelpresent_<labelname>
__meta_kubernetes_service_annotation_<annotationname>
__meta_kubernetes_service_annotationpresent_<annotationname>
```

**role: endpoints** — *plus all `role: service` labels for the backing Service, plus all
`role: pod` labels for targets backed by a pod* [VERIFIED as a documented behaviour]
```
__meta_kubernetes_namespace
__meta_kubernetes_endpoints_name
__meta_kubernetes_endpoints_label_<labelname>
__meta_kubernetes_endpoints_labelpresent_<labelname>
__meta_kubernetes_endpoint_hostname
__meta_kubernetes_endpoint_node_name
__meta_kubernetes_endpoint_ready
__meta_kubernetes_endpoint_port_name
__meta_kubernetes_endpoint_port_protocol
__meta_kubernetes_endpoint_address_target_kind
__meta_kubernetes_endpoint_address_target_name
```

**role: endpointslice**
```
__meta_kubernetes_namespace
__meta_kubernetes_endpointslice_name
__meta_kubernetes_endpointslice_address_type
__meta_kubernetes_endpointslice_address_target_kind
__meta_kubernetes_endpointslice_address_target_name
__meta_kubernetes_endpointslice_endpoint_conditions_ready
__meta_kubernetes_endpointslice_endpoint_hostname
__meta_kubernetes_endpointslice_endpoint_node_name
__meta_kubernetes_endpointslice_endpoint_zone
__meta_kubernetes_endpointslice_endpoint_topology_kubernetes_io_hostname
__meta_kubernetes_endpointslice_endpoint_topology_present_kubernetes_io_hostname
__meta_kubernetes_endpointslice_port
__meta_kubernetes_endpointslice_port_name
__meta_kubernetes_endpointslice_port_protocol
```

**role: ingress**
```
__meta_kubernetes_namespace
__meta_kubernetes_ingress_name
__meta_kubernetes_ingress_class_name
__meta_kubernetes_ingress_scheme
__meta_kubernetes_ingress_path
__meta_kubernetes_ingress_label_<labelname>
__meta_kubernetes_ingress_labelpresent_<labelname>
__meta_kubernetes_ingress_annotation_<annotationname>
__meta_kubernetes_ingress_annotationpresent_<annotationname>
```

**Note the endpointslice naming trap:** the `endpoints` role uses the singular prefix
`__meta_kubernetes_endpoint_*` for per-address labels and plural
`__meta_kubernetes_endpoints_*` for the object's own labels, while `endpointslice` uses
`__meta_kubernetes_endpointslice_*` throughout. Relabeling rules are **not** portable between the two
roles. This is exactly the kind of detail a textbook gets wrong.

### 6.3 RBAC for the non-operator path

Upstream's own example [VERIFIED verbatim from
`prometheus/prometheus/documentation/examples/rbac-setup.yml`]:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: prometheus
rules:
  - apiGroups: [""]
    resources:
      - nodes
      - nodes/metrics
      - services
      - endpoints
      - pods
    verbs: ["get", "list", "watch"]
  - apiGroups:
      - extensions
      - networking.k8s.io
    resources:
      - ingresses
    verbs: ["get", "list", "watch"]
  - nonResourceURLs: ["/metrics", "/metrics/cadvisor"]
    verbs: ["get"]
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: prometheus
  namespace: default
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: prometheus
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: prometheus
subjects:
  - kind: ServiceAccount
    name: prometheus
    namespace: default
```

Two corrections the book must make to that upstream example, because it is stale:

1. **`endpointslices` is missing.** If you use `role: endpointslice` you additionally need:
   ```yaml
     - apiGroups: ["discovery.k8s.io"]
       resources: ["endpointslices"]
       verbs: ["get", "list", "watch"]
   ```
   The operator's own RBAC docs do include `discovery.k8s.io` endpointslices for the Prometheus
   service account. [VERIFIED that the operator RBAC doc covers this.]
2. `apiGroups: ["extensions"]` for Ingress is a Kubernetes 1.21-era relic; only
   `networking.k8s.io` matters on any supported cluster. Harmless but misleading.

Also note the prerequisite the upstream doc states: **the kubelet must be running with
`--authentication-token-webhook` and `--authorization-mode=Webhook`** for the ServiceAccount token to
be accepted at `https://<node>:10250/metrics`. [VERIFIED]

Interesting contrast to point out: **kube-prometheus's** `ClusterRole` for Prometheus is deliberately
tiny — only `nodes/metrics` (get) and `nonResourceURLs: ["/metrics", "/metrics/slis"]` (get) — because
the rest of the discovery permissions are granted as namespaced **`Role`s** in only the namespaces
being watched. That is the least-privilege pattern and worth a sentence. [VERIFIED from
`kube-prometheus/manifests/prometheus-clusterRole.yaml`.]

### 6.4 The standard relabeling boilerplate

**Important correction for the book.** The famous `prometheus.io/scrape`, `prometheus.io/port`,
`prometheus.io/path` annotation convention is a **community convention, not an official Prometheus
feature.** As of today, the upstream example config
(`prometheus/documentation/examples/prometheus-kubernetes.yml`) **does not contain the string
`prometheus_io` anywhere** — it uses placeholder annotation names like
`__meta_kubernetes_service_annotation_example_io_metric_path` and
`__meta_kubernetes_pod_annotation_example_io_scrape_port`, and those rules are **commented out**.
[VERIFIED by a literal string search of the current file.] Books and blogs that present the
`prometheus.io/*` block as "the standard Prometheus Kubernetes config" are overstating it. Present it
as "the convention almost everyone adopted", not as an upstream feature.

What the current upstream example *does* contain [VERIFIED — job names and roles]:

| job_name | role |
|---|---|
| `kubernetes-apiservers` | `endpoints` |
| `kubernetes-nodes` | `node` |
| `kubernetes-cadvisor` | `node` |
| `kubernetes-service-endpoints` | `endpoints` |
| `kubernetes-services` | `service` (blackbox probing) |
| `kubernetes-ingresses` | `ingress` (blackbox probing) |
| `kubernetes-pods` | `pod` |

plus a global `keep_dropped_targets: 100` (so the UI can still show you what relabeling threw away —
see §12.2). Every job authenticates with:

```yaml
    tls_config:
      ca_file: /var/run/secrets/kubernetes.io/serviceaccount/ca.crt
    authorization:
      credentials_file: /var/run/secrets/kubernetes.io/serviceaccount/token
```

Note `authorization: { credentials_file: … }` — the old `bearer_token_file:` spelling still works but
`authorization` is the modern form. [VERIFIED — the current upstream example uses `credentials_file`.]

**Rules verified verbatim from the current upstream file:**

`kubernetes-apiservers` — keep only the one real API server endpoint:
```yaml
relabel_configs:
  - source_labels:
      [__meta_kubernetes_namespace, __meta_kubernetes_service_name, __meta_kubernetes_endpoint_port_name]
    action: keep
    regex: default;kubernetes;https
```

`kubernetes-nodes` and `kubernetes-cadvisor` — promote every node label to a real label:
```yaml
relabel_configs:
  - action: labelmap
    regex: __meta_kubernetes_node_label_(.+)
```

`kubernetes-service-endpoints`:
```yaml
relabel_configs:
  - action: labelmap
    regex: __meta_kubernetes_service_label_(.+)
  - source_labels: [__meta_kubernetes_namespace]
    action: replace
    target_label: namespace
  - source_labels: [__meta_kubernetes_service_name]
    action: replace
    target_label: service
```

`kubernetes-pods`:
```yaml
relabel_configs:
  - action: labelmap
    regex: __meta_kubernetes_pod_label_(.+)
  - source_labels: [__meta_kubernetes_namespace]
    action: replace
    target_label: namespace
  - source_labels: [__meta_kubernetes_pod_name]
    action: replace
    target_label: pod
```

`kubernetes-services` (blackbox):
```yaml
relabel_configs:
  - source_labels: [__address__]
    target_label: __param_target
  - target_label: __address__
    replacement: blackbox-exporter.example.com:9115
  - source_labels: [__param_target]
    target_label: instance
  - action: labelmap
    regex: __meta_kubernetes_service_label_(.+)
  - source_labels: [__meta_kubernetes_namespace]
    target_label: namespace
  - source_labels: [__meta_kubernetes_service_name]
    target_label: service
```

`kubernetes-ingresses` (blackbox):
```yaml
relabel_configs:
  - source_labels: [__meta_kubernetes_ingress_scheme, __address__, __meta_kubernetes_ingress_path]
    regex: (.+);(.+);(.+)
    replacement: ${1}://${2}${3}
    target_label: __param_target
  - target_label: __address__
    replacement: blackbox-exporter.example.com:9115
  - source_labels: [__param_target]
    target_label: instance
  - action: labelmap
    regex: __meta_kubernetes_ingress_label_(.+)
  - source_labels: [__meta_kubernetes_namespace]
    target_label: namespace
  - source_labels: [__meta_kubernetes_ingress_name]
    target_label: ingress
```

Commented-out annotation-driven rules, with the exact regexes upstream uses [VERIFIED]:
```yaml
  # override the metrics path from an annotation
  # - source_labels: [__meta_kubernetes_pod_annotation_example_io_metric_path]
  #   action: replace
  #   regex: (.+)
  #   target_label: __metrics_path__

  # override the port from an annotation
  # - source_labels: [__address__, __meta_kubernetes_pod_annotation_example_io_scrape_port]
  #   action: replace
  #   regex: ([^:]+)(?::\d+)?;(\d+)
  #   replacement: $1:$2
  #   target_label: __address__
```

**The community `prometheus.io/*` version**, which is what readers will meet in the wild. Present it
as convention and tell them to verify against their cluster:

```yaml
- job_name: kubernetes-pods
  kubernetes_sd_configs:
    - role: pod
  relabel_configs:
    # 1. only scrape pods that opted in
    - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_scrape]
      action: keep
      regex: true
    # 2. optional scheme override
    - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_scheme]
      action: replace
      regex: (https?)
      target_label: __scheme__
    # 3. optional path override
    - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_path]
      action: replace
      regex: (.+)
      target_label: __metrics_path__
    # 4. optional port override  (verbatim regex/replacement from upstream)
    - source_labels: [__address__, __meta_kubernetes_pod_annotation_prometheus_io_port]
      action: replace
      regex: ([^:]+)(?::\d+)?;(\d+)
      replacement: $1:$2
      target_label: __address__
    # 5. promote pod labels
    - action: labelmap
      regex: __meta_kubernetes_pod_label_(.+)
    # 6. standard identity labels
    - source_labels: [__meta_kubernetes_namespace]
      action: replace
      target_label: namespace
    - source_labels: [__meta_kubernetes_pod_name]
      action: replace
      target_label: pod
    - source_labels: [__meta_kubernetes_pod_node_name]
      action: replace
      target_label: node
```

**[PARTIALLY UNVERIFIED]** — rules 1, 2, 3, 6 above are written in the shape upstream uses for the
`example_io_*` equivalents, with the annotation name changed. Rule 4's `regex`/`replacement` pair is
verbatim upstream. Rule 5's `labelmap` is verbatim upstream. Before printing, run this against a live
`kind` cluster and confirm targets appear.

**cAdvisor via the node role** — the two variants, and which is which:

```yaml
# Variant A: scrape the kubelet directly (needs network reachability to :10250)
- job_name: kubernetes-cadvisor
  scheme: https
  tls_config:
    ca_file: /var/run/secrets/kubernetes.io/serviceaccount/ca.crt
  authorization:
    credentials_file: /var/run/secrets/kubernetes.io/serviceaccount/token
  kubernetes_sd_configs:
    - role: node
  relabel_configs:
    - action: labelmap
      regex: __meta_kubernetes_node_label_(.+)
    - target_label: __metrics_path__
      replacement: /metrics/cadvisor
```

```yaml
# Variant B: go through the API server proxy (works when :10250 is firewalled)
  relabel_configs:
    - action: labelmap
      regex: __meta_kubernetes_node_label_(.+)
    - target_label: __address__
      replacement: kubernetes.default.svc:443
    - source_labels: [__meta_kubernetes_node_name]
      regex: (.+)
      target_label: __metrics_path__
      replacement: /api/v1/nodes/${1}/proxy/metrics/cadvisor
```

**[UNVERIFIED]** — Variant B is the long-standing community pattern and appears (historically
commented) in the upstream example, but I could not read that portion of the current file. Verify
before printing. Note also that Variant B routes all node metrics through the API server, which is a
scaling hazard on large clusters — say so either way.

---

## 7. kube-state-metrics vs metrics-server vs cAdvisor

This section is the highest-value part of the chapter for a newcomer, because these three are
constantly confused and the confusion produces wrong dashboards.

### 7.1 The one-line distinctions

| | **cAdvisor (in the kubelet)** | **kube-state-metrics (KSM)** | **metrics-server** |
|---|---|---|---|
| Question it answers | "How much CPU/RAM/IO is this **container actually using**?" | "What does the Kubernetes **API say should exist**, and what state is it in?" | "What is the **current** CPU/RAM of this pod/node, right now?" |
| Data source | cgroups (Linux) / CRI container metrics | watches the Kubernetes API server | scrapes every kubelet's `/metrics/resource` |
| Where it runs | **inside the kubelet** — not a separate deployment | separate Deployment | separate Deployment |
| Exposes | Prometheus text at kubelet `/metrics/cadvisor` | Prometheus text on its own `/metrics` | the **Kubernetes Metrics API** (`metrics.k8s.io/v1beta1`) — **not** Prometheus format |
| Stores history? | no (Prometheus does) | no, it is stateless & derived from API state | **no — latest value only** |
| Consumed by | Prometheus | Prometheus | HPA, VPA, `kubectl top` |
| Example series | `container_cpu_usage_seconds_total`, `container_memory_working_set_bytes` | `kube_pod_status_phase`, `kube_deployment_status_replicas` | *(not Prometheus series at all)* |

The upstream KSM README states the distinction explicitly: KSM "is focused on generating completely
new metrics from Kubernetes' object state (e.g. metrics based on deployments, replica sets, etc.)"
whereas metrics-server "periodically scrapes metrics from all Kubernetes nodes" and "stores the
latest values only." [VERIFIED, KSM README]

### 7.2 The confusions, named

1. **"I installed metrics-server, why doesn't Prometheus see it?"** — Because metrics-server does not
   speak Prometheus. It serves the aggregated Metrics API. `kubectl top pod` works; a Prometheus
   scrape of it does not give you `kubectl top`-style data. **You generally do not need
   metrics-server for Prometheus at all** — but you *do* need it for HPA. Both can coexist; they
   are not competitors. (metrics-server does expose its *own* internal `/metrics` for self-monitoring;
   that is not the resource data.)
2. **"kube-state-metrics tells me how much CPU my pod uses."** — It does not. KSM tells you the
   pod's **requests and limits** (`kube_pod_container_resource_requests`,
   `kube_pod_container_resource_limits`) — declarations, not usage. Usage comes from cAdvisor.
   Every "% of CPU limit used" panel is therefore a **join across two exporters**, which is why the
   free dashboards are full of `* on(namespace,pod) group_left(...)`.
3. **"I need to install cAdvisor."** — You do not. cAdvisor is compiled into the kubelet. The
   Kubernetes docs describe it as a "Daemon for collecting, aggregating and exposing container
   metrics included in Kubelet". Standalone cAdvisor exists but is not what Kubernetes uses.
   [VERIFIED, kubernetes.io resource-metrics-pipeline]
4. **"node-exporter and cAdvisor overlap."** — Barely. node-exporter is about the **host** (disk,
   filesystem, network device, load average, hardware). cAdvisor is about **containers**. Node CPU
   comes from node-exporter (`node_cpu_seconds_total`); container CPU from cAdvisor.
5. **"KSM is the Kubernetes API's metrics."** — No; the **API server's own** metrics
   (`apiserver_request_total`, etcd metrics, etc.) come from scraping the API server's `/metrics`.
   KSM is a translator of object *state* into gauges.

### 7.3 kubelet metrics endpoints [VERIFIED, kubernetes.io]

| Endpoint | Content |
|---|---|
| `/metrics` | the kubelet's own operational metrics (`kubelet_*`, runtime ops, pod worker latencies, …) |
| `/metrics/cadvisor` | container resource metrics (`container_*`) — **this is cAdvisor** |
| `/metrics/resource` | a small, efficient set of CPU/memory numbers; **this is what metrics-server scrapes** (v0.6.0+; older metrics-server used `/stats/summary`) |
| `/metrics/probes` | liveness/readiness/startup probe results (`prober_probe_total`) |
| `/metrics/slis` | component SLI metrics (scraped by kube-prometheus at a 5s interval) |

Kubernetes documents that the metrics on `/metrics/cadvisor`, `/metrics/resource` and
`/metrics/probes` **do not follow the same stability lifecycle** as the kubelet's own `/metrics` —
i.e. they can change without the usual deprecation guarantees. Worth a warning box, because readers
will build dashboards on `container_*` and be surprised.

Newer content on those endpoints: **PSI (Pressure Stall Information)** counters are exposed via
`/metrics/cadvisor` and are **stable in Kubernetes v1.36**, enabled by default:
```
container_pressure_cpu_stalled_seconds_total
container_pressure_cpu_waiting_seconds_total
container_pressure_memory_stalled_seconds_total
container_pressure_memory_waiting_seconds_total
container_pressure_io_stalled_seconds_total
container_pressure_io_waiting_seconds_total
```
[VERIFIED, kubernetes.io system-metrics]. This is genuinely new and a nice "here's something the
2021 books don't have" moment: PSI tells you *contention*, not just utilisation.

### 7.4 kube-state-metrics detail

- Exposes metrics for **28 default resource kinds** [VERIFIED, KSM docs]: Deployments, StatefulSets,
  DaemonSets, ReplicaSets, Jobs, CronJobs, Pods, HorizontalPodAutoscalers, ReplicationControllers,
  ConfigMaps, PersistentVolumes, PersistentVolumeClaims, Secrets, StorageClasses, VolumeAttachments,
  Services, Endpoints, Ingresses, EndpointSlices, Nodes, Namespaces, Leases, LimitRanges,
  NetworkPolicies, PodDisruptionBudgets, ResourceQuotas, CertificateSigningRequests,
  Validating/MutatingWebhookConfigurations, ValidatingAdmissionPolicies (+Bindings).
- Seven more are **opt-in**: ClusterRoles, ClusterRoleBindings, Roles, RoleBindings, ServiceAccounts,
  IngressClasses, EndpointSlices.
- **By default KSM does NOT export Kubernetes labels as metric labels** — precisely to avoid a
  cardinality explosion. You opt in per-resource with:
  ```
  --metric-labels-allowlist=pods=[app,version,tier],deployments=[app]
  ```
  `[*]` exports everything and is explicitly warned against. [VERIFIED]
  In the Helm chart this is `kube-state-metrics.metricLabelsAllowlist`.
- KSM v2.19.x tracks Kubernetes client-go v1.35; the project supports the five most recent
  KSM/Kubernetes releases. [VERIFIED, KSM README]
- KSM is a **singleton by default**, and it holds a full snapshot of cluster object state in memory.
  On big clusters it is a memory hog and supports sharding. If you shard your *Prometheus*, KSM must
  be excluded from sharding or you will silently lose half the object state — see §9.3.

### 7.5 Canonical PromQL that joins the three sources

These are the queries a reader will actually copy. Put them in the chapter.

CPU actually used, per pod:
```promql
sum by (namespace, pod) (
  rate(container_cpu_usage_seconds_total{container!="", image!=""}[5m])
)
```

Memory working set, per pod:
```promql
sum by (namespace, pod) (
  container_memory_working_set_bytes{container!="", image!=""}
)
```

CPU usage as a fraction of the configured limit (the cAdvisor × KSM join):
```promql
sum by (namespace, pod) (rate(container_cpu_usage_seconds_total{container!=""}[5m]))
  /
sum by (namespace, pod) (kube_pod_container_resource_limits{resource="cpu"})
```

Pods not ready:
```promql
kube_pod_status_ready{condition="true"} == 0
```

Crash-looping:
```promql
increase(kube_pod_container_status_restarts_total[15m]) > 3
```

Deployment not at desired replicas:
```promql
kube_deployment_status_replicas_available
  != on (namespace, deployment)
kube_deployment_spec_replicas
```

**[UNVERIFIED — verify the exact filter idiom against a live cluster before printing.]** The
`container!=""` filter drops the pod-level rollup series that cAdvisor also emits (the pod cgroup,
which has an empty `container` label). Older material adds `container!="POD"` to exclude the pause
container; whether that is still needed depends on the container runtime and cAdvisor version. The
`kubernetes-mixin` recording rules use `{job="kubelet", metrics_path="/metrics/cadvisor", image!=""}`.
Pick one idiom, verify it on `kind` + a managed cluster, and use it consistently in every chapter.

Also worth teaching: **prefer the recording rules over the raw queries.** The stack ships
`node_namespace_pod_container:container_cpu_usage_seconds_total:sum_irate`-style recording rules
precisely because the raw joins are expensive.

---

## 8. What you get for free

### 8.1 Dashboards shipped by `kube-prometheus-stack`

35 dashboards, from `templates/grafana/dashboards-1.14/` [VERIFIED — full directory listing]:

```
alertmanager-overview            apiserver                        cluster-total
controller-manager               etcd                             grafana-overview
k8s-coredns                      k8s-resources-cluster            k8s-resources-multicluster
k8s-resources-namespace          k8s-resources-node               k8s-resources-nodes-overview
k8s-resources-pod                k8s-resources-windows-cluster    k8s-resources-windows-namespace
k8s-resources-windows-pod        k8s-resources-workload           k8s-resources-workloads-namespace
k8s-windows-cluster-rsrc-use     k8s-windows-node-rsrc-use        kubelet
namespace-by-pod                 namespace-by-workload            node-cluster-rsrc-use
node-rsrc-use                    nodes                            nodes-aix
nodes-darwin                     persistentvolumesusage           pod-total
prometheus                       prometheus-remote-write          proxy
scheduler                        workload-total
```

Point the reader at the five that matter on day one:
`k8s-resources-namespace`, `k8s-resources-pod`, `k8s-resources-workload`, `nodes`, `prometheus`
(the last one being "is my monitoring healthy?", which is the chapter's meta-lesson).

Provenance: these come from the **kubernetes-mixin** project (jsonnet), via **kube-prometheus**, into
the Helm chart. Explain the lineage in two sentences — it makes the ecosystem legible and it explains
why the dashboards all look the same across vendors. [VERIFIED — kube-prometheus README states it
incorporates dashboards and alerts from kubernetes-mixin.]

How they get into Grafana: the chart renders each dashboard as a **ConfigMap** labelled
`grafana_dashboard: "1"`, and the Grafana **sidecar** watches for that label across all namespaces
and drops the JSON into Grafana's provisioning directory. Verbatim from the chart's values
[VERIFIED]:

```yaml
  sidecar:
    dashboards:
      enabled: true
      label: grafana_dashboard
      labelValue: "1"
      searchNamespace: ALL
      enableNewTablePanelSyntax: false
      annotations: {}
      multicluster:
        global:
          enabled: false
        etcd:
          enabled: false
      provider:
        allowUiUpdates: false

    datasources:
      enabled: true
      defaultDatasourceEnabled: true
      isDefaultDatasource: true
      name: Prometheus
      uid: prometheus
      annotations: {}
      httpMethod: POST
      createPrometheusReplicasDatasources: false
      prometheusServiceName: prometheus-operated
      label: grafana_datasource
      labelValue: "1"
      exemplarTraceIdDestinations: {}
      alertmanager:
        enabled: true
        name: Alertmanager
        uid: alertmanager
        handleGrafanaManagedAlerts: false
        implementation: prometheus
```

and the surrounding Grafana knobs [VERIFIED]:

```yaml
grafana:
  enabled: true
  namespaceOverride: ""
  forceDeployDatasources: false
  forceDeployDashboards: false
  defaultDashboardsEnabled: true
  defaultDashboardsTimezone: utc
  defaultDashboardsEditable: true
  defaultDashboardsInterval: 1m
  adminUser: admin
  # adminPassword: strongpassword
  admin:
    existingSecret: ""
    userKey: admin-user
    passwordKey: admin-password
  serviceMonitor:
    enabled: true
```

**This is a great teaching moment**: the reader has been hand-importing dashboard JSON all book. Now
show them that "put the JSON in a ConfigMap with one label" is the whole Kubernetes-native
provisioning story — and that the datasource UID is a stable, well-known `prometheus`, which is why
the shipped dashboards work without editing.

Default Grafana credentials for the lab: user `admin`, and the password is generated into a Secret
unless `grafana.adminPassword` is set. Show:
```console
kubectl -n monitoring get secret kps-grafana -o jsonpath="{.data.admin-password}" | base64 -d ; echo
kubectl -n monitoring port-forward svc/kps-grafana 3000:80
```
**[UNVERIFIED]** the exact Secret name and service port for the current chart version — verify with
`kubectl -n monitoring get secret,svc | grep grafana` before printing.

### 8.2 Alert rules shipped

41 `PrometheusRule` files in `templates/prometheus/rules-1.14/` [VERIFIED — full listing]:

```
alertmanager.rules                       config-reloaders
etcd                                     general.rules
k8s.rules.container_cpu_limits           k8s.rules.container_cpu_requests
k8s.rules.container_cpu_usage_seconds_total
k8s.rules.container_memory_cache         k8s.rules.container_memory_limits
k8s.rules.container_memory_requests      k8s.rules.container_memory_rss
k8s.rules.container_memory_swap          k8s.rules.container_memory_working_set_bytes
k8s.rules.container_resource             k8s.rules.pod_owner
kube-apiserver-availability.rules        kube-apiserver-burnrate.rules
kube-apiserver-histogram.rules           kube-apiserver-slos
kube-prometheus-general.rules            kube-prometheus-node-recording.rules
kube-scheduler.rules                     kube-state-metrics
kubelet.rules                            kubernetes-apps
kubernetes-resources                     kubernetes-storage
kubernetes-system-apiserver              kubernetes-system-controller-manager
kubernetes-system-kube-proxy             kubernetes-system-kubelet
kubernetes-system-scheduler              kubernetes-system
node-exporter.rules                      node-exporter
node-network                             node.rules
prometheus-operator                      prometheus
windows.node.rules                       windows.pod.rules
```

All individually switchable via `defaultRules.rules.<key>`. Verbatim from `values.yaml` [VERIFIED]:

```yaml
## Create default rules for monitoring the cluster
##
defaultRules:
  create: true
  rules:
    alertmanager: true
    etcd: true
    configReloaders: true
    general: true
    k8sContainerCpuUsageSecondsTotal: true
    k8sContainerMemoryCache: true
    k8sContainerMemoryRss: true
    k8sContainerMemorySwap: true
    k8sContainerResource: true
    k8sContainerMemoryWorkingSetBytes: true
    k8sPodOwner: true
    kubeApiserverAvailability: true
    kubeApiserverBurnrate: true
    kubeApiserverHistogram: true
    kubeApiserverSlos: true
    kubeControllerManager: true
    kubelet: true
    kubeProxy: true
    kubePrometheusGeneral: true
    kubePrometheusNodeRecording: true
    kubernetesApps: true
    kubernetesResources: true
    kubernetesStorage: true
    kubernetesSystem: true
    kubeSchedulerAlerting: true
    kubeSchedulerRecording: true
    kubeStateMetrics: true
    network: true
    node: true
    nodeExporterAlerting: true
    nodeExporterRecording: true
    prometheus: true
    prometheusOperator: true
    windows: true
```

**Tie this back to the book's alerting chapter.** `kube-apiserver-slos` and
`kube-apiserver-burnrate.rules` are a *worked multi-window multi-burn-rate SLO implementation* that
the reader can read as a reference for their own service. That is a genuinely valuable payoff for a
book that has spent a chapter on "alerts that don't cry wolf".

### 8.3 The other free thing: `global.rbac.createAggregateClusterRoles`

[VERIFIED verbatim from values.yaml]

```yaml
global:
  rbac:
    create: true
    ## Create ClusterRoles that extend the existing view, edit and admin ClusterRoles to interact with prometheus-operator CRDs
    ## Ref: https://kubernetes.io/docs/reference/access-authn-authz/rbac/#aggregated-clusterroles
    createAggregateClusterRoles: false
  imageRegistry: ""
  imagePullSecrets: []
```

Worth one sentence: turning this on means anyone with `edit` in a namespace can create
ServiceMonitors there. That is the "self-service monitoring" unlock and also the governance question.

---

## 9. What is genuinely harder on Kubernetes

Be honest here. This is the section that distinguishes the book from a tutorial.

### 9.1 Cardinality, because pods are ephemeral

The mechanism, stated plainly: **on a VM fleet, `instance` changes when you rebuild a machine —
maybe monthly. On Kubernetes, `pod` changes on every deploy, every restart, every autoscale event,
every node drain.** Each new pod name is a new label value, so every series for that workload is a
*new* series. Prometheus keeps a series in the head block until it has been stale for a while, and
keeps its label set in the index for the whole retention period.

Amplifiers specific to Kubernetes:

- **Deployments** create pod names like `example-app-7d9f8c6b45-x7k2p`. The ReplicaSet hash changes on
  every image change. 50 deploys/week × 20 pods = 1000 new `pod` values per week, per workload.
- **Jobs and CronJobs** are the worst offender: a CronJob running every minute creates a new pod name
  every minute, and KSM emits `kube_job_*` and `kube_pod_*` series for each, forever (until the Job
  is garbage-collected). A single `*/1 * * * *` CronJob generates ~43k pod names a month.
- **cAdvisor emits per-container series** — every container in every pod, times ~40 `container_*`
  metrics, times the label set (`namespace`, `pod`, `container`, `image`, `id`, `name`). The `id`
  label (the full cgroup path) is especially nasty.
- **KSM** emits per-object series; enabling `--metric-labels-allowlist=pods=[*]` multiplies them by
  the number of distinct Kubernetes labels, and Kubernetes labels include things like
  `pod-template-hash` — which changes on every deploy.
- **Sidecars.** Service meshes add a proxy container to every pod, often with its own high-cardinality
  metrics keyed by source/destination workload pairs — that's quadratic in service count.

Diagnosis queries the reader should learn:

```promql
# total active series in the head block — the #1 memory predictor
prometheus_tsdb_head_series

# which metric names have the most series
topk(20, count by (__name__) ({__name__=~".+"}))

# which jobs are adding the most series per scrape
topk(20, scrape_series_added)

# how many samples each target exposes
topk(20, scrape_samples_scraped)

# label-value cardinality for a suspect label
count(count by (pod) (kube_pod_info))
```

Also point at the TSDB status page in the Prometheus UI (`/tsdb-status`), which lists the top label
names by cardinality and top metric names by series count. That is faster than any query.

The defences, in order of leverage:

1. **`metricRelabelings` with `action: drop`** on the ServiceMonitor — cheapest, most surgical.
2. **`labeldrop`** the labels you never group by (e.g. `id`, `image_id`).
3. **KSM label allowlists** — never `[*]`.
4. **Limits enforced centrally** — see §9.4.
5. **Recording rules** to pre-aggregate away the pod label for dashboards that only need workload-level
   numbers. This does not reduce ingest, but it makes queries survivable.
6. **Shorter retention** does *not* reduce head-block memory; it reduces disk. Say this — it is a
   common misconception.

kube-prometheus's own cAdvisor drops, verbatim, as a model to copy [VERIFIED from
`kube-prometheus/manifests/kubernetesControlPlane-serviceMonitorKubelet.yaml`]:

```yaml
    metricRelabelings:
    - action: drop
      sourceLabels: [__name__]
      regex: container_(network_tcp_usage_total|network_udp_usage_total|tasks_state|cpu_load_average_10s)
    - action: drop
      sourceLabels: [__name__, pod, namespace]
      regex: (container_spec_.*|container_file_descriptors|container_sockets|container_threads_max|container_threads|container_start_time_seconds|container_last_seen);;
    - action: drop
      sourceLabels: [__name__, container]
      regex: (container_blkio_device_usage_total);.+
```

That second rule is worth explaining in detail — it is a beautiful teaching example. The separator is
`;`, so `regex: (…);;` matches "this metric name **and** empty `pod` **and** empty `namespace`", i.e.
it drops the machine-level rollup copies of those metrics while keeping the per-pod ones. Readers who
understand that rule understand relabeling.

The corresponding kubelet drop list (verbatim, abbreviated in the book) removes long-obsolete
`*_microseconds` summary metrics:

```yaml
    - action: drop
      sourceLabels: [__name__]
      regex: kubelet_(pod_worker_latency_microseconds|pod_start_latency_microseconds|cgroup_manager_latency_microseconds|pod_worker_start_latency_microseconds|pleg_relist_latency_microseconds|pleg_relist_interval_microseconds|runtime_operations|runtime_operations_latency_microseconds|runtime_operations_errors|eviction_stats_age_microseconds|device_plugin_registration_count|device_plugin_alloc_latency_microseconds|network_plugin_operations_latency_microseconds)
```

### 9.2 Target churn

Distinct from cardinality: even if the *series* count were stable, the *target set* is not. Every
pod create/delete is a discovery event. Symptoms and instrumentation:

- Prometheus holds watches on the API server for every role it uses. Broad discovery (watch all pods
  cluster-wide, throw 99% away with `keep` rules) puts real load on the API server and on Prometheus's
  own discovery manager. `ServiceMonitor.spec.selectorMechanism` (role selectors) and
  `kubernetes_sd_config`'s `selectors:` field push the filter server-side. Prefer that at scale.
- **`keep_dropped_targets`** (global config; `keepDroppedTargets` per-monitor,
  `enforcedKeepDroppedTargets` on the Prometheus CR) caps how many relabel-dropped targets are kept
  in memory for the UI. On a big cluster with an aggressive `keep` rule, *the dropped targets can use
  more memory than the kept ones.* The upstream example config sets `keep_dropped_targets: 100`.
  [VERIFIED]
- Useful self-metrics: `prometheus_sd_kubernetes_events_total`,
  `prometheus_target_sync_length_seconds`, `prometheus_sd_discovered_targets`,
  `prometheus_target_scrape_pool_targets`. **[UNVERIFIED — metric names asserted from practice;
  confirm against a running Prometheus 3.13 before printing.]**
- **Staleness**: when a pod disappears, its series go stale and PromQL stops returning them after
  ~5 minutes. This is *correct* but surprising: `count(up{job="x"})` dips during a rolling deploy.
  Alerts on `up == 0` must use a `for:` long enough to survive a rollout, or use
  `absent()`/`kube_deployment_status_replicas_available` instead.

### 9.3 Sharding, and the trap inside it

[VERIFIED from the operator sharding doc]

- The operator creates `spec.shards` StatefulSets, each with `spec.replicas` pods. Since v0.93.0 the
  default for `.spec.shards` is explicitly `1`.
- Distribution is **modulus hashing**: `__address__` for ServiceMonitor/PodMonitor,
  `__param_target__` for Probe.
- You can override the hash input:
  ```yaml
  endpoints:
  - port: web
    relabelings:
    - sourceLabels: [__meta_kubernetes_pod_namespace, __meta_kubernetes_pod_name]
      separator: /
      targetLabel: __tmp_hash
  ```
- **You can exclude a target from sharding entirely** — essential for singletons like KSM:
  ```yaml
  endpoints:
  - port: http
    relabelings:
    - targetLabel: __tmp_disable_sharding
      replacement: "true"
  ```
  **This is the trap.** If you shard Prometheus and forget this, KSM gets hashed to exactly one shard,
  and every dashboard/rule that joins cAdvisor data (spread across all shards) with KSM data (on one
  shard) silently returns partial results. Nothing errors. Say this explicitly.
- **Topology sharding** (Beta, on by default since v0.92.0):
  ```yaml
  spec:
    shards: 4
    shardingStrategy:
      mode: Topology
      topology:
        values:
          - europe-west4-a
          - europe-west4-b
  ```
  Pins shards to zones and distributes targets within a zone, minimising cross-zone traffic cost. The
  operator adds node selectors and external labels automatically.
- **Shard retention policy** (Beta, on by default since v0.92.0):
  ```yaml
  spec:
    shards: 2
    shardRetentionPolicy:
      whenScaled: Retain
      retain:
        retentionPeriod: 7d
  ```
  Without this, scaling shards down throws away the scaled-down shard's data.
- Sharding does **not** give you a global query view. You need Thanos Query (or similar) in front.
  The chart README says the same about HA replicas: don't strip the replica label, use Thanos Query
  for dedup. [VERIFIED]

### 9.4 Resource limits on Prometheus itself

The reader's docker-compose Prometheus had the whole machine. In Kubernetes it has a `limits.memory`,
and exceeding it means **OOMKilled**, which means **WAL replay on restart**, which on a large TSDB
takes minutes and can loop forever if the limit is genuinely too small. This is the single most
common way a Kubernetes Prometheus dies.

What to teach:

- Memory is driven overwhelmingly by **active series in the head block**
  (`prometheus_tsdb_head_series`), plus query workload. Common rules of thumb range from
  **~3 KB to ~7.5 KiB of RSS per active series**, and `process_resident_memory_bytes` can be ~2× the
  naive head-block estimate once the Go heap, mmapped chunks and in-flight queries are counted.
  **[UNVERIFIED — these figures come from secondary blog sources, not a primary Prometheus doc. Print
  them as "rules of thumb people use", never as a specification, and pair them with "measure your own
  cluster".]** The methodologically safe advice is: measure `prometheus_tsdb_head_series` and
  `process_resident_memory_bytes` on your own cluster and derive your own per-series constant.
- **Set requests ≈ limits for Prometheus.** It is a stateful, memory-heavy singleton; bursty
  overcommit is how you get evicted.
- **Give the query path its own headroom.** A single unbounded `{__name__=~".+"}` from a dashboard can
  double RSS. `--query.max-samples` (default 50,000,000) and `--query.timeout` exist for this;
  in the chart they surface as `prometheus.prometheusSpec.query.*`.
  **[UNVERIFIED: the exact values-key path — verify with `helm show values`.]**
- **Storage.** The operator does *not* use a default PVC; without `spec.storage` you get an
  `emptyDir` and lose all data on pod restart. That is a genuinely nasty default for a beginner.
  Verbatim example [VERIFIED, operator storage doc]:

  ```yaml
  apiVersion: monitoring.coreos.com/v1
  kind: Prometheus
  metadata:
    name: persisted
  spec:
    storage:
      volumeClaimTemplate:
        spec:
          storageClassName: ssd
          resources:
            requests:
              storage: 40Gi
  ```

  The docs recommend "volumes that have high I/O throughput" (SSD-class).
- **Resizing that volume is painful.** Kubernetes does not support volume expansion through
  StatefulSets, so the documented procedure is [VERIFIED, operator storage doc]:
  1. `spec.paused: true`
  2. update `spec.storage`
  3. patch each PVC with the new size
  4. delete the StatefulSet with the **`orphan`** deletion strategy
  5. `spec.paused: false`

  Show this. It is exactly the kind of operational reality a textbook usually omits.
- **Retention** moved from CLI flags to the config file for the Prometheus CRD in operator v0.92.0.
  The CRD-level default when both `spec.retention` and `spec.retentionSize` are empty is **`24h`**
  [VERIFIED from the API reference]. The chart sets its own non-empty default — the template renders
  `retention: {{ .Values.prometheus.prometheusSpec.retention | quote }}` unconditionally, so a value
  is always present. **[UNVERIFIED: what that chart default is. Check with
  `helm show values prometheus-community/kube-prometheus-stack --version 87.21.0 | grep -A2 '  retention'`
  before printing a number. Commonly cited as `10d`, but do not print that unverified.]**
- Likewise **UNVERIFIED**: the chart's default `prometheus.prometheusSpec.scrapeInterval` /
  `evaluationInterval`. The template guards both with `{{- if … }}`, which means the chart default is
  **empty** and the *operator's* default applies. The operator's documented default `scrapeInterval`
  is **`30s`** [VERIFIED, API reference]; `replicas` defaults to `1`; `portName` defaults to `"web"`.
  Safe sentence for the book: "the chart leaves `scrapeInterval` unset, so you get the operator's
  default of 30s unless you set it."

### 9.5 Control-plane targets that are down on day one

On any **managed** cluster (EKS, GKE, AKS) the control plane is not yours. `kubeEtcd`,
`kubeControllerManager`, `kubeScheduler` (and often `kubeProxy`) will show as **down**, and the
shipped alerts `KubeControllerManagerDown` / `KubeSchedulerDown` / `etcd*` will fire immediately.
Every single person who installs this chart on EKS hits this. [VERIFIED — this is the content of
helm-charts#1966, #3368, kube-prometheus#713/#717/#718 and is standard guidance.]

The fix:

```yaml
kubeEtcd:
  enabled: false
kubeControllerManager:
  enabled: false
kubeScheduler:
  enabled: false
kubeProxy:
  enabled: false     # on EKS with the VPC CNI / on GKE Dataplane V2
```

On self-managed / kubeadm clusters the components *are* there but bind to `127.0.0.1` by default;
you must change `--bind-address=0.0.0.0` on the static pods, and scrape over HTTPS on
**10257** (controller-manager, k8s ≥ 1.22) and **10259** (scheduler, k8s ≥ 1.23), typically with
`insecureSkipVerify: true` because the certs are for `localhost`. [VERIFIED via community issues;
**flag the port numbers for a live re-check** before printing.]

This is a good place for the book's honesty point: **"the default install fires alerts that are not
your fault, and the first job of an on-call-friendly setup is to silence or disable the ones that
can never be actioned."** That ties straight back to the "alerts that don't cry wolf" chapter.

### 9.6 Other honest difficulties worth one paragraph each

- **You now have two alerting systems.** Grafana has its own unified alerting; the operator has
  `PrometheusRule` + Alertmanager. The chart's Grafana datasource block has
  `handleGrafanaManagedAlerts: false` by default [VERIFIED]. Pick one; explain that mixing them is
  how organisations end up with two on-call rotations that disagree.
- **Multi-tenancy is a selector problem, not a security boundary.** Anyone who can create a
  `ServiceMonitor` in a watched namespace can make your Prometheus scrape an arbitrary address and
  can inject labels. `enforced*` limits (§9.7) and `--namespaces` scoping are the mitigations.
- **Debugging is indirect.** Your config is generated. Your rules are in ConfigMaps. Your targets come
  from four chained selectors. Nothing tells you "this ServiceMonitor matched nothing." Budget a
  whole section for §12.
- **Upgrades are two-step**: chart upgrade *and* CRD upgrade, and the CRD step is manual (§2.2).

### 9.7 The limits that stop one team taking down monitoring for everyone

[VERIFIED — exact field names from the API reference]

| On `Prometheus.spec` (cluster-admin enforces) | On `ServiceMonitor`/`PodMonitor`/`Probe` (team sets) |
|---|---|
| `enforcedSampleLimit` | `sampleLimit` |
| `enforcedTargetLimit` | `targetLimit` |
| `enforcedLabelLimit` | `labelLimit` |
| `enforcedLabelNameLengthLimit` | `labelNameLengthLimit` |
| `enforcedLabelValueLengthLimit` | `labelValueLengthLimit` |
| `enforcedKeepDroppedTargets` | `keepDroppedTargets` |
| `enforcedBodySizeLimit` | `bodySizeLimit` |

Descriptions, quoted from the API reference: `enforcedSampleLimit` "defines a global limit on the
number of scraped samples that will be accepted"; `enforcedBodySizeLimit` "defines a global limit on
the size of uncompressed response body that will be accepted by Prometheus".

This table is a strong ending for the "what's harder" section, because it turns an abstract worry
(cardinality) into a concrete governance control.

---

## 10. Prometheus Agent mode — worth 3 paragraphs, not more

`PrometheusAgent` (`monitoring.coreos.com/v1alpha1`) runs Prometheus in agent mode: it discovers,
scrapes and `remote_write`s, with no local TSDB, no query API, no rules. It is the right answer when
the cluster is a *collector* and the storage/query layer lives elsewhere (Thanos Receive, Mimir,
Cortex, a vendor). It supports `spec.mode: DaemonSet` (behind the `PrometheusAgentDaemonSet` feature
gate), where each agent scrapes only the pods on its own node — which eliminates cross-node scrape
traffic and makes target sharding trivially node-local.

The chart supports it via `prometheus.agentMode` — the template guards `retention`,
`evaluationInterval` etc. with `{{- if not .Values.prometheus.agentMode }}` [VERIFIED from the
template source].

For this book, one page maximum. The reader's mental model — "Prometheus scrapes and stores" — is
correct for 95% of first jobs; agent mode is a fork in the road, not the main road.

---

## 11. Alternatives worth naming (so the reader isn't blindsided)

- **`kube-prometheus`** (jsonnet) — the upstream from which the Helm chart's dashboards and rules
  descend. Deploys operator + HA Prometheus/Alertmanager + node-exporter + blackbox-exporter +
  **prometheus-adapter** (Metrics API from Prometheus, for HPA on custom metrics) + KSM + Grafana.
  Compatibility: `release-0.18` covers k8s 1.33–1.36. [VERIFIED]
- **`kubernetes-mixin`** — the jsonnet library of dashboards + alerts that both of the above consume.
- **Grafana `k8s-monitoring` Helm chart** — Grafana's own stack, built on **Grafana Alloy** and the
  Alloy Operator rather than the Prometheus Operator. **v4 shipped April 2026** and was described by
  Grafana as the most significant update since the chart's introduction; it replaces hard-coded
  collector names with a map of named collectors that get "presets" (clustered / statefulset /
  daemonset). Worth one paragraph as "the other mainstream way", especially for readers heading to
  Grafana Cloud. [VERIFIED]
- **OpenTelemetry Collector** with the Prometheus receiver + target allocator — mention in one line;
  do not teach it here.
- **VictoriaMetrics Operator** — an API-compatible-ish alternative with `VMServiceScrape`/`VMRule`.
  One line. Naming it prevents the reader being confused when they meet `VMAgent` at work.

---

## 12. Debugging recipes for the chapter

### 12.1 "My ServiceMonitor produces no targets" — the checklist

Run in order. [Sources: operator troubleshooting doc, VERIFIED commands]

1. Does the Prometheus CR select the ServiceMonitor?
   ```console
   kubectl -n monitoring get prometheus -o yaml | grep -A5 serviceMonitorSelector
   kubectl get servicemonitor -A --show-labels
   ```
   → 90% of the time the `release: <name>` label is missing (§5.1).
2. Is the ServiceMonitor in the generated config at all?
   ```console
   kubectl -n monitoring get secret <prometheus-secret> -ojson \
     | jq -r '.data["prometheus.yaml.gz"]' | base64 -d | gunzip | grep "my-service-monitor"
   ```
   → present in the config but absent from **Service Discovery** in the UI means **no Service matches
   `spec.selector`**. [VERIFIED as the documented interpretation.]
3. Does a Service actually carry the label?
   ```console
   kubectl get services -A -l "label-key=label-value"
   ```
4. Is the port **named**, and is the name spelled identically in Service and ServiceMonitor?
   A numeric `port:` gives `spec.endpoints.port in body must be of type string: integer`.
5. Does the Service have endpoints (i.e. are the pods Ready)?
   ```console
   kubectl -n demo get endpointslices -l kubernetes.io/service-name=example-app
   ```
6. Did the operator reject something?
   ```console
   kubectl get events --field-selector=involvedObject.name="example-app" -n demo
   kubectl -n monitoring logs deploy/kps-kube-prometheus-stack-operator
   ```
7. Look at the Prometheus UI's **Service Discovery** page (not just Targets) — it shows discovered
   targets *before* relabeling, with all their `__meta_*` labels, and why each was dropped:
   ```console
   kubectl -n monitoring port-forward svc/prometheus-operated 9090:9090
   ```
   Then open `/service-discovery` and `/targets?search=&scrapePool=…`.

### 12.2 Reading dropped targets

With `keep_dropped_targets` (or `keepDroppedTargets`) > 0, the `/service-discovery` page keeps a
bounded sample of relabel-dropped targets so you can see exactly which `keep` rule rejected them.
Teach the reader to set it to a small number (e.g. 10–100) rather than leaving it at 0 (unbounded
retention of *every* dropped target, which is the memory hazard) — the upstream example uses `100`
and explains it as "to keep details of relabeled targets in the UI for troubleshooting". [VERIFIED
that the upstream example sets `keep_dropped_targets: 100` for that stated reason.]

### 12.3 Is monitoring itself healthy?

The `prometheus` and `prometheus-operator` dashboards + `defaultRules.rules.prometheus` /
`prometheusOperator` exist for exactly this. Key symptoms:
`PrometheusRuleFailures`, `PrometheusErrorSendingAlertsToSomeAlertmanagers`,
`PrometheusTargetSyncFailure`, `PrometheusOperatorRejectedResources` (this last one is the one that
tells you a ServiceMonitor was thrown away). **[UNVERIFIED — alert names asserted from the rule-file
names; verify each against the shipped rules before printing them.]**

---

## 13. Lab suggestion for the chapter

Keep the book's docker-compose service; run it on a throwaway local cluster.

```console
kind create cluster --name obs --config kind-config.yaml
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update
helm install kps prometheus-community/kube-prometheus-stack \
  --version 87.21.0 -n monitoring --create-namespace \
  -f values-lab.yaml
kubectl -n monitoring port-forward svc/kps-grafana 3000:80
```

`values-lab.yaml` should contain, at minimum:

```yaml
# Control-plane bits kind does expose, but keep the lab honest about managed clusters:
kubeEtcd:
  enabled: false
kubeControllerManager:
  enabled: false
kubeScheduler:
  enabled: false
kubeProxy:
  enabled: false

grafana:
  adminPassword: admin           # lab only. Say so.

prometheus:
  prometheusSpec:
    retention: 6h                # a laptop is not a production cluster
    resources:
      requests: { cpu: 200m, memory: 512Mi }
      limits:   { memory: 1Gi }
    # Deliberately leave the selectors at their defaults so the chapter can TEACH
    # the `release: kps` label rule rather than papering over it.
```

Notes:
- `kind` is the right choice over minikube here: multi-node with one flag, and image loading is
  `kind load docker-image`, which keeps the lab offline-friendly.
- Do **not** use `--set` for anything the reader will need to change twice; a values file is the
  lesson.
- Show `kubectl -n monitoring get prometheus,alertmanager,servicemonitor,prometheusrule` early — the
  "these are just objects" moment.

---

## 14. Beginner pitfalls — the consolidated list

1. **Missing `release: <helm-release>` label** on ServiceMonitor / PrometheusRule / PodMonitor /
   ScrapeConfig. Silent zero targets, silent missing rules. #1 by a mile.
2. **`port:` as a number** instead of the Service port's **name** (a string).
3. **Naming the container port instead of the Service port** in a ServiceMonitor (or vice-versa for a
   PodMonitor).
4. **`endpoints:` on a PodMonitor** — it is `podMetricsEndpoints:`.
5. **snake_case copied from `prometheus.yml`** into a CRD — `relabel_configs` vs `relabelings`,
   `source_labels` vs `sourceLabels`, `group_by` vs `groupBy`.
6. **`relabelings` at `spec:` level** instead of inside an endpoint. Several 2026-dated blog posts
   show this incorrectly.
7. **`kubectl apply -f` on the CRDs** → `metadata.annotations: Too long: must have at most 262144
   bytes`. Use `--server-side --force-conflicts`.
8. **Assuming `helm upgrade` upgrades CRDs.** It does not.
9. **Expecting the control plane to be scrapeable on EKS/GKE/AKS.** Disable `kubeEtcd`,
   `kubeControllerManager`, `kubeScheduler`, often `kubeProxy`.
10. **No `spec.storage`** → `emptyDir` → all history lost on every pod restart.
11. **Confusing metrics-server with Prometheus.** metrics-server serves the Metrics API for HPA and
    `kubectl top`; it is not a Prometheus exporter and stores only the latest value.
12. **Thinking kube-state-metrics reports usage.** It reports declared requests/limits and object
    state. Usage is cAdvisor.
13. **Trying to install cAdvisor.** It is in the kubelet.
14. **Using `role: service` to scrape an app.** You hit the Service VIP and get one random backend
    per scrape, with no stable `instance`. Use `endpoints`/`endpointslice`.
15. **Mixing up `__meta_kubernetes_endpoint_*` (endpoints role) with
    `__meta_kubernetes_endpointslice_*`.** Relabeling rules do not port between roles.
16. **Forgetting `discovery.k8s.io/endpointslices` RBAC** when switching
    `serviceDiscoveryRole: EndpointSlice`. Symptom: targets vanish entirely
    (see helm-charts#4864).
17. **Sharding Prometheus without `__tmp_disable_sharding` on kube-state-metrics.** Silent partial
    data in every joined dashboard.
18. **Alerting on `up == 0` with a short `for:`** — normal rolling deploys will page you.
19. **Setting `--metric-labels-allowlist=pods=[*]`** on KSM. `pod-template-hash` alone will hurt you.
20. **Assuming a shorter `retention` fixes OOMs.** Head-block memory is driven by *active series*, not
    retention.
21. **Grafana's own alerting silently competing with Alertmanager.** Pick one.
22. **Deleting the CRDs to "clean up"** — takes every ServiceMonitor and PrometheusRule in the cluster
    with it.

---

## 15. Stale advice to avoid (things older books and blogs still say)

1. **"Add the Grafana chart from `https://grafana.github.io/helm-charts`."** Moved to
   `https://grafana-community.github.io/helm-charts` on **2026-01-30**. Old signing key won't verify
   new releases and vice-versa.
2. **"Prometheus 2.x."** Prometheus 3 has been out since late 2024; current is **3.13.1**, LTS
   **3.5.5**. Any `prom/prometheus:v2.x` pin, and any advice framed around 2.x defaults, is stale.
3. **"Use the `endpoints` role."** The Kubernetes **`Endpoints` API is deprecated as of v1.33**;
   prefer `endpointslice`, and on ServiceMonitors set `spec.serviceDiscoveryRole: EndpointSlice`
   (plus the `discovery.k8s.io` RBAC). kube-prometheus `release-0.16` moved to dual mode with removal
   of Endpoints planned.
4. **"`prometheus.io/scrape` is the standard Prometheus annotation."** It is a *community convention*.
   The current upstream example config contains no `prometheus_io` string at all — it uses
   `example.io/*` placeholders, commented out. Present the convention as a convention.
5. **"`bearer_token_file:`"** — still accepted, but the modern spelling is
   `authorization: { credentials_file: … }`, which is what the current upstream example uses.
6. **"The Thanos sidecar requires you to disable local Prometheus compaction."** Reversed in operator
   **v0.93.0**: compaction is now *kept enabled* for Prometheus ≥ v3.9.0 with Thanos ≥ v0.41.0.
7. **"Retention is set via the `--storage.tsdb.retention.time` flag."** For the Prometheus CRD the
   operator **migrated retention options from CLI flags to the config file in v0.92.0**.
8. **"`AlertmanagerConfig` is `v1alpha1`."** Half true — `v1beta1` is also served, with conversion
   webhooks. Don't state `v1alpha1` as the only version. (But equally: don't claim `v1beta1` is the
   storage version — that is unresolved, see §4.)
9. **"`ScrapeConfig` is beta / v1."** It is still **`v1alpha1`**. Graduation is proposed, not done.
10. **"`kubectl apply -f bundle.yaml` to install the operator."** Fails on CRD size. Server-side apply.
11. **"Native histograms are experimental / behind `--enable-feature=native-histograms`."** As of
    Prometheus 3.9 native histograms are no longer experimental and the feature flag is a no-op; but
    scraping them is still opt-in (`scrape_native_histograms`). The operator exposes
    `scrapeNativeHistograms` on the monitoring CRDs (v0.88.0). *(Cross-check with the
    `prometheus-core` dossier and `_CONFLICTS.md` C4 before writing this paragraph — it is contested.)*
12. **"Install `metrics-server` so Prometheus can see pod CPU."** Wrong pipeline entirely.
13. **"kube-prometheus-stack installs Prometheus 2.x / Grafana 9."** Current chart 87.21.0 pairs with
    operator v0.92.1 and Grafana **13.1.1**.
14. **"You need Kubernetes ≥ 1.16."** That's the *operator's* floor. The chart requires **≥ 1.25**.
15. **"Use `container!="POD"` to exclude the pause container."** Runtime-dependent and largely
    superseded by `container!=""` / `image!=""`; verify against the cluster rather than repeating it.
16. **"The `prometheus-adapter` is how you get HPA metrics."** Still true for *custom* metrics, but
    the resource-metrics path (`kubectl top`, basic HPA) is metrics-server. Don't conflate.
17. **Screenshots and step counts from any pre-2026 Grafana.** Grafana 13 (April 2026) changed the
    dashboard editing experience substantially (dynamic dashboards GA, new query sidebar).

---

## 16. Sources

Primary sources fetched 2026-07-27 / 2026-07-28.

**Prometheus Operator**
- https://github.com/prometheus-operator/prometheus-operator — README, CRD list, k8s floor
- https://github.com/prometheus-operator/prometheus-operator/releases — release list & dates
- https://github.com/prometheus-operator/prometheus-operator/releases/tag/v0.93.0
- https://raw.githubusercontent.com/prometheus-operator/prometheus-operator/main/CHANGELOG.md
- https://raw.githubusercontent.com/prometheus-operator/prometheus-operator/main/pkg/operator/defaults.go
- https://prometheus-operator.dev/docs/getting-started/introduction/
- https://prometheus-operator.dev/docs/developer/getting-started/ — ServiceMonitor/Service/Prometheus examples
- https://prometheus-operator.dev/docs/developer/alerting/ — PrometheusRule, ruleSelector, AlertmanagerConfig
- https://prometheus-operator.dev/docs/developer/scrapeconfig/ — ScrapeConfig examples, SD tiers
- https://prometheus-operator.dev/docs/api-reference/api/ — CRD fields, enforced* limits, ScrapeClass, defaults
- https://prometheus-operator.dev/docs/platform/troubleshooting/ — debugging recipes, exact commands
- https://prometheus-operator.dev/docs/platform/rbac/ — Prometheus + operator ClusterRoles
- https://prometheus-operator.dev/docs/platform/storage/ — volumeClaimTemplate, resize procedure
- https://prometheus-operator.dev/docs/platform/sharding/ — shards, `__tmp_hash`, `__tmp_disable_sharding`, topology
- https://prometheus-operator.dev/docs/platform/operator/ — CLI flag reference
- https://prometheus-operator.dev/docs/proposals/accepted/scrapeconfig-graduation/
- https://prometheus-operator.dev/docs/proposals/accepted/remote-write/
- https://prometheus-operator.dev/kube-prometheus/kube/blackbox-exporter/ — Probe example
- https://pkg.go.dev/github.com/prometheus-operator/prometheus-operator/pkg/apis/monitoring/v1alpha1
- https://pkg.go.dev/github.com/prometheus-operator/prometheus-operator/pkg/apis/monitoring/v1beta1
- https://github.com/prometheus-operator/prometheus-operator/tree/main/example/prometheus-operator-crd

**kube-prometheus-stack Helm chart**
- https://raw.githubusercontent.com/prometheus-community/helm-charts/main/charts/kube-prometheus-stack/Chart.yaml
- https://raw.githubusercontent.com/prometheus-community/helm-charts/main/charts/kube-prometheus-stack/README.md
- https://raw.githubusercontent.com/prometheus-community/helm-charts/main/charts/kube-prometheus-stack/UPGRADE.md
- https://raw.githubusercontent.com/prometheus-community/helm-charts/main/charts/kube-prometheus-stack/values.yaml (partial — file truncates before `prometheusSpec`)
- https://raw.githubusercontent.com/prometheus-community/helm-charts/main/charts/kube-prometheus-stack/templates/prometheus/prometheus.yaml
- https://raw.githubusercontent.com/prometheus-community/helm-charts/main/charts/kube-prometheus-stack/templates/exporters/kubelet/servicemonitor.yaml
- https://github.com/prometheus-community/helm-charts/tree/main/charts/kube-prometheus-stack/templates/grafana/dashboards-1.14
- https://github.com/prometheus-community/helm-charts/tree/main/charts/kube-prometheus-stack/templates/prometheus/rules-1.14
- https://github.com/prometheus-community/helm-charts/tree/main/charts/kube-prometheus-stack/charts/crds/crds
- https://artifacthub.io/api/v1/packages/helm/prometheus-community/kube-prometheus-stack
- https://artifacthub.io/api/v1/packages/helm/prometheus-community/kube-state-metrics
- https://artifacthub.io/api/v1/packages/helm/prometheus-community/prometheus-node-exporter
- https://artifacthub.io/api/v1/packages/helm/grafana-community/grafana

**kube-prometheus (jsonnet)**
- https://github.com/prometheus-operator/kube-prometheus — components, k8s compatibility matrix
- https://raw.githubusercontent.com/prometheus-operator/kube-prometheus/main/manifests/kubernetesControlPlane-serviceMonitorKubelet.yaml
- https://raw.githubusercontent.com/prometheus-operator/kube-prometheus/main/manifests/prometheus-clusterRole.yaml

**Prometheus core**
- https://prometheus.io/download/ — 3.13.1 stable, 3.5.5 LTS, alertmanager 0.33.1, node_exporter 1.12.1, blackbox 0.28.0
- https://raw.githubusercontent.com/prometheus/prometheus/main/documentation/examples/prometheus-kubernetes.yml
- https://raw.githubusercontent.com/prometheus/prometheus/main/documentation/examples/rbac-setup.yml
- https://prometheus.io/docs/prometheus/latest/configuration/configuration/ (kubernetes_sd_config section unreachable — see §6.2 caveat)

**Kubernetes / exporters**
- https://kubernetes.io/docs/tasks/debug/debug-cluster/resource-metrics-pipeline/
- https://kubernetes.io/docs/concepts/cluster-administration/system-metrics/ — kubelet endpoints, PSI metrics stable in 1.36
- https://kubernetes.io/blog/2025/04/24/endpoints-deprecation/ — Endpoints deprecated in v1.33
- https://kubernetes.io/releases/1.36/ and https://kubernetes.io/blog/2026/04/22/kubernetes-v1-36-release/
- https://github.com/kubernetes/kube-state-metrics — KSM vs metrics-server, compatibility
- https://github.com/kubernetes/kube-state-metrics/blob/main/docs/README.md — resource list
- https://github.com/kubernetes-sigs/metrics-server — v0.8.1

**Grafana**
- https://grafana-community.github.io/helm-charts/ and https://github.com/grafana-community/helm-charts
- https://github.com/grafana/helm-charts/issues/4087 — migration announcement
- https://github.com/prometheus-community/helm-charts/issues/6580 — chart-side migration issue
- https://grafana.com/blog/grafana-13-release-all-the-latest-features/
- https://grafana.com/docs/grafana/latest/whatsnew/whats-new-in-v13-1/
- https://grafana.com/docs/alloy/latest/reference/components/discovery/discovery.kubernetes/ — `__meta_kubernetes_*` label lists
- https://github.com/grafana/k8s-monitoring-helm — the Alloy-based alternative
- https://www.infoq.com/news/2026/05/kubernetes-monitoring-helm/ — v4 (April 2026)

**Community issues cited for pitfalls (secondary, but authoritative as evidence the problem is real)**
- prometheus-operator#4355, #5104, #6751 — CRD annotation size
- prometheus-community/helm-charts#1500 — CRD upgrade failure
- prometheus-community/helm-charts#1966, #3368 — control-plane targets down
- prometheus-community/helm-charts#4864 — empty targets with `serviceDiscoveryRole: EndpointSlice`
- prometheus-operator#6672 — ServiceDiscoveryRole PR
- prometheus-operator#8285 — Probe: HTTPRoute/IngressRoute not supported

---

## 17. Explicit UNVERIFIED list (quarantine — do not print as fact)

1. `kube-prometheus-stack` chart defaults for `prometheus.prometheusSpec.retention`,
   `scrapeInterval`, `evaluationInterval`, `image.tag`, `resources`. The values.yaml is too large for
   my fetch tool to reach the `prometheusSpec` block. **Verify with**
   `helm show values prometheus-community/kube-prometheus-stack --version 87.21.0`.
   *(Note: an early fetch returned `tag: v2.47.1` for the Prometheus image — that answer came from a
   truncated read and is almost certainly fabricated. Do not use it.)*
2. Current version of the standalone `prometheus-operator-crds` chart (search showed both 17.0.0 and
   30.0.1).
3. The full Prometheus Operator feature-gate table (name / stage / default / since). Only the gate
   *names* are verified.
4. Which API version is the **stored** version for `AlertmanagerConfig`.
5. The exact matcher the operator injects to namespace-scope an `AlertmanagerConfig`.
6. A canonical `Probe.spec.targets.ingress` example.
7. The `kubernetes_sd_config` role/meta-label lists as published on **prometheus.io** specifically
   (verified via Grafana Alloy's equivalent reference instead — same discovery implementation, but
   confirm before printing).
8. The exact `relabel_configs` for the annotation-driven `prometheus.io/*` boilerplate (§6.4) and for
   the cAdvisor-via-API-server-proxy variant. Regexes marked verbatim are verified; the surrounding
   rules are reconstructed.
9. Prometheus memory-per-active-series figures (~3 KB … ~7.5 KiB). Secondary sources only.
10. Prometheus self-metric names for discovery churn
    (`prometheus_sd_kubernetes_events_total`, `prometheus_target_sync_length_seconds`,
    `prometheus_sd_discovered_targets`).
11. Shipped alert names in §12.3 (`PrometheusOperatorRejectedResources` etc.).
12. `container!=""` vs `container!="POD"` — which idiom is correct on current runtimes.
13. Control-plane HTTPS ports 10257 / 10259 (community-sourced, plausible, unverified against docs).
14. Grafana Secret/Service names in the lab snippet (`kps-grafana`, port 80).
15. The chart's values path for query limits (`prometheus.prometheusSpec.query.*`).
