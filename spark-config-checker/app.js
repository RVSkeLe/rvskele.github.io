"use strict";

const state = { hidePassed: false, results: [] };
const statuses = new Set(["pass", "info", "warning", "error", "unknown"]);

const operators = {
  equals: (value, rule) => equal(value, rule.expected),
  notEquals: (value, rule) => !equal(value, rule.expected),
  gt: (value, rule) => finite(value) && value > rule.expected,
  gte: (value, rule) => finite(value) && value >= rule.expected,
  lt: (value, rule) => finite(value) && value < rule.expected,
  lte: (value, rule) => finite(value) && value <= rule.expected,
  between: (value, rule) => finite(value) && value >= rule.min && value <= rule.max,
  oneOf: (value, rule) => Array.isArray(rule.expected) && rule.expected.some((item) => equal(value, item)),
  includes: (value, rule) => Array.isArray(value) ? value.some((item) => equal(item, rule.expected)) : typeof value === "string" && value.includes(String(rule.expected)),
  exists: (_value, _rule, lookup) => lookup.found,
  isBoolean: (value) => typeof value === "boolean",
  isNumber: (value) => finite(value),
  isString: (value) => typeof value === "string"
};

const form = document.querySelector("#analyze-form");
const input = document.querySelector("#spark-url");
const analyzeButton = document.querySelector("#analyze-button");
const statusNode = document.querySelector("#status");
const resultsNode = document.querySelector("#results");
const summaryPanel = document.querySelector("#summary-panel");
const summaryCounters = document.querySelector("#summary-counters");
const rulesVersionNode = document.querySelector("#rules-version");
const togglePassedButton = document.querySelector("#toggle-passed");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await analyze(input.value);
});

togglePassedButton.addEventListener("click", () => {
  state.hidePassed = !state.hidePassed;
  togglePassedButton.textContent = state.hidePassed ? "Show passed" : "Hide passed";
  renderResults(state.results);
});

async function analyze(rawUrl) {
  setBusy(true);
  clearResults();
  setStatus("Loading report and rules…");

  try {
    const [configurations, rules] = await Promise.all([
      fetchJson(createRawUrl(rawUrl)),
      fetchJson("./rules.json", { cache: "no-cache" })
    ]);

    validateRules(rules);
    state.results = runChecks(configurations, rules);

    rulesVersionNode.textContent = `Rules version: ${rules.rulesVersion ?? "unknown"}`;
    summaryPanel.classList.remove("hidden");
    renderSummary(state.results);
    renderResults(state.results);
    setStatus(`Analysis complete: ${state.results.length} checks.`, "success");
  } catch (error) {
    console.error(error);
    setStatus(error instanceof Error ? error.message : String(error), "error");
  } finally {
    setBusy(false);
  }
}

