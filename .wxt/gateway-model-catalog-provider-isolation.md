# Gateway model catalog provider isolation

## Goal
- Ensure an OpenAI-compatible account such as ckt-aicode keeps a unique Codex model identity when it exposes the same upstream model as a ChatGPT subscription account.
- Ensure the target Codex home has the final gateway catalog before the App is launched.

## Why Complex
- Crosses model catalog identity resolution, gateway/account synchronization, App launch ordering, and regression tests.

## Scope
- Related modules/classes: account model catalog, gateway model binding, desktop bridge App launch flow.
- Related files: `apps/desktop/electron/model-catalog-store.ts`, `apps/desktop/electron/bridge.ts`, corresponding tests.
- Compatibility: preserve upstream wire model ids and existing provider ids used by gateway credentials; only Codex-facing catalog identity changes for custom endpoints.

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | Derive stable catalog provider identity from the actual upstream endpoint, including gateway-restored accounts | model catalog + bridge identity resolution | focused model/bridge tests | done | `resolveModelCatalogProviderId("openai", "https://aicode.ckt.cn/v1")` now returns `custom-openai:aicode.ckt.cn`; bridge regression verifies gateway endpoint lookup |
| 2 | Keep Plus and ckt entries independently exposed and routeable | gateway catalog/binding compiler | gateway/model catalog tests | done | `environment gateway catalog keeps a custom OpenAI endpoint separate from the bundled model`; real route member ids are validated |
| 3 | Ensure App launch cannot race final catalog/config synchronization | target home + launch flow | launch/order tests and build | done | Gateway is rebuilt from current bindings and catalog sync is awaited immediately before App launch; packaged projection uses the same awaited path |
| 4 | Run focused and desktop verification | test/build scripts | executed commands and results | done | 78 focused desktop tests passed; 30 bridge smoke tests passed; full desktop run passed with 488 tests (1 skipped); `npm run desktop:build` passed |

## Rules
- Simultaneously only one task may be `in_progress`.
- Update this file after each task with status and evidence.
- Add new tasks here before expanding scope.
