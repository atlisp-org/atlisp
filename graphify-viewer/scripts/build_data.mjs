#!/usr/bin/env node
/**
 * Convert a graphify graph.json (networkx node-link) into a graphology JSON
 * file with a precomputed ForceAtlas2 layout, ready for the Sigma.js viewer.
 *
 * Usage:
 *   node scripts/build_data.mjs <graph.json> [out.json]
 *   node scripts/build_data.mjs /path/to/graphify-out/graph.json public/graph.json
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, basename, resolve } from "node:path";
import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";

const COMMUNITY_COLORS = [
  "#4E79A7", "#F28E2B", "#E15759", "#76B7B2", "#59A14F",
  "#EDC948", "#B07AA1", "#FF9DA7", "#9C755F", "#BAB0AC",
];

function loadCommunityLabels(graphPath) {
  const report = join(dirname(graphPath), "GRAPH_REPORT.md");
  const labels = {};
  if (!existsSync(report)) return labels;
  const text = readFileSync(report, "utf-8");
  const re = /### Community (\d+) - "(.*?)"/g;
  let m;
  while ((m = re.exec(text)) !== null) labels[Number(m[1])] = m[2];
  return labels;
}

const input = resolve(process.argv[2] || "/home/vitalgg/atlisp/graphify-out/graph.json");
const output = resolve(process.argv[3] || "public/graph.json");

const data = JSON.parse(readFileSync(input, "utf-8"));
const rawNodes = data.nodes || [];
const rawEdges = data.links || data.edges || [];

const degree = new Map();
for (const e of rawEdges) {
  degree.set(e.source, (degree.get(e.source) || 0) + 1);
  degree.set(e.target, (degree.get(e.target) || 0) + 1);
}
const maxDeg = Math.max(1, ...degree.values());

const labels = loadCommunityLabels(input);

const graph = new Graph({ multi: false, type: "undirected" });
let seed = 42;
const rand = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
for (const n of rawNodes) {
  const cid = Number(n.community ?? 0);
  graph.addNode(n.id, {
    label: String(n.label ?? n.id),
    size: 3 + 12 * ((degree.get(n.id) || 1) / maxDeg),
    color: COMMUNITY_COLORS[cid % COMMUNITY_COLORS.length],
    community: cid,
    community_name: labels[cid] ?? `Community ${cid}`,
    file_type: n.file_type ?? "",
    source_file: n.source_file ?? "",
    source_location: n.source_location ?? "",
    degree: degree.get(n.id) || 0,
    x: Number.isFinite(n.x) ? n.x : (rand() - 0.5) * 1000,
    y: Number.isFinite(n.y) ? n.y : (rand() - 0.5) * 1000,
  });
}
let i = 0;
for (const e of rawEdges) {
  if (!graph.hasNode(e.source) || !graph.hasNode(e.target)) continue;
  if (graph.hasEdge(e.source, e.target)) continue;
  const conf = e.confidence ?? "EXTRACTED";
  graph.addEdgeWithKey(`e${i++}`, e.source, e.target, {
    relation: e.relation ?? "",
    confidence: conf,
    size: conf === "EXTRACTED" ? 2 : 1,
    color: conf === "EXTRACTED" ? "#888888" : "#555555",
  });
}

console.log(`Layout: ForceAtlas2 on ${graph.order} nodes / ${graph.size} edges...`);
const t0 = Date.now();
forceAtlas2.assign(graph, {
  iterations: 250,
  settings: {
    gravity: 0.08,
    scalingRatio: 30,
    barnesHutOptimize: false,
    slowDown: 2,
  },
});
console.log(`Layout done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const serialized = graph.export();
serialized.meta = {
  source: input,
  communities: labels,
  community_colors: COMMUNITY_COLORS,
  node_count: graph.order,
  edge_count: graph.size,
};

writeFileSync(output, JSON.stringify(serialized));
console.log(`Wrote ${output} (${graph.order} nodes, ${graph.size} edges) - ${basename(input)}`);
