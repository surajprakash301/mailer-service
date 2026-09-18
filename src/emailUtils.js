/** Real inbox we can send with Resend (exclude placeholders). */
export function isDeliverableEmail(email) {
  const value = String(email || "")
    .trim()
    .toLowerCase();
  if (!value.includes("@")) return false;
  if (value.endsWith("@loky-mock.test")) return false;
  if (value.endsWith("@example.com") || value.endsWith("@example-patna-motors.test")) return false;
  return true;
}
