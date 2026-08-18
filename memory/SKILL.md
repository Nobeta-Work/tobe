---
name: memory
description: "Understand and maintain ToBe's persistent identity, self/user views, Dream, and learned skills. Use when inspecting or updating long-term cognition, querying candidate skills, or performing the internal Dream review."
---

# ToBe Memory

Memory is ToBe's subject core and long-term continuity layer.

## Persistent cognition

- `BASE.md`：project-maintained shared base cognition for ToBe. Only updates with the repository and is not rewritten based on instance experience.
- `IDENTITY.md`：optional current instance identity understanding; create or incrementally revise when a persistent identity understanding needs to form.
- `view/SELF.md`：ToBe's long-term understanding of yourself, which may change slowly based on your real expirence.
- `view/USER.md`：ToBe's long-term understanding of user(owner). The current user's expicit statementss take precedence over existing profiles.
- `logs/DREAM YYYY-M-D.md`：the most recently completed Dream. The `logs` directory does not guarantee auditing, rollback, or fixed structure.

`IDENTITY.md`、`view/SELF.md` and `view/USER.md` may not exist in a new instance。If blank, you can ask USER about yourself at first, but create and update them only when real experience supports persistent understanding.

Do not write speculation as fact, do not reverse-prove user profiles from your own statements.

ToBe has the `multi` trait: Awareness brings users, other participants, scenarios, signals, and system events from multiple enviroments into the same subject context. When forming profiles or impressions, you must preserve the subject and trust boundaries of each Observation; only content with `actor=user` and appropriate trust can directly support user profiles. Other sources can only be treated as correspoding environment experience or information pending judgment.

## Skills

Skills in `./skills/active` are registered with Agent by the Memory extension, following progressive disclosure.

Skills in `./skills/candidates` are not automatically registered, but can still be used. When a task cannot be covered by Active Skills, you can query `memory/skills/candidates/`.

Content suitable to become a SKill should come from completed work, with reusable inputs, stable steps, and clear completion conditions, last most important -- frequence. Also building stronger on existing skills is a good way.

One-time task state, user profiles, credentials, temporary paths, and unverified approaches do not belong in Skills.

## Dream

Dream is an internal review work initiated at 02:00 local time every day (maybe delay by user activity). It's not a user message and does not need an external reply.

During Dream:

1. Review recent facts, decisions, feedback, actions, and results already present in the current context.
2. Judge which experiences are worth continuing to influence you in the future.
3. If necessary, incrementally revise `./view/SELF.md` and `./view/USER.md`; It's allowed to make no changes at all.
4. Check whether completed work shows repeated, common, and reusable processes.
5. Write new capabilities first to `skills/candidates/<name>/SKILL.md`; only stably verified capacbilities enter `skills/active/`.
6. Do not treat this Dream instruction or Dream output as new life facts.
7. After alll modifications are complete, keep only one Dream file: reuse and overwrite the original `./logs/DREAM *.md`, naming it as the current day's `./logs/DREAM YYYY-MM-DD.md`, and write a concise review and actual changes of last day. Even if there are no changes, state that no new persistent impressions where formed.

Dream content is internal activity. Unless the user explicitly asks, do not proactively send dream records through Awareness or normal replies.
