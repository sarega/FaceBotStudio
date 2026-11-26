import test from "node:test";
import assert from "node:assert/strict";
import { extractEventContent, eventContentFingerprint, localizeEventSettings, parseEventLocalizations } from "../src/lib/eventLocalization";
const original={event_name:"สมาธิ",event_description:"<p>สวัสดี</p>",event_content_language:"th",event_public_slug:"meditation",event_date:"2026-12-05",event_public_summary:""};
const fields={event_name:"Meditation",event_description:"<p>Hello</p>",event_date:"bad",event_public_slug:"bad"};
test("only approved public fields overlay original settings; operational values stay stable",()=>{
 const settings={...original,event_translations_json:JSON.stringify({en:{fields,published:true,sourceFingerprint:eventContentFingerprint(original)}})};
 const result=localizeEventSettings(settings,"en");
 assert.equal(result.event_name,"Meditation");assert.equal(result.event_description,"<p>Hello</p>");assert.equal(result.event_public_slug,"meditation");assert.equal(result.event_date,original.event_date);
 assert.equal(localizeEventSettings(settings,"th"),settings);assert.equal(localizeEventSettings(settings,"fr"),settings);
});
test("draft and legacy events fall back to original",()=>{
 const settings={...original,event_translations_json:JSON.stringify({en:{fields,published:false}})};
 assert.equal(localizeEventSettings(settings,"en"),settings);
 assert.equal(localizeEventSettings({...settings,event_content_language:""},"en").event_name,original.event_name);
 assert.deepEqual(Object.keys(parseEventLocalizations("invalid")),[]);
});
test("fingerprint changes with source content but not operational settings",()=>{
 assert.equal(eventContentFingerprint(original),eventContentFingerprint({...original,event_date:"later"}));
 assert.notEqual(eventContentFingerprint(original),eventContentFingerprint({...original,event_description:"new"}));
 assert.equal(eventContentFingerprint(extractEventContent(original)),eventContentFingerprint(original));
});
