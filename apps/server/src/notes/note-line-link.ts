/** Append a task/event markdown link onto the line that matches `lineNeedle` (trimmed equality or substring). */
export function appendMarkerAfterLine(content: string, lineNeedle: string, marker: string): string {
  const needle = lineNeedle.trim();
  if (!needle || !marker) return content;
  const lines = content.split("\n");
  let index = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === needle || line.includes(needle)) {
      index = i;
      break;
    }
  }
  if (index < 0) return content;
  const line = lines[index]!;
  if (line.includes(marker)) return content;
  lines[index] = `${line.replace(/\s*$/, "")} ${marker}`;
  return lines.join("\n");
}

export const appendMarkerAfterLineScript = `var appendMarkerAfterLine=(${appendMarkerAfterLine.toString()});`;
