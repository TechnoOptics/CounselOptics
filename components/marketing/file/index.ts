export * from './type';
export { Band } from './Band';
export { FilePage } from './FilePage';
export { Section } from './Section';
export { Sheet, SheetRow, Stamp } from './Sheet';
export { Definitions } from './Definitions';
export { Schedule } from './Schedule';
export type { ScheduleColumn, ScheduleRow } from './Schedule';
export { Memo } from './Memo';
export { Entry } from './Entry';
export { Prose } from './Prose';

// Screen (components/marketing/file/Screen.tsx) is deliberately NOT
// re-exported here. It reads node:fs and node:path at module scope, and
// this barrel is imported by client components for their pure string
// roles alone (e.g. components/EnterpriseInquiryForm.tsx imports only
// BUTTON_INK, FOCUS, LABEL, LINK). A re-export here still puts Screen in
// the same module graph, so `next build` tried to bundle node:fs for the
// browser and failed with "UnhandledSchemeError: Reading from node:fs is
// not handled by plugins" before webpack ever got to tree-shake the
// unused name. Screen is imported from its own file instead:
// `import { Screen } from '@/components/marketing/file/Screen'`.
