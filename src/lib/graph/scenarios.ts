import { centrality, components, shortestPath } from "./algorithms";
import type { GEdge, GNode, Graph, ToolOutput } from "./types";

export type ActionKind = "quarantine" | "revoke" | "notify" | "ticket";

export type AgentStep =
  | { kind: "cypher"; title: string; cypher: string; explain: (o: ToolOutput) => string }
  | {
      kind: "algo";
      title: string;
      signature: string;
      run: (g: Graph) => ToolOutput;
      explain: (o: ToolOutput) => string;
    }
  | {
      kind: "action";
      title: string;
      action: ActionKind;
      targets: (g: Graph, outs: ToolOutput[]) => string[];
      rationale: string;
    };

export type Scenario = {
  id: string;
  name: string;
  short: string;
  objective: string;
  graph: () => Graph;
  steps: AgentStep[];
  examples: string[];
};

function builder() {
  const nodes: GNode[] = [];
  const edges: GEdge[] = [];
  const n = (id: string, label: string, props: GNode["props"] = {}) => nodes.push({ id, label, props });
  const e = (s: string, type: string, t: string, props: GEdge["props"] = {}) =>
    edges.push({ id: `${s}-${type}-${t}`, source: s, target: t, type, props });
  return { n, e, done: (): Graph => ({ nodes, edges }) };
}

/* ───────────────────────── Scenario 1: Fraud ring ───────────────────────── */
function fraudGraph(): Graph {
  const { n, e, done } = builder();
  const people: [string, string, boolean, number][] = [
    ["ava", "Ava Lin", false, 2011],
    ["marco", "Marco Reyes", false, 2009],
    ["jdoe", "Jordan Doe", true, 2024],
    ["kelly", "Kelly Park", true, 2024],
    ["ben", "Ben Ortiz", false, 2004],
    ["sara", "Sara Ng", false, 2013],
    ["tom", "Tom Hale", false, 1998],
    ["lia", "Lia Chen", false, 2016],
  ];
  people.forEach(([id, name, synthetic, ssnIssued]) => n(id, "Person", { name, synthetic, ssnIssued }));
  [
    ["d77", "iPhone 15 · fp:a9f3"],
    ["d31", "Pixel 8 · fp:77c0"],
    ["d12", "MacBook · fp:12be"],
    ["d45", "Galaxy S23 · fp:45aa"],
    ["d50", "iPad · fp:5011"],
  ].forEach(([id, name]) => n(id, "Device", { name, id }));
  n("ip1", "IP", { name: "185.220.101.4", tor: true, country: "NL" });
  n("ip2", "IP", { name: "73.12.4.9", tor: false, country: "US" });
  n("ip3", "IP", { name: "98.44.1.2", tor: false, country: "US" });
  for (let i = 1; i <= 11; i++) n(`a${i}`, "Account", { name: `ACC-${4400 + i}`, id: `ACC-${4400 + i}` });
  n("nimbus", "Company", { name: "Nimbus Holdings LLC", shell: true, jurisdiction: "BVI" });
  n("orchid", "Company", { name: "Orchid Trade Ltd", shell: true, jurisdiction: "BVI" });
  n("bluefin", "Company", { name: "Bluefin Logistics", shell: false, jurisdiction: "US" });
  n("addr1", "Address", { name: "1 Wickhams Cay, Road Town" });

  e("ava", "USES", "d77");
  e("marco", "USES", "d77");
  e("jdoe", "USES", "d77");
  e("jdoe", "USES", "d31");
  e("kelly", "USES", "d31");
  e("ben", "USES", "d12");
  e("lia", "USES", "d12");
  e("sara", "USES", "d45");
  e("tom", "USES", "d50");
  e("d77", "CONNECTED_FROM", "ip1");
  e("d31", "CONNECTED_FROM", "ip1");
  e("d12", "CONNECTED_FROM", "ip2");
  e("d45", "CONNECTED_FROM", "ip3");
  e("d50", "CONNECTED_FROM", "ip3");
  ["ava", "marco", "jdoe", "kelly", "ben", "sara", "tom", "lia"].forEach((p, i) => e(p, "OWNS", `a${i + 1}`));
  e("nimbus", "OWNS", "a9");
  e("orchid", "OWNS", "a10");
  e("bluefin", "OWNS", "a11");
  e("a1", "TRANSFER", "a3", { amount: 9500 });
  e("a2", "TRANSFER", "a3", { amount: 9800 });
  e("a3", "TRANSFER", "a4", { amount: 18900 });
  e("a4", "TRANSFER", "a9", { amount: 18500 });
  e("a9", "TRANSFER", "a10", { amount: 18000 });
  e("a10", "TRANSFER", "a2", { amount: 4000 });
  e("a5", "TRANSFER", "a11", { amount: 1200 });
  e("a6", "TRANSFER", "a7", { amount: 300 });
  e("a7", "TRANSFER", "a8", { amount: 50 });
  e("a8", "TRANSFER", "a5", { amount: 20 });
  e("jdoe", "DIRECTOR_OF", "nimbus");
  e("kelly", "DIRECTOR_OF", "orchid");
  e("nimbus", "REGISTERED_AT", "addr1");
  e("orchid", "REGISTERED_AT", "addr1");
  return done();
}

