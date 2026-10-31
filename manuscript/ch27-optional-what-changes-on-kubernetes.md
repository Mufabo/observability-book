# Chapter 27 — Optional: What Changes on Kubernetes

**This chapter is optional.** Nothing later depends on it, nothing earlier is
incomplete without it, and it runs on a throwaway cluster that never touches
`compose.yaml`. Skip it with a clear conscience if Kubernetes is not in your
near future, and come back on the morning somebody tells you it is.

That morning is what this chapter is for. Somebody says the word "migration" in
a planning meeting, and a quiet fear arrives with it: that the last twenty-six
chapters were about a toy, and that you are back at the beginning. Search the
web for confirmation and you will find it — a wall of unfamiliar nouns.
Operators. ServiceMonitors. CRDs. kube-state-metrics. A Helm chart with two
thousand lines of values. None of it looks like the `prometheus.yml` you now
know by heart.

The fear is misplaced, and the way to prove it is arithmetic rather than
reassurance. Count what actually changes. The answer is **four things**, and at
the end of this chapter you will import the RED dashboard you built in
Chapter 13, "Dashboard Mechanics: Intervals, Panels and Variables", into a
Grafana running inside a Kubernetes cluster, without editing one character of
it, and watch it work. Not because the dashboard was written to be portable,
but because none of its queries was ever about Docker in the first place.

!!! objectives "Objectives"
    After this chapter you can:

    - Name the four things that change on Kubernetes and the six that do not.
    - Read a `kubernetes_sd_config` by hand and say why `role: service` is the
      wrong role for scraping an application.
    - Write a `ServiceMonitor` that is actually discovered, including the one
      label almost everybody forgets.
    - Debug a `ServiceMonitor` that produces zero targets and no error message,
      by decoding the configuration the operator generated.
    - Distinguish cAdvisor, kube-state-metrics and metrics-server by the
      question each one answers.
    - Explain why a default `kube-prometheus-stack` install pages you on day one
      about things you are not allowed to fix.

## Six things that do not change

Start here: it is the load-bearing claim, and the rest is detail hanging off it.

**PromQL does not change.** `rate()` still extrapolates over a range vector,
`sum by` still drops the labels you did not name, `histogram_quantile` still
interpolates inside a bucket. There is no Kubernetes dialect.

**The data model does not change.** A series is still a metric name plus a set
of labels. A counter still only resets to zero. `le` is still a string label
whose values normalize to float form.

**Instrumentation does not change.** Snip's `main.go` is byte-identical in the
cluster. The same `client_golang` registry, the same `snip_http_requests_total`,
the same `/metrics` handler on port 8000. The image in the cluster is the image
`docker compose build` produced.

**Dashboards do not change.** You will prove this at the end of the chapter.

**Alerting logic does not change.** `for:` is still a debounce, annotations
still template `{{ $labels.route }}` and `{{ $value | humanizePercentage }}`,
Alertmanager still groups and inhibits exactly as Chapter 17, "Alertmanager:
Routing, Grouping and Silence", described.

**SLOs do not change.** The burn-rate arithmetic from Chapter 21, "Burn Rates:
Alerts That Don't Cry Wolf", is arithmetic. `14.4` is still `0.02 × 720 / 1`
whatever the platform.

And four things that do:

1. **Targets stop being a list you write and become a query against the cluster
   API.** `static_configs` and `docker_sd_configs` give way to
   `kubernetes_sd_config`, which hands you twenty-odd `__meta_*` labels per
   target and expects you to decide which ones become real. The relabeling from
   Chapter 12, "`prometheus.yml` in Full: Service Discovery and Relabeling",
   stops being an optional refinement and becomes the thing that makes discovery
   usable at all.
2. **Configuration stops being a file you edit and becomes objects you
   `kubectl apply`.** A controller called the Prometheus Operator watches those
   objects and compiles them into a `prometheus.yaml` you never see — it lives
   in a gzipped Kubernetes Secret. Learning to read that Secret is the single
   highest-leverage debugging skill on the platform.
3. **You inherit a large amount of telemetry you did not ask for.**
   Thirty-five dashboards and forty-one files of alerting and recording rules
   arrive with one `helm install`, describing layers of a platform you have
   never operated.
4. **The edges get materially harder.** Pods are ephemeral, so cardinality and
   target churn are structural rather than accidental, and Prometheus now runs
   inside a memory limit that kills it when you get sizing wrong.

Four changes, six constants. The rest is mechanics.

## Where the parallel lab is

This lab is deliberately separate: its own cluster, its own Prometheus, its own
Grafana, all of it deleted by one command. Your Compose stack is untouched
throughout — leave it running or stop it, nothing here cares.

You need three tools the rest of the book did not: `kind` (which runs a
Kubernetes cluster inside Docker containers), `kubectl` and `helm`. You also
need the internet for one `helm install` — the one place in the whole lab where
`make pull` does not already have everything.

```bash
cd lab
git checkout ch27
make k8s-up
```

The `ch27` tag carries the finished `k8s/` manifests and the `k8s-up` target.
That target is worth reading rather than trusting, because every step in it is
something this chapter explains. Here it is out of `lab/Makefile`, make
variables and all:

```text
kind create cluster --name $(KIND_CLUSTER) \
  --config k8s/kind-cluster.yaml
$(COMPOSE) build snip-api
kind load docker-image $(SNIP_IMAGE) --name $(KIND_CLUSTER)
helm repo add prometheus-community \
  https://prometheus-community.github.io/helm-charts
helm repo update prometheus-community
helm upgrade --install kps \
  prometheus-community/kube-prometheus-stack \
  --version $(KPS_CHART_VERSION) \
  --namespace monitoring --create-namespace \
  --values k8s/values-kps.yaml --wait
kubectl apply \
  -f k8s/snip-deployment.yaml \
  -f k8s/snip-service.yaml \
  -f k8s/snip-servicemonitor.yaml \
  -f k8s/snip-prometheusrule.yaml
```

Four variables carry the whole configuration of the parallel lab:
`$(COMPOSE)` is `docker compose`, `$(KIND_CLUSTER)` is `obslab`,
`$(SNIP_IMAGE)` is `obslab-snip-api` and `$(KPS_CHART_VERSION)` is `87.21.0`.
The Helm release is named `kps`, and that name is not cosmetic — it is about to
become part of a label selector that decides whether anything you write is seen
at all.

