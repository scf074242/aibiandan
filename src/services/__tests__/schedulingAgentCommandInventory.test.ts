import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('Scheduling agent command inventory', () => {
  const inventoryPath = resolve(process.cwd(), 'docs/scheduling-agent-natural-language-command-inventory.md')

  it('keeps the scheduler utterance inventory broad and machine-checkable', () => {
    const markdown = readFileSync(inventoryPath, 'utf8')
    const commandNumbers = markdown
      .split(/\r?\n/)
      .map((line) => line.trim().match(/^(\d+)\.\s+/)?.[1])
      .filter((value): value is string => Boolean(value))
      .map(Number)

    expect(commandNumbers.length).toBeGreaterThanOrEqual(100)
    expect(commandNumbers[0]).toBe(1)
    expect(commandNumbers.at(-1)).toBe(commandNumbers.length)
    expect(commandNumbers).toEqual(commandNumbers.map((_, index) => index + 1))
  })

  it('keeps occupied-destination blocking explicit in the atomic command matrix', () => {
    const markdown = readFileSync(inventoryPath, 'utf8')
    const matrixRows = markdown
      .split(/\r?\n/)
      .filter((line) => /^\| C\d+ \|/.test(line))

    expect(matrixRows.length).toBeGreaterThanOrEqual(30)
    expect(markdown).toContain('移动/插入目的地已有节目')
    expect(markdown).toContain('time_overlap; block')
  })
})
