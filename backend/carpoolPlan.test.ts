import test from "node:test";
import assert from "node:assert/strict";
import {parseCarpoolUpdate} from "./carpoolPlan";
const car={driverId:"shared-van1",kind:"shared",label:"Van 1",driverName:"External driver",seats:10,pickup:"Lobby",departure:"07:00",note:"Meet early",passengers:["p1"]};
test("shared cars retain independent identity and logistics details",()=>{
 const plan=parseCarpoolUpdate({version:0,roles:{},cars:[car]});
 assert.deepEqual(plan?.cars,[car]);
});
test("reject overbooking and duplicate passengers across shared and private vehicles",()=>{
 assert.equal(parseCarpoolUpdate({version:0,roles:{},cars:[{...car,seats:0}]}),null);
 assert.equal(parseCarpoolUpdate({version:0,roles:{},cars:[car,{driverId:"d1",seats:2,pickup:"",passengers:["p1"]}]}),null);
});
