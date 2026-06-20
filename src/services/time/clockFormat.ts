import dayjs from 'dayjs'

export const normalizeClockText = (value: string): string => {
  const text = String(value || '').trim()
  if (!text) return '00:00:00'

  if (text.includes('T')) {
    const parsed = dayjs(text)
    if (parsed.isValid()) return parsed.format('HH:mm:ss')
    return text.split('T')[1]?.slice(0, 8) || text
  }

  if (/^\d{1,2}:\d{2}$/.test(text)) return `${text}:00`
  if (/^\d{1,2}:\d{2}:\d{2}/.test(text)) return text.slice(0, 8)
  return text
}

export const formatClockWithFrame = (value: string): string => {
  const clock = normalizeClockText(value)
  const parsed = dayjs(`1970-01-01T${clock}`)
  if (!parsed.isValid()) return '00:00:00:00'
  return `${parsed.format('HH:mm:ss')}:00`
}
