/** Local presentation state only. The booking/audit records remain on the server. */
export type NotificationState = {
  key: string;
  time: number; // Legacy "all read before this time" value.
  readIds: string[];
  dismissedIds: string[];
};
export type NotificationItem = { id:string; occurred_ms:number };
const MAX_IDS=2000;
const ids=(value:unknown):string[]=>Array.isArray(value)
  ? [...new Set(value.filter((x):x is string=>typeof x==="string"&&x.length>0))].slice(-MAX_IDS)
  : [];
export const blankNotificationState=(key:string):NotificationState=>
  ({key,time:0,readIds:[],dismissedIds:[]});
export function parseNotificationState(key:string,raw:string|null):NotificationState {
  try {
    const value=JSON.parse(raw??"null");
    if(typeof value==="number")return {...blankNotificationState(key),time:Number.isFinite(value)?value:0};
    if(!value || typeof value!=="object")return blankNotificationState(key);
    return {key,time:Number.isFinite(Number(value.time))?Math.max(0,Number(value.time)):0,
      readIds:ids(value.readIds),dismissedIds:ids(value.dismissedIds)};
  }catch {return blankNotificationState(key);}
}
export const notificationIsUnread=(state:NotificationState,item:NotificationItem)=>
  Number(item.occurred_ms)>state.time&&!state.readIds.includes(item.id);
export const notificationIsArchived=(state:NotificationState,item:NotificationItem)=>
  state.dismissedIds.includes(item.id);
const append=(prior:string[],added:string[])=>ids([...prior,...added]);
export function markNotificationRead(state:NotificationState,items:NotificationItem[]):NotificationState {
  return {...state,readIds:append(state.readIds,items.map(x=>x.id))};
}
export function archiveNotifications(state:NotificationState,items:NotificationItem[]):NotificationState {
  return {...state,dismissedIds:append(state.dismissedIds,items.map(x=>x.id))};
}
export function restoreNotifications(state:NotificationState,items?:NotificationItem[]):NotificationState {
  if(!items)return {...state,dismissedIds:[]};
  const restore=new Set(items.map(x=>x.id));
  return {...state,dismissedIds:state.dismissedIds.filter(id=>!restore.has(id))};
}
