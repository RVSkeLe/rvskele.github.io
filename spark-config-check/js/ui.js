import { formatValue, normalizeStatus } from "./utils.js";

const form = document.querySelector("#analyze-form");
const input = document.querySelector("#spark-url");
const analyzeButton = document.querySelector("#analyze-button");
const statusNode = document.querySelector("#status");
const resultsNode = document.querySelector("#results");
const summaryPanel = document.querySelector("#summary-panel");
const summaryCounters = document.querySelector("#summary-counters");
const rulesVersionNode = document.querySelector("#rules-version");
const togglePassedButton = document.querySelector("#toggle-passed");

export function bindUi({ onAnalyze }) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await onAnalyze(input.value);
  });

  togglePassedButton.addEventListener("click", () => {
    const hidePassed = togglePassedButton.dataset.hidePassed !== "true";
    togglePassedButton.dataset.hidePassed = String(hidePassed);
    togglePassedButton.textContent = hidePassed ? "Show passed" : "Hide passed";
    renderResults(currentResults, hidePassed);
  });
}

let currentResults = [];

export function showAnalysis(results, rulesVersion) {
  currentResults = results;
  rulesVersionNode.textContent = `Rules version: ${rulesVersion ?? "unknown"}`;
  summaryPanel.classList.remove("hidden");
  renderSummary(results);
  renderResults(results, togglePassedButton.dataset.hidePassed === "true");
}

export function setBusy(busy) {
  analyzeButton.disabled = busy;
  input.disabled = busy;
  analyzeButton.textContent = busy ? "Analyzing…" : "Analyze";
}

export function setStatus(message, type = "") {
  statusNode.className = `status ${type}`.trim();
  statusNode.textContent = message;
}

export function clearResults() {
  currentResults = [];
  resultsNode.replaceChildren();
  summaryPanel.classList.add("hidden");
  summaryCounters.replaceChildren();
  rulesVersionNode.textContent = "";
}

function renderSummary(results) {
  const counts = results.reduce((accumulator, item) => {
    const status = normalizeStatus(item.status, "unknown");
    accumulator[status] = (accumulator[status] ?? 0) + 1;
    return accumulator;
  }, {});

  summaryCounters.replaceChildren();
  for (const [label, value] of [
    ["Checks", results.length], ["Passed", counts.pass ?? 0], ["Info", counts.info ?? 0],
    ["Warnings", counts.warning ?? 0], ["Errors", counts.error ?? 0], ["Unknown", counts.unknown ?? 0]
  ]) {
    const node = document.createElement("span");
    node.className = "counter";
    node.textContent = `${label}: ${value}`;
    summaryCounters.appendChild(node);
  }
}

function renderResults(results, hidePassed) {
  resultsNode.replaceChildren();
  const visible = hidePassed
    ? results.filter((item) => item.status !== "pass" || item.alwaysShow === true)
    : results;

  if (visible.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "All visible checks passed.";
    resultsNode.appendChild(empty);
    return;
  }

  const groups = new Map();
  for (const item of visible) {
    const name = item.group ?? "Other";
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(item);
  }

  for (const [name, items] of groups) {
    const section = document.createElement("section");
    section.className = "result-group";
    const header = document.createElement("div");
    header.className = "result-group-header";
    const title = document.createElement("h2");
    title.textContent = name;
    const summary = document.createElement("span");
    summary.className = "muted";
    summary.textContent = `${items.length} check${items.length === 1 ? "" : "s"}`;
    header.append(title, summary);

    const list = document.createElement("div");
    list.className = "result-list";
    for (const item of items) list.appendChild(resultCard(item));
    section.append(header, list);
    resultsNode.appendChild(section);
  }
}

function resultCard(result) {
  const status = normalizeStatus(result.status, "unknown");
  const article = document.createElement("article");
  article.className = `result-card ${status}`;
  const header = document.createElement("div");
  header.className = "result-card-header";
  const heading = document.createElement("h3");
  heading.textContent = result.title;
  const badge = document.createElement("span");
  badge.className = "result-badge";
  badge.textContent = status.toUpperCase();
  header.append(heading, badge);
  article.appendChild(header);

  if (result.values && typeof result.values === "object") {
    const values = document.createElement("div");
    values.className = "result-values";
    for (const [name, value] of Object.entries(result.values)) {
      const row = document.createElement("div");
      row.textContent = `${name}: ${formatValue(value)}`;
      values.appendChild(row);
    }
    article.appendChild(values);
  }

  const message = document.createElement("p");
  message.className = "result-message";
  message.textContent = result.message ?? "No message provided.";
  article.appendChild(message);

  if (result.description) {
    const description = document.createElement("p");
    description.className = "result-description";
    description.textContent = result.description;
    article.appendChild(description);
  }
  return article;
}
