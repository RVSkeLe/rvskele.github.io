# Spark Configuration Checker

A lightweight, dependency-free web application for analyzing Minecraft server configuration from a **spark** report.

The application runs entirely in the browser. Paste a spark report URL, and it evaluates your server configuration against a declarative set of rules defined in `rules.json`.

Designed to be hosted as a static site (for example, GitHub Pages), no backend or build process is required.

---

## Features

* No dependencies or build tools
* Runs entirely in the browser
* Declarative rule system (`rules.json`)
* Reusable configuration inputs
* Supports Paper, Spigot, and vanilla configuration where applicable
* Easy to extend with additional rules

---

## Live Demo

Once GitHub Pages is enabled:

```
https://rvskele.github.io/
```

---

## How it works

1. Paste a spark report URL.
2. The report is fetched directly from `spark.lucko.me`.
3. Configuration files are extracted from the report.
4. Inputs defined in `rules.json` are resolved once.
5. Rules are evaluated against the resolved inputs.
6. Results are displayed in the browser.

No report data is uploaded anywhere other than the original spark endpoint.

---

## Rule Engine

The application separates **input resolution** from **rule evaluation**.

### Inputs

Inputs describe where values come from. They are resolved once and cached for reuse across multiple rules.

Supported input types:

| Type                   | Description                                                                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config-value`         | Reads a value from a specific configuration file.                                                                                                     |
| `world-setting`        | Resolves the effective world setting, taking defaults and overrides into account. Falls back to `server.properties` when `spigot.yml` is unavailable. |
| `spigot-world-setting` | Resolves settings available only on Spigot-compatible servers. Automatically skipped when unsupported.                                                |

---

### Rules

Rules consume resolved inputs and generate user-facing results.

Supported rule types:

| Type             | Purpose                                                                                                        |
| ---------------- | -------------------------------------------------------------------------------------------------------------- |
| `outcomes`       | Produces different results based on logical expressions.                                                       |
| `world-limit`    | Checks world settings against a maximum recommended value.                                                     |
| `world-relation` | Validates relationships between two world settings (for example, `mob-spawn-range` vs. `simulation-distance`). |

---

## Adding Rules

Most changes only require editing `rules.json`.

Typical workflow:

1. Define a reusable input.
2. Reference that input from one or more rules.
3. Reload the page.

No JavaScript changes are required unless introducing a completely new input or rule type.

---

## License

This project is provided as-is. Feel free to modify or extend the rules to suit your own server configuration requirements.

