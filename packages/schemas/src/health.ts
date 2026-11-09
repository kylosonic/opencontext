import { z } from "zod";

export const READINESS_ENVIRONMENTS = [
  "production",
  "preview",
  "development",
] as const;

export const READINESS_CHECK_IDS = [
  "database",
  "auth",
  "storage",
  "worker",
  "publicUrl",
  "rateLimit",
] as const;

export const ReadinessEnvironmentSchema = z.enum(READINESS_ENVIRONMENTS);
export const ReadinessCheckIdSchema = z.enum(READINESS_CHECK_IDS);

export const ReadinessCheckSchema = z.object({
  id: ReadinessCheckIdSchema,
  ok: z.boolean(),
  detail: z.string(),
});

export const ReadinessResponseSchema = z
  .object({
    ready: z.boolean(),
    environment: ReadinessEnvironmentSchema,
    checks: z.array(ReadinessCheckSchema),
    checkedAt: z.string().datetime(),
  })
  .superRefine((value, context) => {
    if (value.ready !== value.checks.every((check) => check.ok)) {
      context.addIssue({
        code: "custom",
        path: ["ready"],
        message: "ready must match the aggregate of all readiness checks",
      });
    }
  });

export type DeploymentEnvironment = z.infer<typeof ReadinessEnvironmentSchema>;
export type ReadinessCheckId = z.infer<typeof ReadinessCheckIdSchema>;
export type ReadinessCheck = z.infer<typeof ReadinessCheckSchema>;
export type ReadinessResponse = z.infer<typeof ReadinessResponseSchema>;
