/** Room names always start with the tenant; only the server puts sockets in rooms. */
export const memberRoom = (tenantId: string, memberId: string) => `t:${tenantId}:m:${memberId}`;
export const departmentRoom = (tenantId: string, departmentId: string) =>
  `t:${tenantId}:d:${departmentId}`;
export const projectRoom = (tenantId: string, projectId: string) => `t:${tenantId}:p:${projectId}`;
/** Everyone in the tenant (tasks of company-wide projects). */
export const everyoneRoom = (tenantId: string) => `t:${tenantId}:all`;
/** Members who read tasks company-wide (owner, executives, oversight departments). */
export const readersRoom = (tenantId: string) => `t:${tenantId}:readers`;