`kind-cluster.yaml` asks for two nodes, one control-plane and one worker,
because a single-node cluster makes every question about *which node is this
running on* uninteresting. `kind load docker-image` copies the image you built
locally into the cluster's own image store, which is why
`k8s/snip-deployment.yaml` carries `imagePullPolicy: IfNotPresent` and the one
image reference in the lab that is not a pinned upstream tag.

One line in that recipe has a stale twin you will meet in older material. The
`prometheus-community` repository, where `kube-prometheus-stack` itself lives,
has not moved. The **Grafana sub-chart** the stack pulls in did: on 2026-01-30
the Grafana charts moved to `https://grafana-community.github.io/helm-charts`,
and releases published before that date were signed with a different key, so
provenance checks across the boundary fail in both directions. The recipe never
names that repository, because the stack chart declares its own dependencies —
but a colleague's notes written before 2026 probably do.

The Makefile then creates a ConfigMap from `postgres/initdb/01-schema.sql` and
waits for the rollout. Snip dials Postgres and Valkey before it binds its HTTP
listener, so both come along in cut-down form, and the order shows in the
output: the manifests go first, so the Postgres pod waits in `ContainerCreating`
with a `FailedMount` event until the ConfigMap it mounts exists. `snip-api`
meanwhile retries its database connection for sixty seconds and exits if
Postgres never arrives, so those pods may restart once before settling.
`make k8s-up` ends with `kubectl rollout status`, which waits for the settled
state rather than the first one.

Two commands to orient yourself. First, the workload. Both generated segments in
each pod name are yours alone, and so is the restart column:

```console
$ kubectl -n snip get pods
NAME                        READY   STATUS    RESTARTS   AGE
postgres-7d4b9c8f6-2xqnl    1/1     Running   0          2m
snip-api-6f8d5c7b94-4gkzt   1/1     Running   1          2m
snip-api-6f8d5c7b94-r9p2w   1/1     Running   1          2m
valkey-5c9d7f8b6-hsk4n      1/1     Running   0          2m
```

Two `snip-api` pods, the same two replicas the Compose lab has run since
Chapter 2, "What's Actually on the Wire". Those names are worth staring at:
in `snip-api-6f8d5c7b94-4gkzt` the middle segment is a hash of the pod template
and the last is random, and both change every time you deploy. Hold that
thought; it is the whole of the fourth change.

Second, the monitoring stack — the "these are ordinary objects" moment:

```bash
kubectl -n monitoring get \
  prometheus,alertmanager,servicemonitor,prometheusrule
```

One `Prometheus`, one `Alertmanager`, a short column of `ServiceMonitor` objects
and a longer one of `PrometheusRule` objects, none of which you wrote. Count
them on your own cluster rather than carrying a number away from a book: the
chart ships forty-one rule files, and the values you install with decide how
many become objects. These are ordinary Kubernetes resources — `kubectl get`,
`kubectl describe`, `kubectl edit`, all of it works. Nothing is magic.

To reach Prometheus itself, forward a port. The operator creates a headless
Service called `prometheus-operated` for exactly this:

```bash
kubectl -n monitoring port-forward \
  svc/prometheus-operated 9090:9090
```

`http://localhost:9090/` is now the Prometheus UI you have used for twenty-six
chapters, running inside a Kubernetes cluster. Targets, Query, Explain, the Tree
view, `/status`, `/service-discovery` — all of it.

## Change one: targets become a query

In the Compose lab, Prometheus finds Snip by asking the Docker daemon for a list
of containers and filtering it with relabel rules. On Kubernetes it asks the
Kubernetes API server instead, through `kubernetes_sd_config`. The shape is the
same and the relabeling is the same; only the source of the list is different.

Here is what Snip's scrape job looks like written by hand, in an ordinary
`prometheus.yml`, with no operator anywhere:

```yaml
scrape_configs:
  - job_name: snip-api
    kubernetes_sd_configs:
      - role: endpoints
        namespaces:
          names: [snip]
    relabel_configs:
      - source_labels:
          - __meta_kubernetes_service_label_app
          - __meta_kubernetes_endpoint_port_name
        action: keep
        regex: snip-api;http
      - source_labels: [__meta_kubernetes_namespace]
        target_label: namespace
      - source_labels: [__meta_kubernetes_pod_name]
        target_label: pod
      - source_labels: [__meta_kubernetes_service_name]
        target_label: job
      - target_label: env
        replacement: lab
```

Read it downward and nothing is unfamiliar. `kubernetes_sd_configs` replaces
`docker_sd_configs`. The `keep` rule does the job the two `keep` rules in
`lab/prometheus/prometheus.yml` do, using a technique from the same chapter:
two source labels joined with the default `;` separator, matched as one pair.
The three `replace` rules promote meta-labels into real ones, and the last line
writes `env="lab"` exactly as the Compose config does. **This file is what the
operator is going to generate for you**, and you will read it back out of a
Secret later in this chapter.

The one genuinely new decision is `role`. `kubernetes_sd_config` has six of
them, and the role decides what counts as one target:

| Role | One target per | Use it for |
|---|---|---|
| `node` | cluster node | the kubelet, cAdvisor |
| `pod` | container port on a pod | pods with no Service |
| `endpoints` | address behind a Service | scraping applications |
| `endpointslice` | address from an EndpointSlice | the same, at scale |
| `service` | service port | black-box probing only |
| `ingress` | each path of each Ingress | black-box probing only |

Five of those six are unremarkable. The sixth is a trap with a name that sounds
exactly right.

!!! pitfall "`role: service` is not for scraping services"
    A Kubernetes Service is a virtual IP with a load balancer behind it, and a
    target discovered by `role: service` is that virtual IP — so every scrape
    lands on whichever backend the load balancer picks. Scrape a three-replica
    deployment this way and you get one series, whose `instance` label names the
    Service, built from a counter that jumps backwards whenever the load
    balancer routes you to a different pod than last time. It looks exactly like
    the counter resets from Chapter 6, "`rate()`, `increase()`, and Why Nothing
    Is a Whole Number", except that nothing restarted. Use `endpoints` or
    `endpointslice` for applications. `role: service` is for probing a Service
    from outside with `blackbox_exporter`, the pattern from Chapter 23, "The
    Multi-Target Pattern: Probing From Outside" — and for nothing else.

