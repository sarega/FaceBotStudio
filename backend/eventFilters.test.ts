import test from "node:test";
import assert from "node:assert/strict";
import { eventMatchesFilter, eventMatchesText } from "../src/lib/eventFilters";
import type { EventRecord } from "../src/types";
const make=(effective_status:EventRecord["effective_status"],date=""):EventRecord=>({id:effective_status,name:"Meditation Seminar",slug:"seminar",organizer_id:"org_default",organizer_name:"Yoga",effective_status,status:effective_status==="closed"?"active":effective_status,event_date:date,event_timezone:"Asia/Bangkok",is_default:false,is_active:effective_status==="active",created_at:"",updated_at:""});
test("event lifecycle filters preserve archive and selected records",()=>{
 const archived=make("archived");
 assert.equal(eventMatchesFilter(archived,"current"),false);
 assert.equal(eventMatchesFilter(archived,"assigned",["archived"]),true);
 assert.equal(eventMatchesFilter(archived,"archived"),true);
 assert.equal(eventMatchesFilter(make("closed"),"past"),true);
 assert.equal(eventMatchesFilter(make("pending"),"current"),true);
 assert.equal(eventMatchesFilter(make("active"),"current"),true);
 assert.equal(eventMatchesFilter(make("active","2026-11-27T12:00"),"upcoming",[],new Date("2026-11-26T10:00:00Z")),true);
 assert.equal(eventMatchesText(archived,"yoga seminar"),true);
});
