import { parseConfigurations } from "./js/configuration.js";
import { createRawUrl, fetchJson } from "./js/data.js";
import { runChecks } from "./checks.js";
import { bindUi, clearResults, setBusy, setStatus, showAnalysis } from "./js/ui.js";
bindUi({onAnalyze:analyze});
async function analyze(rawUrl){ setBusy(true); clearResults(); setStatus("Loading report…"); try{ const raw=await fetchJson(createRawUrl(rawUrl)); const results=runChecks(parseConfigurations(raw)); showAnalysis(results,"hardcoded checks"); setStatus(`Analysis complete: ${results.length} checks.`,"success"); }catch(error){ console.error(error); setStatus(error instanceof Error?error.message:String(error),"error"); }finally{ setBusy(false); } }