Between `endpoints` and `endpointslice`, prefer the second. The Kubernetes
`Endpoints` API has been **deprecated since Kubernetes 1.33**; `EndpointSlice`
(`discovery.k8s.io/v1`) is its replacement and scales far better, because a
Service with a thousand backends becomes many small objects instead of one
enormous one that every watcher re-reads on every change.

The two roles are not interchangeable in relabel rules, which is a detail
textbooks get wrong. The `endpoints` role attaches `__meta_kubernetes_endpoints_*`
for the object and `__meta_kubernetes_endpoint_*` — singular — for each address.
The `endpointslice` role uses `__meta_kubernetes_endpointslice_*` throughout, so
that `keep` rule on `__meta_kubernetes_endpoint_port_name` would silently match
nothing under the other role.

Switching roles also has a permission consequence that produces one of the most
confusing failures on the platform:

!!! warning "Switching to EndpointSlice without the RBAC"
    Prometheus reads the API server with a ServiceAccount whose permissions are
    enumerated per API group, and reading `Endpoints` and reading
    `EndpointSlices` are different permissions. Switch a monitor to
    `serviceDiscoveryRole: EndpointSlice` without granting `get`, `list` and
    `watch` on `endpointslices` in the `discovery.k8s.io` API group and the
    targets do not degrade — they vanish completely.

Here is the minimum for the hand-written path, adapted from the upstream
example — which does not list `endpointslices` at all, so it has to be added:

```yaml
rules:
  - apiGroups: [""]
    resources: [nodes, nodes/metrics, services, endpoints, pods]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["discovery.k8s.io"]
    resources: ["endpointslices"]
    verbs: ["get", "list", "watch"]
  - nonResourceURLs: ["/metrics", "/metrics/cadvisor"]
    verbs: ["get"]
```

The lab's own `k8s/snip-servicemonitor.yaml` leaves `serviceDiscoveryRole`
unset, which does not mean `Endpoints` outright: it means *fall back to whatever
the `Prometheus` object says*, and that object is at its own default, which is
`Endpoints`.

Each role attaches its own `__meta_*` labels — namespace, pod name, node name,
pod phase, readiness, every Kubernetes label and annotation on the object. The
Prometheus UI's Service Discovery page shows all of them for every discovered
target, before relabeling, together with the reason each rejected target was
dropped. Open it at `http://localhost:9090/service-discovery` and read one entry
end to end. It is the fastest way to internalize what discovery hands you.

Two more facts about the hand-written path, both of which save arguments.

**The `prometheus.io/scrape` annotation is a convention, not a feature.** You
will meet a block of relabel rules that keeps pods annotated
`prometheus.io/scrape: "true"` and reads the port from `prometheus.io/port`. It
is genuinely widespread, and genuinely not an upstream Prometheus feature: the
upstream example configuration does not contain the string `prometheus_io`
anywhere, uses placeholder annotation names, and leaves those rules commented
out. Nothing knows what `prometheus.io/scrape` means until somebody writes the
`keep` rule that gives it meaning. Inherit a cluster that uses it and your first
job is to find that rule.

**The kubelet is not a pod.** It is a process on the node, outside Kubernetes'
own object model, so there is nothing for `role: endpoints` to discover — which
is awkward, because the kubelet is where container metrics come from. The
Prometheus Operator solves this by *synthesizing* a Service named `kubelet` in
the `kube-system` namespace, listing every node as a backend, so an entirely
ordinary `ServiceMonitor` can target it:

```bash
kubectl -n kube-system get svc kubelet
```

That Service has no selector and no pods; the operator writes its backends
itself. It is a small, honest hack, and knowing it exists explains a Service
that otherwise looks impossible.

## Change two: configuration becomes objects

!!! jargon "Operator, and CRD"
    A **CRD** (CustomResourceDefinition) teaches the Kubernetes API server a new
    kind of object, so `kubectl get servicemonitors` works the same way
    `kubectl get pods` does. An **operator** is an ordinary program that watches
    those objects and makes reality match them. The Prometheus Operator is a
    YAML-to-YAML compiler with a reconcile loop: it reads custom resources,
    generates a normal `prometheus.yaml` plus rule files, stores the config as a
    gzipped Kubernetes Secret, and runs Prometheus as a StatefulSet with a small
    sidecar container that notices the Secret changed and hits the reload
    endpoint you met in Chapter 12. Nothing happens that you could not have done
    by hand.

Ten CRDs ship with `kube-prometheus-stack` chart 87.21.0, which bundles
Prometheus Operator v0.92.1 — a number to read out of the chart's own
`Chart.yaml` `appVersion` rather than assume, because the chart deliberately
lags the newest operator release. Those ten span three API versions. Four of
them matter to you now.

| Kind | API version | What it is |
|---|---|---|
| `ServiceMonitor` | `monitoring.coreos.com/v1` | scrape the pods behind a Service |
| `PodMonitor` | `monitoring.coreos.com/v1` | scrape pods with no Service |
| `PrometheusRule` | `monitoring.coreos.com/v1` | recording and alerting rules |
| `Probe` | `monitoring.coreos.com/v1` | black-box probes of static targets |

The other six are `Prometheus`, `Alertmanager`, `ThanosRuler`,
`AlertmanagerConfig`, `PrometheusAgent` and `ScrapeConfig`. Get an API version
wrong and the server rejects the object outright, so carry three details around.
In the CRDs this chart ships, **`ScrapeConfig` is still at API version
`monitoring.coreos.com/v1alpha1`** — graduation has been proposed, not done —
and so is `PrometheusAgent`, which is how you run the agent mode from
Chapter 26, "When One Prometheus Isn't Enough: HA, `remote_write`, and the
Scaling Map". `AlertmanagerConfig` is served at both `v1alpha1` and `v1beta1`,
with conversion webhooks so both work at once, and the chart's own examples
still write `v1alpha1`. And there is **no `RemoteWrite` CRD**: remote write is
configured on the `Prometheus` object itself.

`ScrapeConfig` is the escape hatch worth remembering: a near-raw `scrape_config`
as a Kubernetes object, for targets that are not Kubernetes workloads at all — a
switch, an appliance, a VM outside the cluster. One trap inside it: `role` values
are **capitalized** in the CRD (`Node`, `Pod`, `EndpointSlice`) where raw
`prometheus.yml` writes them lowercase.

