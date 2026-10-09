import {sqliteTable, text, index, primaryKey} from 'drizzle-orm/sqlite-core';

export const auditRuns = sqliteTable('audit_runs', {
  id:text('id').primaryKey(), userId:text('user_id').notNull(),
  startedAt:text('started_at').notNull(), completedAt:text('completed_at'),
  status:text('status').notNull(), mode:text('mode').notNull(), origin:text('origin').notNull(),
  source:text('source').notNull(), symbolsJson:text('symbols_json').notNull(),
  settingsJson:text('settings_json').notNull(), requestHash:text('request_hash').notNull(),
  engineVersion:text('engine_version').notNull()
}, table=>[index('idx_audit_runs_user_started').on(table.userId,table.startedAt,table.id)]);

export const auditResults = sqliteTable('audit_results', {
  runId:text('run_id').notNull().references(()=>auditRuns.id), symbol:text('symbol').notNull(),
  recordedAt:text('recorded_at').notNull(), status:text('status').notNull(),
  recommendation:text('recommendation').notNull(), asOf:text('as_of'),
  inputHash:text('input_hash').notNull(), payloadHash:text('payload_hash').notNull(),
  payloadJson:text('payload_json').notNull()
}, table=>[primaryKey({columns:[table.runId,table.symbol]}),index('idx_audit_results_run_recommendation').on(table.runId,table.recommendation)]);

export const marketProfiles = sqliteTable('market_profiles', {
  userId:text('user_id').notNull(),symbol:text('symbol').notNull(),
  contextJson:text('context_json').notNull(),updatedAt:text('updated_at').notNull()
}, table=>[primaryKey({columns:[table.userId,table.symbol]})]);

export const personalPortfolios = sqliteTable('personal_portfolios', {
  userId:text('user_id').primaryKey(),portfolioJson:text('portfolio_json').notNull(),updatedAt:text('updated_at').notNull()
});

export const dataReconciliations = sqliteTable('data_reconciliations', {
  id:text('id').primaryKey(),userId:text('user_id').notNull(),symbol:text('symbol').notNull(),
  createdAt:text('created_at').notNull(),status:text('status').notNull(),mode:text('mode').notNull(),
  fromDate:text('from_date').notNull(),toDate:text('to_date').notNull(),
  requestHash:text('request_hash').notNull(),payloadHash:text('payload_hash').notNull(),payloadJson:text('payload_json').notNull()
}, table=>[index('idx_reconciliation_user_symbol_date').on(table.userId,table.symbol,table.createdAt,table.id)]);

export const evidenceObservations = sqliteTable('evidence_observations', {
  userId:text('user_id').notNull(),runId:text('run_id').notNull().references(()=>auditRuns.id),symbol:text('symbol').notNull(),
  recordedAt:text('recorded_at').notNull(),originDate:text('origin_date').notNull(),status:text('status').notNull(),
  configJson:text('config_json').notNull(),outcomeJson:text('outcome_json'),updatedAt:text('updated_at').notNull()
}, table=>[primaryKey({columns:[table.runId,table.symbol]}),index('idx_evidence_user_symbol_status').on(table.userId,table.symbol,table.status),index('idx_evidence_user_recorded').on(table.userId,table.recordedAt)]);
