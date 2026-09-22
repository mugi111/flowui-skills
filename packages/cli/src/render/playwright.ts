import type{ScenarioDocument}from"../contracts/types.js";
export function renderPlaywright(s:ScenarioDocument):string{return `import { test } from "@playwright/test";\n\ntest(${JSON.stringify(s.id)}, async () => {\n  // Execute through FlowUI's Safety Gate; never embed secrets or permits.\n  await flowui.run(${JSON.stringify(s.id)});\n});\n`;}
