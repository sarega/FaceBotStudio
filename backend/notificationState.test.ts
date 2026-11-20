import test from "node:test";
import assert from "node:assert/strict";
import {archiveNotifications,blankNotificationState,markNotificationRead,notificationIsArchived,
  notificationIsUnread,parseNotificationState,restoreNotifications} from "../src/features/notifications/notificationState";
test("notification operations never change server items and persist across reload",()=>{
 const items=[{id:"a",occurred_ms:10},{id:"b",occurred_ms:20},{id:"c",occurred_ms:30}];
 const blank=blankNotificationState("user-event");
 const read=markNotificationRead(blank,items.slice(0,2));
 assert.equal(notificationIsUnread(read,items[0]),false);
 assert.equal(notificationIsUnread(read,items[2]),true,"a future alert must stay unread");
 const archived=archiveNotifications(read,[items[0]]);
 assert.equal(notificationIsArchived(archived,items[0]),true);
 assert.equal(notificationIsArchived(parseNotificationState("user-event",JSON.stringify(archived)),items[0]),true);
 const restored=restoreNotifications(archived);
 assert.equal(notificationIsArchived(restored,items[0]),false);
 assert.equal(notificationIsUnread(restored,items[0]),false,"restore must not turn a read alert into unread");
 assert.deepEqual(items.map(x=>x.id),["a","b","c"]);
});
test("legacy timestamps, corrupted storage and many entries handled",()=>{
 assert.equal(notificationIsUnread(parseNotificationState("a","100"),{id:"old",occurred_ms:50}),false);
 assert.deepEqual(parseNotificationState("a","not-json"),blankNotificationState("a"));
 const many=Array.from({length:100},(_,i)=>({id:String(i),occurred_ms:i+1}));
 const archived=archiveNotifications(blankNotificationState("a"),many);
 assert.equal(archived.dismissedIds.length,100,"older dismissal state must not fall off at 40");
 const restored=restoreNotifications(archived,[many[0]]);
 assert.equal(restored.dismissedIds.length,99);
});
