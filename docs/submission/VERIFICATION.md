# Publication verification

Completed 2026-11-14T14:55:20.022Z. Full local verification: **PASS**.

| Check | Result |
| --- | --- |
| Unit/API | 283 passed; 0 failed |
| Browser journeys | 79 passed; 0 failed; 0 flaky |
| Native Rust contract | 29 passed; 0 failed; 1 intentionally ignored |
| TypeScript and production build | PASS |
| Formatting | PASS |
| Isolated HTTP journey | 10 checks passed |
| Live 1Click dry quote | Provider signature verified; zero funds moved |

Source digest: `5f15b7a2bb189662efcd78cb8092a0e7261e44c4dc3dd1f3660941bd262c8021`. Source did not change during verification.

The ignored migration rehearsal needs a private V2 snapshot. It is not counted as passed.
Browser provider fixtures and actual external dry-quote checks are separate.
No mainnet transfer or human wallet signature was automated. These results are not an official score.

See [sanitized structured evidence](verification.json). Re-run `npm run verify -- --browser --contract` to verify your checkout; generated reports are stored privately under `artifacts/`.

The source import workflow independently verifies a clean Ubuntu checkout; its public log is in [GitHub Actions](https://github.com/Huntrackers/numa/actions). Local Windows results do not by themselves claim CI success.
