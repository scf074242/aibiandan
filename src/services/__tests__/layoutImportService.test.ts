import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'

import { LayoutImportService } from '@/services/layoutImportService'

const createWorkbookFile = (sheets: Record<string, unknown[][]>, fileName = 'layout.xlsx') => {
  const workbook = XLSX.utils.book_new()

  Object.entries(sheets).forEach(([sheetName, rows]) => {
    const worksheet = XLSX.utils.aoa_to_sheet(rows)
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName)
  })

  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
  return new File([buffer], fileName, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

describe('LayoutImportService', () => {
  it('识别 weekday_columns 模板并按日期匹配当天列', async () => {
    const service = new LayoutImportService()
    const file = createWorkbookFile({
      Template: [
        ['time', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
        ['06:00-07:00', 'Morning News', 'Morning News', 'Morning News', 'Morning News', 'Morning News', 'Weekend News', 'Weekend News'],
        ['07:00-08:00', 'City Focus', 'City Focus', 'City Focus', 'City Focus', 'Friday Special', 'Weekend Show', 'Weekend Show'],
        ['08:00-09:00', '', '', '', '', '', '', ''],
      ],
    }, 'weekday-columns.xlsx')

    const result = await service.importFile(file, 'dragon', '2026-04-03')

    expect(result.templateMode).toBe('weekday_columns')
    expect(result.matchedSheetName).toBe('Template')
    expect(result.matchedWeekday).toBe('friday')
    expect(result.layoutReference.slots).toHaveLength(2)
    expect(result.columns.length).toBeGreaterThanOrEqual(2)
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('识别 weekday_sheet 模板并按工作表名导入', async () => {
    const service = new LayoutImportService()
    const file = createWorkbookFile({
      Friday: [
        ['starttime', 'endtime', 'columnname', 'programtype'],
        ['09:00', '10:00', 'Morning Live', 'news'],
        ['10:00', '11:30', 'Drama Replay', 'drama'],
      ],
    }, 'weekday-sheet.xlsx')

    const result = await service.importFile(file, 'dragon', '2026-04-03')

    expect(result.templateMode).toBe('weekday_sheet')
    expect(result.matchedSheetName).toBe('Friday')
    expect(result.matchedWeekday).toBe('friday')
    expect(result.layoutReference.slots).toHaveLength(2)
    expect(result.columns.some((column) => column.defaultProgramType === 'drama')).toBe(true)
  })

  it('无法识别版面模板时抛出错误', async () => {
    const service = new LayoutImportService()
    const file = createWorkbookFile({
      Sheet1: [
        ['foo', 'bar'],
        ['baz', 'qux'],
      ],
    }, 'invalid-layout.xlsx')

    await expect(service.importFile(file, 'dragon', '2026-04-03')).rejects.toThrow()
  })
})
