# FlowUI Skills

FlowUI Skills provides black-box UI observation, scenario design, and browser automation primitives for system testing. It operates on a running web application and a Playwright-compatible browser connection; the target application's source code is not required.

This repository is in active MVP development. The execution contracts and task plan are available in [`docs/detailed-design.md`](docs/detailed-design.md) and [`docs/implementation-tasks.md`](docs/implementation-tasks.md).

## Development

Requirements: Node.js 24 or later and npm 11 or later.

```sh
npm install
npm run check
npm test
```

The `flowui` CLI currently provides its command surface only. Commands are implemented incrementally according to the task plan.

## License

[MIT](LICENSE)
