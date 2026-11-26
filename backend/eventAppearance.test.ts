import test from "node:test";
import assert from "node:assert/strict";
import {resolvePublicLayout,resolvePublicHeaderColor,getPublicHeaderForeground,resolvePublicThemeColor} from "../src/lib/publicEventPageBranding";
test("legacy appearance defaults remain compatible",()=>{
 assert.equal(resolvePublicLayout(undefined),"classic");
 assert.equal(resolvePublicHeaderColor(undefined),"");
 assert.equal(resolvePublicThemeColor(undefined),"#2563eb");
});
test("layout and header colors are validated",()=>{
 assert.equal(resolvePublicLayout("centered"),"centered");
 assert.equal(resolvePublicLayout("compact"),"compact");
 assert.equal(resolvePublicLayout("invalid"),"classic");
 assert.equal(resolvePublicHeaderColor("#ABCDEF"),"#abcdef");
 assert.equal(resolvePublicHeaderColor("url(bad)"),"");
});
test("header foreground maintains contrast",()=>{
 assert.equal(getPublicHeaderForeground("#ffffff"),"#000000");
 assert.equal(getPublicHeaderForeground("#000000"),"#ffffff");
 assert.equal(getPublicHeaderForeground("#ffff00"),"#000000");
});
