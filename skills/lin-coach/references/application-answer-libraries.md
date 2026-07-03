# Application answer libraries — full-text file storage & recall

When the user provides pre-written application answers (e.g. "save for Runway:", "save for Siena AI:"), store them as **full-text markdown files** under `~/.hermes/profiles/lin/home/applications/`. These are distinct from `lin-coach` `answer` drafts — the user wrote these themselves.

**The user's explicit preference (corrected Jun '26): memory-only compression was insufficient. Save full verbatim text to file.**

## Storage pattern

1. **Write full text to file:**
   - Path: `~/.hermes/profiles/lin/home/applications/{company}-answers.md`
   - Format: markdown with company name + date as H1 header, each original question as H2 section, verbatim answer text below
   - Create the `applications/` dir if absent
2. **One-line memory pointer:**
   - `{Company} app: ~/.../applications/{company}-answers.md`
   - That's it — just enough to locate the file later. No prose, no metrics.
3. **When memory is full:**
   - Compress existing app-answer memory entries to one-liners (`{Company} app: ~/.../applications/{company}-answers.md`)
   - The full text is safe on disk; memory only needs to say where it is

## Recall flow

When the user asks "get me the X answers" or "redraft the [Company] answers":
1. Read the memory pointer to get the file path
2. Read the file with `read_file` to retrieve full verbatim text
3. If the file doesn't exist (ancient entry from before the pattern changed), fall back to drafting fresh from stored memory hooks

## Relation to `lin-coach` `answer <slug>` 

The `answer` verb drafts new answers from the JD + career profile + user's CV evidence. Curated answer libraries are user-supplied text that gets stored for later use/submission. If the user asks to **revise** a stored answer, use the library entry as context for a new `answer`-style draft.
