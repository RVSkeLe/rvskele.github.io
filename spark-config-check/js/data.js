export function createRawUrl(rawInput) {
  let url;
  try {
    url = new URL(rawInput.trim());
  } catch {
    throw new Error("Enter a valid URL.");
  }

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

export async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    ...options
  });

  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}.`);
  }

  try {
    return await response.json();
  } catch {
    throw new Error(`${url} did not return valid JSON.`);
  }
}

export function validateDefinition(definition) {
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
    throw new Error("rules.json must contain an object.");
  }

  if (definition.schemaVersion !== 2) {
    throw new Error(`Unsupported rules schema version: ${String(definition.schemaVersion)}`);
  }

  if (!definition.inputs || typeof definition.inputs !== "object" || Array.isArray(definition.inputs)) {
    throw new Error("rules.json inputs must be an object.");
  }

  if (!Array.isArray(definition.rules)) {
    throw new Error("rules.json rules must be an array.");
  }
}
