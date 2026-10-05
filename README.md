# claude-pomodoro

A pomodoro timer on the prompt's hint line in [Claude Code](https://claude.com/claude-code). It runs on the wall clock like any other, with one difference: the break is timed to land while Claude works, when you have a wait ahead of you anyway.

Type `/pomodoro start` and the round counts down at the end of the hint line under the prompt:

```
> _
? for shortcuts · 🍅 18:42 · 2/4
```

## Install

```sh
claude plugin marketplace add barisdemirhan/claude-mods
claude plugin install pomodoro@claude-mods
```

Restart Claude Code, then run `/pomodoro start`.

The same two steps work from inside a session with `/plugin marketplace add barisdemirhan/claude-mods` and `/plugin install pomodoro@claude-mods`.

[claude-mods](https://github.com/barisdemirhan/claude-mods) is one marketplace for all of these mods, so its first line is needed once for the lot.

### If you installed from `claude-pomodoro`

Nothing has to change. This repository is still a marketplace of its own, and `pomodoro@claude-pomodoro` goes on getting updates.

Moving to `claude-mods` is a new install as Claude Code sees it, and it starts with an empty store: without your rounds and the running timer. To bring them along, copy the store's file to its new name before you install, with no Claude Code session open:

```sh
cp -R ~/.claude/plugins/store ~/claude-store-backup
cp ~/.claude/plugins/store/pomodoro_claude-pomodoro-69a776f141b5.json ~/.claude/plugins/store/pomodoro_claude-mods-cf0e3c48f8c2.json
claude plugin marketplace add barisdemirhan/claude-mods
claude plugin install pomodoro@claude-mods
claude plugin uninstall pomodoro@claude-pomodoro
```

The two file names are where Claude Code 2.1.288 keeps a mod's store. They are Claude Code's own and may change with it. The first line keeps a copy of every store in `~/claude-store-backup`, to put back if the move goes wrong; delete it once the mod shows what it showed before. Uninstalling leaves the old store's file where it is. Keep one of the two installs, not both: with both on, every hook runs twice.

## Use

| Command | What it does |
| --- | --- |
| `/pomodoro start [what #tag]` | Begins a set at focus round 1, for what you name with any `#tags`. On a running pomodoro it runs a paused timer on, or begins the round a finished break waits on. Plain `/pomodoro` begins one the same way, and says where the timer stands once one is on |
| `/pomodoro pause` | Holds the timer where it is |
| `/pomodoro resume` | Runs a paused timer on |
| `/pomodoro extend [minutes]` | Gives the phase 5 more minutes, or as many as you say |
| `/pomodoro finish` | Ends the focus round now and counts it with the time it ran, then the break begins |
| `/pomodoro skip` | Goes to the next phase now. A focus round skipped before its end is not counted, though its focus time is |
| `/pomodoro stop` | Ends the pomodoro |
| `/pomodoro note [what #tag]` | Says what the rounds are for from now on. With nothing after it, clears it |
| `/pomodoro undo` | Takes back the last change of phase, within five minutes: a stop, a skip, a finish, or a break that began, with the round it counted |
| `/pomodoro stats` | Today's rounds and focus time, against your daily goal if you set one; your days in a row and the best run; your rounds in all; and the last seven days by project and tag, with Claude's share |
| `/pomodoro report` | Opens a pane with the same, drawn: the last seven days as bars, twelve weeks as a heat map, the hours you focus in, and your top projects and tags |
| `/pomodoro log [day]` | One day's rounds, one to a line: when, how long, what for, where, and Claude's part. `today` with no word, or `yesterday`, or a date as `2026-10-02` |
| `/pomodoro export [json\|csv\|ical] [file]` | Every round kept, as CSV with no word. To the clipboard, or to the file you name (`~/focus.ics`) |
| `/pomodoro sound` | Turns the sounds off or on. `/pomodoro sound on` and `/pomodoro sound off` say which. Every open session follows within a second |
| `/pomodoro controls` | Opens or closes the timer's row of buttons. `/pomodoro controls on` and `/pomodoro controls off` say which. Every open session follows within a second |
| `/pomodoro close` | Takes it all out of sight and hearing, in every open session within a second: the timer on the hint line and its row of buttons, the report, the toasts and the sounds. Unlike `/pomodoro stop`, the pomodoro runs on. `/pomodoro exit` and `/pomodoro quit` do the same; `/pomodoro open` brings it all back as it was, and so do `/pomodoro start`, `/pomodoro resume` and `/pomodoro controls on` |

A set is four focus rounds of 25 minutes with a 5 minute break after each, and a 15 minute break after the fourth. Once started it runs round after round until you stop it.

Where there is a pointer to press with, the terminal's fullscreen layout or the desktop app, the timer moves to a row of its own right under the hint line, with buttons beside it that do the same as the commands:

```
? for shortcuts
🍅 18:42 · 2/4  [ ❚❚ pause ]  [ +5m ]  [ ✓ finish ]  [ ■ stop ]  [ ● sound ]  [ report ]  [ × ]
```

The row always begins with 🍅, so it reads as the pomodoro's: `🍅 pomodoro` with none on, `🍅 ☕ 4:12` on a break. The buttons follow where the timer stands: `▶ start` with none on, `▶ resume` when paused, `▶ break` for a round that ran out, `▶ focus` during a break, and `↶ undo` for five minutes after a change of phase. The one most likely wanted comes first; the rest are drawn dim. `×` closes the row, in every session, and the timer goes back to the end of the hint line; `/pomodoro controls` opens it again. The **Control row** setting shows it always, only while a pomodoro is on, or never. On the terminal's main screen, which has no pointer, there is no row and the commands do it all.

The row sits right under the hint line, over the rows other mods draw there, and leaves what they draw over the line where it is.

| On the hint line | It means |
| --- | --- |
| `🍅 18:42 · 2/4` | Focus round 2 of 4, 18:42 left |
| `🍅 break due · 2/4` | The round ran out and waits for Claude to start working |
| `☕ 4:12` | A break, 4:12 left |
| `☕ break over` | The break ran out and the next round waits for you to come back |
| `🍅 paused 18:42 · 2/4` | Paused |

## It keeps time with Claude

- **The break begins while Claude works.** When a focus round runs out in the middle of a turn, the break starts right then: Claude is busy and you are waiting. When it runs out while you are at the prompt, the hint line says `break due` and the break starts with your next prompt, so you step away as Claude gets to work. If no prompt comes within five minutes, the break starts anyway. The minutes past the round's end count as focus.
- **The next round begins when you are back.** When a break runs out, a toast and a sound say so, the hint line says `break over`, and the next focus round starts with the next prompt you send. A prompt from a schedule, a background task or another session is not you, and does not start it.
- **It tells you when Claude wants you back.** If Claude finishes its turn or asks for a permission during your break, a toast says so and how much of the break is left. When you are back, a toast says how many turns Claude finished and how many times it asked for you while you were away.
- **It knows Claude's part.** A round keeps how long Claude worked inside it and how many prompts you sent, and the stats say what share of your focus time Claude was working.
- **One timer for every session.** All your open Claude Code sessions show the same pomodoro. Start it in one, and the others pick it up within five seconds; a break shows as a toast in each, and the sound plays once. Before a session turns the phase it reads the timer again, and leaves the turn to another session that changed it first. Claude Code's store has no atomic write, so two sessions turning it in the very same moment can still both do so.
- **It stops when nobody is there.** A break that has waited half an hour for you ends the pomodoro, and so does a phase that ran out more than half an hour ago with the machine asleep or every session closed. Neither counts a round nobody did.

## What a round keeps

Each focus round is kept with when it began and ended, how long it was focused, whether it was done or stopped early, what you said it was for and its tags, the repositories or folders you worked in during it (by name), Claude's working time and your prompts. A round stopped before a minute of focus is not kept. Rounds older than 400 days are folded into their days' totals.

The stats from an earlier version of the mod, a total per day, carry over as days with no rounds listed.

## Settings

All of these are in Claude Code's `/config` menu, under the plugin's name:

| Setting | Default | What it does |
| --- | --- | --- |
| Focus minutes | 25 | |
| Break minutes | 5 | |
| Long break minutes | 15 | |
| Rounds | 4 | Focus rounds in a set, the long break after the last |
| Focus starts | `prompt` | After a break: `prompt` waits for your next prompt, `auto` starts the round at once. A round `auto` started that sees no prompt, command or turn of Claude's is taken as nobody being there, and ends uncounted |
| Break starts | `claude` | After a focus round: `claude` waits up to five minutes for Claude to start working, `auto` starts the break at once |
| Daily goal | 0 | Rounds a day you aim for, shown in the stats and told with a toast when met. 0 for none |
| Hint style | `full` | `full` shows `2/4`, `dots` shows `●●○○`, `minimal` the clock alone |
| Control row | `always` | The timer's row of buttons where there is a pointer: `always`, `running` (only while a pomodoro is on) or `off` |
| Volume | 50 | How loud the sounds play, 0 to 100 |
| Spoken announcements | off | Says each change of phase aloud as well, with the system voice |
| Open Pomodoro files | off | See below |
| Hook scripts | off | See below |
| Tools for Claude | off | See below |

A change of length applies from the next phase on.

## Open Pomodoro and hook scripts

[openpomodoro-cli](https://github.com/open-pomodoro/openpomodoro-cli) and the tools around it keep a pomodoro in `~/.pomodoro`, in the [Open Pomodoro format](https://github.com/open-pomodoro/open-pomodoro-format). Two settings, both off until you turn them on, let this mod share it:

- **Open Pomodoro files** keeps `~/.pomodoro/current` while a focus round runs and clears it when the round ends, so a tmux status line or anything else that reads it shows this timer. The format has no pause, so a resumed round's end moves later by the time it sat paused. Each round done goes into `~/.pomodoro/history` with the time it ran, in place of the line the CLI wrote for a round it began; a round stopped early or taken back with `/pomodoro undo` has its line removed, as the CLI's cancel does. A pomodoro `pomodoro start` began while none is on here shows up here within five seconds. Finishing or cancelling it with the CLI is not followed: end it here. Breaks are not part of the format, so they stay in the mod.
- **Hook scripts** runs the executables you keep in `~/.pomodoro/hooks/` as openpomodoro-cli does: `start` when a focus round begins, `break` when a break begins, and `stop` when a phase ends, a break included when it runs out with the next round waiting on you. Each gets `POMODORO_EVENT`, `POMODORO_PHASE`, `POMODORO_ROUND`, `POMODORO_ROUNDS`, `POMODORO_MINUTES`, `POMODORO_DESCRIPTION`, `POMODORO_TAGS` and `POMODORO_DIRECTORY`, and ten seconds to run. Unlike the CLI's, these run when a phase runs out on its own too. A script that turns on macOS Focus could be:

  ```sh
  #!/bin/sh
  # ~/.pomodoro/hooks/start
  shortcuts run "Focus On"
  ```

Only the session that changes the phase writes the files and runs the scripts, so they happen once however many sessions are open.

## Tools for Claude

With **Tools for Claude** on, Claude can call two tools: `stats`, which reads where the timer stands, the stats and one day's rounds, and `timer`, which acts on the timer as `/pomodoro` does. Ask "how much did I focus this week, and on what?" or "start a pomodoro for the auth tests". Claude Code asks your permission for them as for any tool, and their descriptions take a little of every prompt's context, which is why they are off by default.

## Requirements

- A Claude Code build with mod support (plugins that ship a hooks module). Built and tested on 2.1.288. Mods sit behind a rollout switch, so if `/pomodoro` does not show up after installing, the switch may still be off for you.
- The terminal or the desktop app: the timer is drawn only there. The terminal has it on the hint line, the desktop app among the mode labels beside it.
- Sound needs macOS, where Claude Code has a player for it. Elsewhere the timer is silent.

## Privacy and data handling

The mod registers one slash command, adds one label to the hint line under the prompt, or where there is a pointer a row under it with the label and its buttons, and draws the report pane when you open it. It never changes a prompt, a tool call or a tool's result.

**What it reads.** Of Claude's work, only when a turn starts and ends and how long it ran, and when Claude Code notifies you that it waits on a permission or a question. Of your prompts, only where each came from, to tell yours from a schedule's or another session's. It reads nothing of a prompt's text, a tool call or an answer. It asks Claude Code for the name of the repository or folder a session works in, to keep it with the rounds.

**What it sends.** Nothing. It makes no network request, and has no server, no account and no analytics.

**What reaches Claude.** What `/pomodoro` answers is a row of the conversation, as any command's output is, and Claude reads it with the rest: `/pomodoro stats` and `/pomodoro log` show your rounds' labels, tags and project names. With **Tools for Claude** on, what the `stats` tool answers goes into the conversation the same way. It is off until you turn it on.

**What it keeps.** These, in the plugin's own Claude Code store, one JSON file under `~/.claude/plugins/store/` on your disk: the timer (its phase, when it began, how long it runs, and what the rounds are for), your rounds and a count of their changes, what the running round gathered so far in each session, the rounds lately ended, when you last sent a prompt, what `/pomodoro undo` would take back, whether the sound is off, whether the row of buttons is closed, and whether you closed it all with `/pomodoro close`.

**Sound.** It plays two short sounds from its own `sounds/` folder, through Claude Code's player, and with spoken announcements on, speaks through the system voice.

**Files and processes.** Out of the box it reads no files, writes none and runs no processes. Only these do, each when you ask for it:

- `/pomodoro export` with a file name writes that file. Without one it copies to the clipboard.
- **Open Pomodoro files** reads `HOME` to find `~/.pomodoro`, reads and writes `current` and `history` there, and nothing else.
- **Hook scripts** runs the files in `~/.pomodoro/hooks/` named `start`, `stop` and `break`, if they are there.

[PRIVACY.md](PRIVACY.md) is the same as a privacy policy, with what reaches Claude and how to take your data off.

### Hooks

Its hooks are in `hooks/register.tsx`, with the report pane's drawing in `hooks/report.tsx`:

- `session.start` registers the `/pomodoro` command (and with Tools for Claude on, the two tools), and starts the one-second tick that reads the shared timer, then passes the event on unchanged.
- `command.run` answers only the `/pomodoro` command. Other commands never reach it.
- `prompt.submit` reads where a prompt came from; one of yours begins a round that waits on you and is counted into the round. It passes the prompt on unchanged.
- `turn.start` notes that Claude is working and begins a break that was due, then passes the event on unchanged.
- `turn.complete` and `classic.Notification` note Claude's working time and show the toast during a break: the first when Claude's turn ends, the second when Claude Code notifies you that it waits on you. Both pass the event on unchanged and decide nothing.
- `tool.call`, with Tools for Claude on, answers only the mod's own two tools.
- `ui.render` adds the timer's label to the end of the hint line, after what the line already holds, and on the desktop app to the mode labels beside it; the hint itself and the other labels stay as they are. Where there is a pointer it draws the timer's row under the line instead, keeping what other mods drew. It also draws the report pane, and only that pane.

The files under `tests/` run only under `claude plugin test`, and are never loaded in a session.

## Develop

```sh
git clone https://github.com/barisdemirhan/claude-pomodoro
claude plugin validate claude-pomodoro
claude plugin test claude-pomodoro
claude --plugin-dir claude-pomodoro
```

`hooks/register.tsx` holds the hooks that tie the mod to Claude Code, and every call it makes on Claude Code: the engine follows `$` into no function of another file. The other files are plain functions it calls:

- `hooks/timer.ts`: the timer itself, told from the clock alone.
- `hooks/history.ts`: the rounds kept, and the stats and log told from them.
- `hooks/insights.ts` and `hooks/report.tsx`: the report pane's numbers and its drawing.
- `hooks/export.ts`: the rounds as JSON, CSV and iCalendar.
- `hooks/openpomodoro.ts` and `hooks/automation.ts`: the Open Pomodoro format, and the paths, variables and file contents the two Open Pomodoro settings need.
- `hooks/tools.ts`: the tools Claude reads, as it reads them.
- `hooks/values.ts`: readers for what the store hands back.

## More mods

From the same marketplace, [claude-mods](https://github.com/barisdemirhan/claude-mods):

- [ambient](https://github.com/barisdemirhan/claude-ambient): a living band above the prompt, with sound, fed by Claude's work.
- [dino](https://github.com/barisdemirhan/claude-dino): a T-Rex runner in a pane, with Claude's tool calls as the obstacles.
- [tycoon](https://github.com/barisdemirhan/claude-tycoon): Token Tycoon, an idle game where Claude's tool calls earn the money.

## License

MIT
