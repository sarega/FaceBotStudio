export type CustomerLocale = "th" | "en";
export type CustomerCopy = [thai: string, english: string];

export function formatCustomerDate(value: string | null | undefined, locale: CustomerLocale) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "th" ? "th-TH" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(date);
}

const customerErrors: Record<string, CustomerCopy> = {
  CUSTOMER_NOT_AUTHENTICATED: ["กรุณาเข้าสู่ระบบอีกครั้ง", "Please sign in again."],
  CUSTOMER_APP_DISABLED: ["ระบบบัญชีผู้เข้าร่วมยังไม่พร้อมใช้งาน", "Customer accounts are currently unavailable."],
  "Invalid email or password": ["อีเมลหรือรหัสผ่านไม่ถูกต้อง", "Invalid email or password."],
  "Enter a valid email address": ["กรอกอีเมลที่ถูกต้อง", "Enter a valid email address."],
  "Enter a valid phone number": ["กรอกเบอร์โทรศัพท์ที่ถูกต้อง", "Enter a valid phone number."],
  "Password must be at least 8 characters": ["รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร", "Password must be at least 8 characters."],
  "An account with this email already exists": ["มีบัญชีที่ใช้อีเมลนี้แล้ว", "An account with this email already exists."],
  "Verification link is invalid or expired": ["ลิงก์ยืนยันอีเมลไม่ถูกต้องหรือหมดอายุ", "The verification link is invalid or expired."],
  "Too many password reset requests. Please wait and try again.": ["ขอรีเซ็ตรหัสผ่านหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่", "Too many password reset requests. Please wait and try again."],
  "Password reset email is temporarily unavailable": ["ระบบส่งอีเมลรีเซ็ตรหัสผ่านยังไม่พร้อม กรุณาลองใหม่ภายหลัง", "Password reset email is temporarily unavailable. Please try again later."],
  "Reset link is invalid or expired": ["ลิงก์ตั้งรหัสผ่านใหม่ไม่ถูกต้องหรือหมดอายุ", "The reset link is invalid or expired."],
  "Verified account contact does not match this record": ["ข้อมูลติดต่อที่ยืนยันแล้วไม่ตรงกับรายการนี้", "Your verified contact does not match this record."],
  "Record not found": ["ไม่พบรายการนี้", "Record not found."],
  "This order has expired or is no longer payable": ["คำสั่งซื้อนี้หมดอายุหรือชำระเงินไม่ได้แล้ว", "This order has expired or is no longer payable."],
  "Payment proof must be PNG, JPG, or WebP": ["เลือกหลักฐานเป็นภาพ PNG, JPG หรือ WebP", "Payment proof must be PNG, JPG, or WebP."],
  "Payment proof must be between 1 byte and 4 MB": ["เลือกภาพหลักฐานขนาดไม่เกิน 4 MB", "Choose a payment proof image up to 4 MB."],
};

export function customerErrorCopy(error: unknown, fallback: CustomerCopy): CustomerCopy {
  if (!(error instanceof Error)) return fallback;
  const detail = typeof error.cause === "string" && error.cause !== "Not found" ? error.cause : error.message;
  if (Object.hasOwn(customerErrors, detail)) return customerErrors[detail];
  return fallback;
}
