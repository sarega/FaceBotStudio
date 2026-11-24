// Keep the number as entered so domestic leading zeros and international prefixes survive.
export function isOptionalAttendeePhone(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 64) return false;
  const phone = value.trim();
  if (!phone) return true;
  const digits = phone.replace(/\D/g, "");
  return /^\+?[0-9(][0-9(). -]*$/.test(phone) && digits.length >= 6 && digits.length <= 15;
}
