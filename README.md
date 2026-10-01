# claude-pomodoro

A pomodoro timer in the prompt footer of [Claude Code](https://claude.com/claude-code). It runs on the wall clock like any other, with one difference: the break is timed to land while Claude works, when you have a wait ahead of you anyway.

Type `/pomodoro start` and the round counts down at the right of the footer, on the row over the hint line:

```
> _
                                                 🍅 18:42 · 2/4
? for shortcuts
```

## Install

```sh
claude plugin marketplace add barisdemirhan/claude-pomodoro
claude plugin install pomodoro@claude-pomodoro
```

Restart Claude Code, then run `/pomodoro start`.

The same two steps work from inside a session with `/plugin marketplace add barisdemirhan/claude-pomodoro` and `/plugin install pomodoro@claude-pomodoro`.

## Use

| Command | What it does |
| --- | --- |
| `/pomodoro start` | Begins a set at focus round 1, or runs a paused timer on. Plain `/pomodoro` does the same, and says where the timer stands once one is on |
| `/pomodoro pause` | Holds the timer where it is |
| `/pomodoro resume` | Runs a paused timer on |
| `/pomodoro skip` | Goes to the next phase now. A skipped focus round is not counted |
| `/pomodoro stop` | Ends the pomodoro |
| `/pomodoro stats` | Today's rounds and focus time, your days in a row, and your rounds in all |
| `/pomodoro sound` | Turns the sounds off or on. `/pomodoro sound on` and `/pomodoro sound off` say which |

A set is four focus rounds of 25 minutes with a 5 minute break after each, and a 15 minute break after the fourth. Once started it runs round after round until you stop it.

| In the footer | It means |
| --- | --- |
| `🍅 18:42 · 2/4` | Focus round 2 of 4, 18:42 left |
| `🍅 break due · 2/4` | The round ran out and waits for Claude to start working |
| `☕ 4:12` | A break, 4:12 left |
| `🍅 paused 18:42 · 2/4` | Paused |

## It keeps time with Claude

- **The break begins while Claude works.** When a focus round runs out in the middle of a turn, the break starts right then: Claude is busy and you are waiting. When it runs out while you are at the prompt, the footer says `break due` and the break starts with your next prompt, so you step away as Claude gets to work. If no prompt comes within five minutes, the break starts anyway. The minutes past the round's end count as focus.
- **It tells you when Claude wants you back.** If Claude finishes its turn or asks for a permission during your break, a toast says so and how much of the break is left.
- **One timer for every session.** All your open Claude Code sessions show the same pomodoro. Start it in one, and the others pick it up within five seconds; a break shows as a toast in each, and the sound plays once.
- **It stops when nobody is there.** A phase that ran out more than half an hour ago, with the machine asleep or every session closed, ends the pomodoro without counting the round.

## Settings

The lengths are in Claude Code's `/config` menu, under the plugin's name:

| Setting | Default |
| --- | --- |
| Focus minutes | 25 |
| Break minutes | 5 |
| Long break minutes | 15 |
| Rounds | 4 |

A change applies from the next phase on.

## Requirements

- A Claude Code build with mod support (plugins that ship a hooks module). Built and tested on 2.1.287. Mods sit behind a rollout switch, so if `/pomodoro` does not show up after installing, the switch may still be off for you.
- The terminal or the desktop app: the footer label is drawn only there.
- Sound needs macOS, where Claude Code has a player for it. Elsewhere the timer is silent.

## What it does on your machine

The mod registers one slash command and adds one label to the mode labels at the right of the prompt footer. It makes no network requests, reads no files and runs no processes. It never changes a prompt, a tool call or a tool's result.

Of Claude's work it reads only when a turn starts and ends, and when Claude Code notifies you that it waits on a permission or a question. It reads nothing of a prompt's text, a tool call or an answer.

It saves three things in the plugin's own Claude Code store: the timer (its phase, when the phase began and how long it runs), your rounds and focus time per day, and whether the sound is off.

It plays two short sounds from its own `sounds/` folder, through Claude Code's player.

Its hooks, all in `hooks/register.ts`:

- `session.start` registers the `/pomodoro` command and starts the one-second tick that reads the shared timer, then passes the event on unchanged.
- `command.run` answers only the `/pomodoro` command. Other commands never reach it.
- `turn.start` notes that Claude is working and begins a break that was due, then passes the event on unchanged.
- `turn.complete` and `classic.Notification` show the toast during a break: the first when Claude's turn ends, the second when Claude Code notifies you that it waits on you. Both pass the event on unchanged and decide nothing.
- `ui.render` adds the timer's label to the footer's mode labels, leaving the others as they are.

The file under `tests/` runs only under `claude plugin test`, and is never loaded in a session.

## Develop

```sh
git clone https://github.com/barisdemirhan/claude-pomodoro
claude plugin validate claude-pomodoro
claude plugin test claude-pomodoro
claude --plugin-dir claude-pomodoro
```

The mod is two files: `hooks/timer.ts` is the timer itself, told from the clock alone, and `hooks/register.ts` holds the hooks that tie it to Claude Code.

## License

MIT
