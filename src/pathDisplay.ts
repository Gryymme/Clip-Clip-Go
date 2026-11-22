// Presentation only. Never pass this through to native execution or publication.
export function displayPath(value: string): string {
  if (/^\\\\\?\\[a-z]:\\/i.test(value)) return value.slice(4);
  if (/^\\\\\?\\UNC\\[^\\]+\\[^\\]+/i.test(value)) return '\\\\' + value.slice(8);
  return value;
}
// Recognize paths at message boundaries, leaving URL tokens and other namespaces intact.
export function displayPathText(value: string): string {
  return value.replace(/https?:\/\/[^\s]+|(^|[\s"'(])((?:\\\\\?\\)(?:[a-z]:\\|UNC\\[^\\\s]+\\[^\\\s]+))/gi,
    (match, boundary: string | undefined, path: string | undefined) => path ? (boundary ?? '') + displayPath(path) : match);
}
