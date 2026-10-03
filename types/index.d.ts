declare module 'claude-code' {
  interface PluginState {
    pomodoro: {
      /**
       * The timer as the prompt's hint line shows it (`🍅 18:42 · 2/4`):
       * empty while no pomodoro is on.
       */
      label: string
      /**
       * Bumped each time a round is recorded, so an open report pane, which
       * reads it, draws again.
       */
      historyVersion: number
    }
  }
}