### The ServiceMonitor, read line by line

Here is `lab/k8s/snip-servicemonitor.yaml`, with its comments stripped:

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: snip-api
  namespace: snip
  labels:
    release: kps
spec:
  selector:
    matchLabels:
      app: snip-api
  namespaceSelector:
    matchNames:
      - snip
  endpoints:
    - port: http
      path: /metrics
      interval: 15s
      scrapeTimeout: 10s
      relabelings:
        - targetLabel: env
          replacement: lab
      metricRelabelings:
        - sourceLabels: [__name__]
          regex: go_memstats_.*
          action: drop
```

Read the bottom half first, because you have seen it before. `path: /metrics`,
`interval: 15s`, `scrapeTimeout: 10s` are the same three settings you set in
`prometheus.yml`. The `relabelings` entry writes `env="lab"` onto every target,
which is what the Compose lab's `snip-api` job does with a one-line `replace`.
The `metricRelabelings` entry drops the `go_memstats_*` family, which is the
same drop Chapter 12 added, for the same reason. Same labels, same values,
different mechanism.

Now the top half, which is new, and which is where everything goes wrong.

### Four selectors that must all agree

A `ServiceMonitor` does not attach to a Service. It *describes* a search, and
four separate searches have to succeed in sequence before a single target
exists.

```text
Prometheus.spec.serviceMonitorNamespaceSelector
        │  picks namespaces
        ▼
Prometheus.spec.serviceMonitorSelector
        │  picks ServiceMonitors, by THEIR labels
        ▼
ServiceMonitor.spec.namespaceSelector
        │  picks namespaces
        ▼
ServiceMonitor.spec.selector
        │  picks Services, by THE SERVICE'S labels
        ▼
Service.spec.selector
        │  picks Pods
        ▼
ServiceMonitor.spec.endpoints[].port
        │  names a SERVICE port, by name, as a string
        ▼
    a target
```

A missing label anywhere along that chain produces the identical symptom: zero
targets, and no error message. The middle is where people trip over their own
YAML. `spec.selector` matches the **Service's** `metadata.labels`, not the pods'
labels, so `app: snip-api` has to appear twice on `lab/k8s/snip-service.yaml`
and mean two different things:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: snip-api
  namespace: snip
  labels:
    app: snip-api      # what the ServiceMonitor matches
spec:
  selector:
    app: snip-api      # what the Service matches: pods
  ports:
    - name: http
      port: 8000
      targetPort: http
```

And `endpoints[].port` names that Service port **by name**, as a string. Not the
container port, not a number.

### The label everybody forgets

Now the top of the chain, and the reason this section gets a page of its own.

`kube-prometheus-stack` templates its `Prometheus` object like this, whenever
`serviceMonitorSelectorNilUsesHelmValues` is true — which is its default:

```yaml
serviceMonitorSelector:
  matchLabels:
    release: {{ $.Release.Name | quote }}
```

The release name in `make k8s-up` is `kps`. So this Prometheus only looks at
`ServiceMonitor` objects carrying the label `release: kps`. The same pattern
applies to `ruleSelector`, `podMonitorSelector`, `probeSelector` and
`scrapeConfigSelector`. A `PrometheusRule` without that label is never loaded.

Break it on purpose and watch what you get.

```bash
kubectl -n snip label servicemonitor snip-api release-
```

Wait thirty seconds, then look at the Targets page, or ask Prometheus:

```promql
up{job="snip-api"}
```

```text
Empty query result
```

That is the entire diagnostic output. Not a warning. Not a Kubernetes Event.
Nothing in `kubectl describe servicemonitor snip-api`, nothing in the operator's
log, nothing on the Alerts page. The object still exists, still validates, still
looks exactly right. It is invisible, and the reason it is invisible is one
label on a completely different object in a completely different namespace.

!!! trap "Zero targets and no error message"
    This is the number one Kubernetes monitoring failure by a very large margin,
    and its defining property is that nothing reports it. The symptom is
    indistinguishable from "my application does not expose metrics", from "my
    Service has no endpoints", and from "I typed the port name wrong". Every
    newcomer loses an afternoon to it exactly once. Reading the generated config
    is how you turn that afternoon into thirty seconds.

### The one command that ends the guessing

The operator compiles every selected `ServiceMonitor` into a real scrape config
and stores the result as a gzipped Kubernetes Secret. Read that Secret and you
stop guessing, because you are looking at what Prometheus loaded rather than
what you meant.

Find the Secret first. Its name is built from the release name and the chart's
own templates, and the exact spelling has changed across chart majors, so look
it up rather than memorize it:

```bash
kubectl -n monitoring get secret | grep prometheus
```

With release `kps` that comes back as
`prometheus-kps-kube-prometheus-prometheus`. Use whatever your own `grep`
printed:

```bash
kubectl -n monitoring get secret \
  prometheus-kps-kube-prometheus-prometheus -ojson \
  | jq -r '.data["prometheus.yaml.gz"]' \
  | base64 -d | gunzip \
  | grep -A5 snip
```

With the label removed, that prints nothing at all — which is the answer. The
`ServiceMonitor` never reached the config. Put the label back:

```bash
kubectl -n snip label servicemonitor snip-api release=kps
```

and run the same command again. Now you get a whole scrape job, and it is the
hand-written job from the start of this chapter with more rules in it: a
`job_name` naming the monitor that produced it, a `kubernetes_sd_configs` block
with `role: endpoints`, and a long chain of `relabel_configs` — the same
actions, the same `source_labels`, the same `target_label` spellings you learned
in Chapter 12. Find the rule that writes into `job`; it takes the Service's
name. That is why the series here carry `job="snip-api"`, the same string the
Compose lab uses, and why the ported rules in `k8s/snip-prometheusrule.yaml` can
hard-code `job="snip-api"` and work.

Learn to read that output and the operator stops being a black box. It is
generating the file you would have written, and it gives you a two-step
diagnosis that covers almost everything:

- **Not in the generated config at all** → the `Prometheus` object is not
  selecting your `ServiceMonitor`. Check the `release:` label first.
