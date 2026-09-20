import { resolveInputs } from "./js/configuration.js";

// Everything the checker reads is declared here. Add a value here, then write a normal JS check below.
const INPUTS = {
  compression: scalar("server.properties", "network-compression-threshold"),
  rcon: scalar("server.properties", "enable-rcon"),
  query: scalar("server.properties", "enable-query"),
  queryPlugins: scalar("bukkit.yml", "settings", "query-plugins"),
  onlineMode: scalar("server.properties", "online-mode"),
  velocity: scalar("paper/", "global.yml", "proxies", "velocity", "enabled"),
  velocityOnline: scalar("paper/", "global.yml", "proxies", "velocity", "online-mode"),
  bungee: scalar("spigot.yml", "settings", "bungeecord"),
  bungeeOnline: scalar("paper/", "global.yml", "proxies", "bungee-cord", "online-mode"),
  redstone: scalar("paper/", "world-defaults.yml", "misc", "redstone-implementation"),
  pathfinding: scalar("paper/", "world-defaults.yml", "misc", "update-pathfinding-on-block-update"),
  viewDistance: { type:"world-setting", key:"view-distance" },
  simulationDistance: { type:"world-setting", key:"simulation-distance" },
  mobSpawnRange: { type:"spigot-world-setting", key:"mob-spawn-range" }
};
function scalar(file,...path){ return {type:"config-value",file,path}; }
function value(x){ return x?.found === false ? undefined : x?.value; }
function result(group,title,status,message,values,description){ return {group,title,status,message,values,description}; }

export function runChecks(configurations){
  const i = resolveInputs(INPUTS, configurations);
  return [checkOnline(i), checkWorldMax(i.viewDistance,"Effective view distance",10), checkWorldMax(i.simulationDistance,"Effective simulation distance",8), checkCompression(i), checkRcon(i), checkQuery(i), checkMobRange(i), checkRedstone(i), checkPathfinding(i)];
}

function checkOnline(i){
  const online=value(i.onlineMode), vel=value(i.velocity), velOnline=value(i.velocityOnline), bun=value(i.bungee), bunOnline=value(i.bungeeOnline);
  if(vel===true) return result("Authentication","Online mode",velOnline===true?"pass":"warning",`Velocity proxy detected; proxy online mode is ${velOnline===true?"enabled":"disabled"}.`);
  if(bun===true) return result("Authentication","Online mode",bunOnline===true?"pass":"warning",`BungeeCord proxy detected; proxy online mode is ${bunOnline===true?"enabled":"disabled"}.`);
  if(online===undefined) return result("Authentication","Online mode","unknown","server.properties → online-mode was not found.");
  return result("Authentication","Online mode",online===true?"pass":"warning",`Direct server authentication is ${online===true?"enabled":"disabled"}.`);
}
function checkWorldMax(input,title,max){
  if(!input?.available) return result("World settings",title,"unknown",input?.error||"Setting not available.");
  const worlds=input.worlds||[]; const bad=worlds.filter(w=>Number(w.value)>max);
  return result("World settings",title,bad.length?"warning":"pass",bad.length?bad.map(w=>`${w.world}: ${w.value} (recommended ≤ ${max})`).join("\n"):`All resolved worlds are ≤ ${max}.`,Object.fromEntries(worlds.map(w=>[w.world,w.value])));
}
function checkCompression(i){
  const v=value(i.compression); if(v===undefined) return result("Networking","Network compression","unknown","network-compression-threshold was not found.");
  if(v===-1) return result("Networking","Network compression","info","Compression is disabled (-1).",{threshold:v});
  if(v<256) return result("Networking","Network compression","warning",`Threshold ${v} compresses relatively small packets and can increase CPU usage.`,{threshold:v});
  return result("Networking","Network compression","pass",`Threshold is ${v}.`,{threshold:v});
}
function checkRcon(i){ const v=value(i.rcon); return result("Services","RCON",v===true?"info":"pass",v===true?"RCON is enabled. Make sure it is intentionally exposed and secured.":"RCON is disabled.",{enabled:v}); }
function checkQuery(i){ const q=value(i.query), p=value(i.queryPlugins); if(q!==true) return result("Services","Server query","pass","Query is disabled.",{enabled:q}); return result("Services","Server query",p===true?"warning":"info",p===true?"Query is enabled and exposes the plugin list.":"Query is enabled without plugin-list exposure.",{enabled:q,"query-plugins":p}); }
function checkMobRange(i){ const x=i.mobSpawnRange; if(!x?.available) return result("World settings","Mob spawn range","unknown",x?.error||"mob-spawn-range was not found."); const worlds=x.worlds||[]; const view=new Map((i.viewDistance?.worlds||[]).map(w=>[w.world,Number(w.value)])); const bad=worlds.filter(w=>{const vd=view.get(w.world)??view.get("default"); return Number(w.value)>0 && Number.isFinite(vd) && Number(w.value)>vd;}); return result("World settings","Mob spawn range",bad.length?"warning":"pass",bad.length?bad.map(w=>`${w.world}: mob-spawn-range ${w.value} exceeds view-distance`).join("\n"):"Mob spawn range is within the resolved view distance.",Object.fromEntries(worlds.map(w=>[w.world,w.value]))); }
function checkRedstone(i){ const v=value(i.redstone); if(v===undefined) return result("Paper","Redstone implementation","unknown","Paper redstone implementation was not found."); const good=["alternate-current","eigencraft"].includes(String(v).toLowerCase()); return result("Paper","Redstone implementation",good?"pass":"info",`Configured implementation: ${v}.`,{value:v}); }
function checkPathfinding(i){ const v=value(i.pathfinding); if(v===undefined) return result("Paper","Pathfinding on block updates","unknown","Paper pathfinding setting was not found."); return result("Paper","Pathfinding on block updates",v===false?"pass":"info",v===false?"Pathfinding updates on block changes are disabled.":"Pathfinding updates on block changes are enabled.",{enabled:v}); }
