# Graphwise Agent Atlas

Build a hackathon-winning application for "Graph Hacks: Give Your AI Agents Real Context" (WeMakeDevs x FalkorDB).

Target Track: Track 01 — Agents That Act on Connected Data (Easiest to achieve 100% complete, visually stunning demo with multi-hop reasoning, graph algorithms, and explainable decision paths).

Key Requirements & Design Principles:
1. Aesthetic & UI: Minimalist, modern, highly polished developer-tool aesthetic (Linear/Vercel inspired, dark mode by default with clean monochrome accents, crisp typography, subtle borders, no generic AI styling). Must look like an elite production product built by top engineers.
2. Core Architecture & FalkorDB Context Layer:
   - FalkorDB Integration: Direct FalkorDB connection settings (Host, Port, Graph Name, Password, Docker run snippet `docker pull falkordb/falkordb:latest`) + robust built-in browser-based FalkorDB Cypher Engine so judges can test and demo every single query and graph traversal instantly with zero setup.
   - Interactive Visual Graph Canvas: Force-directed interactive node-edge graph visualization (zoom, pan, node drag, click to inspect attributes, highlight multi-hop paths during agent reasoning).
   - Autonomous Agent Loop with Explainability: Step-by-step trace showing (1) Agent Objective, (2) Multi-hop Cypher Query generated, (3) Graph execution & algorithmic metrics (traversal depth, nodes touched, execution ms), (4) Graph evidence extracted, and (5) Autonomous action taken.
3. Pre-loaded High-Impact Demo Scenarios:
   - Scenario 1: Fraud Ring & Synthetic Identity Detection (Tracking multi-hop laundering through shared devices, IP addresses, and shell entities using Cypher path matching).
   - Scenario 2: Cloud Security Breach & Incident Blast Radius (Tracing compromised credentials through IAM roles, VPC peering, and sensitive production datastores).
   - Scenario 3: Company Brain & Decision Traceability (Who worked on what, legacy architecture dependencies, and incident escalation paths).
4. Features:
   - Cypher Query Editor & Runner: Interactive query bar where users or the agent can run Cypher statements directly against the graph with syntax highlighting, latency measurement, and graph/table view.
   - Graph Algorithm Tools: Run Shortest Path, Centrality, and Connected Components directly as agent tools.
   - Action Execution Center: The agent takes real actions based on graph evidence (e.g. Quarantine node cluster, Revoke IAM session, Notify on-call engineer) with full explainable audit trail.
   - Hackathon Submission Kit / README Modal: Quick overview of FalkorDB graph schema, Cypher queries used, architecture diagram, and submission details for WeMakeDevs judges.


**Live app**: https://hopewise.ritik.biz

## Development

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
