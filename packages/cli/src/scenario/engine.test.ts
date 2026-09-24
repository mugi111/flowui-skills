import assert from "node:assert/strict"; import test from "node:test"; import { runScenario } from "./engine.js";
const scenario = { schema_version:"1.0" as const,id:"s",status:"ready" as const,intent:"x",start_page:"p",steps:[{id:"act",page:"p",action:"click" as const,target:"go"},{id:"assert",page:"p",assert:{type:"visible" as const,target:"done"},expectation:{source:"user-intent" as const,reference:"x"}}]};
test("pauses before the requested step", async()=>assert.equal(await runScenario(scenario,{beforeAction:async()=>"ok",act:async()=>"ok",assert:async()=>true},"act"),"paused"));
test("does not call later steps after a blocked action", async()=>assert.equal(await runScenario(scenario,{beforeAction:async()=>"blocked",act:async()=>"ok",assert:async()=>true}),"blocked"));
test("returns failed for an unmet explicit assertion", async()=>assert.equal(await runScenario(scenario,{beforeAction:async()=>"ok",act:async()=>"ok",assert:async()=>false}),"failed"));
test("rejects an unknown pause step before executing", async()=>await assert.rejects(runScenario(scenario,{beforeAction:async()=>"ok",act:async()=>"ok",assert:async()=>true},"missing"),/unknown pause step/));
