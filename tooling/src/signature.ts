export function splitSignatureParameters(value: string): string[] {
  const result: string[] = []
  let start = 0
  let depth = 0
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (character === '<' || character === '(' || character === '[' || character === '{') depth += 1
    else if (character === '>' || character === ')' || character === ']' || character === '}') {
      depth -= 1
      if (depth < 0) throw new Error(`Invalid signature parameter list: ${value}`)
    } else if (character === ',' && depth === 0) {
      result.push(value.slice(start, index))
      start = index + 1
    }
  }
  if (depth !== 0) throw new Error(`Invalid signature parameter list: ${value}`)
  if (value.slice(start).trim() !== '') result.push(value.slice(start))
  return result
}
