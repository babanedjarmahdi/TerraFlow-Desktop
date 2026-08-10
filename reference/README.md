# Untested prototype — reference material only

This file is an **early, untested prototype draft** ported from the Core repository
(originally `scripts/desktop/install.mjs`). It is kept **only as reference material**
for the Desktop Runtime track.

## Status

- **NOT implemented.**
- **NOT tested.**
- **NOT part of any accepted plan.** See `docs/PLAN.md` for the actual plan.
- It predates this repository and the architecture decisions in
  `docs/CONTRACT_WITH_CORE.md`; it may contradict them.

## What it was

A rough sketch of a Windows installer: copies the app tree to `%LOCALAPPDATA%\TerraFlow`,
runs `npm ci --omit=dev`, writes a `run.ps1` launcher + `.vbs` wrappers, and registers a
`HKCU\...\Run` autostart entry.

## Do not

- Do not treat this as the implementation.
- Do not copy its decisions blindly into the plan.
- Do not assume its paths, hardcoding, or behavior are correct.
- Do not run it against a real environment.
