// Two tools the model can call, for a person who turned them on: one reads
// where the pomodoro stands and what was done, the other acts on the timer
// with the words `/pomodoro` takes. Here only as the model reads them: the
// hooks module serves them.

import type { ToolSpec } from 'claude-code'

export const ACTIONS = ['start', 'pause', 'resume', 'skip', 'finish', 'stop', 'extend', 'note']

export const TOOLS: readonly ToolSpec[] = [
  {
    name: 'stats',
    description:
      "Reads the person's pomodoro timer: where it stands now, their focus stats (today, days in a row, the last 7 days by project and tag) and one day's focus rounds with what each was for. Read-only.",
    inputSchema: {
      type: 'object',
      properties: {
        day: {
          type: 'string',
          description: 'The day to list: today (the default), yesterday or YYYY-MM-DD',
        },
      },
    },
  },
  {
    name: 'timer',
    description:
      "Acts on the person's pomodoro timer as `/pomodoro <action> [text]` does. Use it only when the person asks for it. start and note take what the rounds are for, with #tags; extend takes minutes.",
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ACTIONS },
        text: {
          type: 'string',
          description: 'What the rounds are for, or the minutes to extend by',
        },
      },
      required: ['action'],
    },
  },
]
