import type { AgentCapability, AgentSubmitInput } from './types'

export class CapabilityRegistry {
  private readonly capabilities: AgentCapability[] = []

  register(capability: AgentCapability): void {
    if (this.capabilities.some((registered) => registered.id === capability.id)) {
      throw new Error(`Agent capability already registered: ${capability.id}`)
    }
    this.capabilities.push(capability)
  }

  list(): AgentCapability[] {
    return [...this.capabilities]
  }

  resolve(input: AgentSubmitInput): AgentCapability | null {
    return this.resolveAll(input)[0] ?? null
  }

  resolveAll(input: AgentSubmitInput): AgentCapability[] {
    return this.capabilities.filter((capability) => capability.canHandle(input))
  }
}
