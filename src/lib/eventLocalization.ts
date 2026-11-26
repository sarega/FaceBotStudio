export const TRANSLATABLE_EVENT_FIELDS = [
  "event_name","event_public_summary","event_description","event_venue_name","event_room_detail","event_location","event_travel","event_recurring_schedule","event_public_cta_label","event_public_success_message","event_public_privacy_label","event_public_privacy_text","event_public_contact_intro","event_public_contact_hours"
] as const;
export type EventTranslationField = typeof TRANSLATABLE_EVENT_FIELDS[number];
export type EventContent = Partial<Record<EventTranslationField,string>>;
export type EventTranslation = { fields: EventContent; sourceFingerprint: string; published: boolean; publishedFields?: EventContent };
export type EventLocalizations = Record<string,EventTranslation>;
export function normalizeLocale(value:unknown):string {
  return typeof value==="string" && /^[a-z]{2,3}(?:-[a-z0-9]{2,8}){0,2}$/i.test(value.trim()) ? value.trim().toLowerCase() : "";
}
export function extractEventContent(settings:Record<string,unknown>):EventContent {
  return Object.fromEntries(TRANSLATABLE_EVENT_FIELDS.map(key=>[key,typeof settings[key]==="string"?settings[key]:""]));
}
export function eventContentFingerprint(settings:Record<string,unknown>):string {
  const text=JSON.stringify(extractEventContent(settings));let hash=2166136261;
  for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619);}
  return (hash>>>0).toString(16);
}
export function parseEventLocalizations(raw:unknown):EventLocalizations {
  try {
    const obj=typeof raw==="string"?JSON.parse(raw||"{}"):raw;
    if(!obj||typeof obj!=="object"||Array.isArray(obj))return {};
    const result:EventLocalizations=Object.create(null);
    for(const [key,value] of Object.entries(obj).slice(0,20)){
      const locale=normalizeLocale(key);if(!locale||!value||typeof value!=="object")continue;
      const v=value as Record<string,unknown>;const fields:EventContent={};
      if(v.fields&&typeof v.fields==="object")for(const field of TRANSLATABLE_EVENT_FIELDS){
        const val=(v.fields as Record<string,unknown>)[field];if(typeof val==="string")fields[field]=val.slice(0,60000);
      }
      const publishedFields:EventContent={};
      if(v.publishedFields&&typeof v.publishedFields==="object")for(const field of TRANSLATABLE_EVENT_FIELDS){const val=(v.publishedFields as Record<string,unknown>)[field];if(typeof val==="string")publishedFields[field]=val.slice(0,60000);}
      result[locale]={fields,...(v.publishedFields&&typeof v.publishedFields==="object"?{publishedFields}:{}),sourceFingerprint:typeof v.sourceFingerprint==="string"?v.sourceFingerprint.slice(0,64):"",published:v.published===true};
    }return result;
  }catch{return {};}
}
export function localizeEventSettings<T extends Record<string,string>>(settings:T,locale:unknown):T {
  const target=normalizeLocale(locale);const primary=normalizeLocale(settings.event_content_language);
  if(!target||!primary||target===primary)return settings;
  const translation=parseEventLocalizations(settings.event_translations_json)[target];
  if(!translation?.published)return settings;
  return {...settings,...Object.fromEntries(Object.entries(translation.publishedFields??translation.fields).filter(([key,value])=>value.trim()))};
}