function createRawUrl(rawInput) {
  let url;
  try { url = new URL(rawInput.trim()); }
  catch { throw new Error("Enter a valid URL."); }

  if (url.protocol !== "https:" || url.hostname !== "spark.lucko.me") {
    throw new Error("Enter a valid https://spark.lucko.me report URL.");
  }
  if (!url.pathname || url.pathname === "/") {
    throw new Error("The Spark report URL is missing its report ID.");
  }

  url.search = "";
  url.hash = "";
  url.searchParams.set("raw", "1");
  url.searchParams.set("path", "metadata.serverConfigurations");
  return url.toString();
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { headers: { Accept: "application/json" }, ...options });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}.`);
  try { return await response.json(); }
  catch { throw new Error(`${url} did not return valid JSON.`); }
}

function validateRules(rules) {
  if (!rules || typeof rules !== "object" || Array.isArray(rules)) throw new Error("rules.json must contain an object.");
  if (rules.schemaVersion !== 1) throw new Error(`Unsupported rules schema version: ${String(rules.schemaVersion)}`);
  if (!Array.isArray(rules.checkGroups)) throw new Error("rules.json checkGroups must be an array.");
  if (!Array.isArray(rules.compositeChecks)) throw new Error("rules.json compositeChecks must be an array.");
}

function runChecks(configurations, rules) {
  const cache = new Map();
  const simple = rules.checkGroups.flatMap((group) =>
    group.rules.map((rule) => evaluateRule(group, rule, configurations, cache))
  );
  const composite = rules.compositeChecks.map((definition) =>
    evaluateComposite(definition, configurations, cache)
  );
  return [...simple, ...composite];
}

function evaluateRule(group, rule, configurations, cache) {
  const path = [...(group.basePath ?? []), ...(rule.path ?? [])];
  const base = {
    kind: "rule", id: rule.id, group: group.group ?? group.file,
    title: rule.title, file: group.file, path,
    description: rule.description ?? "", alwaysShow: rule.alwaysShow === true
  };

  let config;
  try { config = parsedConfig(configurations, group.file, cache); }
  catch (error) { return { ...base, status: "unknown", value: undefined, message: error.message }; }

  const lookup = nested(config, path);
  const operatorName = rule.operator ?? "equals";
  const operator = operators[operatorName];
  if (!operator) return { ...base, status: "unknown", value: lookup.value, message: `Unsupported operator: ${operatorName}` };
  if (!lookup.found && operatorName !== "exists") {
    return { ...base, status: rule.missingSeverity ?? "unknown", value: undefined, message: rule.missingMessage ?? "Configuration path was not found." };
  }

  let passed;
  try { passed = operator(lookup.value, rule, lookup); }
  catch (error) { return { ...base, status: "unknown", value: lookup.value, message: `Evaluation failed: ${error.message}` }; }

  return {
    ...base,
    status: passed ? "pass" : normalizeStatus(rule.severity, "warning"),
    value: lookup.value,
    message: passed ? (rule.passMessage ?? passMessage(rule)) : (rule.failMessage ?? failureMessage(rule, lookup.value))
  };
}

function evaluateComposite(definition, configurations, cache) {
  switch (definition.type) {
    case "online-mode": return evaluateOnlineMode(definition, configurations, cache);
    case "spigot-world-setting": return evaluateWorldSetting(definition, configurations, cache);
    default:
      return { kind: "composite", id: definition.id, group: definition.group ?? "Composite checks", title: definition.title ?? "Unknown composite check", description: definition.description ?? "", status: "unknown", message: `Unsupported composite type: ${definition.type}` };
  }
}

function evaluateOnlineMode(definition, configurations, cache) {
  const onlineMode = optional(configurations, cache, "server.properties", ["online-mode"]);
  const velocityEnabled = optional(configurations, cache, "paper/", ["global.yml", "proxies", "velocity", "enabled"]);
  const velocityOnlineMode = optional(configurations, cache, "paper/", ["global.yml", "proxies", "velocity", "online-mode"]);
  const bungeeEnabled = optional(configurations, cache, "spigot.yml", ["settings", "bungeecord"]);
  const bungeeOnlineMode = optional(configurations, cache, "paper/", ["global.yml", "proxies", "bungee-cord", "online-mode"]);

  let status = "pass";
  let message;
  if (onlineMode === true) message = "The server authenticates players directly.";
  else if (velocityEnabled === true && velocityOnlineMode === true) message = "Velocity authentication appears to be enabled.";
  else if (bungeeEnabled === true && bungeeOnlineMode === true) message = "BungeeCord authentication appears to be enabled.";
  else {
    status = normalizeStatus(definition.severity, "warning");
    message = "Online mode is disabled without a detected authenticated proxy configuration.";
  }

  return { kind: "composite", id: definition.id, group: definition.group ?? "Misc", title: definition.title, description: definition.description ?? "", alwaysShow: definition.alwaysShow === true, status, message };
}

function evaluateWorldSetting(definition, configurations, cache) {
  const base = { kind: "composite", id: definition.id, group: definition.group ?? "World distances", title: definition.title, description: definition.description ?? "", alwaysShow: definition.alwaysShow === true };
  let resolved;
  try { resolved = resolveSpigotWorldSetting(configurations, cache, definition.key); }
  catch (error) { return { ...base, status: "unknown", message: error.message }; }

  const entries = [{ name: "default", value: resolved.default.value }, ...resolved.explicitWorldOverrides.map((item) => ({ name: item.world, value: item.value }))];
  const invalid = entries.filter((item) => !finite(item.value));
  if (invalid.length) return { ...base, status: "unknown", message: `Could not determine a numeric ${definition.key} for: ${invalid.map((item) => item.name).join(", ")}` };

  const excessive = entries.filter((item) => item.value > definition.maximum);
  if (excessive.length) {
    return { ...base, status: normalizeStatus(definition.severity, "warning"), message: [`Maximum recommended value: ${definition.maximum}`, "", "Values above the limit:", ...excessive.map((item) => `• ${item.name}: ${item.value}`)].join("\n") };
  }

  const differs = resolved.default.differsFromServer || resolved.explicitWorldOverrides.some((item) => item.differsFromDefault);
  return {
    ...base,
    status: differs ? normalizeStatus(definition.differenceSeverity, "warning") : "pass",
    message: differs ? differenceMessage(resolved) : matchingMessage(resolved)
  };
}

function resolveSpigotWorldSetting(configurations, cache, key) {
  const server = parsedConfig(configurations, "server.properties", cache);
  const spigot = parsedConfig(configurations, "spigot.yml", cache);
  const serverValue = server[key];
  const worldSettings = spigot?.["world-settings"] ?? {};
  const rawDefault = worldSettings?.default?.[key];
  const overridden = rawDefault !== undefined && rawDefault !== null && rawDefault !== "default";
  const effectiveDefault = overridden ? rawDefault : serverValue;
  const explicitWorldOverrides = [];

  for (const [world, settings] of Object.entries(worldSettings)) {
    if (world === "default") continue;
    const value = settings?.[key];
    if (value === undefined || value === null || value === "default") continue;
    explicitWorldOverrides.push({ world, value, differsFromDefault: !equal(value, effectiveDefault) });
  }

  return {
    key,
    serverValue,
    default: { value: effectiveDefault, overridden, differsFromServer: overridden && !equal(effectiveDefault, serverValue) },
    explicitWorldOverrides
  };
}

function differenceMessage(resolved) {
  const lines = [];
  if (resolved.default.differsFromServer) lines.push(`Default override: ${resolved.serverValue} → ${resolved.default.value}`);
  else if (resolved.default.overridden) lines.push(`Default explicitly set to ${resolved.default.value}`);

  const differing = resolved.explicitWorldOverrides.filter((item) => item.differsFromDefault);
  const matching = resolved.explicitWorldOverrides.filter((item) => !item.differsFromDefault);

  if (differing.length) lines.push("", "World overrides:", ...differing.map((item) => `• ${item.world}: ${resolved.default.value} → ${item.value}`));
  if (matching.length) lines.push("", `Explicitly matching default (${resolved.default.value}):`, ...matching.map((item) => `• ${item.world}`));
  return lines.join("\n").trim();
}

function matchingMessage(resolved) {
  const lines = [`Effective ${resolved.key}: ${resolved.default.value}`];
  const matching = resolved.explicitWorldOverrides.filter((item) => !item.differsFromDefault);
  if (matching.length) lines.push("", `Explicitly matching default (${resolved.default.value}):`, ...matching.map((item) => `• ${item.world}`));
  return lines.join("\n");
}

function parsedConfig(configurations, filename, cache) {
  if (cache.has(filename)) return cache.get(filename);
  if (!Object.prototype.hasOwnProperty.call(configurations, filename)) throw new Error(`${filename} was not found in the Spark report.`);
  const raw = configurations[filename];
  let parsed;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) parsed = raw;
  else if (typeof raw === "string") {
    try { parsed = JSON.parse(raw); }
    catch { throw new Error(`${filename} could not be parsed.`); }
  } else throw new Error(`${filename} has an unsupported value type.`);
  cache.set(filename, parsed);
  return parsed;
}

function nested(object, path) {
  let current = object;
  for (const segment of path) {
    if (current === null || typeof current !== "object" || !Object.prototype.hasOwnProperty.call(current, segment)) return { found: false, value: undefined };
    current = current[segment];
  }
  return { found: true, value: current };
}

function optional(configurations, cache, file, path) {
  try { return nested(parsedConfig(configurations, file, cache), path).value; }
  catch { return undefined; }
}

function passMessage(rule) {
  switch (rule.operator) {
    case "equals": return `Value matches ${formatValue(rule.expected)}.`;
    case "lte": return `Value is at most ${formatValue(rule.expected)}.`;
    case "gte": return `Value is at least ${formatValue(rule.expected)}.`;
    case "between": return `Value is between ${formatValue(rule.min)} and ${formatValue(rule.max)}.`;
    default: return "Check passed.";
  }
}

function failureMessage(rule, value) {
  switch (rule.operator) {
    case "equals": return `Expected ${formatValue(rule.expected)}, found ${formatValue(value)}.`;
    case "lte": return `Expected at most ${formatValue(rule.expected)}, found ${formatValue(value)}.`;
    case "gte": return `Expected at least ${formatValue(rule.expected)}, found ${formatValue(value)}.`;
    case "between": return `Expected between ${formatValue(rule.min)} and ${formatValue(rule.max)}, found ${formatValue(value)}.`;
    default: return "Check failed.";
  }
}

function equal(a, b) {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  try { return JSON.stringify(a) === JSON.stringify(b); }
  catch { return false; }
}

function finite(value) { return typeof value === "number" && Number.isFinite(value); }
function normalizeStatus(value, fallback) { return statuses.has(value) ? value : fallback; }
function formatValue(value) {
  if (value === undefined) return "undefined";
  if (typeof value === "string") return JSON.stringify(value);
  if (value && typeof value === "object") { try { return JSON.stringify(value); } catch { return String(value); } }
  return String(value);
}

function renderSummary(results) {
  const counts = results.reduce((acc, item) => { const status = normalizeStatus(item.status, "unknown"); acc[status] = (acc[status] ?? 0) + 1; return acc; }, {});
  summaryCounters.replaceChildren();
  for (const [label, value] of [["Checks", results.length], ["Passed", counts.pass ?? 0], ["Info", counts.info ?? 0], ["Warnings", counts.warning ?? 0], ["Errors", counts.error ?? 0], ["Unknown", counts.unknown ?? 0]]) {
    const node = document.createElement("span");
    node.className = "counter";
    node.textContent = `${label}: ${value}`;
    summaryCounters.appendChild(node);
  }
}

function renderResults(results) {
  resultsNode.replaceChildren();
  const visible = state.hidePassed ? results.filter((item) => item.status !== "pass" || item.alwaysShow === true) : results;
  if (!visible.length) {
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
  const headingWrap = document.createElement("div");
  const heading = document.createElement("h3");
  heading.textContent = result.title;
  headingWrap.appendChild(heading);

  if (result.kind === "rule") {
    const path = document.createElement("div");
    path.className = "result-path";
    path.textContent = `${result.file} → ${result.path.join(" → ")}`;
    headingWrap.appendChild(path);
  }

  const badge = document.createElement("span");
  badge.className = "result-badge";
  badge.textContent = status.toUpperCase();
  header.append(headingWrap, badge);
  article.appendChild(header);

  if (result.kind === "rule") {
    const value = document.createElement("div");
    value.className = "result-value";
    value.textContent = `Current value: ${formatValue(result.value)}`;
    article.appendChild(value);
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

function setBusy(busy) {
  analyzeButton.disabled = busy;
  input.disabled = busy;
  analyzeButton.textContent = busy ? "Analyzing…" : "Analyze";
}
function setStatus(message, type = "") { statusNode.className = `status ${type}`.trim(); statusNode.textContent = message; }
function clearResults() { state.results = []; resultsNode.replaceChildren(); summaryPanel.classList.add("hidden"); summaryCounters.replaceChildren(); rulesVersionNode.textContent = ""; }