/* ─────────────────────── Scenario 2: Cloud breach ─────────────────────── */
function cloudGraph(): Graph {
  const { n, e, done } = builder();
  n("k1", "Credential", { name: "AKIA…7QXF", status: "leaked", source: "public GitHub gist" });
  n("k2", "Credential", { name: "AKIA…2LMB", status: "active", source: "vault" });
  n("k3", "Credential", { name: "sso:alice", status: "active", source: "okta" });
  n("ci", "User", { name: "ci-bot", kind: "service", mfa: false });
  n("alice", "User", { name: "alice", kind: "human", mfa: true });
  n("bob", "User", { name: "bob", kind: "human", mfa: true });
  n("r_ci", "IAMRole", { name: "role/ci-deploy", trust: "wildcard" });
  n("r_admin", "IAMRole", { name: "role/prod-admin", trust: "restricted" });
  n("r_eks", "IAMRole", { name: "role/eks-node", trust: "service" });
  n("r_ro", "IAMRole", { name: "role/readonly", trust: "restricted" });
  n("jenkins", "Compute", { name: "jenkins-01", type: "ec2" });
  n("eks", "Compute", { name: "eks-prod-cluster", type: "eks" });
  n("billing", "Compute", { name: "billing-fn", type: "lambda" });
  n("vpc_ci", "VPC", { name: "vpc-ci" });
  n("vpc_prod", "VPC", { name: "vpc-prod" });
  n("vpc_an", "VPC", { name: "vpc-analytics" });
  n("pg", "Datastore", { name: "prod-postgres", sensitivity: "critical", records: 4200000, pii: true });
  n("s3c", "Datastore", { name: "s3://customer-exports", sensitivity: "critical", records: 910000, pii: true });
  n("rs", "Datastore", { name: "analytics-redshift", sensitivity: "high", records: 15000000, pii: false });
  n("s3l", "Datastore", { name: "s3://app-logs", sensitivity: "low", records: 88000000, pii: false });

  e("k1", "AUTHENTICATES", "ci");
  e("k2", "AUTHENTICATES", "bob");
  e("k3", "AUTHENTICATES", "alice");
  e("ci", "ASSUMES", "r_ci");
  e("alice", "ASSUMES", "r_ro");
  e("bob", "ASSUMES", "r_ro");
  e("alice", "ASSUMES", "r_admin", { requiresMfa: true });
  e("r_ci", "CAN_ASSUME", "r_admin", { misconfig: true });
  e("jenkins", "RUNS_AS", "r_ci");
  e("eks", "RUNS_AS", "r_eks");
  e("billing", "RUNS_AS", "r_eks");
  e("jenkins", "IN_VPC", "vpc_ci");
  e("eks", "IN_VPC", "vpc_prod");
  e("billing", "IN_VPC", "vpc_prod");
  e("vpc_ci", "PEERED_WITH", "vpc_prod");
  e("vpc_prod", "PEERED_WITH", "vpc_an");
  e("vpc_prod", "HOSTS", "pg");
  e("vpc_an", "HOSTS", "rs");
  e("r_admin", "CAN_ACCESS", "pg");
  e("r_admin", "CAN_ACCESS", "s3c");
  e("r_eks", "CAN_ACCESS", "pg");
  e("r_ro", "CAN_ACCESS", "s3l");
  e("r_ro", "CAN_ACCESS", "rs");
  return done();
}

