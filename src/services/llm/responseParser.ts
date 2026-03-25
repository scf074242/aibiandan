/**
 * LLM 响应解析器
 * 负责解析和验证 LLM 返回的 JSON 命令
 */
import type {
  ScheduleCommand,
  CommandType,
  ParseResult,
  ValidationResult,
} from '@/types/llm'

// 支持的命令类型列表
const VALID_COMMAND_TYPES: CommandType[] = [
  'plan',
  'query_candidates',
  'fill_item',
  'insert',
  'delete',
  'replace',
  'swap',
  'move',
  'update_field',
  'batch',
]

export class ResponseParser {
  /**
   * 解析 LLM 响应
   */
  parse(response: string): ParseResult<ScheduleCommand> {
    try {
      // 清理响应内容
      const cleaned = this.cleanResponse(response)

      // 解析 JSON
      const parsed = JSON.parse(cleaned)

      // 验证命令结构
      const validation = this.validateCommand(parsed)
      if (!validation.valid) {
        return {
          success: false,
          error: `Command validation failed: ${validation.errors.join(', ')}`,
          rawResponse: response,
        }
      }

      return {
        success: true,
        data: parsed as ScheduleCommand,
      }
    } catch (error) {
      return this.handleParseError(error as Error, response)
    }
  }

  /**
   * 验证命令结构
   */
  validateCommand(command: unknown): ValidationResult {
    const errors: string[] = []

    if (!command || typeof command !== 'object') {
      errors.push('Command must be an object')
      return { valid: false, errors }
    }

    const cmd = command as Record<string, unknown>

    // 检查 action 字段
    if (!cmd.action || typeof cmd.action !== 'string') {
      errors.push('Missing or invalid "action" field')
    } else if (!VALID_COMMAND_TYPES.includes(cmd.action as CommandType)) {
      errors.push(`Invalid action type: ${cmd.action}`)
    }

    // 检查 data 字段
    if (!cmd.data || typeof cmd.data !== 'object') {
      errors.push('Missing or invalid "data" field')
    }

    // 根据 action 类型进行特定验证
    if (cmd.action && errors.length === 0) {
      const actionErrors = this.validateActionData(cmd.action as CommandType, cmd.data)
      errors.push(...actionErrors)
    }

    return {
      valid: errors.length === 0,
      errors,
    }
  }

  /**
   * 根据 action 类型验证 data
   */
  private validateActionData(action: CommandType, data: unknown): string[] {
    const errors: string[] = []
    const d = data as Record<string, unknown>

    switch (action) {
      case 'plan':
        if (!Array.isArray(d.blocks)) {
          errors.push('plan command requires "blocks" array')
        }
        break

      case 'fill_item':
        if (!d.selectedProgram || typeof d.selectedProgram !== 'object') {
          errors.push('fill_item command requires "selectedProgram" object')
        }
        break

      case 'insert':
      case 'delete':
      case 'replace':
        if (!Array.isArray(d.items) && !Array.isArray(d.targetIds)) {
          errors.push(`${action} command requires "items" or "targetIds" array`)
        }
        break

      case 'swap':
      case 'move':
        if (!d.sourceId || !d.targetId) {
          errors.push(`${action} command requires "sourceId" and "targetId"`)
        }
        break

      case 'update_field':
        if (!d.itemId || !d.field || d.value === undefined) {
          errors.push('update_field command requires "itemId", "field", and "value"')
        }
        break

      case 'batch':
        if (!Array.isArray(d.commands)) {
          errors.push('batch command requires "commands" array')
        }
        break
    }

    return errors
  }

  /**
   * 清理响应内容
   * 去除 markdown 代码块标记等
   */
  private cleanResponse(response: string): string {
    let cleaned = response.trim()

    // 去除 markdown 代码块标记
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.slice(7)
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.slice(3)
    }

    if (cleaned.endsWith('```')) {
      cleaned = cleaned.slice(0, -3)
    }

    // 去除前后空白
    cleaned = cleaned.trim()

    // 尝试提取 JSON 对象（如果响应包含其他文本）
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      cleaned = jsonMatch[0]
    }

    return cleaned
  }

  /**
   * 处理解析错误
   */
  handleParseError(error: Error, rawResponse: string): ParseResult<never> {
    console.error('Failed to parse LLM response:', error)
    console.error('Raw response:', rawResponse)

    let errorMessage = 'Failed to parse response'

    if (error instanceof SyntaxError) {
      errorMessage = 'Invalid JSON format in response'
    } else if (error.message.includes('Unexpected token')) {
      errorMessage = 'Response contains unexpected characters'
    }

    return {
      success: false,
      error: errorMessage,
      rawResponse,
    }
  }

  /**
   * 批量解析多个命令
   */
  parseBatch(response: string): ParseResult<ScheduleCommand[]> {
    try {
      const cleaned = this.cleanResponse(response)
      const parsed = JSON.parse(cleaned)

      if (!Array.isArray(parsed)) {
        return {
          success: false,
          error: 'Expected array of commands',
          rawResponse: response,
        }
      }

      const commands: ScheduleCommand[] = []
      const errors: string[] = []

      for (let i = 0; i < parsed.length; i++) {
        const validation = this.validateCommand(parsed[i])
        if (validation.valid) {
          commands.push(parsed[i] as ScheduleCommand)
        } else {
          errors.push(`Command ${i + 1}: ${validation.errors.join(', ')}`)
        }
      }

      if (errors.length > 0 && commands.length === 0) {
        return {
          success: false,
          error: `All commands failed validation: ${errors.join('; ')}`,
          rawResponse: response,
        }
      }

      return {
        success: true,
        data: commands,
      }
    } catch (error) {
      return this.handleParseError(error as Error, response)
    }
  }
}

// 导出单例实例
export const responseParser = new ResponseParser()
