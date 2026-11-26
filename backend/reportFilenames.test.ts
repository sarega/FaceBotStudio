import test from "node:test";
import assert from "node:assert/strict";
import {reportFilename,reportNames,downloadFilename} from "../src/lib/reportFilenames";
test("report filenames identify purpose, event and Bangkok date",()=>{
 const now=new Date("2026-11-26T18:00:00Z");
 assert.equal(reportFilename(reportNames.attendees,"syseminar2026","pdf",undefined,now),"Attendee-and-Meal-Roster_syseminar2026_2026-11-27.pdf");
 assert.equal(reportFilename("Payment-Transfer-Verification","event","pdf","all",now),"Payment-Transfer-Verification_event_all_2026-11-27.pdf");
 assert.equal(downloadFilename("attachment; filename*=UTF-8''%E0%B8%AD.pdf","fallback"),"อ.pdf");
 assert.equal(downloadFilename('attachment; filename="report.pdf"',"fallback"),"report.pdf");
});
