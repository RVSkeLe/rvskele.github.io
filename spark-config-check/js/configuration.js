import { getPath } from "./utils.js";

export function parseConfigurations(rawConfigurations) {
  if (!rawConfigurations || typeof rawConfigurations !== "object" || Array.isArray(rawConfigurations)) {
    throw new Error("Spark returned an invalid server configuration object.");
  }

  const files = Object.create(null);
  const errors = Object.create(null);

  for (const [filename, rawValue] of Object.entries(rawConfigurations)) {
    try {
      files[filename] = parseConfigurationValue(filename, rawValue);
    } catch (error) {
      errors[filename] = error instanceof Error ? error.message : String(error);
    }
  }

  return { files, errors };
}

function parseConfigurationValue(filename, rawValue) {
  if (rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)) {
    return rawValue;
  }

  if (typeof rawValue !== "string") {
    throw new Error(`${filename} has an unsupported value type.`);
  }

  let parsed;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    throw new Error(`${filename} could not be parsed.`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${filename} did not contain an object.`);
  }

  return parsed;
}

export function resolveInputs(definitions, configurations) {
  const resolved = Object.create(null);

  for (const [name, definition] of Object.entries(definitions)) {
    try {
      resolved[name] = resolveInput(definition, configurations);
    } catch (error) {
      resolved[name] = {
        kind: definition.type ?? "unknown",
        available: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  return resolved;
}

function resolveInput(definition, configurations) {
  switch (definition.type) {
    case "config-value":
      return resolveConfigValue(definition, configurations);

    case "world-setting":
      return resolveSpigotWorldSetting(definition, configurations, false);

    case "spigot-world-setting":
      return resolveSpigotWorldSetting(definition, configurations, true);

    case "paper-world-setting":
      return resolvePaperWorldSetting(definition, configurations);

    default:
      throw new Error(`Unsupported input type: ${String(definition.type)}`);
  }
}

function resolveConfigValue(definition, configurations) {
  const file = configurations.files[definition.file];

  if (!file) {
    return {
      kind: "scalar",
      available: false,
      found: false,
      file: definition.file,
      path: definition.path ?? [],
      error: configurations.errors[definition.file] ?? `${definition.file} was not found.`
    };
  }

  const lookup = getPath(file, definition.path ?? []);
  return {
    kind: "scalar",
    available: true,
    found: lookup.found,
    value: normalizeConfigValue(lookup.value),
    file: definition.file,
    path: definition.path ?? []
  };
}

// Negative values are seen as strings
function normalizeConfigValue(value) {
    if (
        typeof value === "string" &&
        /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value.trim())
    ) {
        return Number(value);
    }

    return value;
}

function resolvePaperWorldSetting(definition, configurations) {
  const paper = configurations.files["paper/"];
  const bukkit = configurations.files["bukkit.yml"];

  const key = definition.key;
  const paperPath = definition.paperPath ?? [];
  const bukkitPath = definition.bukkitPath ?? [];
  const inheritedValue = definition.inheritedValue ?? -1;

  if (!paper) {
    return {
      kind: "world",
      available: false,
      key,
      source: "not-applicable",
      error: configurations.errors["paper/"] ?? "paper/ was not found."
    };
  }

  if (!bukkit) {
    return {
      kind: "world",
      available: false,
      key,
      source: "paper",
      error: configurations.errors["bukkit.yml"] ?? "bukkit.yml was not found."
    };
  }

  const bukkitLookup = getPath(bukkit, bukkitPath);
  const bukkitValue = bukkitLookup.value;

  const worldDefaults = paper["world-defaults.yml"];
  const defaultLookup = getPath(worldDefaults, paperPath);
  const defaultRaw = defaultLookup.value;

  const hasPaperDefaultOverride =
    defaultLookup.found &&
    defaultRaw !== undefined &&
    defaultRaw !== null &&
    defaultRaw !== inheritedValue;

  const defaultValue = hasPaperDefaultOverride
    ? defaultRaw
    : bukkitValue;

  const worlds = [
    {
      world: "default",
      value: defaultValue,
      source: hasPaperDefaultOverride
        ? `paper/world-defaults.yml ${paperPath.join(".")}`
        : `bukkit.yml ${bukkitPath.join(".")}`
    }
  ];

  for (const [filename, worldConfig] of Object.entries(paper)) {
    if (
      filename === "global.yml" ||
      filename === "world-defaults.yml" ||
      !filename.endsWith(".yml")
    ) {
      continue;
    }

    const lookup = getPath(worldConfig, paperPath);
    const rawValue = lookup.value;

    const hasWorldOverride =
      lookup.found &&
      rawValue !== undefined &&
      rawValue !== null &&
      rawValue !== inheritedValue;

    if (!hasWorldOverride) {
      continue;
    }

    worlds.push({
      world: filename.slice(0, -4),
      value: rawValue,
      explicit: true,
      source: `paper/${filename} ${paperPath.join(".")}`
    });
  }

  return {
    kind: "world",
    available: defaultValue !== undefined,
    key,
    source: "paper",
    serverValue: bukkitValue,
    bukkitValue,
    defaultRaw,
    defaultValue,
    defaultOverridden: hasPaperDefaultOverride,
    worlds
  };
}

function resolveSpigotWorldSetting(definition, configurations, spigotOnly) {
  const key = definition.key;
  const server = configurations.files["server.properties"];
  const spigot = configurations.files["spigot.yml"];

  if (spigotOnly && !spigot) {
    return { kind: "world", available: false, key, source: "not-applicable", error: "spigot.yml was not found." };
  }

  if (!server && !spigotOnly) {
    return {
      kind: "world",
      available: false,
      key,
      source: "unknown",
      error: configurations.errors["server.properties"] ?? "server.properties was not found."
    };
  }

  const serverValue = server?.[key];
  const worldSettings = spigot?.["world-settings"];

  if (!spigot) {
    return {
      kind: "world",
      available: serverValue !== undefined,
      key,
      source: "vanilla",
      serverValue,
      defaultValue: serverValue,
      worlds: [{ world: "default", value: serverValue, source: "server.properties" }]
    };
  }

  const defaultRaw = worldSettings?.default?.[key];
  const hasDefaultOverride = defaultRaw !== undefined && defaultRaw !== null && defaultRaw !== "default";
  const defaultValue = spigotOnly
    ? (hasDefaultOverride ? defaultRaw : undefined)
    : (hasDefaultOverride ? defaultRaw : serverValue);

  const worlds = [{
    world: "default",
    value: defaultValue,
    source: hasDefaultOverride ? "spigot.yml world-settings.default" : (spigotOnly ? "unset" : "server.properties")
  }];

  for (const [worldName, worldConfig] of Object.entries(worldSettings ?? {})) {
    if (worldName === "default") continue;

    const rawValue = worldConfig?.[key];
    const hasOverride = rawValue !== undefined && rawValue !== null && rawValue !== "default";

    if (!hasOverride) continue;

    worlds.push({
      world: worldName,
      value: rawValue,
      explicit: true,
      source: `spigot.yml world-settings.${worldName}`
    });
  }

  return {
    kind: "world",
    available: defaultValue !== undefined,
    key,
    source: "spigot",
    serverValue,
    defaultRaw,
    defaultValue,
    defaultOverridden: hasDefaultOverride,
    worlds
  };
}
