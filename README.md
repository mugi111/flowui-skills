# FlowUI Skills

FlowUI Skills provides black-box UI observation, scenario design, and browser automation primitives for system testing. It operates on a running web application and a Playwright-compatible browser connection; the target application's source code is not required.

The repository contains a working MVP: a CLI for browser sessions, page inspection, UI Model capture, recording, validation, safety-bound Scenario execution, and Playwright Test generation. It operates against a running application without requiring access to that application's source code.

## Development

Requirements: Node.js 24 or later and npm 11 or later. Browser-backed commands use Playwright and Chromium.

```sh
npm install
npm run check
npm test
npm run build
npm exec --workspace=@mugi111/flowui-skills -- flowui --help
```

In a target project, run `flowui init` to create `.flowui/`, then start a persistent browser session with `flowui session start`. The CLI supports `inspect`, `capture`, `record`, `validate`, `permit create`, `run`, and `render playwright`; use `flowui --help` for the command list. Scenario inputs are read from `FLOWUI_INPUT_<NAME>` environment variables and converted according to their declared string, number, or boolean type. Secret references currently support `env:VARIABLE` references; vault and keychain providers are not implemented.

The npm workspace package is named `@mugi111/flowui-skills`. Skills and editor adapters are included in this repository under `skills/` and `adapters/`.

## License

[MIT](LICENSE)
