import assert from "node:assert/strict";
import test from "node:test";
import { roomSurchargeMinor, foodPreferencePresets, normalizePaidSeminarAnswers, parsePaidSeminarFields,
  seminarDefaultAnswers } from "./paidSeminarFields";

test("seminar form saves and restores accommodation default and selectable food options", () => {
  const fields=parsePaidSeminarFields([
    {key:"accommodation",scope:"attendee",required:true,defaultValue:"yes"},
    {key:"food",scope:"attendee",required:true,defaultValue:"Vegetarian",options:[...foodPreferencePresets]},
    {key:"arrival",scope:"booking",required:false,defaultValue:"2026-12-05"},
  ]);
  assert.ok(fields);
  assert.deepEqual(seminarDefaultAnswers(fields,"attendee"),{
    accommodation:"yes",food:"Vegetarian",
  });
  assert.deepEqual(seminarDefaultAnswers(fields,"booking"),{arrival:"2026-12-05"});
  assert.deepEqual(parsePaidSeminarFields(JSON.parse(JSON.stringify(fields))),fields);
  const accepted=normalizePaidSeminarAnswers(fields,"attendee",seminarDefaultAnswers(fields,"attendee"));
  assert.deepEqual(accepted?.map(({key,value})=>[key,value]),[
    ["accommodation","yes"],["food","Vegetarian"],
  ]);
  assert.ok(normalizePaidSeminarAnswers(fields,"attendee",{food:"Non-vegetarian",accommodation:"no"}));
  assert.equal(normalizePaidSeminarAnswers(fields,"attendee",{food:"Other",accommodation:"yes"}),undefined);
});

test("custom food choices, free text, and historical field definitions remain compatible", () => {
  const custom=parsePaidSeminarFields([
    {key:"food",scope:"booking",required:false,options:["Vegan","Halal","Regular"],defaultValue:"Halal"},
  ]);
  assert.ok(custom);
  assert.equal(normalizePaidSeminarAnswers(custom,"booking",{food:"Vegetarian"}),undefined);
  assert.ok(normalizePaidSeminarAnswers(custom,"booking",{food:"Halal"}));
  const legacy=parsePaidSeminarFields([{key:"food",scope:"attendee",required:false}]);
  assert.deepEqual(legacy,[{key:"food",scope:"attendee",required:false}]);
  assert.ok(legacy && normalizePaidSeminarAnswers(legacy,"attendee",{food:"I do not eat onion"}));
});

test("invalid seminar default configurations are rejected before saving",()=>{
  const base={key:"accommodation",scope:"attendee",required:true};
  assert.equal(parsePaidSeminarFields([{...base,defaultValue:"sometimes"}]),undefined);
  assert.equal(parsePaidSeminarFields([{
    key:"food",scope:"attendee",required:true,options:["Veg","Veg"],
  }]),undefined);
  assert.equal(parsePaidSeminarFields([{
    key:"food",scope:"attendee",required:true,options:["Veg","Non-veg"],defaultValue:"Halal",
  }]),undefined);
  assert.equal(parsePaidSeminarFields([{
    key:"notes",scope:"booking",required:false,options:["One","Two"],
  }]),undefined);
});

test("transport dropdown preserves custom choices and validates attendee answers", () => {
  const config = { key: "transport", scope: "attendee", required: true, options: ["Shuttle", "Own car"], defaultValue: "Shuttle" };
  const fields = parsePaidSeminarFields([config]);
  assert.deepEqual(fields, [config]);
  assert.deepEqual(seminarDefaultAnswers(fields!, "attendee"), { transport: "Shuttle" });
  assert.ok(normalizePaidSeminarAnswers(fields!, "attendee", { transport: "Own car" }));
  assert.equal(normalizePaidSeminarAnswers(fields!, "attendee", { transport: "Taxi" }), undefined);
  assert.equal(parsePaidSeminarFields([{ ...config, defaultValue: "Taxi" }]), undefined);
});

test("single room adds the configured amount per attendee", () => {
  const room = { key: "room_preference", scope: "attendee", required: true,
    options: ["Shared", "Single"], surcharge: { option: "Single", minor: 130000 } };
  const fields = parsePaidSeminarFields([room]);
  assert.ok(fields);
  assert.equal(340000 + roomSurchargeMinor(fields, { room_preference: "Single" }), 470000);
  assert.equal(roomSurchargeMinor(fields, { room_preference: "Shared" }), 0);
  assert.equal(roomSurchargeMinor(fields, { room_preference: "Single", accommodation: "no" }), 0);
  assert.equal(parsePaidSeminarFields([{ ...room, scope: "booking" }]), undefined);
  assert.equal(parsePaidSeminarFields([{ ...room, surcharge: { option: "Missing", minor: 130000 } }]), undefined);
});
