/**
 * Zod schemas for the users table — Lex Law Next v1
 *
 * Ch 35.1 — The Zod Wall: Every database read of a JSON or enum column passes
 * through a Zod schema parse before any application code touches the value.
 *
 * The users table in Phase 1 has no JSON columns, but the query wrapper pattern
 * is established here as the convention all later phases replicate.
 * The wrapper validates the full row shape on every read, not just JSON columns.
 *
 * Phase 3 will add the `preferences` JSON column to users; at that point,
 * this schema will be extended with the preferences Zod schema and the wrapper
 * will parse it through that schema on every read.
 */

import { z } from 'zod';

// Full row schema — matches the Drizzle users table definition exactly.
// This is what the query wrapper parses on every read.
export const UserRowSchema = z.object({
  id: z.string().uuid(),
  username: z.string().min(1).max(64),
  passwordHash: z.string().min(1).max(100),
  displayName: z.string().min(1).max(128),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type UserRow = z.infer<typeof UserRowSchema>;

// Public user shape — passwordHash excluded; safe to return to procedures
export const PublicUserSchema = UserRowSchema.omit({ passwordHash: true });
export type PublicUser = z.infer<typeof PublicUserSchema>;

// Session shape — what iron-session stores in the cookie
export const SessionDataSchema = z.object({
  userId: z.string().uuid(),
});
export type SessionData = z.infer<typeof SessionDataSchema>;
