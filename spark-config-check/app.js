import { parseConfigurations, resolveInputs } from "./js/configuration.js";
import { createRawUrl, fetchJson, validateDefinition } from "./js/data.js";
import { runRules } from "./js/rules-engine.js";
import { bindUi, clearResults, setBusy, setStatus, showAnalysis } from "./js/ui.js";

bindUi({ onAnalyze: analyze });

async function analyze(rawUrl) {
  setBusy(true);
  clearResults();
  setStatus("Loading report and rules…");

  try {
    const [rawConfigurations, definition] = await Promise.all([
      fetchJson(createRawUrl(rawUrl)),
      fetchJson("./rules.json", { cache: "no-cache" })
    ]);

    validateDefinition(definition);
    const configurations = parseConfigurations(rawConfigurations);
    const inputs = resolveInputs(definition.inputs, configurations);
    const results = runRules(definition.rules, { configurations, inputs });

    showAnalysis(results, definition.rulesVersion);
    setStatus(`Analysis complete: ${results.length} checks.`, "success");
  } catch (error) {
    console.error(error);
    setStatus(error instanceof Error ? error.message : String(error), "error");
  } finally {
    setBusy(false);
  }
}
