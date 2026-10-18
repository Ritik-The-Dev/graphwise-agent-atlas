import { describe, expect, it } from "vitest";
import { runCypher } from "@/lib/graph/cypher";
import { shortestPath } from "@/lib/graph/algorithms";
import { scenarios } from "@/lib/graph/scenarios";

const graphOf = (id: string) => scenarios.find((s) => s.id === id)!.graph();

describe("embedded Cypher engine", () => {
  it("finds people sharing a device", () => {
    const r = runCypher(
      graphOf("fraud"),
      "MATCH (p1:Person)-[:USES]->(d:Device)<-[:USES]-(p2:Person) WHERE p1.name < p2.name RETURN d.id AS device, p1.name, p2.name",
    );
    expect(r.table.rows.length).toBe(5);
  });

  it("reaches both critical datastores from the leaked key", () => {
    const r = runCypher(
      graphOf("cloud"),
      "MATCH (k:Credential {status:'leaked'})-[*1..6]->(d:Datastore) WHERE d.sensitivity = 'critical' RETURN DISTINCT d.name",
    );
    expect(r.table.rows.map((x) => x[0]).sort()).toEqual(["prod-postgres", "s3://customer-exports"]);
  });

  it("aggregates with count and orders", () => {
    const r = runCypher(graphOf("brain"), "MATCH (t:Team)-[:OWNS]->(s:Service) RETURN t.name AS team, count(s) AS n ORDER BY n DESC");
    expect(r.table.rows[0]).toEqual(["Payments", 2]);
  });

  it("every scripted agent query runs without error", () => {
    for (const sc of scenarios)
      for (const st of sc.steps) if (st.kind === "cypher") expect(runCypher(sc.graph(), st.cypher).table.rows.length).toBeGreaterThan(0);
  });

  it("shortest attack path from leaked key to prod-postgres is 4 hops", () => {
    expect(shortestPath(graphOf("cloud"), "k1", "pg").metrics.depth).toBe(4);
  });
});