- **In the config, but absent from the Targets page** → the config is fine and
  discovery found nothing. No Service matches `spec.selector`, or the Service
  has no ready endpoints, or the port name is wrong.

Those are two new rungs bolted under the debugging ladder in Appendix B: before
"does the metric exist", ask whether the target reached the generated config,
then whether it reached the Targets page. Two yeses, and the ordinary ladder
starts.

### Two syntax traps in the CRDs

The CRD field names are **camelCase** where `prometheus.yml` is snake_case:
`relabelings`, `metricRelabelings`, `sourceLabels`, `targetLabel`,
`honorLabels`, `scrapeTimeout`. Copying a `relabel_configs` block out of a
working Prometheus config into a `ServiceMonitor` therefore fails, and the same
applies to `AlertmanagerConfig`, where `group_by` becomes `groupBy`.

!!! pitfall "`relabelings` at the wrong level"
    `relabelings` and `metricRelabelings` belong **inside an endpoint**, not at
    `spec:` level. Blog posts published in 2026 still show them at `spec:` level.
    The indentation looks plausible, YAML parses it happily, and the API server
    rejects or ignores it. If your relabeling does nothing at all, check the
    indentation before you check the regex. A numeric `port:` fails more
    honestly, with `spec.endpoints.port in body must be of type string: integer`.

### Installing the CRDs, and upgrading them

You never typed a command to install those ten CRDs, because the chart ships
them as a sub-chart and Helm installs them on first install. That is the last
time Helm helps you with them, and two facts explain why.

!!! warning "`kubectl apply -f` fails on these CRDs"
    Client-side apply writes a copy of the whole object into the
    `kubectl.kubernetes.io/last-applied-configuration` annotation, and the
    `Prometheus` CRD is bigger than the annotation size limit:

    ```text
    The CustomResourceDefinition "prometheuses.monitoring.coreos.com"
    is invalid: metadata.annotations: Too long: must have at most
    262144 bytes
    ```

    The fix is server-side apply, which keeps no such annotation:

    ```bash
    kubectl apply --server-side --force-conflicts -f <crds>
    ```

The second fact is that **Helm v3 installs CRDs on first install and never
upgrades them** — a documented Helm limitation, not a chart bug. A chart upgrade
that ships new CRD fields therefore leaves you with an operator that understands
them and an API server that rejects them, so you apply the new CRDs yourself,
server-side, before the `helm upgrade`. The chart ships an opt-in upgrade job to
automate this, described in its own values file as "in preview, off by default
and may change in the future" — worth knowing about, not worth building a
process on.

And one warning out loud: **deleting the CRDs deletes every `ServiceMonitor` and
`PrometheusRule` in the cluster.** They survive `helm uninstall` on purpose.
Anyone who "cleans up" by deleting them takes every team's monitoring with them.

## Change three: telemetry you did not ask for

One `helm install` gave you new sources of data, thirty-five Grafana dashboards
and forty-one rule files. That is a genuine gift and a genuine liability.

### Three components, three different questions

Three names get confused constantly, and the confusion produces dashboards that
are quietly wrong. Two arrived with the chart; the third did not.

| Component | Question it answers | Speaks Prometheus? |
|---|---|---|
| cAdvisor | what is this container *using*? | yes |
| kube-state-metrics | what does the API say should *exist*? | yes |
| metrics-server | what is this pod's CPU *right now*? | no |

**cAdvisor** is compiled into the kubelet. You do not install it; there is
nothing to install. It reads cgroup accounting and publishes
`container_cpu_usage_seconds_total`, `container_memory_working_set_bytes` and
friends at the kubelet's `/metrics/cadvisor` path. You met these exact metric
names in Chapter 22, "Metrics From Things You Didn't Write" — the standalone
cAdvisor container in the Compose lab is the same code. Only the labels differ:
in Docker you grouped by `name`, here you group by `namespace` and `pod`.

**kube-state-metrics** watches the API server and turns object state into
gauges: `kube_pod_status_phase`, `kube_deployment_status_replicas`,
`kube_pod_container_status_restarts_total`. It knows nothing about resource
usage. What it knows is what you *declared*:

!!! note "Requests and limits are declarations, not usage"
    `kube_pod_container_resource_requests` and
    `kube_pod_container_resource_limits` are the numbers somebody typed into a
    YAML file. They tell you what a pod asked for, never what it used. Which
    means that every "percentage of limit" panel you have ever seen is a join
    across two different exporters — usage from cAdvisor over declarations from
    kube-state-metrics. That is the vector-matching shape from Chapter 11,
    "Joins, Info Metrics, and the Rest of PromQL", arriving in the most ordinary
    possible place:

    ```promql
    sum by (namespace, pod) (
      rate(container_cpu_usage_seconds_total{container!=""}[5m])
    )
      /
    sum by (namespace, pod) (
      kube_pod_container_resource_limits{resource="cpu"}
    )
    ```

    The `container!=""` filter drops the pod-level rollup series cAdvisor also
    emits. Which exclusion is correct depends on your container runtime, so
    check rather than copy: run the numerator alone and see whether each pod
    appears once or twice.

**metrics-server** is the one that is not a Prometheus exporter at all. It
scrapes every kubelet's `/metrics/resource` endpoint, keeps only the latest
value, and serves it through the Kubernetes Metrics API for `kubectl top` and
for the Horizontal Pod Autoscaler. Pointing Prometheus at it does not give you
`kubectl top` data. You do not need it for Prometheus; you do need it for
autoscaling. They are not competitors and they do not overlap.

`node-exporter` is here too, one pod per node, exposing the same `node_*`
metrics you scraped in Chapter 22 and answering the same question about the host
rather than the container. It needed no adaptation to get here.

### Where the free dashboards come from

!!! sidebar "The lineage, in two sentences"
    The dashboards and rules are generated from a jsonnet project called
    **kubernetes-mixin**, which feeds **kube-prometheus**, which feeds the Helm
    chart. That is why every Kubernetes monitoring stack you have ever seen
    looks the same, whichever vendor wrapped it.

The delivery mechanism is worth more than the dashboards. Each one is rendered
into a **ConfigMap carrying the label `grafana_dashboard: "1"`**, and a sidecar
container next to Grafana watches for that label across all namespaces and drops
the JSON into Grafana's provisioning directory — the whole Kubernetes-native
version of the provisioning you set up by hand in Chapter 3, "Your First
Dashboard: The Early Win". One ConfigMap, one label, done. The datasource
arrives the same way, and the chart gives it the **UID `prometheus`**, which is
why the dashboard import at the end of this chapter needs no edits.

