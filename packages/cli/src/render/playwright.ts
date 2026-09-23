import type{ScenarioDocument}from"../contracts/types.js";
export function renderPlaywright(s:ScenarioDocument):string{return `import { test } from "@playwright/test";
import { executeScenario } from "@mugi111/flowui-skills";
import scenario from ${JSON.stringify(`./${s.id}.json`)} with { type: "json" };

test(${JSON.stringify(s.id)}, async () => {
  const result = await executeScenario({ scenario, inputs: process.env, secrets: process.env });
  if (result.status !== "passed") throw new Error("Scenario did not pass: " + result.status);
});
` ;}
