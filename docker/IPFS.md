# IPFS (Kubo) — Operator Guide

Lessons from bringing a Kubo node up behind Docker on a public host. The
`docker-compose.ipfs.yml` stack works out of the box for a local-only node; the
items below are what operators typically need to configure on their own machine
to make the node fully functional for public serving, remote administration, and
monitoring.

## Quick Reference

| Concern | Where |
|---|---|
| Bring up / down | `make ipfs-start` / `make ipfs-stop` (project name `ipfs`) |
| CLI | `alias ipfs='docker exec ipfs-node ipfs'` — never run `ipfs daemon` through this alias, the container already runs it |
| Repo on disk | `${IPFS_DATA_DIR:-./data/ipfs}/data` — bind-mounted, survives container recreation |
| Ports | 5001 API/WebUI, 8080 gateway, 4001 swarm (TCP+UDP) |
| Metrics | `http://localhost:5001/debug/metrics/prometheus` (scraped by Prometheus job `ipfs`) |
| Grafana dashboard | "IPFS Node" (uid `ipfs-node-dashboard`) |

## 1. Swarm port 4001 must be publicly reachable

Without a host-exposed swarm port, your node is visible in DHT provider records
but **no peer can dial it**. You will see content "pinned locally" yet remote
fetches hang, and `ipfs-check` will return `ConnectionError: failed to dial:
context deadline exceeded` with only circuit-relay addresses advertised.

The compose file publishes `4001/tcp` and `4001/udp` by default. You must also:

```bash
# Host firewall (Ubuntu/ufw example)
sudo ufw allow 4001/tcp
sudo ufw allow 4001/udp

# Verify from OFF the server:
nc -zv <your-public-ip> 4001
nc -zvu <your-public-ip> 4001
```

Cloud providers (OVH, Hetzner, AWS SG, etc.) may have their own edge firewall.
Check that first if `nc` times out despite the host firewall being open.

After the port becomes reachable, restart the daemon so AutoNAT re-probes and
stops advertising circuit-relay fallbacks:

```bash
make ipfs-stop && make ipfs-start
# expect direct addrs to reappear:
ipfs id | grep -E 'tcp/4001|quic-v1'
```

## 2. Stale DHT records after reachability changes

When AutoNAT concludes "not reachable", your node publishes a DHT peer record
containing only relay addresses. That record has a ~24h TTL and is cached by
peers across the network. Fixing your ports **does not immediately fix
discoverability** — the stale record has to expire or be republished.

Two remedies:

**Direct-multiaddr check** — bypass the DHT to confirm the node is actually
working end-to-end. At https://check.ipfs.network, paste your full multiaddr
into the "Multiaddr" field:

```
/ip4/<public-ip>/tcp/4001/p2p/<your-peer-id>
```

If that succeeds, the node is fine; only the DHT is lagging.

**Accelerated DHT client** — cuts republish latency from hours to minutes:

```bash
ipfs config --json Routing.AcceleratedDHTClient true
make ipfs-stop && make ipfs-start
```

The first daemon start after enabling this is slower (it builds a routing
table snapshot). Subsequent starts are normal. Recommended for any public node.

## 3. Remote WebUI access requires CORS config

The WebUI at `http://127.0.0.1:5001/webui` works locally out of the box. If you
want to access the WebUI from another host (pointed at this node's RPC), Kubo
will reject the cross-origin XHR calls unless you allow-list the origin:

```bash
ipfs config --json API.HTTPHeaders.Access-Control-Allow-Origin \
  '["https://your-remote-host","http://127.0.0.1:5001"]'
ipfs config --json API.HTTPHeaders.Access-Control-Allow-Methods \
  '["PUT","POST","GET"]'
docker restart ipfs-node
```

**Never set `Allow-Origin` to `*`.** Port 5001 is an unauthenticated admin RPC
— anyone who can reach it can modify the node's config, pin arbitrary content,
and read private keys. Keep 5001 firewalled to trusted IPs if exposed at all.

## 4. Non-RFC1918 Docker bridge subnets leak into announcements

Kubo auto-filters RFC1918 ranges (10/8, 172.16–172.31, 192.168/16) from DHT
announcements, but some Docker installations use bridge subnets outside that
range (e.g. `172.33.0.0/16`). Those will be announced as if public, causing
noise in provider records and wasted dial attempts by peers.

```bash
ipfs config --json Addresses.NoAnnounce '[
  "/ip4/10.0.0.0/ipcidr/8",
  "/ip4/100.64.0.0/ipcidr/10",
  "/ip4/169.254.0.0/ipcidr/16",
  "/ip4/172.16.0.0/ipcidr/12",
  "/ip4/172.33.0.0/ipcidr/16",
  "/ip4/192.0.0.0/ipcidr/24",
  "/ip4/192.0.2.0/ipcidr/24",
  "/ip4/192.168.0.0/ipcidr/16",
  "/ip4/198.18.0.0/ipcidr/15",
  "/ip4/198.51.100.0/ipcidr/24",
  "/ip4/203.0.113.0/ipcidr/24",
  "/ip4/240.0.0.0/ipcidr/4"
]'
docker restart ipfs-node
```

Adjust `172.33.0.0/16` to match whatever subnet `docker network inspect
ipfs-network` shows for your deployment.

## 5. Common footguns

**`Error: lock /data/ipfs/repo.lock: someone else has the lock`** — you ran
`ipfs daemon` through the `docker exec` alias. The container is already running
the daemon. Just run client commands (`ipfs id`, `ipfs swarm peers`, etc.); the
CLI auto-detects and talks to the running daemon.

**`container name "/ipfs-node" is already in use`** — you ran `docker compose
-f docker/docker-compose.ipfs.yml up -d` without `-p ipfs`. Compose inferred
the project name from the directory and tried to create a second stack. Always
use `make ipfs-*` or pass `-p ipfs` explicitly. Same for monitoring (`-p
monitoring`), cardano, and hydra stacks.

**Data loss on container recreate** — will not happen as long as
`${IPFS_DATA_DIR:-./data/ipfs}/data` is bind-mounted (default). `docker compose
up -d` recreates the container but the repo stays on disk. Avoid `down -v` out
of habit; it would delete named volumes if you ever added any.

**`make ipfs-start` bumps cAdvisor/Prometheus containers to unhealthy** —
unrelated. The cAdvisor image ships a healthcheck hardcoded to port 8080; the
compose file already overrides to 8085.

## 6. Monitoring

Prometheus scrapes Kubo's metrics endpoint directly:

```
- job_name: 'ipfs'
  metrics_path: /debug/metrics/prometheus
  static_configs:
    - targets: ['localhost:5001']
```

This job is in `scripts/generate-prometheus-config.sh` and included every time
the script regenerates `docker/monitoring/prometheus.yml`.

The "IPFS Node" Grafana dashboard is provisioned from
`docker/monitoring/grafana/dashboards/ipfs-node.json`. Metric names track Kubo's
current Prometheus exporter (`ipfs_bitswap_*`, `libp2p_swarm_*`,
`libp2p_rcmgr_*`) and may drift across Kubo releases. If panels show "No data"
after an upgrade, dump the raw metric names and adjust:

```bash
curl -s http://localhost:5001/debug/metrics/prometheus \
  | grep -E '^(ipfs|libp2p)_' | awk '{print $1}' | sort -u
```
