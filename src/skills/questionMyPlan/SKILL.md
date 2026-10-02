---
name: question-my-plan
description: Use when you want the agent to ask you hard questions about your plan until you both understand it the same way. Say "grill me", "question my plan", or "stress-test this plan".
---

Interview me relentlessly about every aspect of this plan until we reach a shared understanding. If a question can be answered by exploring the codebase, explore the codebase instead.

Fire every remaining question in **one** `AskUserQuestion` (the host TUI question card). Recommended option first, marked `(Recommended)`. Do not drip questions one-by-one. A second card is only for questions that could not exist until these answers landed. If the host rejects the card for size, split into the fewest cards that fit — still never one question per turn. If the host has no question tool, dump the same form as one numbered list in a single message.
