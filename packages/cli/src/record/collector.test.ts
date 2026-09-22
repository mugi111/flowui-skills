import assert from "node:assert/strict"; import test from "node:test"; import {RecordCollector} from "./collector.js";
test("orders events and masks captured values",()=>{const c=new RecordCollector();c.add({documentId:"a",type:"input",target:"password",value:"private"});const e=c.stop();assert.equal(e[0]!.sequence,1);assert.doesNotMatch(JSON.stringify(e),/private/);});
test("keeps non-sensitive input values for scenario normalization",()=>{const c=new RecordCollector();c.add({documentId:"a",type:"input",target:"displayName",value:"Ada"});assert.equal(c.stop()[0]!.value,"Ada");});
