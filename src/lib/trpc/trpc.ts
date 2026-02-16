import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { getCurrentUser } from "@/lib/auth";
import type { User } from "@/database";

export type TRPCContext = {
  user: Omit<User, "password_hash"> | null;
};

export async function createContext(): Promise<TRPCContext> {
  const user = await getCurrentUser();
  return { user };
}

const t = initTRPC.context<TRPCContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

export const authedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authenticated" });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});