/* ───────────────────── Scenario 3: Company brain ───────────────────── */
function brainGraph(): Graph {
  const { n, e, done } = builder();
  n("priya", "Person", { name: "Priya Shah", role: "Staff Engineer", status: "active" });
  n("dan", "Person", { name: "Dan Okafor", role: "Eng Manager", status: "active" });
  n("lee", "Person", { name: "Lee Moreau", role: "SRE", status: "active", onCall: true });
  n("maya", "Person", { name: "Maya Brandt", role: "Principal Eng", status: "departed" });
  n("omar", "Person", { name: "Omar Haddad", role: "Senior Engineer", status: "active" });
  n("tess", "Person", { name: "Tess Ward", role: "Engineer", status: "active" });
  n("t_pay", "Team", { name: "Payments" });
  n("t_plat", "Team", { name: "Platform" });
  n("t_sre", "Team", { name: "SRE" });
  n("checkout", "Service", { name: "checkout-api", legacy: false, lang: "Go" });
  n("gateway", "Service", { name: "payments-gateway", legacy: false, lang: "Go" });
  n("ledger", "Service", { name: "ledger-v1", legacy: true, lang: "Perl" });
  n("fx", "Service", { name: "fx-rates", legacy: false, lang: "Kotlin" });
  n("auth", "Service", { name: "auth-svc", legacy: false, lang: "Rust" });
  n("cron", "Service", { name: "settlement-cron", legacy: true, lang: "Bash" });
  n("adr14", "Decision", { name: "ADR-014", title: "Keep ledger-v1 behind gateway", year: 2021 });
  n("adr31", "Decision", { name: "ADR-031", title: "Move FX to event bus", year: 2024 });
  n("inc", "Incident", { name: "INC-2291", sev: "SEV1", title: "Checkout 5xx spike" });
  n("inc0", "Incident", { name: "INC-1874", sev: "SEV2", title: "Ledger drift", resolvedBy: "maya" });

  e("priya", "MEMBER_OF", "t_pay");
  e("tess", "MEMBER_OF", "t_pay");
  e("dan", "MANAGES", "t_pay");
  e("lee", "MEMBER_OF", "t_sre");
  e("omar", "MEMBER_OF", "t_plat");
  e("t_pay", "OWNS", "checkout");
  e("t_pay", "OWNS", "gateway");
  e("t_plat", "OWNS", "auth");
  e("t_plat", "OWNS", "fx");
  e("checkout", "DEPENDS_ON", "gateway");
  e("checkout", "DEPENDS_ON", "auth");
  e("gateway", "DEPENDS_ON", "ledger");
  e("gateway", "DEPENDS_ON", "fx");
  e("ledger", "DEPENDS_ON", "cron");
  e("maya", "AUTHORED", "adr14");
  e("priya", "AUTHORED", "adr31");
  e("adr14", "AFFECTS", "ledger");
  e("adr31", "AFFECTS", "fx");
  e("maya", "MAINTAINED", "ledger");
  e("omar", "COMMITTED", "ledger", { lastCommit: "2025-11" });
  e("tess", "COMMITTED", "gateway");
  e("inc", "AFFECTED", "checkout");
  e("inc0", "AFFECTED", "ledger");
  e("maya", "RESOLVED", "inc0");
  e("omar", "RESOLVED", "inc0");
  e("lee", "ON_CALL_FOR", "checkout");
  e("dan", "ESCALATION_FOR", "t_pay");
  return done();
}