Five of the thirty-five are worth your first hour: `k8s-resources-namespace`,
`k8s-resources-pod`, `k8s-resources-workload`, `nodes`, and `prometheus` — the
last being "is my monitoring healthy", which is the meta-lesson of Chapter 19,
"What a Page Should Say, and Who Watches the Watcher", arriving pre-built. Among
the rule files, `kube-apiserver-slos` and `kube-apiserver-burnrate.rules` are a
complete multi-window multi-burn-rate SLO implementation for the API server. You
spent Chapter 21 deriving that structure; here it is, written by somebody else,
for you to check your understanding against.

### The install that pages you on day one

Now the liability half. `values-kps.yaml` in this lab contains four lines you
should understand rather than copy:

```yaml
kubeEtcd:
  enabled: false
kubeControllerManager:
  enabled: false
kubeScheduler:
  enabled: false
kubeProxy:
  enabled: false
```

By default the chart tries to scrape etcd, the controller-manager, the scheduler
and kube-proxy, and ships alerts that fire when they are unreachable. On any
managed cluster — EKS, GKE, AKS — **the control plane is not yours**. Those
components are not exposed to you and never will be. So the default install
comes up with four targets permanently down and a handful of alerts firing
within minutes, about components you have no access to, cannot investigate, and
cannot repair.

Read that back against Chapter 19, which argued that an alert is a message to a
human who must be able to *do* something, and against Chapter 21, which spent a
chapter making alerts rare enough to be believed. The single most popular
Kubernetes monitoring install in the world pages you on day one for things you
cannot fix, and the people who have lived with it have mostly stopped noticing.
That is exactly how a team learns to ignore its pager — not through one bad
alert, but through a default nobody turned off.

`kind` wires those components up to be scrapeable, so this lab could have left
them on. It turns them off deliberately, because the habit is what transfers.

## Change four: the edges get harder

Four honest difficulties. None is a reason to avoid Kubernetes; all four are
reasons to measure before you scale.

**Cardinality becomes structural.** On a fleet of virtual machines, `instance`
changes when you rebuild a machine — perhaps monthly. On Kubernetes, `pod`
changes on every deploy, every restart, every autoscale event, every node drain.
Look again at `snip-api-6f8d5c7b94-4gkzt`: that name is new on every image
change, and every series carrying it is a new series. Fifty deploys a week
across twenty pods is a thousand new `pod` values a week for one workload. A
CronJob running every minute mints a new pod name every minute, and
kube-state-metrics emits series for each. The arithmetic from Chapter 7,
"Labels, and the Cardinality Arithmetic You Must Do First", has not changed; the
multiplier has.

The defenses are the ones you already have, in order of leverage:
`metricRelabelings` with `action: drop` on the noisiest families, `labeldrop`
for labels you never group by, kube-state-metrics label allowlists that are
never `[*]` — `pod-template-hash` alone will hurt you — and recording rules that
pre-aggregate the pod label away. One misconception to kill early: **shortening
retention does not reduce memory.** Head-block memory tracks active series,
exactly as Chapter 25, "Storage, Retention, Backups and Locking the Door",
showed. Retention buys disk.

**Target churn is a separate problem from cardinality.** Every pod create and
delete is a discovery event, and broad discovery — watch every pod in the
cluster, throw 99 % away with a `keep` rule — puts real load on the API server
and on Prometheus's discovery manager. When a pod disappears its series go stale
and PromQL stops returning them, which is correct and still surprising:
`count(up{job="snip-api"})` dips during every rolling deploy, so alerting on
`up == 0` with a short `for:` pages you for normal deployments.

**Storage defaults to nothing.** The operator creates no persistent volume
unless you ask. Omit `spec.storage` and Prometheus runs on an `emptyDir`, so the
pod's TSDB lives and dies with the pod.

!!! warning "Your history disappears on every restart"
    `values-kps.yaml` in this lab sets `retention: 6h` and deliberately omits
    `spec.storage` — fine for a throwaway cluster, catastrophic anywhere else,
    and a pairing worth noticing: retention is a promise about disk you were
    never given in the first place. A Prometheus that is OOMKilled, rescheduled,
    or upgraded loses every sample it ever stored, silently, and comes back
    looking healthy with an empty database. Setting it is one block:

    ```yaml
    storage:
      volumeClaimTemplate:
        spec:
          storageClassName: ssd
          resources:
            requests:
              storage: 40Gi
    ```

    Resizing that volume later is genuinely painful — the documented procedure
    pauses the `Prometheus` object, patches each PVC, and deletes the StatefulSet
    with the `orphan` strategy. Size it generously the first time.

**Prometheus now lives inside a memory limit.** Exceed it and the pod is
OOMKilled, which triggers a write-ahead-log replay on restart, which on a large
database takes minutes and can loop forever if the limit is genuinely too small.
This is the most common way a Kubernetes Prometheus dies. Set requests equal to
limits — it is a stateful, memory-heavy singleton, and bursty overcommit is how
it gets evicted — and derive the number from your own cluster by watching
`prometheus_tsdb_head_series` against `process_resident_memory_bytes`, the pair
Chapter 24, "Cardinality: Detonate, Diagnose, Defuse", put on one graph.
Published per-series figures vary by more than a factor of two; your own
measurement does not.

The lab breaks that advice in front of you, which is the point of putting it in
a file you can read. `values-kps.yaml` asks for `200m` of CPU and `512Mi` of
memory and caps memory at `1Gi` — requests below limits, the thing not to do. A
two-node `kind` cluster has nothing to overcommit and six hours of retention
keeps the head block tiny, so the gap costs nothing here. Copy the shape of that
block, not its numbers.

Finally, one trap that appears only at scale and fails silently when it does.
The operator can run several Prometheus **shards**, splitting targets between
them by a hash of the address. Singletons like kube-state-metrics must be
excluded, or cluster object state lands on exactly one shard while container
metrics spread across all of them — and every dashboard that joins the two
returns partial data with no error. The exclusion is one relabel rule on the
monitor:

