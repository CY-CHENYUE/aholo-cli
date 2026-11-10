---
name: aholo-cli
description: Use the independent aholo CLI for official Aholo Asset uploads and Lux3D generation, material transfer, splitting, export, rigging, animation, task query, wait and download. Use when the user asks to generate or process 3D files through Aholo, or to inspect or resume an existing Aholo task. Does not control a webpage, local artwork library or display hardware.
---

# Aholo CLI

Bundled CLI and Skill version: **0.1.0**. This is our CLI around official APIs/SDKs, not an official Aholo CLI release.

1. Locate the executable. Use `aholo --version --json` if installed on PATH, otherwise run `node /absolute/path/to/aholo-cli/bin/aholo.mjs` with the same arguments. Use the host's terminal; no MCP connection or running webpage is required.
2. Read `aholo capabilities --json` or the selected command's `--describe --json`. Compare CLI version with this Skill. If they differ, read the executable's description and export its matching Skill; do not force an upgrade or change global host configuration.
3. Check `aholo config show --json` or `doctor --json`. Obtain authorization for the requested operation through the user's request. Credentials come from AHOLO_API_KEY or a selected CLI profile; never print or place them in prompts/arguments. `config set --api-key-stdin` saves to the isolated profile with private file permissions. Do not copy credentials from a webpage's private storage.
4. Use business flags for local files, and `--request file.json` or `--request -` for complex official JSON bodies. Quote paths containing spaces or Chinese. Duplicate declarations of the same request field are errors. Use one stdin consumer per invocation. Run `--dry-run --json` when preparing an unfamiliar operation; dry-run does not upload or submit.
5. For each intended new submission choose a stable `--request-id`. Reuse that ID after interruption. Creation returns taskId by default. `--wait` polls; `--download` waits and saves outputs. A local request ID prevents concurrent/repeated attempts for identical inputs in the same CLI home; it is not a server-side exactly-once guarantee.
6. If exit code 4 / E_UNCERTAIN occurs, do not issue another create with a new ID. Inspect `request get <requestId>`, query `lux3d task list` and verify the existing task manually. Only with a verified official task ID use `request attach <requestId> --task-id <taskId>`. Do not infer ownership from a similar prompt.
7. Resume using `lux3d task get|wait|download <taskId>`. Wait has a bounded `--max-wait`; codes 3 (pending/deadline), 5 (official failure), 6 (network/auth/download), and 130 (local interruption) are distinct. Local interruption does not cancel the cloud task. Failed/canceled official tasks do not trigger a replacement task.
8. Download queries the original task, saves all URL/array/action outputs, ignores NOT_REQUESTED, validates files and writes an atomic manifest. Links may expire after about two hours. On expiry the CLI queries the same task once; a new usable URL is not guaranteed. Existing verified files are reused, conflicts require a new directory or explicit --overwrite. Report available files and partial failures accurately.
9. Parse the single stdout JSON object: schemaVersion, ok, data (official content), local (paths/request ID), or error. Progress goes to stderr. Show the user local file paths and actual status; never claim a live result based on mock tests. Keep signed URLs and account records out of source control.

Read [the generated command reference](references/commands.md) for all flags and official input schemas. Support status and limitations are documented in the package README. This Skill adds instructions only; the CLI owns the API implementation.
