# Privacy

What the Pomodoro mod for Claude Code does with data. Last changed on 5 October 2026.

## Out of the box

Nothing leaves your machine. The mod makes no network request, and has no server, no account and no analytics. Nothing is sent to the author of this mod.

Of Claude's work it reads only when a turn starts and ends and how long it ran, and when Claude Code notifies you that it waits on a permission or a question. Of your prompts it reads only where each came from, to tell yours from a schedule's or another session's. It reads nothing of a prompt's text, a tool call or an answer. It asks Claude Code for the name of the repository or folder a session works in.

In the plugin's own Claude Code store, on your disk, it keeps:

- The timer: its phase, when it began, how long it runs, and what you said the rounds are for, with their tags.
- Your rounds: when each began and ended, how long it was focused, whether it was done or stopped, what it was for and its tags, the names of the repositories or folders worked in, how long Claude worked inside it and how many prompts you sent. Rounds older than 400 days are folded into a total per day.
- What the running round gathered so far in each open session, under a random id that session makes when it starts.
- When you last sent a prompt, the rounds lately ended, what `/pomodoro undo` would take back, whether the sound is off, whether the row of buttons is closed and whether you closed it all with `/pomodoro close`.

## What reaches Claude

What `/pomodoro` answers is a row of the conversation, as any command's output is: `/pomodoro stats` and `/pomodoro log` show your rounds' labels, tags and project names there, and Claude reads them with the rest of the conversation, which Claude Code sends to the model as it sends everything else in it.

With **Tools for Claude** on (it is off until you turn it on), Claude can call the mod's `stats` tool, and what it answers, the timer, your stats and one day's rounds, goes into the conversation the same way.

## What you turn on

Each of these is off until you turn it on in the plugin's settings, or until you ask for it:

- **Open Pomodoro files** reads `HOME` to find `~/.pomodoro`, and reads and writes `current` and `history` there: the start, length, description and tags of your focus rounds, in the Open Pomodoro format other tools on your machine read.
- **Hook scripts** runs the executables you keep in `~/.pomodoro/hooks/` named `start`, `stop` and `break`, and hands them the phase, the round, the minutes, what the round is for and its tags. What your scripts do with them is up to them.
- `/pomodoro export` copies your rounds to the clipboard, or writes them to the file you name.

## Taking your data off

What the mod keeps on your machine is one JSON file, the plugin's store: `~/.claude/plugins/store/pomodoro_<marketplace>-<id>.json`, which is `pomodoro_claude-mods-cf0e3c48f8c2.json` when installed from `claude-mods`. That is where Claude Code 2.1.288 keeps it; the place is Claude Code's own and may change with it. Deleting the file with no session open takes it all off.

With Open Pomodoro files on, there is also `~/.pomodoro`, which is yours to keep or delete, and any file `/pomodoro export` wrote where you named it.

If something here is unclear or wrong, [open an issue](https://github.com/barisdemirhan/claude-pomodoro/issues). To report a security problem in private, see [SECURITY.md](SECURITY.md).

## Changes

This file's history in the repository is the record of what changed and when.
