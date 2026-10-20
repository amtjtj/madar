# 0022 — Internal chat

- Status: Accepted
- Date: 2026-10-20

## Context
Phase 2, step 15a (`docs/plans/phase-2-step-15a.md`), from the team review (`docs/feedback/1405-07-27-team-review.md`, section 10) and `docs/architecture.md` §10.6. People want to talk to a colleague, a small group and their project team without leaving Madar for a foreign messenger. Letters (ADR 0020) are formal and numbered. Chat is the quick, informal channel. Attachments, mentions, reactions, search, pinning a message to a task and chat export come in step 15b.

## Decision
- **Four kinds, one table.** `conversations.kind` is `project`, `department`, `direct` or `group`. A check constraint fixes which columns each kind uses:
  - `project_id` for a project channel;
  - `department_id` for a department channel;
  - `direct_key` (the two member ids, sorted) for a direct conversation;
  - `title` for a group.

  Unique keys make one channel per project and department, and one direct conversation per pair. Opening a direct conversation again returns the old one.
- **Channels follow their source.** A project channel is created with the project (`chat/channels.ts`, inside `ProjectsService.create`), and a department channel with the department. Migration `0018_chat` backfills both.
  - Membership is read from `project_members` and `department_memberships`, never copied. Adding someone to a project gives them the channel and its history at once; removing them takes it away at once.
  - For channels, `conversation_members` holds only personal state (read mark, muted). It is created on first use.
- **Who sees** is one SQL rule, `visibleConversations()` in `apps/api/src/chat/access.ts`, used for every read, including notifications (`Notifier.canSee`):
  - a project channel: the project's members, observers included;
  - a department channel: the department's members, viewers included;
  - direct and group: current members (`left_at is null`).

  No role or permission is an exception. Owners, admins, department managers and overseeing departments do not see conversations they are not in, including channels of projects they could otherwise see (product owner, answer 5).
- **Who writes** is `postableConversations()`: the same rule, minus project observers and department viewers, and only while the project is active and the department is not archived. A read-only tenant cannot post (the existing write guard). This also blocks moving the read mark, because that is a POST; accepted, since a suspended company only reads.
- **Groups.** The creator owns the group (up to 50 members). Any member may add people. Only the owner renames it or removes members. Anyone may leave. If the owner leaves, ownership passes to the member who joined first. Leaving sets `left_at`, so history stays and the person can be added again.
  - **History belongs to the conversation.** A current member reads all of it, as in a project channel. That includes someone who joins later, and someone added back after leaving or being removed, who also sees what was said while they were away. A work group is a shared space, not a set of private letters. The add-members box says so in its hint, so nobody adds a person without knowing. People wanting a fresh start create a new group. A re-added member starts with nothing unread and is notified again for new messages (the notification dedupe key includes their join time).
- **Messages.**
  - Plain text up to 4000 characters, rendered as React text. Only `http`/`https` links become links (`messageSegments` in `@madar/shared`). No HTML, no markdown.
  - The author may edit or delete for 15 minutes (`canStillEdit`).
  - Delete is soft: the body is cleared in the database, and «این پیام حذف شد» stays.
  - A reply points to a message in the same conversation. The schema enforces it: the reply FK is `(tenant_id, conversation_id, reply_to_id)`. The API shows a quote only from the same conversation.
  - The app role has no DELETE on any chat table.
- **Ids are UUIDv7**, so «newer» is «larger id».
  - Pages go by id (`before` / `after`), with the index `(tenant_id, conversation_id, id)`.
  - Unread is «messages from others with an id above my read mark». Without a read mark, it is messages since I joined, so a new project member does not get the whole history as unread.
  - The read mark only moves forward. Moving it also marks that conversation's `chat_message` notifications read.
- **Live delivery: to people, not conversation rooms.** This changes plan §3. The API computes the audience (`audienceOf()`, active members only) in the same transaction as the write. After commit it emits the message to each member's personal room (`RealtimePublisher.toMembers`).
  - This is the one realtime event that carries data (`chat:message`), an exception to ADR 0011's data-free hints. It goes only to people the access rule allows at that moment.
  - Conversation rooms with a `chat:join` step would need sockets moved out at the instant someone leaves a project, a department or a group, from every code path that changes membership. A forgotten path would leak messages. Computing the audience per message has no such state to get wrong.
  - The cost is one audience query per message, which is fine for companies of a few hundred people.
  - The client refreshes the list and the unread count when a `chat:message` arrives, so a message needs no second hint. The unread count has its own single query, because it runs after every message.
  - A data-free `chat.changed` hint is sent for membership and name changes: groups (add, remove, leave, rename) and project members (from the realtime consumer). Department membership changes send no event yet; the list catches up on the next refetch (focus or navigation).
- **Notifications** (`chat_message`) are only for direct and group conversations; channels show unread counts only (product owner, question 1). They come from the `message.created` event through `Notifier`, so quiet hours and muted kinds apply. Muted conversations are skipped.
  - One notification per recipient until they read: the dedupe key is `chat:{conversation}:{read mark}`, so a busy group does not flood the bell.
  - The push payload has no text (ADR 0012): «پیام تازه‌ای در گفت‌وگوهایت داری».
- **Rate limit:** 30 messages a minute per person.
- **Screens.**
  - `/chat` shows the list, with tabs for all, teams, and direct and groups.
  - `/chat/:id` is the conversation. Desktop shows both columns; phones show one at a time.
  - Chat sits in the sidebar with its unread count. On phones it sits in the header next to letters and the bell (product owner, question 2).
  - A project page has «گفت‌وگوی تیم» for its members.

## Alternatives considered
- **Copying channel members into `conversation_members`:** two sources of truth that drift whenever a project or department changes from any of its code paths. Reading the source tables keeps the channel exactly in step.
- **Conversation rooms with join and leave:** described above. Safer only if every membership change also moved sockets, and that is easy to miss.
- **Owners and managers reading every conversation:** it would make direct messages unsafe to use and conflicts with the privacy promise; audit and export of chat for legal needs is a separate, audited feature in 15b.
- **Notifying every channel message:** a 30-person channel would drown the bell. Channel mentions come with 15b.
- **A foreign or separate chat server (Matrix, Rocket.Chat):** a second user database, another permission model and another thing to host and back up. Chat has to follow Madar's projects, departments and tenant isolation, so it lives in the core.
