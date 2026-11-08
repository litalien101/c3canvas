# CoModel Studio Copilot Bridge

This local VS Code extension connects the CoModel Studio API to the Copilot model already available in VS Code. It uses the official VS Code Language Model API; it does not read Copilot credentials, call a provider directly, or expose modeling tools.

## Requirements

- VS Code 1.90 or later.
- GitHub Copilot installed and signed in, with at least one language model available to extensions.
- CoModel Studio API running locally at `http://127.0.0.1:8000`.

## Run from this repository

1. Open the repository root in VS Code.
2. Start the API (`cd starter/api && .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000`) and web UI (`cd starter/web && npm run dev -- --host 127.0.0.1`) if they are not already running.
3. Press F5 and choose **Run CoModel Studio Copilot Bridge** to open an Extension Development Host.
4. In that new VS Code window, open the Command Palette and run **CoModel Studio: Connect Copilot**.
5. Choose a Copilot model. If VS Code prompts for language-model access, approve it.
6. Open CoModel Studio at `http://127.0.0.1:5173`. Its status should show the selected Copilot model.

The extension only creates the local bridge after the user runs the connect command and selects a model. The bridge binds to `127.0.0.1` on an ephemeral port and requires a random bearer token. Its configuration is stored in a per-user config directory with owner-only permissions and removed when disconnected or deactivated.

The API reads the same config path. Set `COMODEL_COPILOT_BRIDGE_CONFIG` in both the API process and VS Code extension host to override the default `$XDG_CONFIG_HOME/comodel-studio/copilot-bridge.json` (or `~/.config/comodel-studio/copilot-bridge.json`). This extension is optional if you already use the Universal Messages Copilot bridge: the API can connect to that bridge directly using the server-only settings documented in [the starter README](../README.md).

## Scope and limitations

- Chat prompts and project metadata selected by the API are sent to the Copilot model after the user connects. Reference image bytes are not sent; only their names, dimensions, and notes may be included as project context.
- The bridge supports chat only. It has no modeling tools and cannot execute Python, shell commands, or Blender operations.
- The API exposes only approval-gated CC3 import and scoped CC3 morph-save operations, with strict schemas, scene-version/scope checks, and checkpoints. The Copilot chat bridge does not invoke modeling operations.
- If Copilot is unavailable, chat fails explicitly. Deterministic plan generation remains available and does not imply that references were analyzed.
- This is a local development bridge, not a hosted or multi-user integration.
