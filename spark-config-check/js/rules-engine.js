import { equal, formatValue, getPath, isFiniteNumber, normalizeStatus, worstStatus } from "./utils.js";

export function runRules(rules, context) {
  const results = [];

  for (const rule of rules) {
    try {
      const result = evaluateRule(rule, context);
      if (Array.isArray(result)) {
        results.push(...result.filter(Boolean));
      } else if (result) {
        results.push(result);
      }
    } catch (error) {
      results.push({
        id: rule.id ?? "unknown-rule",
        group: rule.group ?? "Internal errors",
        title: rule.title ?? rule.id ?? "Rule error",
        status: "unknown",
        message: `Rule failed: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  }

  for (const [filename, message] of Object.entries(context.configurations.errors)) {
    results.push({
      id: `parse-${filename}`,
      group: "Configuration parsing",
      title: `Could not parse ${filename}`,
      status: "unknown",
      message
    });
  }

  return results;
}

function evaluateRule(rule, context) {
  if (rule.appliesWhen && !evaluateExpression(rule.appliesWhen, context)) {
    return null;
  }

  switch (rule.type) {
    case "outcomes":
      return evaluateOutcomeRule(rule, context);

    case "world-limit":
      return evaluateWorldLimitRule(rule, context);

    case "world-relation":
      return evaluateWorldRelationRule(rule, context);

    default:
      return baseResult(rule, "unknown", `Unsupported rule type: ${String(rule.type)}`);
  }
}

function evaluateOutcomeRule(rule, context) {
  const values = resolveRuleValues(rule.values ?? {}, context);

  for (const outcome of rule.outcomes ?? []) {
    if (evaluateExpression(outcome.expression, context, values)) {
      return {
        ...baseResult(
            rule,
            normalizeStatus(outcome.status, "unknown"),
            interpolate(outcome.message, values)
        ),
        ...(rule.showValues ? { values } : {})
      };
    }
  }

  const fallback = rule.defaultOutcome ?? {
    status: "unknown",
    message: "No rule outcome matched."
  };

  return {
    ...baseResult(rule, normalizeStatus(fallback.status, "unknown"), interpolate(fallback.message, values)),
    values
  };
}

function evaluateWorldLimitRule(rule, context) {
  const input = resolveReference(rule.input, context);

  if (!input || input.kind !== "world" || !input.available) {
    return rule.skipWhenUnavailable
      ? null
      : baseResult(rule, "unknown", input?.error ?? "The world setting was unavailable.");
  }

  const invalid = input.worlds.filter((entry) => !isFiniteNumber(entry.value));
  if (invalid.length > 0) {
    return baseResult(
      rule,
      "unknown",
      `Could not determine a numeric ${input.key} for: ${invalid.map((entry) => entry.world).join(", ")}.`
    );
  }

  const excessive = input.worlds.filter((entry) => entry.value > rule.maximum);
  if (excessive.length > 0) {
    return {
      ...baseResult(
        rule,
        normalizeStatus(rule.severity, "warning"),
        [
          `Maximum recommended value: ${rule.maximum}`,
          "",
          "Values above the limit:",
          ...excessive.map((entry) => `• ${entry.world}: ${entry.value}`)
        ].join("\n")
      ),
      values: createWorldDisplayValues(input)
    };
  }

  const sourceMessage = input.source === "vanilla"
    ? "The value comes directly from server.properties because spigot.yml was not found."
    : "Spigot defaults and per-world overrides were resolved.";

  return {
    ...baseResult(
      rule,
      "pass",
      `Effective ${input.key} values are within the recommended maximum of ${rule.maximum}. ${sourceMessage}`
    ),
    values: createWorldDisplayValues(input)
  };
}

function evaluateWorldRelationRule(rule, context) {
  const left = resolveReference(rule.leftInput, context);
  const right = resolveReference(rule.rightInput, context);

  if (!left || left.kind !== "world" || !left.available) {
    return rule.skipWhenUnavailable
      ? null
      : baseResult(
          rule,
          "unknown",
          left?.error ?? "The left world setting was unavailable."
        );
  }

  if (!right || right.kind !== "world" || !right.available) {
    return rule.skipWhenUnavailable
      ? null
      : baseResult(
          rule,
          "unknown",
          right?.error ?? "The comparison world setting was unavailable."
        );
  }

  /*
   * input.worlds should contain:
   * - the "default" entry
   * - only genuine per-world overrides
   *
   * A world that overrides only one of the two settings is still included.
   * worldValue() supplies the inherited default for the other setting.
   */
  const worldNames = new Set(["default"]);

  for (const entry of left.worlds) {
    if (entry.world !== "default") {
      worldNames.add(entry.world);
    }
  }

  for (const entry of right.worlds) {
    if (entry.world !== "default") {
      worldNames.add(entry.world);
    }
  }

  const comparisons = [];

  for (const world of worldNames) {
    const leftValue = worldValue(left, world);
    const rightValue = worldValue(right, world);

    if (!isFiniteNumber(leftValue) || !isFiniteNumber(rightValue)) {
      comparisons.push({
        world,
        leftValue,
        rightValue,
        status: "unknown",
        reason: "non-numeric value"
      });
      continue;
    }

    if (
      rule.minimumExclusive !== undefined &&
      leftValue <= rule.minimumExclusive
    ) {
      comparisons.push({
        world,
        leftValue,
        rightValue,
        status: normalizeStatus(rule.minimumSeverity, "warning"),
        reason: `must be greater than ${rule.minimumExclusive}`
      });
      continue;
    }

    const offsets = Array.isArray(rule.allowedOffsets)
      ? rule.allowedOffsets
      : [0];

    const accepted = offsets.some(
      (offset) => leftValue === rightValue + offset
    );

    comparisons.push({
      world,
      leftValue,
      rightValue,
      status: accepted
        ? "pass"
        : normalizeStatus(rule.severity, "info"),
      reason: accepted
        ? "matches the recommended relation"
        : `expected ${offsets
            .map((offset) => formatOffset(rightValue, offset))
            .join(" or ")}`
    });
  }

  const status = worstStatus(
    comparisons.map((comparison) => comparison.status)
  );

  const problems = comparisons.filter(
    (comparison) => comparison.status !== "pass"
  );

  const message =
    problems.length === 0
      ? `All configured worlds satisfy the recommended relationship between ${left.key} and ${right.key}.`
      : [
          `${left.key} should be related to ${right.key} as configured by this rule.`,
          "",
          ...problems.map(
            (problem) =>
              `• ${problem.world}: ` +
              `${left.key}=${formatValue(problem.leftValue)}, ` +
              `${right.key}=${formatValue(problem.rightValue)} ` +
              `(${problem.reason})`
          )
        ].join("\n");

  const values = {};

  for (const comparison of comparisons) {
    values[`${comparison.world}:${left.key}`] = comparison.leftValue;
    values[`${comparison.world}:${right.key}`] = comparison.rightValue;
  }

  return {
    ...baseResult(rule, status, message),
    values
  };
}

function resolveRuleValues(definitions, context) {
  const values = Object.create(null);

  for (const [name, reference] of Object.entries(definitions)) {
    values[name] = resolveReference(reference, context);
  }

  return values;
}

function resolveReference(reference, context) {
  if (typeof reference !== "string") {
    return reference;
  }

  if (reference.startsWith("@inputs.")) {
    return getPath(context.inputs, reference.slice(8).split(".")).value;
  }

  if (reference.startsWith("@config.")) {
    return getPath(context.configurations.files, reference.slice(8).split(".")).value;
  }

  return reference;
}

function evaluateExpression(expression, context, localValues = {}) {
  if (!expression || typeof expression !== "object") {
    return false;
  }

  if (Array.isArray(expression.all)) {
    return expression.all.every((item) => evaluateExpression(item, context, localValues));
  }

  if (Array.isArray(expression.any)) {
    return expression.any.some((item) => evaluateExpression(item, context, localValues));
  }

  if (expression.not) {
    return !evaluateExpression(expression.not, context, localValues);
  }

  const left = resolveExpressionOperand(expression.ref, context, localValues);
  const rightBase = expression.rightRef !== undefined
    ? resolveExpressionOperand(expression.rightRef, context, localValues)
    : expression.value;
  const right = isFiniteNumber(rightBase) && isFiniteNumber(expression.offset)
    ? rightBase + expression.offset
    : rightBase;

  switch (expression.operator) {
    case "exists":
      return expression.value === false ? left === undefined : left !== undefined;

    case "equals":
      return equal(left, right);

    case "notEquals":
      return !equal(left, right);

    case "gt":
      return isFiniteNumber(left) && isFiniteNumber(right) && left > right;

    case "gte":
      return isFiniteNumber(left) && isFiniteNumber(right) && left >= right;

    case "lt":
      return isFiniteNumber(left) && isFiniteNumber(right) && left < right;

    case "lte":
      return isFiniteNumber(left) && isFiniteNumber(right) && left <= right;

    case "oneOf":
      return Array.isArray(right) && right.some((item) => equal(left, item));

    default:
      return false;
  }
}

function resolveExpressionOperand(reference, context, localValues) {
  if (typeof reference !== "string") {
    return reference;
  }

  if (reference.startsWith("$")) {
    return getPath(localValues, reference.slice(1).split(".")).value;
  }

  return resolveReference(reference, context);
}

function createWorldDisplayValues(input) {
  const values = {
    source: input.source,
    serverProperties: input.serverValue,
    effectiveDefault: input.defaultValue
  };

  for (const entry of input.worlds) {
    if (entry.world !== "default") {
      values[`world:${entry.world}`] = entry.value;
    }
  }

  return values;
}

function worldValue(input, world) {
  const explicit = input.worlds.find((entry) => entry.world === world);
  if (explicit) {
    return explicit.value;
  }

  return input.defaultValue;
}

function formatOffset(base, offset) {
  if (offset === 0) {
    return String(base);
  }

  return String(base + offset);
}

function baseResult(rule, status, message) {
  return {
    id: rule.id,
    group: rule.group ?? "Other",
    title: rule.title ?? rule.id,
    description: rule.description ?? "",
    alwaysShow: rule.alwaysShow === true,
    status,
    message
  };
}

function interpolate(template, values) {
  return String(template ?? "").replace(/\{\{([^}]+)\}\}/g, (_match, path) => {
    const lookup = getPath(values, path.trim().split("."));
    return formatValue(lookup.value);
  });
}

