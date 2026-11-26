import type { ReportKind, RosterCsvKind } from "./registrationReportKinds";
export const reportNames:Record<ReportKind,string> = {
 accounting:"Registration-Accounting",followup:"Payment-Follow-Up",coupons:"Coupons-and-VIP-Guests",attendees:"Attendee-and-Meal-Roster",active_roster:"Active-Attendee-Roster"
};
export const rosterNames:Record<RosterCsvKind,string> = {active:"Active-Attendee-Roster",confirmed:"Confirmed-Attendee-Roster",pending:"Pending-Payment-Attendee-Roster"};
export function reportFilename(kind:string,eventName:string,extension:"pdf"|"csv",period?:string,now=new Date()){
 const safe=(value:string)=>value.normalize("NFKC").replace(/[^\p{L}\p{M}\p{N}_-]+/gu,"-").replace(/^-+|-+$/g,"").slice(0,80).replace(/-+$/,"");
 const date=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Bangkok",year:"numeric",month:"2-digit",day:"2-digit"}).format(now);
 return [safe(kind),safe(eventName)||"Event",...(period?[safe(period)]:[]),date].join("_")+"."+extension;
}
export function downloadFilename(header:string|null,fallback:string){
 const encoded=header?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
 if(encoded){try{return decodeURIComponent(encoded).replace(/[\\/\x00-\x1f]/g,"-");}catch{/* use ASCII fallback */}}
 return header?.match(/filename="([^"]+)"/i)?.[1]||fallback;
}