```yaml
relabelings:
  - targetLabel: __tmp_disable_sharding
    replacement: "true"
```

You met the `__tmp_*` namespace in Chapter 12 as scratch space that never
reaches a series. This is what it is for.

## The proof: the same dashboard, unchanged

All of that was preparation for one demonstration.

First, give the cluster something to measure. The kubelet's readiness and
liveness probes already hit `/healthz` every ten seconds on both pods, which is
why the RED panels have anything to draw — but nothing here creates links or
follows them, because `loadgen` stayed in the Compose lab. Be the load generator
yourself:

```bash
kubectl -n snip port-forward svc/snip-api 8000:8000
```

In a second terminal:

```bash
for i in $(seq 1 100); do
  code=$(curl -s -XPOST localhost:8000/links \
    -H 'Content-Type: application/json' \
    -d '{"url":"https://prometheus.io/docs/"}' \
    | jq -r .code)
  curl -s -o /dev/null "localhost:8000/l/$code"
done
```

Now reach the Grafana that came with the chart. Its Service name is built from
the release name, so find it rather than assume it:

```bash
kubectl -n monitoring get svc | grep grafana
```

Forward whatever port that Service publishes, and log in with `admin` and
`admin` — a password `values-kps.yaml` sets in plain text, which is acceptable
in a cluster you are about to delete and nowhere else.

Import `lab/dashboards/snip-red.json`. Not a rewritten copy: the file, exactly as
Chapter 13 left it and Chapter 14, "Dashboards That Tell the Truth", corrected
it.

The RED row draws immediately: request rate by route, the error ratio with its
`or 0 *` guard from Chapter 9, "Ratios, Arithmetic, and the Series That Isn't
There", and the p50/p95/p99 latency panel. The `$job` variable — a
`label_values(snip_http_requests_total, job)` query — populates itself from the
cluster and offers `snip-api`. The `$route` variable, chained off it, offers the
routes those two pods have actually served. The heatmap draws. The "faster than
300 ms" stat panel draws, reading the `le="0.3"` bucket, which exists because
Snip's default bucket layout was designed backwards from the 300 ms objective in
Chapter 10, "Latency: Histograms Without Tears" — and that layout is compiled
into the binary, so it came along with the image.

None of that needed an edit, and it is worth being precise about why. The first
panel runs this:

```promql
sum by (route) (
  rate(snip_http_requests_total{job=~"$job",
    route=~"$route"}[$__rate_interval])
)
```

A metric name, two labels and a time window, none of which was ever about
Docker. All four exist in the cluster for the same reason they exist under
Compose: Snip's instrumentation is the same binary in both places. The only
reason the file needed no edit *at all* is smaller and more mundane: its panels
reference the datasource by the UID `prometheus`, and that is the UID the
chart's sidecar gives its datasource. Had those two strings differed, you would
have re-pointed the datasource once, in the UI, and everything else would still
have worked.

Be equally precise about what does **not** draw. Every panel in the worker row
is empty, the "Client-observed vs server-observed p95" panel draws one of its
two series, and the whole spike-recovery row — both in-flight panels and all
three injector stat panels — reads "No data". Those panels query `snip_worker_*`
and `loadgen_*`, and neither service exists in this cluster. That is not a
Kubernetes difference; it is an absent service, and it would look the same if
you stopped those two containers in the Compose lab.

Then port a rule. `lab/k8s/snip-prometheusrule.yaml` carries Chapter 21's tier-1
burn-rate alert and the two recording rules it reads:

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: snip-rules
  namespace: snip
  labels:
    release: kps
spec:
  groups:
    - name: snip-burnrate
      interval: 30s
      rules:
        - alert: SnipAvailabilityBurnFast
          expr: |
            (
              (1 - job:snip_sli_availability:ratio_rate1h{job="snip-api"})
                > (14.4 * 0.005)
              and
              (1 - job:snip_sli_availability:ratio_rate5m{job="snip-api"})
                > (14.4 * 0.005)
            )
            and
            sum by (job) (
              increase(snip_http_requests_total{job="snip-api",
                                                route="/l/{code}"}[1h])
            ) >= 60
          for: 2m
          labels:
            severity: page
            service: snip
            route: "/l/{code}"
          # annotations omitted here; they are unchanged
```

Open that file next to `prometheus/rules/snip-burnrate.yml` and diff them by
eye. Everything under `spec.groups` is the rule-file format from Chapter 15,
"Recording Rules", character for character: `groups[].name`, `groups[].interval`,
`rules[].alert`, `expr`, `for`, `labels`, `annotations`, and the
`{{ $value | humanizePercentage }}` templating survives untouched. Only two
things differ, and neither is PromQL: the CRD wrapper around the groups, and the
`release: kps` label — the same trap as the `ServiceMonitor`, with the same
symptom.

The file carries one more rule, `SnipSLIAbsent`, which watches for the SLI itself
going missing with the `absent()` from Chapter 9. It matters more here than under
Compose. Scale the Deployment to zero and the pods are gone, so the targets are
gone, so the `up` series is gone — and there is nothing left to compare with `0`.
An alert on `up == 0` cannot fire on a target that has ceased to exist.
`absent()` on the SLI notices anyway.

The one real behavioral difference is a good one. The operator **validates** the
object and rejects a bad expression instead of logging it and carrying on, so
when `kubectl apply` succeeds but the rules never appear, ask the object:

```bash
kubectl get events -n snip \
  --field-selector=involvedObject.name=snip-rules