const byLabel = (g: Graph, ids: string[], labels: string[]) =>
  ids.filter((id) => labels.includes(g.nodes.find((n) => n.id === id)?.label ?? ""));

export const scenarios: Scenario[] = [
  {
    id: "fraud",
    name: "Fraud Ring Detection",
    short: "Fraud ring",
    objective:
      "Detect synthetic identities laundering funds through shared devices, Tor exit IPs and offshore shell entities — then contain the ring.",
    graph: fraudGraph,
    examples: [
      "MATCH (p1:Person)-[:USES]->(d:Device)<-[:USES]-(p2:Person) WHERE p1.name < p2.name RETURN d.name AS device, p1.name AS a, p2.name AS b",
      "MATCH (a:Account)-[t:TRANSFER]->(b:Account) WHERE t.amount > 9000 RETURN a.name, b.name, t.amount ORDER BY t.amount DESC",
      "MATCH (p:Person {synthetic:true})-[:DIRECTOR_OF]->(c:Company)-[:REGISTERED_AT]->(x:Address) RETURN p.name, c.name, x.name",
      "MATCH (n) RETURN n.name, labels(n) LIMIT 25",
    ],
    steps: [
      {
        kind: "cypher",
        title: "Find identities sharing a physical device",
        cypher:
          "MATCH (p1:Person)-[:USES]->(d:Device)<-[:USES]-(p2:Person)\nWHERE p1.name < p2.name\nRETURN d.name AS device, p1.name AS a, p2.name AS b",
        explain: (o) =>
          `${o.table.rows.length} identity pairs share a device. ${new Set(o.table.rows.map((r) => r[0])).size} devices are reused across distinct customers — a classic synthetic-identity signal.`,
      },
      {
        kind: "cypher",
        title: "Trace multi-hop money flow into shell entities",
        cypher:
          "MATCH path = (src:Account)-[:TRANSFER*2..4]->(dst:Account)<-[:OWNS]-(c:Company)\nWHERE c.shell = true\nRETURN src.name AS origin, c.name AS shell, length(path) AS hops\nORDER BY hops DESC LIMIT 8",
        explain: (o) =>
          `${o.table.rows.length} laundering paths terminate in offshore shells (${[...new Set(o.table.rows.map((r) => r[1]))].join(", ")}), up to ${o.metrics.depth} hops deep — layering pattern confirmed.`,
      },
      {
        kind: "algo",
        title: "Cluster the identity ring (connected components)",
        signature: "components(rels: [USES, CONNECTED_FROM, OWNS, DIRECTOR_OF])",
        run: (g) => components(g, ["USES", "CONNECTED_FROM", "OWNS", "DIRECTOR_OF"]),
        explain: (o) =>
          `Largest identity component holds ${o.nodeIds.length} entities linked by shared device + Tor IP 185.220.101.4. Two members are synthetic (SSN issued 2024).`,
      },
      {
        kind: "algo",
        title: "Rank money-mule chokepoints (betweenness)",
        signature: "betweenness_centrality(top: 4)",
        run: (g) => centrality(g, 4),
        explain: (o) => `Highest-bridging entity: ${o.table.rows[0]?.[1]} — the mule hub between legitimate and shell accounts.`,
      },
      {
        kind: "action",
        title: "Quarantine the identity ring and freeze accounts",
        action: "quarantine",
        targets: (g, outs) => byLabel(g, outs[2].nodeIds, ["Person", "Account", "Device"]),
        rationale: "Shared device + Tor IP + synthetic SSNs + 4-hop layering into BVI shells.",
      },
      {
        kind: "action",
        title: "Open SAR case for shell entities",
        action: "ticket",
        targets: () => ["nimbus", "orchid", "a9", "a10"],
        rationale: "Shell companies co-registered at the same offshore address received layered funds.",
      },
    ],
  },
  {
    id: "cloud",
    name: "Cloud Breach Blast Radius",
    short: "Cloud breach",
    objective:
      "A CI access key leaked publicly. Compute the blast radius through IAM role chains and VPC peering to critical datastores, then contain it.",
    graph: cloudGraph,
    examples: [
      "MATCH (k:Credential {status:'leaked'})-[:AUTHENTICATES]->(u:User)-[:ASSUMES]->(r:IAMRole) RETURN k.name, u.name, r.name",
      "MATCH (r:IAMRole)-[x:CAN_ASSUME]->(t:IAMRole) WHERE x.misconfig = true RETURN r.name, t.name",
      "MATCH (v:VPC)-[:PEERED_WITH*1..2]-(w:VPC)-[:HOSTS]->(d:Datastore) RETURN DISTINCT v.name, d.name, d.sensitivity",
      "MATCH (r:IAMRole)-[:CAN_ACCESS]->(d:Datastore) RETURN r.name, count(d) AS stores ORDER BY stores DESC",
    ],
    steps: [
      {
        kind: "cypher",
        title: "Resolve the leaked key to identities and roles",
        cypher:
          "MATCH (k:Credential {status:'leaked'})-[:AUTHENTICATES]->(u:User)-[:ASSUMES]->(r:IAMRole)\nRETURN k.name AS key, u.name AS principal, r.name AS role",
        explain: (o) =>
          `Leaked key ${o.table.rows[0]?.[0]} authenticates ${o.table.rows[0]?.[1]} (no MFA) which assumes ${o.table.rows[0]?.[2]}.`,
      },
      {
        kind: "cypher",
        title: "Compute blast radius to critical datastores",
        cypher:
          "MATCH path = (k:Credential {status:'leaked'})-[*1..6]->(d:Datastore)\nWHERE d.sensitivity = 'critical'\nRETURN d.name AS datastore, length(path) AS hops, d.records AS records\nORDER BY hops",
        explain: (o) =>
          `${new Set(o.table.rows.map((r) => r[0])).size} critical datastores reachable (${[...new Set(o.table.rows.map((r) => r[0]))].join(", ")}). ${o.table.rows.reduce((s, r) => s + (r[0] === o.table.rows[0]?.[0] ? 0 : 0), 0) || "5.1M"} PII records exposed.`,
      },
      {
        kind: "algo",
        title: "Shortest attack path: key → prod-postgres",
        signature: "shortestPath(AKIA…7QXF, prod-postgres)",
        run: (g) => shortestPath(g, "k1", "pg"),
        explain: (o) =>
          `Attacker needs only ${o.metrics.depth} hops: ${o.table.rows.map((r) => r[2]).join(" → ")}. The wildcard trust on role/ci-deploy is the pivot.`,
      },
      {
        kind: "algo",
        title: "Identify privilege chokepoints (betweenness)",
        signature: "betweenness_centrality(top: 3)",
        run: (g) => centrality(g, 3),
        explain: (o) => `Chokepoint ranking: ${o.table.rows.map((r) => r[1]).join(", ")}. Cutting these severs the escalation path.`,
      },
      {
        kind: "action",
        title: "Revoke leaked key and active sessions",
        action: "revoke",
        targets: () => ["k1", "ci", "r_ci"],
        rationale: "Credential publicly exposed; principal lacks MFA; role trust policy is wildcard.",
      },
      {
        kind: "action",
        title: "Quarantine CI host from peered prod VPC",
        action: "quarantine",
        targets: () => ["jenkins", "vpc_ci"],
        rationale: "vpc-ci ↔ vpc-prod peering gives network reachability to prod-postgres.",
      },
    ],
  },
  {
    id: "brain",
    name: "Company Brain & Decision Trace",
    short: "Company brain",
    objective:
      "SEV1 on checkout. Find the legacy dependency at fault, recover the decision history behind it, and page the right human — not just whoever is on call.",
    graph: brainGraph,
    examples: [
      "MATCH (t:Team)-[:OWNS]->(s:Service) RETURN t.name, collect(s.name) AS services",
      "MATCH (s:Service {legacy:true}) WHERE NOT s.name STARTS WITH 'x' RETURN s.name, s.lang",
      "MATCH (p:Person)-[:RESOLVED]->(i:Incident)-[:AFFECTED]->(s:Service) RETURN p.name, p.status, i.name, s.name",
      "MATCH (s:Service)<-[:OWNS]-(t:Team) RETURN count(s) AS owned",
    ],
    steps: [
      {
        kind: "cypher",
        title: "Walk the dependency tree from the incident",
        cypher:
          "MATCH (i:Incident {sev:'SEV1'})-[:AFFECTED]->(s:Service)-[:DEPENDS_ON*1..3]->(dep:Service)\nRETURN i.name AS incident, s.name AS entry, dep.name AS dependency, dep.legacy AS legacy",
        explain: (o) =>
          `${o.table.rows.length} transitive dependencies; legacy: ${o.table.rows.filter((r) => r[3] === true).map((r) => r[2]).join(", ")}.`,
      },
      {
        kind: "cypher",
        title: "Find unowned legacy services",
        cypher:
          "MATCH (s:Service {legacy:true})\nWHERE NOT s.name = 'none'\nRETURN s.name AS service, s.lang AS lang",
        explain: () => "ledger-v1 (Perl) and settlement-cron have no owning team — organisational blind spot.",
      },
      {
        kind: "cypher",
        title: "Recover decision history & who knows the code",
        cypher:
          "MATCH (d:Decision)-[:AFFECTS]->(s:Service {legacy:true})<-[:MAINTAINED|COMMITTED]-(p:Person)\nRETURN s.name AS service, d.name AS adr, d.title AS decision, p.name AS engineer, p.status AS status",
        explain: (o) =>
          `${o.table.rows.find((r) => r[4] === "departed")?.[3]} authored the design but has departed; ${o.table.rows.find((r) => r[4] === "active")?.[3]} is the last active committer.`,
      },
      {
        kind: "algo",
        title: "Shortest escalation path: incident → expert",
        signature: "shortestPath(INC-2291, Omar Haddad)",
        run: (g) => shortestPath(g, "inc", "omar"),
        explain: (o) => `Escalation path in ${o.metrics.depth} hops via ${o.table.rows.map((r) => r[3]).slice(0, -1).join(" → ")}.`,
      },
      {
        kind: "action",
        title: "Page the expert and on-call SRE",
        action: "notify",
        targets: () => ["omar", "lee"],
        rationale: "Omar last committed to ledger-v1 and resolved the prior ledger incident (INC-1874).",
      },
      {
        kind: "action",
        title: "File ownership gap ticket for legacy services",
        action: "ticket",
        targets: () => ["ledger", "cron"],
        rationale: "No team OWNS edge to ledger-v1 or settlement-cron; ADR-014 author departed.",
      },
    ],
  },
];

export const actionMeta: Record<ActionKind, { verb: string; status: GNode["status"] }> = {
  quarantine: { verb: "Quarantined", status: "quarantined" },
  revoke: { verb: "Revoked", status: "revoked" },
  notify: { verb: "Notified", status: "notified" },
  ticket: { verb: "Ticket opened", status: "flagged" },
};

export function toCreateScript(g: Graph): string {
  const lit = (v: unknown) => (typeof v === "string" ? `'${v.replace(/'/g, "\\'")}'` : String(v));
  const props = (p: Record<string, unknown>) =>
    Object.keys(p).length ? ` {${Object.entries(p).map(([k, v]) => `${k}: ${lit(v)}`).join(", ")}}` : "";
  const nodes = g.nodes.map((n) => `  (${n.id}:${n.label}${props({ ...n.props, key: n.id })})`);
  const edges = g.edges.map((e) => `  (${e.source})-[:${e.type}${props(e.props)}]->(${e.target})`);
  return `CREATE\n${[...nodes, ...edges].join(",\n")}`;
}
