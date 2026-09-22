import Graph from "graphology";
import Sigma from "sigma";
import "./style.css";

const container = document.getElementById("graph");
const statsEl = document.getElementById("stats");
const legendEl = document.getElementById("legend");
const legendCountEl = document.getElementById("legend-count");
const infoEl = document.getElementById("info-content");
const searchEl = document.getElementById("search");
const searchResultsEl = document.getElementById("search-results");
const resetEl = document.getElementById("reset");

const confEnabled = new Set(["EXTRACTED", "INFERRED", "AMBIGUOUS"]);
const hiddenCommunities = new Set();
let hoveredNode = null;
let selectedNode = null;

const dataUrl = new URL("graph.json", document.baseURI).href;

fetch(dataUrl)
  .then((r) => {
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r.json();
  })
  .then(init)
  .catch((err) => {
    container.innerHTML =
      `<div style="padding:24px;color:#e15759;font-size:13px">` +
      `Failed to load graph.json: ${err.message}<br><br>` +
      `Run <code>npm run build:data -- /path/to/graphify-out/graph.json</code> first, ` +
      `and serve the folder over http (not file://).</div>`;
  });

function init(data) {
  const graph = new Graph({ multi: false, type: "undirected" });
  graph.import(data);

  const meta = data.meta || {};
  statsEl.textContent =
    `${graph.order.toLocaleString()} nodes · ${graph.size.toLocaleString()} edges`;

  const renderer = new Sigma(graph, container, {
    renderEdgeLabels: false,
    labelDensity: 0.6,
    labelGridCellSize: 70,
    labelRenderedSizeThreshold: 9,
    minCameraRatio: 0.02,
    maxCameraRatio: 20,
    defaultEdgeColor: "#666",
    zIndex: true,
    hideEdgesOnMove: true,
  });

  renderer.setSetting("nodeReducer", (node, attrs) => {
    const res = { ...attrs };
    if (hiddenCommunities.has(attrs.community)) {
      res.hidden = true;
      return res;
    }
    if (hoveredNode && hoveredNode !== node) {
      if (graph.areNeighbors(hoveredNode, node)) {
        res.highlighted = true;
      } else {
        res.color = "#2a2a3e";
        res.label = "";
      }
    }
    if (selectedNode === node) res.highlighted = true;
    return res;
  });

  renderer.setSetting("edgeReducer", (edge, attrs) => {
    const res = { ...attrs };
    if (!confEnabled.has(attrs.confidence)) {
      res.hidden = true;
      return res;
    }
    const [s, t] = graph.extremities(edge);
    if (hiddenCommunities.has(graph.getNodeAttribute(s, "community")) ||
        hiddenCommunities.has(graph.getNodeAttribute(t, "community"))) {
      res.hidden = true;
      return res;
    }
    if (hoveredNode) {
      if (s === hoveredNode || t === hoveredNode) {
        res.color = "#ffffff";
        res.size = 2.5;
        res.zIndex = 2;
      } else {
        res.color = "#242438";
      }
    }
    return res;
  });

  renderer.on("enterNode", ({ node }) => {
    hoveredNode = node;
    container.style.cursor = "pointer";
    renderer.refresh();
  });
  renderer.on("leaveNode", () => {
    hoveredNode = null;
    container.style.cursor = "default";
    renderer.refresh();
  });
  renderer.on("clickNode", ({ node }) => {
    selectedNode = node;
    showInfo(graph, renderer, node);
    renderer.refresh();
  });
  renderer.on("clickStage", () => {
    selectedNode = null;
    infoEl.className = "muted";
    infoEl.textContent = "Click a node to inspect it";
    renderer.refresh();
  });

  buildLegend(graph, renderer);
  setupSearch(graph, renderer);
  setupConfidenceFilters(renderer);
  resetEl.addEventListener("click", () => fitView(graph, renderer));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      selectedNode = null;
      renderer.refresh();
    }
  });

  fitView(graph, renderer);
  if (meta.node_count > 5000) {
    statsEl.textContent += " · WebGL";
  }
}

function fitView(graph, renderer) {
  renderer.getCamera().animate({ x: 0.5, y: 0.5, ratio: 1 }, { duration: 400 });
}

