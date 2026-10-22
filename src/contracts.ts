import { z } from 'zod';
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/);
export const money = z.object({currency:z.string().regex(/^[A-Z]{3}$/),amount:z.number().int().nonnegative().max(1e12)}).strict();
export const actionSchema = z.object({
  id, agentId:id, sessionId:id, category:z.enum(['filesystem','shell','http','subagent']),
  operation:z.enum(['read','write','run','request','launch']),
  parameters:z.object({path:z.string().max(4096).optional(),content:z.string().max(1024*1024).optional(),executable:z.string().max(4096).optional(),args:z.array(z.string().max(8192)).max(128).optional(),url:z.string().max(8192).optional(),method:z.enum(['GET','POST']).optional(),body:z.string().max(1024*1024).optional(),runner:id.optional(),childAgentId:id.optional()}).strict(),
  resourceScope:z.string().min(1).max(4096),timestamp:z.string().datetime(),requestedPermissions:z.array(z.string().max(80)).max(16),maxCost:money.optional(),expectedResultFormat:z.enum(['text','json']),
}).strict();
export type Action = z.infer<typeof actionSchema>;
export type State = 'SUBMITTED'|'ALLOWED'|'DENIED'|'PENDING_APPROVAL'|'APPROVED'|'EXECUTING'|'COMPLETED'|'FAILED'|'EXPIRED'|'CANCELLED';
export type RequestRecord = {action:Action;state:State;reason:string;createdAt:string;expiresAt:string;policyVersion:number;approvalToken?:string;result?:unknown};
export const policySchema=z.object({
  version:z.literal(1), default:z.enum(['allow','deny','approval']),
  workspace:z.string().min(1),filesystem:z.object({allow:z.array(z.string()),deny:z.array(z.string())}).strict(),
  commands:z.array(z.object({executable:z.string(),args:z.array(z.string())}).strict()),
  network:z.object({allow:z.array(z.string()),deny:z.array(z.string()),allowPrivate:z.boolean().default(false)}).strict(),
  limits:z.object({maxDurationMs:z.number().int().min(100).max(300000),approvalTtlMs:z.number().int().min(100).max(86400000),subagentConcurrency:z.number().int().min(0).max(32)}).strict(),
  budgets:z.array(z.object({sessionId:id,currency:z.string().regex(/^[A-Z]{3}$/),maximum:z.number().int().nonnegative().max(1e12)}).strict()),
  rules:z.array(z.object({id,agentId:id.optional(),sessionId:id.optional(),category:actionSchema.shape.category.optional(),operation:actionSchema.shape.operation.optional(),effect:z.enum(['allow','deny','approval'])}).strict()),
}).strict();
export type Policy=z.infer<typeof policySchema>;
