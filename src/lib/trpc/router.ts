import { router } from "./trpc";
import { providersRouter } from "./routers/providers";
import { systemRouter } from "./routers/system";

export const appRouter = router({
  providers: providersRouter,
  system: systemRouter,
});

export type AppRouter = typeof appRouter;
