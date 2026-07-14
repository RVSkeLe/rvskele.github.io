# Spark Configuration Checker

Static GitHub Pages app for analyzing Minecraft server configuration values from a spark report.

## Deploy

1. Commit `index.html`, `app.js`, `styles.css`, and `rules.json` to a repository.
2. Open **Settings → Pages**.
3. Select **Deploy from a branch** and choose the repository root.
4. Open the generated GitHub Pages URL.

## Rules

Most checks are declarative entries in `rules.json`. Supported operators:

- `equals`, `notEquals`
- `gt`, `gte`, `lt`, `lte`
- `between`, `oneOf`, `includes`
- `exists`, `isBoolean`, `isNumber`, `isString`

Implemented composite types:

- `online-mode`
- `spigot-world-setting`

The JSON file cannot execute arbitrary JavaScript. New composite logic must be implemented in `app.js`.