```

Confirm the rules loaded on the Prometheus UI's Rules page, or query the SLI
directly:

```promql
job:snip_sli_availability:ratio_rate5m{job="snip-api"}
```

A value at or very near `1` is correct here: your redirect loop produced almost
no failures, so almost none of the error budget has been spent. An empty result
means something more interesting — the loop has aged out of the five-minute
window, so with no `/l/{code}` traffic the denominator is empty, which is the
blank-panel case Chapter 9 warned about. Run the loop again and watch the value
reappear.

!!! selfcheck "Self-check"
    ```bash
    make verify-ch27
    ```

    It asserts that a cluster is reachable, that the operator CRDs are
    installed, that a Snip `ServiceMonitor` and `PrometheusRule` exist, that the
    `ServiceMonitor` carries a `release:` label, that the ServiceMonitor produces
    at least one target, that the imported dashboard's three RED queries return
    data, and that the ported rule is loaded. It opens its own port-forward on
    **9091**, not 9090, so it does not fight the one you opened by hand. It
    prints `ch27 OK` when every assertion passes.

    Two honest caveats. Without `kubectl` or a reachable cluster the script
    exits **2** — a missing prerequisite, not a failure of your work, and the
    only verify target in the book that behaves that way. And unlike every other
    chapter's script, this one has never been exercised against a live cluster by
    the lab's own verification pass, because there was no cluster to run it on.
    If it fails, read its output as evidence about the script too.

## Common mistakes

**The missing `release:` label.** Number one by a very large margin, on
`ServiceMonitor`, `PodMonitor`, `PrometheusRule` and `ScrapeConfig` alike. Zero
targets, zero rules, zero error messages. Check it before you check anything
else, then confirm with the gunzip command.

**A numeric `port:`.** `ServiceMonitor.spec.endpoints[].port` names a Service
port by name, as a string. A number gives you
`spec.endpoints.port in body must be of type string: integer`, which at least
tells you what is wrong. Naming a *container* port that the Service does not
republish is worse: it validates, and produces zero targets.

**`endpoints:` on a `PodMonitor`.** It uses `spec.podMetricsEndpoints`, and its
`port` names the **container** port, not a Service port. Two differences, both
easy to miss because the two objects look alike.

**snake_case pasted into a CRD.** `relabel_configs` is `relabelings`,
`source_labels` is `sourceLabels`, `group_by` is `groupBy`. The YAML parses; the
schema rejects it. And expecting `helm upgrade` to upgrade the CRDs belongs in
the same family of wrong assumptions: it does not, ever. Apply them yourself
with `--server-side --force-conflicts` before the chart upgrade.

**Alerting on `up == 0` with a short `for:`.** Every rolling deploy will page
you. Use a `for:` longer than a rollout, or alert on the symptom instead —
`absent()` over the SLI, which catches the case `up` cannot: scale the
Deployment to zero and there is no `up` series left to compare with anything.

## Summary

Kubernetes changes where Prometheus gets its target list, how its configuration
is written, how much telemetry arrives uninvited, and how hard the edges are to
hold. It changes nothing about what a metric is, how you instrument code, how
you query it, how you draw it, or how you decide to wake somebody up. The
imported dashboard is the proof, and that it needed no edit is no accident:
none of those queries was ever about the platform.

The durable takeaways:

- **Four things change; six do not.** Targets become a query, configuration
  becomes objects, telemetry arrives uninvited, and the edges get harder. PromQL,
  the data model, instrumentation, dashboards, alerting logic and SLOs are
  untouched.
- **`role: service` scrapes the load balancer, not the backends.** Use
  `endpoints`, or `endpointslice` on clusters at or past Kubernetes 1.33, where
  the `Endpoints` API is deprecated — and grant the `discovery.k8s.io` RBAC when
  you switch, or the targets vanish entirely.
- **Four selectors must agree**, and a missing label anywhere in the chain
  produces zero targets with no error. The `release: <helm-release>` label is the
  one people forget.
- **Read the generated config.** `kubectl get secret … | base64 -d | gunzip` is
  the highest-leverage debugging skill on the platform, because it shows you what
  Prometheus loaded rather than what you meant.
- **cAdvisor measures usage, kube-state-metrics reports declarations, and
  metrics-server is not a Prometheus exporter.** Every "percentage of limit"
  panel is a join across the first two.
- **The default install pages you on day one for a control plane you do not
  own**, and **omitting `spec.storage` gives you an `emptyDir`** that takes your
  history with it on every restart. Both are defaults nobody turned off, which
  is how a team learns to ignore its pager.

When you are done, take the cluster down. It costs nothing to rebuild:

```bash
make k8s-down
```

Your Compose stack never noticed any of this happened.

## Exercises

!!! exercise
    **1. Two ways to name a port wrong (warm-up).** Edit
    `k8s/snip-servicemonitor.yaml` to read `port: 8000` and apply it. Write down
    the error the API server returns. Now put the string back, but make the
    ServiceMonitor name the *container* port rather than the Service port: both
    are called `http` today, so rename the Service port to `metrics` in
    `k8s/snip-service.yaml` first. Apply, wait thirty seconds, and record what
    you see this time. One mistake tells you what is wrong and the other is
    silent. Say which, and why. Put both files back afterwards.

    **2. Thirty seconds, timed (core).** Run
    `kubectl -n snip label servicemonitor snip-api release-` and start a timer.
    Using only the gunzip command and the Targets page — no web search, no
    re-reading this chapter — find the cause and restore it. Record the elapsed
    time, then do it again a week later and compare the two numbers.

    **3. Memory as a share of its limit (core).** Build the expression for the
    `snip-api` pods from `container_memory_working_set_bytes` and
    `kube_pod_container_resource_limits{resource="memory"}`, and get it to return
    exactly one value per pod. Then say, in one sentence each: which exporter
    supplies the numerator, which supplies the denominator, and what your
    expression returns for a pod with no memory limit set.

    **4. The day-one pager (core).** Re-run the `helm upgrade --install` from
    `make k8s-up` with `kubeControllerManager.enabled=true` and
    `kubeScheduler.enabled=true`, wait five minutes, then read the Targets page
    and the Alerts page. If those targets come up, delete one of the
    operator-managed `ServiceMonitor` objects the chart created for them — the
    same effect as never being allowed to reach the component. If they are
    already down, the managed-cluster experience has arrived for free. Either
    way, count the alerts that fire and name the chapter that predicted this.

    **5. One more tier (stretch).** Port Chapter 21's second tier — 6h/30m at a
    burn rate of 6 — into `k8s/snip-prometheusrule.yaml`, remembering that it
    needs two more recording rules. Apply it and confirm on the Rules page that
    it loaded, then write two lists: what you had to change, and what you did
    not. The second should be much the longer.

    **6. The upgrade nobody does (stretch).** Run `helm upgrade` to a newer
    `kube-prometheus-stack` minor version, then compare
    `kubectl get crd servicemonitors.monitoring.coreos.com -o yaml | head -20`
    against the CRD manifest bundled in the new chart. Did Helm update them?
    What did you have to do yourself, and which field would have failed silently
    if you had not noticed?