function focusNode(graph, renderer, node) {
  const d = renderer.getNodeDisplayData(node);
  selectedNode = node;
  if (d) {
    renderer.getCamera().animate(
      { x: d.x, y: d.y, ratio: 0.15 },
      { duration: 500 }
    );
  }
  showInfo(graph, renderer, node);
  renderer.refresh();
}

function showInfo(graph, renderer, node) {
  const a = graph.getNodeAttributes(node);
  const neighbors = graph.neighbors(node);
  const items = neighbors
    .slice(0, 60)
    .map((n) => {
      const na = graph.getNodeAttributes(n);
      const color = na.color || "#555";
      return `<span class="neighbor" data-node="${escapeAttr(n)}" style="border-left-color:${escapeAttr(color)}">${escapeHtml(na.label || n)}</span>`;
    })
    .join("");
  infoEl.className = "";
  infoEl.innerHTML =
    `<div class="title">${escapeHtml(a.label || node)}</div>` +
    `<div class="field"><b>Type:</b> ${escapeHtml(a.file_type || "unknown")}</div>` +
    `<div class="field"><b>Community:</b> ${escapeHtml(a.community_name || "-")}</div>` +
    `<div class="field"><b>Degree:</b> ${a.degree}</div>` +
    `<div class="field"><b>Source:</b> ${escapeHtml(a.source_file || "-")} ${escapeHtml(a.source_location || "")}</div>` +
    (neighbors.length
      ? `<div class="neighbors"><b>Neighbors (${neighbors.length})</b><br>${items}</div>`
      : "");
  infoEl.querySelectorAll(".neighbor").forEach((el) => {
    el.addEventListener("click", () => focusNode(graph, renderer, el.dataset.node));
  });
}

function buildLegend(graph, renderer) {
  const counts = new Map();
  const names = new Map();
  const colors = new Map();
  graph.forEachNode((_, a) => {
    counts.set(a.community, (counts.get(a.community) || 0) + 1);
    names.set(a.community, a.community_name);
    colors.set(a.community, a.color);
  });
  const sorted = [...counts.entries()].sort((x, y) => y[1] - x[1]);
  legendCountEl.textContent = `(${sorted.length})`;
  legendEl.innerHTML = "";
  for (const [cid, count] of sorted) {
    const item = document.createElement("div");
    item.className = "legend-item";
    item.innerHTML =
      `<span class="swatch" style="background:${escapeAttr(colors.get(cid) || "#888")}"></span>` +
      `<span class="name">${escapeHtml(names.get(cid) || "Community " + cid)}</span>` +
      `<span class="count">${count}</span>`;
    item.addEventListener("click", () => {
      if (hiddenCommunities.has(cid)) hiddenCommunities.delete(cid);
      else hiddenCommunities.add(cid);
      item.classList.toggle("off", hiddenCommunities.has(cid));
      renderer.refresh();
    });
    legendEl.appendChild(item);
  }
}

function setupSearch(graph, renderer) {
  let timer = null;
  searchEl.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const q = searchEl.value.trim().toLowerCase();
      searchResultsEl.innerHTML = "";
      if (q.length < 2) return;
      const hits = [];
      graph.forEachNode((id, a) => {
        if (hits.length >= 30) return;
        if ((a.label || id).toLowerCase().includes(q)) hits.push({ id, a });
      });
      for (const { id, a } of hits) {
        const el = document.createElement("div");
        el.className = "search-item";
        el.innerHTML = `<span class="dot" style="background:${escapeAttr(a.color)}"></span>${escapeHtml(a.label || id)}`;
        el.addEventListener("click", () => {
          focusNode(graph, renderer, id);
          searchResultsEl.innerHTML = "";
          searchEl.value = a.label || id;
        });
        searchResultsEl.appendChild(el);
      }
    }, 120);
  });
}

function setupConfidenceFilters(renderer) {
  document.querySelectorAll("input[data-conf]").forEach((cb) => {
    cb.addEventListener("change", () => {
      if (cb.checked) confEnabled.add(cb.dataset.conf);
      else confEnabled.delete(cb.dataset.conf);
      renderer.refresh();
    });
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function escapeAttr(s) {
  return escapeHtml(s);
}
