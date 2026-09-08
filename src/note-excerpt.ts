const NOTE_EXCERPT_LENGTH = 200

export function noteExcerpt(text: string, lineCut = false): string {
  const newlineAt = text.search(/[\r\n]/u)
  const firstLine = newlineAt < 0 ? text : text.slice(0, newlineAt)
  const characters = [...firstLine]
  const lengthCut = characters.length > NOTE_EXCERPT_LENGTH
  const excerpt = lengthCut ? characters.slice(0, NOTE_EXCERPT_LENGTH).join('') : firstLine
  return newlineAt >= 0 || lengthCut || lineCut ? `${excerpt}…` : excerpt
}
