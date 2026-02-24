/**
 * Split a string into fixed-size chunks.
 *
 * @param str - The string to split.
 * @param size - Maximum character count per chunk.
 * @returns Array of string chunks.
 */
export function chunkString(str: string, size: number) {
  const chunks = [];
  for (let i = 0; i < str.length; i += size) {
    chunks.push(str.slice(i, i + size));
  }
  return chunks;
}
