# Profiler Utils
Static GitHub Pages tools for Minecraft Spark reports/profiles.

## Structure
- `/spark-config-check/` — report URL configuration checker. Checks are plain JavaScript in `checks.js`; no JSON rule DSL.
- `/spark-profile-tools/analyzer.html` — plugin resource attribution for `.sparkprofile` files.
- `/spark-profile-tools/cpu-cleaner.html` — removes identifiable idle/blocking samples and exports a modified `.sparkprofile`.

Everything is static. `.sparkprofile` files are processed locally in the browser.
