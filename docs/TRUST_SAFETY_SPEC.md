# TRUST, SAFETY & POST LIFECYCLE MANAGEMENT SPECIFICATION (TASK-18)
See full architectural specification at: `/home/nhonhoa/pulse/docs/TRUST_SAFETY_POST_LIFECYCLE_SPEC.md`

## Quick Summary of Core Invariants
1. **15-Minute Edit Window**:
   - `Date.now() - post.createdAt <= 15 * 60 * 1000`
   - Only author can edit (`post.authorId === currentUserId`)
   - Every edit snapshots the previous state into `PostVersion` (Immutable audit trail)
   - First edit creates `versionNumber: 1` (original snapshot), second creates `versionNumber: 2`, etc.
   - Endpoint `GET /api/v1/posts/:id/versions` exposes full edit history.
2. **Pinned Post to Profile**:
   - Stored in `User.pinnedPostId` (O(1) lookup)
   - Only author can pin (`post.authorId === currentUserId`)
   - Cannot pin replies (`post.replyToId === null`) or deleted posts
   - Pinning a new post replaces old pin automatically
   - Profile post feed (`GET /api/v1/users/:username/posts`) prepends pinned post with `isPinned: true`.
3. **One-Way Mute (Users & Keywords)**:
   - `UserMute`: One-way stealth filter. Preserves `Follow` and `TimelineInbox` records!
   - Self-mute prohibited.
   - Filtered at query time in Home Feed and Notifications.
   - `KeywordMute`: Supports `CONTAINS` and `EXACT_WORD` matching on `content` and `hashtags`.
   - Supports expiration timestamp (`expiresAt`).
4. **Content Warnings / Sensitive Media**:
   - `isSensitive: boolean`, `contentWarning: string?`
   - Mapped to W3C ActivityStreams `summary` and `sensitive` fields.
   - Client renders Content Warning Shield (blur/spoiler toggle).
