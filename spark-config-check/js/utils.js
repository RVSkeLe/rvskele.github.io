export const VALID_STATUSES = new Set(["pass", "info", "warning", "error", "unknown"]);

export function getPath(object, path) {
  let current = object;

  for (const segment of path) {
    if (
      current === null ||
      typeof current !== "object" ||
      !Object.prototype.hasOwnProperty.call(current, segment)
    ) {
      return { found: false, value: undefined };
    }

    current = current[segment];
  }

  return { found: true, value: current };
}

export function equal(left, right) {
  if (Object.is(left, right)) return true;

  if (
    left === null ||
    right === null ||
    typeof left !== "object" ||
    typeof right !== "object"
  ) {
    return false;
  }

  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

export function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

export function normalizeStatus(value, fallback) {
  return VALID_STATUSES.has(value) ? value : fallback;
}

export function worstStatus(statuses) {
  const order = ["pass", "info", "warning", "error", "unknown"];
  return statuses.reduce(
    (worst, status) => order.indexOf(status) > order.indexOf(worst) ? status : worst,
    "pass"
  );
}

export function formatValue(value) {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);

  if (value && typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  return String(value);
}
