declare module 'claude-code' {
  interface PluginState {
    pomodoro: {
      /**
       * The timer as the prompt footer shows it (`🍅 18:42 · 2/4`): empty
       * while no pomodoro is on.
       */
      label: string
    }
  }
}
