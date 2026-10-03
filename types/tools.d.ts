// The inputs of the tools the mod lists for the model, so a `tool.call`
// hook on them is typed.
export {}

declare module 'claude-code' {
  interface McpToolInputs {
    mcp__pomodoro__stats: { day?: string }
    mcp__pomodoro__timer: { action: string; text?: string }
  }
}
