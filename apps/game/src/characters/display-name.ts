/** „Adam Nowak” or just „Adam” when the (optional) surname is empty. */
export function displayName(firstName: string, lastName = ''): string {
  return [firstName, lastName]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' ');
}
