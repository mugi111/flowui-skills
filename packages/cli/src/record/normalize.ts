import type { RecordedEvent } from "./collector.js";
export function normalizeRecord(events:readonly RecordedEvent[]):readonly RecordedEvent[]{const out:RecordedEvent[]=[];for(const e of events){const last=out.at(-1);if(e.type==="input"&&last?.type==="input"&&last.target===e.target&&last.documentId===e.documentId){out[out.length-1]=e;}else out.push(e);}return out;}
